import express from "express";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { StreamClient } from "@stream-io/node-sdk";


// Load biến môi trường  dotenv.config({ path: './stream_api.env' });
dotenv.config();



const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error("❌ Missing Stream credentials. Add STREAM_API_KEY and STREAM_API_SECRET to .env");
  process.exit(1);
}

// Khởi tạo client server với API key/secret
const serverClient = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET);

const app = express();
app.use(bodyParser.json());

// health check
app.get("/", (req, res) => {
  res.send("Server is running! POST /create-user with { userId, name }");
});

// endpoint tạo token lần đầu
app.post("/create-user", async (req, res) => {
  const { userId, name } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    // 1) Tạo/ cập nhật user bên Stream
    await serverClient.upsertUsers([
      {
        id: String(userId),
        name: name || "No name",
      }
    ]);

    // 2) Tạo token chính xác
    const payload = { user_id: String(userId) };
    const token = jwt.sign(payload, STREAM_API_SECRET, {
      algorithm: "HS256",
      expiresIn: "30d",
    });

    return res.json({
      apiKey: STREAM_API_KEY,
      token,
      userId,
      name,
    });

  } catch (err) {
    console.error("❌ Stream upsertUser error:", err);
    return res.status(500).json({ error: err.message });
  }
});


// endpoint refresh token
app.post("/refresh-stream-token", (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
// "1y" → 1 năm  ,  "7d" → 7 ngày
  const payload = { user_id: String(userId) };
  const token = jwt.sign(payload, STREAM_API_SECRET, {
    algorithm: "HS256",
    expiresIn: "30d",
  });

  return res.json({
    apiKey: STREAM_API_KEY,
    token,
    userId,
  });
});








const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
