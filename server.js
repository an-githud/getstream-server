import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { StreamClient } from '@stream-io/node-sdk';

// Load env (Render sẽ lấy từ dashboard; dòng này vẫn OK local)
dotenv.config({ path: 'stream_api.env' });

const app = express();
app.use(bodyParser.json());

// Log request khi không ở production
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

// Config
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

// ===== In-memory lock theo callId (1 instance). Nhiều instance → dùng Redis/Redlock.
const locks = new Map();
/** Đảm bảo các thao tác trên cùng 1 key chạy tuần tự */
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const p = new Promise((r) => (release = r));
  locks.set(key, prev.then(() => p));
  // chạy fn sau prev; luôn release khi xong để chuỗi tiếp
  return prev.then(fn).finally(() => release());
}

// ===== Helpers: chuẩn hoá ID hợp lệ cho Stream (a-z, 0-9, _-)
function safeId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

// Tạo callId ổn định cho DM, KHÔNG dùng dấu ":" (không hợp lệ)
function dmCallId(a, b) {
  const [x, y] = [safeId(a), safeId(b)].sort();
  return `dm_${x}__${y}`;
}

// Health
app.get('/', (_req, res) => res.send('OK'));

/**
 * POST /token
 * Body:
 *  - mode: "dm" | "group"
 *  - userId: string
 *  - name?: string
 *  - peerId?: string (bắt buộc khi mode="dm")
 *  - callId?: string (bắt buộc khi mode="group")
 */
app.post('/token', async (req, res) => {
  const { userId, name, mode, callId: callIdRaw, peerId } = req.body || {};
  if (!userId || !mode) {
    return res.status(400).json({ error: 'invalid_body', message: 'userId & mode required' });
  }

  // Xác định callId & maxSeats
  let callId, maxSeats;
  if (mode === 'dm') {
    if (!peerId) {
      return res.status(400).json({ error: 'invalid_body', message: 'peerId required for dm' });
    }
    callId = dmCallId(userId, peerId);        // vd: dm_user123__user456
    maxSeats = MAX_SEATS_DM;
  } else if (mode === 'group') {
    if (!callIdRaw) {
      return res.status(400).json({ error: 'invalid_body', message: 'callId required for group' });
    }
    callId = safeId(callIdRaw);               // làm sạch luôn cho chắc
    maxSeats = MAX_SEATS_GROUP;
  } else {
    return res.status(400).json({ error: 'invalid_mode', message: 'mode must be "dm" or "group"' });
  }

  try {
    // (1) đảm bảo user tồn tại
    await client.upsertUsers([{ id: userId, name, role: 'user' }]);

    // (2) đảm bảo call tồn tại TRƯỚC khi query/update members
    const call = client.video.call(CALL_TYPE, callId);
    await call.getOrCreate({ data: { custom: { type: mode } } });

    // (3) Đếm & áp luật dưới lock
    const result = await withLock(`call:${callId}`, async () => {
      let total = 0, next;
      const existing = [];

      do {
        const page = await call.queryMembers({ limit: 100, next });
        total += page.members.length;
        existing.push(...page.members.map(m => m.user_id));
        next = page.next ?? undefined;
        if (total >= maxSeats) break;
      } while (next);

      if (mode === 'dm') {
        const allowed = new Set([userId, peerId]);
        const stranger = existing.find(u => !allowed.has(u));
        if (stranger) return { ok: false, code: 'dm_mismatch' };

        if (existing.length >= 2 && !existing.includes(userId)) {
          return { ok: false, code: 'room_full' };
        }
      }

      if (total >= maxSeats) return { ok: false, code: 'room_full' };

      // (4) cấp role cho caller (JOIN_CALL)
      await call.updateCallMembers({
        update_members: [{ user_id: userId, role: 'call_member' }],
      });

      return { ok: true };
    });

    if (!result.ok) {
      const code = result.code || 'room_full';
      const msg = code === 'dm_mismatch'
        ? 'Phòng 1-1 đã chứa thành viên không hợp lệ'
        : 'Phòng đã đủ người';
      return res.status(403).json({ error: code, message: msg });
    }

    // (5) phát token (1h)
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
