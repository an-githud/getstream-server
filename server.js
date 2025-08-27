import express from 'express';
import bodyParser from 'body-parser';
import { StreamClient } from '@stream-io/node-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

// Middleware log request
app.use((req, res, next) => {
  console.log('Received request:', req.method, req.url);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  next();
});

// Stream API Key và Secret từ .env
const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

const client = new StreamClient(apiKey, apiSecret);

app.post('/create-user', async (req, res) => {
  const { userId, name } = req.body;
  if (!userId || !name) {
    return res.status(400).json({ error: 'Thiếu userId hoặc name' });
  }

  try {
    await client.upsertUsers([{ id: userId, name }]);
    const token = client.createToken(userId);
    res.json({ apiKey, userId, token });
  } catch (err) {
    console.error('GetStream error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Root route test
app.get('/', (req, res) => {
  res.send('Server is running! Try POST /create-user');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${port}`);
});
