import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { StreamClient } from '@stream-io/node-sdk';

dotenv.config();
dotenv.config({ path: './stream_api.env' });

const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error('❌ Missing Stream credentials.');
  process.exit(1);
}

// ✅ Khởi tạo client mới
const client = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET);

const app = express();
app.use(bodyParser.json());

// Health check
app.get('/', (req, res) => {
  res.send('Server is running! Use POST /create-user to get a token.');
});

app.post('/create-user', (req, res) => {
  try {
    const userId = req.body?.userId || "trian020690";
    const name = req.body?.name || "Tri An";

    // ✅ Tạo token cho video call
    const token = client.createToken(userId);

    return res.json({
      apiKey: STREAM_API_KEY,
      token,
      userId,
      name
    });
  } catch (err) {
    console.error('Error creating token:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
