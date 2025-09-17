// server.js
import express from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { StreamClient } from '@stream-io/node-sdk'; // ✅ THÊM

dotenv.config();
dotenv.config({ path: './stream_api.env' });

const STREAM_API_KEY =
  process.env.STREAM_API_KEY || process.env.STREAM_KEY || process.env.STREAM_APIKEY;
const STREAM_API_SECRET =
  process.env.STREAM_API_SECRET || process.env.STREAM_SECRET || process.env.STREAM_APISECRET;

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error('\n❌ Missing Stream credentials. Add STREAM_API_KEY and STREAM_API_SECRET to .env or stream_api.env\n');
  process.exit(1);
}

const app = express();
app.use(express.json());

// ✅ Tạo server-side client ĐÚNG
const client = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET, {
  timeout: 15000,
});

// --- logger/health/create-user/verify ... (giữ nguyên phần cũ) ---

// ============== QUYỀN QUẢN LÝ PHÒNG NHÓM ==============
const CALL_TYPE_DEFAULT = 'call_nhom_chung';

// kiểm tra performer có quyền (host/manager)
async function isHostOrManager(callType, callId, performerId) {
  try {
    const call = client.video.call(callType, callId);      // ✅ ĐÚNG: client.video.call
    // 1) cố lấy membership (nếu đã được add vào members)
    const { members } = await call.queryMembers({ user_id: String(performerId) }, { limit: 1 });
    if (members?.length) {
      const role = members[0].role || 'user';
      // Gợi ý: dùng 'admin' mặc định để khỏi phải cấu hình role custom
      if (role === 'admin') return true;
      // Nếu bạn đã cấu hình role custom thì mở thêm:
      if (role === 'host' || role === 'moderator') return true;
    }
    // 2) fallback: đọc custom hostId/managerId
    const info = await call.get();
    const custom = info?.call?.custom || {};
    return String(performerId) === String(custom.hostId) || String(performerId) === String(custom.managerId);
  } catch {
    return false;
  }
}

/**
 * INIT: đăng ký host/manager cho 1 callId (gọi 1 lần trước khi nhóm call)
 * body: { callId, hostId, managerId?, callType? }
 */
app.post('/calls/group/init', async (req, res) => {
  try {
    const {
      callId,
      callType = CALL_TYPE_DEFAULT,
      hostId,
      managerId = null,
    } = req.body || {};
    if (!callId || !hostId) {
      return res.status(400).json({ error: 'callId and hostId are required' });
    }

    const call = client.video.call(callType, String(callId));          // ✅

    // (khuyến nghị) bảo đảm user tồn tại trước khi add vào members:
    await client.upsertUsers([
      { id: String(hostId), role: 'user', name: 'host' },
      ...(managerId ? [{ id: String(managerId), role: 'user', name: 'manager' }] : []),
    ]);

    // ✅ getOrCreate PHẢI gói dưới "data"
    await call.getOrCreate({
      data: {
        created_by_id: String(hostId),
        custom: { hostId: String(hostId), managerId: managerId ? String(managerId) : null },
        // dùng role 'admin' sẵn có để có quyền quản trị, đỡ phải cấu hình role mới
        members: [
          { user_id: String(hostId), role: 'admin' },
          ...(managerId ? [{ user_id: String(managerId), role: 'admin' }] : []),
        ],
      },
    });

    return res.json({ ok: true, callType, callId: String(callId), hostId: String(hostId), managerId: managerId ? String(managerId) : null });
  } catch (err) {
    console.error('group/init failed:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * KICK: chỉ host/manager mới được phép
 * body: { callId, performerId, targetUserId, callType? }
 */
app.post('/calls/group/kick', async (req, res) => {
  try {
    const { callId, performerId, targetUserId, callType = CALL_TYPE_DEFAULT } = req.body || {};
    if (!callId || !performerId || !targetUserId) {
      return res.status(400).json({ error: 'callId, performerId, targetUserId are required' });
    }

    const allowed = await isHostOrManager(callType, String(callId), String(performerId));
    if (!allowed) return res.status(403).json({ error: 'not_allowed' });

    const call = client.video.call(callType, String(callId));          // ✅
    await call.kickUser({ user_id: String(targetUserId) });            // ✅

    return res.json({ ok: true });
  } catch (err) {
    console.error('group/kick failed:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * BLOCK (tùy chọn): cấm vào lại
 */
app.post('/calls/group/block', async (req, res) => {
  try {
    const { callId, performerId, targetUserId, callType = CALL_TYPE_DEFAULT } = req.body || {};
    if (!callId || !performerId || !targetUserId) {
      return res.status(400).json({ error: 'callId, performerId, targetUserId are required' });
    }
    const allowed = await isHostOrManager(callType, String(callId), String(performerId));
    if (!allowed) return res.status(403).json({ error: 'not_allowed' });

    const call = client.video.call(callType, String(callId));          // ✅
    await call.blockUser({ user_id: String(targetUserId) });           // ✅

    return res.json({ ok: true });
  } catch (err) {
    console.error('group/block failed:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ... phần listen() giữ nguyên


/* ========================= */

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server listening on http://localhost:${port}`);
  console.log(`🔑 Using STREAM_API_KEY=${STREAM_API_KEY ? STREAM_API_KEY.slice(0, 6) + '...' : 'missing'}`);
});
