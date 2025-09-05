// token-tools.js
import fs from 'fs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load env (.env và stream_api.env)
dotenv.config();
dotenv.config({ path: './stream_api.env' });

const STREAM_API_SECRET =
  process.env.STREAM_API_SECRET ||
  process.env.STREAM_SECRET ||
  process.env.STREAM_APISECRET;

if (!STREAM_API_SECRET) {
  console.error("❌ Missing STREAM_API_SECRET in .env hoặc stream_api.env");
  process.exit(1);
}

// Lấy token: ưu tiên argv, rồi đến file @path, rồi env TOKEN
let input = process.argv[2] || process.env.TOKEN || "";
if (!input) {
  console.error("⚠️  Cách dùng:");
  console.error("   node token-tools.js <TOKEN>");
  console.error("   node token-tools.js @token.txt   (đọc token từ file)");
  console.error("   TOKEN=<TOKEN> node token-tools.js");
  process.exit(1);
}

// Nếu là dạng @file -> đọc file
let token = input.startsWith('@')
  ? fs.readFileSync(input.slice(1), 'utf8').trim()
  : input.trim();

if (!token || token === "PASTE_YOUR_TOKEN_HERE") {
  console.error("❌ Chưa cung cấp token thật. Hãy truyền token JWT hợp lệ.");
  process.exit(1);
}

// Kiểm tra định dạng cơ bản JWT
if (token.split('.').length !== 3) {
  console.error("❌ Token không đúng định dạng JWT (phải có 3 phần ngăn bởi dấu chấm).");
  process.exit(1);
}

// --- Decode (không verify, chỉ đọc payload) ---
const decoded = jwt.decode(token, { complete: true });
console.log("===== DECODE =====");
if (decoded) {
  console.log("Header:", decoded.header);
  console.log("Payload:", decoded.payload);
} else {
  console.log("❌ Không decode được token");
}

// --- Verify (kiểm tra chữ ký + hạn token) ---
console.log("\n===== VERIFY =====");
try {
  const verified = jwt.verify(token, STREAM_API_SECRET, { algorithms: ['HS256'] });
  console.log("✅ Token hợp lệ");
  console.log("Payload:", verified);
} catch (err) {
  console.error("❌ Token không hợp lệ:", err.message);
}
