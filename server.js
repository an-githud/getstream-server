// server.js
import express from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load env files
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

// simple request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'getstream-server', time: new Date().toISOString() });
});

// info
app.get('/', (_req, res) => {
  res.send('Server running. POST /create-user { userId, name } to get token.');
});

// issue JWT
app.post('/create-user', (req, res) => {
  try {
    const { userId, name } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required in the request body' });

    const payload = { user_id: String(userId) };
    if (name) payload.name = String(name);

    const expiresIn = process.env.TOKEN_TTL || '1h'; // đổi thời lượng tại env nếu muốn
    const token = jwt.sign(payload, STREAM_API_SECRET, {
      algorithm: 'HS256',
      expiresIn,
    });

    const now = Math.floor(Date.now() / 1000);
    // ước lượng exp ISO (chỉ để hiển thị)
    const expIso = new Date(
      (payload.exp || // nếu lib set exp vào payload
        (expiresIn.endsWith('h')
          ? now + parseInt(expiresIn) * 3600
          : expiresIn.endsWith('m')
          ? now + parseInt(expiresIn) * 60
          : now + 3600)) * 1000
    ).toISOString();

    return res.json({
      apiKey: STREAM_API_KEY,
      token,
      userId: String(userId),
      issuedAt: new Date(now * 1000).toISOString(),
      expiresAt: expIso,
      expiresIn,
    });
  } catch (err) {
    console.error('Error creating token:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token missing' });

  try {
    const decoded = jwt.verify(token, STREAM_API_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// protected route
app.get('/protected', authMiddleware, (req, res) => {
  res.json({ message: 'Access granted ✅', user: req.user });
});

// verify token via body
app.post('/verify', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    const decoded = jwt.verify(token, STREAM_API_SECRET, { algorithms: ['HS256'] });
    return res.json({ ok: true, payload: decoded });
  } catch (e) {
    return res.status(401).json({ ok: false, error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server listening on http://localhost:${port}`);
  console.log(`🔑 Using STREAM_API_KEY=${STREAM_API_KEY ? STREAM_API_KEY.slice(0, 6) + '...' : 'missing'}`);
});
