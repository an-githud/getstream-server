import express from "express";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: './stream_api.env' });
const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error("❌ Missing Stream credentials. Add STREAM_API_KEY and STREAM_API_SECRET to .env");
  process.exit(1);
}

const app = express();
app.use(bodyParser.json());

// health check
app.get("/", (req, res) => {
  res.send("Server is running! POST /create-user with { userId, name }");
});

// endpoint tạo token
app.post("/create-user", (req, res) => {
  const { userId, name } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  // payload phải có user_id
  const payload = { user_id: String(userId) };

  // ký token
  const token = jwt.sign(payload, STREAM_API_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h", // token hết hạn trong 1h
  });

  return res.json({
    apiKey: STREAM_API_KEY,
    token,
    userId,
    name,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
