// Nạp biến môi trường từ file .env khi chạy local.
// Trên Render/production các biến đã được inject sẵn nên file này chỉ điền phần còn thiếu.
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
try {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue; // bỏ qua dòng trống & dòng bình luận (#...)
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val; // không ghi đè biến đã có sẵn
    }
  }
} catch (e) {
  console.warn('⚠️  Không đọc được .env:', e.message);
}
