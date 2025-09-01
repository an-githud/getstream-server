import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { StreamClient } from '@stream-io/node-sdk';

// 🔧 Đọc env từ file hiện có của bạn
dotenv.config({ path: 'stream_api.env' });

const app = express();
app.use(bodyParser.json());

// 🔒 Không log body/headers ở production
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('→', req.method, req.url);
    if (req.body && Object.keys(req.body).length) {
      console.log('  body:', JSON.stringify(req.body));
    }
  }
  next();
});

// ⚙️ Config
const API_KEY = process.env.STREAM_API_KEY;
const API_SECRET = process.env.STREAM_API_SECRET;
const CALL_TYPE = process.env.CALL_TYPE || 'default';
const MAX_SEATS_GROUP = Number(process.env.MAX_SEATS_GROUP || 10); // nhóm
const MAX_SEATS_DM = Number(process.env.MAX_SEATS_DM || 2);       // 1-1
const PORT = Number(process.env.PORT || 3000);

if (!API_KEY || !API_SECRET) {
  throw new Error('Missing STREAM_API_KEY / STREAM_API_SECRET');
}

// 🧩 Stream client
const client = new StreamClient(API_KEY, API_SECRET);

// 🔐 In-memory lock theo callId (nếu nhiều instance → dùng Redis + Redlock)
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const p = new Promise((r) => (release = r));
  locks.set(key, prev.then(() => p));
  return prev.then(fn).finally(() => release());
}

// 🆔 Tạo callId ổn định cho DM (không phụ thuộc ai gọi ai)
function dmCallId(a, b) {
  const [x, y] = [String(a), String(b)].sort();
  return `dm:${x}:${y}`;
}

/**
 * POST /token
 * Body:
 *  - mode: "dm" | "group"
 *  - userId: string
 *  - name?: string
 *  - peerId?: string (bắt buộc khi mode="dm")
 *  - callId?: string (bắt buộc khi mode="group")
 *
 * Flow (cả 2 mode):
 *  1) upsert user
 *  2) (LOCK theo callId) queryMembers (phân trang) → kiểm tra luật:
 *      - dm: chỉ cho đúng 2 user của cặp; không cho người lạ; tối đa 2
 *      - group: tối đa MAX_SEATS_GROUP
 *  3) thêm user vào members với role 'call_member'
 *  4) phát token JWT cho user
 */
app.post('/token', async (req, res) => {
  const { userId, name, mode, callId: callIdRaw, peerId } = req.body || {};
  if (!userId || !mode) {
    return res.status(400).json({ error: 'invalid_body', message: 'userId & mode required' });
  }

  // Xác định callId & maxSeats
  let callId, maxSeats;
  if (mode === 'dm') {
    if (!peerId) return res.status(400).json({ error: 'invalid_body', message: 'peerId required for dm' });
    callId = dmCallId(userId, peerId);
    maxSeats = MAX_SEATS_DM; // 2
  } else if (mode === 'group') {
    if (!callIdRaw) return res.status(400).json({ error: 'invalid_body', message: 'callId required for group' });
    callId = String(callIdRaw);
    maxSeats = MAX_SEATS_GROUP; // 10 mặc định
  } else {
    return res.status(400).json({ error: 'invalid_mode', message: 'mode must be "dm" or "group"' });
  }

  try {
    // (1) đảm bảo user tồn tại
    await client.upsertUsers([{ id: userId, name, role: 'user' }]);

    const call = client.video.call(CALL_TYPE, callId);

    // (2) Đếm & áp luật dưới lock
    const result = await withLock(`call:${callId}`, async () => {
      let total = 0, next;
      const existing = [];

      do {
        const page = await call.queryMembers({ limit: 100, next }); // mặc định 25, tối đa 100
        total += page.members.length;
        existing.push(...page.members.map(m => m.user_id));
        next = page.next ?? undefined;
        if (total >= maxSeats) break;
      } while (next);

      if (mode === 'dm') {
        // chỉ cho đúng cặp (userId, peerId)
        const allowed = new Set([userId, peerId]);
        const stranger = existing.find(u => !allowed.has(u));
        if (stranger) return { ok: false, code: 'dm_mismatch' };

        // Nếu đã đủ 2 và người xin vào không thuộc cặp → chặn
        if (existing.length >= 2 && !existing.includes(userId)) {
          return { ok: false, code: 'room_full' };
        }
      }

      if (total >= maxSeats) {
        return { ok: false, code: 'room_full' };
      }

      // (3) Thêm/cập nhật role 'call_member' (để JOIN_CALL)
      await call.updateCallMembers({
        update_members: [{ user_id: userId, role: 'call_member' }],
      });

      return { ok: true };
    });

    if (!result.ok) {
      const code = result.code || 'room_full';
      const msg =
        code === 'dm_mismatch'
          ? 'Phòng 1-1 đã chứa thành viên không hợp lệ'
          : 'Phòng đã đủ người';
      return res.status(403).json({ error: code, message: msg });
    }

    // (4) phát token cho user (validity 1h)
    const token = client.generateUserToken({ user_id: userId, validity_in_seconds: 3600 });
    return res.json({ token, apiKey: API_KEY, callType: CALL_TYPE, callId, mode });
  } catch (err) {
    console.error('Token error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * (Tuỳ chọn) Route cũ để test tạo user/token "trần" không giới hạn.
 * Android NÊN dùng /token ở trên để được kiểm soát slot.
 */
app.post('/create-user', async (req, res) => {
  const { userId, name } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'invalid_body', message: 'userId required' });
  try {
    await client.upsertUsers([{ id: userId, name, role: 'user' }]);
    const token = client.generateUserToken({ user_id: userId, validity_in_seconds: 3600 });
    res.json({ token, apiKey: API_KEY });
  } catch (err) {
    console.error('GetStream error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Root route
app.get('/', (_req, res) => {
  res.send('OK');
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
