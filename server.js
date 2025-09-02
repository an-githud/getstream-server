import express from 'express';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load environment variables from .env and also stream_api.env (if present)
dotenv.config();
// Try loading stream_api.env explicitly as many users keep credentials there
dotenv.config({ path: './stream_api.env' });

const STREAM_API_KEY = process.env.STREAM_API_KEY || process.env.STREAM_KEY || process.env.STREAM_APIKEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET || process.env.STREAM_SECRET || process.env.STREAM_APISECRET;

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error('\n\u274C Missing Stream credentials. Please add STREAM_API_KEY and STREAM_API_SECRET to a file named .env or stream_api.env in this project root.');
  console.error('Example (stream_api.env):');
  console.error('  STREAM_API_KEY=your_api_key');
  console.error('  STREAM_API_SECRET=your_api_secret\n');
  // Exit so the server doesn't run with undefined secret
  process.exit(1);
}

const app = express();
app.use(bodyParser.json());

// Simple request logger
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health check
app.get('/', (req, res) => {
  res.send('Server is running! POST /create-user with JSON { userId, name } to get a token.');
});

// Create a token for a user (simple server-side token generation)
app.post('/create-user', (req, res) => {
  try {
    const { userId, name } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required in the request body' });
    }

    // Create a JWT expected by Stream: payload must contain user_id
    const payload = { user_id: String(userId) };

    // You can add other optional claims here, for example:
    // payload = { ...payload, name }

    // Create token (no expiration by default; you can set expiresIn if desired)
    const token = jwt.sign(payload, STREAM_API_SECRET, { algorithm: 'HS256' });

    return res.json({ apiKey: STREAM_API_KEY, token, userId: String(userId) });
  } catch (err) {
    console.error('Error creating token:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`\n🚀 Server is running at http://localhost:${port}`);
  console.log(`Using STREAM_API_KEY=${STREAM_API_KEY ? STREAM_API_KEY.slice(0,6) + '...' : 'missing'}`);
});
