// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { StreamClient } from '@stream-io/node-sdk';

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
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'getstream-server', time: new Date().toISOString() });
});
app.get('/', (_req, res) => {
  res.send('Server running. POST /create-user { userId, name } to get token.');
});

// ⚠️ Tăng timeout lên 15s (hoặc theo env)
const STREAM_TIMEOUT_MS = Number(process.env.STREAM_TIMEOUT_MS || 15000);
const stream = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET, { timeout: STREAM_TIMEOUT_MS }); // ← quan trọng

// ---- Helper retry với backoff ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, { tries = 3, baseDelay = 600, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = String(e?.message || '');
      // nếu là timeout hoặc lỗi mạng thì thử lại
      if (i < tries - 1 && (msg.includes('timeout') || !e?.metadata?.responseCode)) {
        const wait = baseDelay * Math.pow(2, i); // 600ms, 1200ms, 2400ms
        console.warn(`⚠️ ${label} failed (try ${i + 1}/${tries}): ${msg}. Retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

// --- tạo/ cập nhật Call Type "default" (idempotent + retry)
async function ensureCallType() {
  const callTypeName = 'default';
  const payload = {
    name: callTypeName,
    settings: {
      audio: {
        mic_default_on: true,
        speaker_default_on: true,
        default_device: 'speaker',
      },
      video: {
        enabled: true,
        camera_default_on: true,
        camera_facing: 'front',
        target_resolution: { width: 640, height: 480 },
      },
    },
    grants: {
      admin: ['send-audio', 'send-video', 'mute-users'],
      user:  ['send-audio', 'send-video'],
    },
  };

  // Nếu tồn tại → update, nếu 404 → create (cả hai đều có retry + backoff)
  try {
    await withRetry(
      () => stream.video.getCallType({ name: callTypeName }),
      { label: 'getCallType' }
    );
    await withRetry(
      () => stream.video.updateCallType(payload),
      { label: 'updateCallType' }
    );
    console.log(`♻️ Updated call type "${callTypeName}"`);
  } catch (e) {
    const isNotFound = e?.metadata?.responseCode === 404 || String(e?.message || '').includes('not found');
    if (isNotFound) {
      await withRetry(
        () => stream.video.createCallType(payload),
        { label: 'createCallType' }
      );
      console.log(`✅ Created call type "${callTypeName}"`);
    } else {
      // Không kill server vì timeout/ mạng chập chờn — chỉ cảnh báo
      console.warn('⚠️ CallType setup warning (server will still start):', e?.message || e);
    }
  }
}

// --- cấp token người dùng
app.post('/create-user', async (req, res) => {
  try {
    const { userId, name } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required in the request body' });
    }

    // TTL tính bằng giây (ưu tiên env TOKEN_TTL_SECONDS, mặc định 3600)
    const ttlSeconds = parseInt(process.env.TOKEN_TTL_SECONDS || '3600', 10);
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;

    // Tạo token: tham số thứ 2 là exp (UNIX seconds)
    const token = stream.createToken(String(userId), exp);

    return res.json({
      apiKey: STREAM_API_KEY,
      token,
      userId: String(userId),
      name, // chỉ để trả về cho client, không nằm trong token
      issuedAt: new Date(now * 1000).toISOString(),
      expiresAt: new Date(exp * 1000).toISOString(),
      expiresInSeconds: ttlSeconds,
    });
  } catch (err) {
    console.error('Error creating token:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});


// optional: endpoint để chạy ensureCallType thủ công
app.post('/setup-call-type', async (_req, res) => {
  try {
    await ensureCallType();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

const port = process.env.PORT || 3000;

(async () => {
  try {
    // chạy setup nhưng không để fail server vì timeout
    await ensureCallType().catch(e => {
      console.warn('⚠️ ensureCallType on start failed:', e?.message || e);
    });
    app.listen(port, () => {
      console.log(`✅ Server listening on http://localhost:${port}`);
      console.log(`🔑 Using STREAM_API_KEY=${STREAM_API_KEY.slice(0, 6)}... (timeout=${STREAM_TIMEOUT_MS}ms)`);
    });
  } catch (e) {
    console.error('Failed to start server:', e);
    process.exit(1);
  }
})();
