// server.js
import express from 'express';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load env files
dotenv.config();
dotenv.config({ path: './stream_api.env' });

const STREAM_API_KEY = process.env.STREAM_API_KEY || process.env.STREAM_KEY || process.env.STREAM_APIKEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET || process.env.STREAM_SECRET || process.env.STREAM_APISECRET;

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error('\nMissing Stream credentials. Add STREAM_API_KEY and STREAM_API_SECRET to .env or stream_api.env\n');
  process.exit(1);
}

const app = express();
app.use(bodyParser.json());

// simple request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  res.send('Server running. POST /create-user { userId, name } to get token.');
});

app.post('/create-user', (req, res) => {
  try {
    const { userId, name } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required in the request body' });

    const payload = { user_id: String(userId) };
    if (name) payload.name = String(name);

    // Create token with expiration (1 hour). Change '1h' to desired duration.
    const token = jwt.sign(payload, STREAM_API_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h' // <-- exp will be present in JWT
    });

    return res.json({ apiKey: STREAM_API_KEY, token, userId: String(userId) });
  } catch (err) {
    console.error('Error creating token:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});




const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`Using STREAM_API_KEY=${STREAM_API_KEY ? STREAM_API_KEY.slice(0,6) + '...' : 'missing'}`);
});
