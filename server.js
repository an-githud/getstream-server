import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { StreamClient } from '@stream-io/node-sdk';

// Load env (local). Trên Render bạn set biến môi trường trong dashboard.
dotenv.config({ path: 'stream_api.env' });

const app = express();
app.use(bodyParser.json());

// Log gọn khi không ở production
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('→', req.method, req.url);
    if (req.body && Object.keys(req.body).length) {
      const safeBody = { ...req.body };
      if (safeBody.token) safeBody.token = '<hidden>';
      console.log('  body =', safeBody);
    }
  }
  next();
});

// ==== Config ====
const API_KEY = process.env.STREAM_API_KEY;
const API_SECRET = process.env.STREAM_API_SECRET;
const CALL_TYPE = process.env.CALL_TYPE || 'default';
const MAX_SEATS_GROUP = Number(process.env.MAX_SEATS_GROUP || 10);
const MAX_SEATS_DM = Number(process.env.MAX_SEATS_DM || 2);
const PORT = Number(process.env.PORT || 3000);

if (!API_KEY || !API_SECRET) {
  console.error('ENV CHECK:', { hasKey: !!API_KEY, hasSecret: !!API_SECRET });
  throw new Error('Missing STREAM_API_KEY / STREAM_API_SECRET');
}

const client = new StreamClient(API_KEY, API_SECRET);

// ==== In-memory lock (1 instance). Nhiều instance -> dùng Redis/Redlock. ====
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const p = new Promise((r) => (release = r));
  locks.set(key, prev.then(() => p));
  return prev.then(fn).finally(() => release());
}

// ==== Helpers: chuẩn hoá ID & tạo callId cho DM ====
function safeId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}
function dmCallId(a, b) {
  const [x, y] = [safeId(a), safeId(b)].sort();
  return `dm_${x}__${y}`; // không dùng dấu :
}

// Health check
app.get('/', (_req, res) => res.send('OK'));

/**
 * POST /token
 * Body:
 *  - mode: "dm" | "group"
 *  - userId: string
 *  - name?: string
 *  - peerId?: string (bắt buộc khi mode="dm")
 *  - callId?: string (bắt buộc khi mode="group")
 *
 * Trả về: { token, apiKey, callType, callId, mode, user }
 */
app.post('/token', async (req, res) => {
  const { userId, name, mode, callId: callIdRaw, peerId } = req.body || {};
  if (!userId || !mode) {
    return res.status(400).json({ error: 'invalid_body', message: 'userId & mode required' });
  }

  // Xác định callId + giới hạn chỗ
  let callId, maxSeats;
  if (mode === 'dm') {
    if (!peerId) {
      return res.status(400).json({ error: 'invalid_body', message: 'peerId required for dm' });
    }
    callId = dmCallId(userId, peerId);
    maxSeats = MAX_SEATS_DM;
  } else if (mode === 'group') {
    if (!callIdRaw) {
      return res.status(400).json({ error: 'invalid_body', message: 'callId required for group' });
    }
    callId = safeId(callIdRaw);
    maxSeats = MAX_SEATS_GROUP;
  } else {
    return res.status(400).json({ error: 'invalid_mode', message: 'mode must be "dm" or "group"' });
  }

  try {
    // (1) đảm bảo user (và peer trong chế độ DM) đã tồn tại
    const usersToUpsert = [{ id: userId, name, role: 'user' }];
    if (mode === 'dm') usersToUpsert.push({ id: peerId, role: 'user' });
    await client.upsertUsers(usersToUpsert);

    // (2) tạo/get call: PHẢI truyền created_by_id khi server-side auth
    const call = client.video.call(CALL_TYPE, callId);

    // Có thể set sẵn members lúc tạo (chỉ áp khi call mới).
    const initialMembers =
      mode === 'dm'
        ? [{ user_id: userId, role: 'call_member' }, { user_id: peerId }]
        : [{ user_id: userId, role: 'call_member' }];

    await call.getOrCreate({
      data: {
        created_by_id: userId,  // <-- quan trọng
        members: initialMembers,
        custom: { type: mode },
      },
    });

    // (3) kiểm tra & áp luật dưới lock (giới hạn số slot & đúng cặp trong DM)
    const result = await withLock(`call:${callId}`, async () => {
      let total = 0, next;
      const existing = [];

      do {
        const page = await call.queryMembers({ limit: 100, next });
        total += page.members.length;
        existing.push(...page.members.map((m) => m.user_id));
        next = page.next ?? undefined;
        if (total >= maxSeats) break;
      } while (next);

      const isMember = existing.includes(userId);

      if (mode === 'dm') {
        const allowed = new Set([userId, peerId]);
        const stranger = existing.find(u => !allowed.has(u));
        if (stranger) return { ok: false, code: 'dm_mismatch' };
      }

      // Chỉ chặn khi đã đủ chỗ VÀ người gọi không phải thành viên
      if (total >= maxSeats && !isMember) {
        return { ok: false, code: 'room_full' };
      }

      // (4) Bổ sung hoặc cập nhật role cho caller
      if (!isMember) {
        await call.updateCallMembers({
          add_members: [{ user_id: userId, role: 'call_member' }],
        });
      } else {
        await call.updateCallMembers({
          update_members: [{ user_id: userId, role: 'call_member' }],
        });
      }

      return { ok: true };
    });

    if (!result.ok) {
      const code = result.code || 'room_full';
      const msg = code === 'dm_mismatch'
        ? 'Phòng 1-1 đã chứa thành viên không hợp lệ'
        : 'Phòng đã đủ người';
      return res.status(403).json({ error: code, message: msg });
    }

    // (5) phát token cho user (1h)
    const token = client.generateUserToken({ user_id: userId, validity_in_seconds: 3600 });

    return res.json({
      token,
      apiKey: API_KEY,
      callType: CALL_TYPE,
      callId,
      mode,
      user: { id: userId, name },
    });
  } catch (err) {
    console.error('Token error:', {
      name: err?.name,
      message: err?.message,
      status: err?.status || err?.response?.status,
      data: err?.response?.data || err?.body,
    });
    const status = err?.status || err?.response?.status || 500;
    return res.status(status).json({ error: 'server_error', message: err?.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
