import express from "express";
import dotenv from "dotenv";

dotenv.config();
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Hello 👋, server đang chạy!");
});

app.get("/token", (req, res) => {
  const apiKey = process.env.API_KEY || "chưa set";
  res.json({ message: "Token endpoint", apiKey });
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});
