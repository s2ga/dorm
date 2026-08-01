// ===== Bộ khung cho test đối kháng =====
// Nguyên tắc: test để LÒI RA LỖI, không phải xác nhận code chạy đúng như code được viết.
// "Kết quả đúng" = nghiệp vụ ĐÚNG PHẢI LÀ. Code làm khác -> đó là lỗi, kể cả khi code chạy đúng ý người viết.

const path = require('path');
const { Pool, types } = require(path.join(__dirname, '../../node_modules/pg'));

// DATE -> chuỗi 'YYYY-MM-DD', NUMERIC -> số. Phải khớp server/db.js, nếu không số liệu so sánh sẽ lệch.
types.setTypeParser(1082, v => v);
types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const DB_URL = process.env.TEST_DB || `postgres://ktx:${process.env.PGPASSWORD || 'ktx_local_secret'}@localhost:5432/ktx`;

// ---- CHẶN CỨNG: bộ test này TẠO và XOÁ dữ liệu thật. Chạy nhầm lên bản demo/thật là mất sạch,
// không hoàn tác được. Chỉ cho phép localhost — không có cờ nào để tắt kiểm tra này.
const localHost = u => /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?([/?].*)?$/.test(u);
const localDb = u => /@(localhost|127\.0\.0\.1):/.test(u);
if (!localHost(BASE) || !localDb(DB_URL)) {
  console.error(`\n  DỪNG. Bộ test này xoá dữ liệu — chỉ được chạy trên máy local.\n` +
    `     Máy chủ : ${BASE}\n     CSDL    : ${DB_URL.replace(/:[^:@/]+@/, ':***@')}\n`);
  process.exit(2);
}

const pool = new Pool({ connectionString: DB_URL, ssl: false });

const req = (method, urlPath, token, body) =>
  fetch(BASE + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

// Đăng nhập lấy vé. Trả về chuỗi token (server đặt cookie httpOnly; API cũng nhận Bearer).
async function login(username, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const m = (r.headers.get('set-cookie') || '').match(/ktx_token=([^;]+)/);
  if (!m) {
    // Nói đúng nguyên nhân: 429 là do net chống dò (20 lần/15 phút theo IP|tên) — chạy bộ test hai
    // lần liền nhau là dính, chứ không phải thiếu mật khẩu. Đoán nhầm ở đây tốn cả buổi đi mò.
    const vi = r.status === 429
      ? 'bị chặn vì thử quá nhiều lần. Đợi hết 15 phút, hoặc khởi động lại máy chủ để xoá bộ đếm trong RAM'
      : `HTTP ${r.status}. Đặt biến ADMIN_P?`;
    throw new Error(`Không đăng nhập được "${username}" — ${vi}`);
  }
  return m[1];
}

const serverUp = () => fetch(BASE + '/api/health').then(r => r.ok).catch(() => false);

// ---- Bộ ghi nhận kết quả của MỘT bộ test ----
function makeCtx() {
  const cases = [];
  const push = (name, pass, detail) => cases.push({ name, pass, detail: detail == null ? '' : String(detail) });
  return {
    cases,
    db: pool,
    api: req,
    login,
    // ok(tên, điều kiện, chi tiết) — chi tiết LUÔN in ra, kể cả khi đúng, để đọc được con số thật
    ok: (name, cond, detail) => push(name, !!cond, detail),
    eq: (name, got, want, detail) => push(name, JSON.stringify(got) === JSON.stringify(want),
      detail != null ? detail : `được ${JSON.stringify(got)} · phải ${JSON.stringify(want)}`),
    // near: cho phép lệch vì làm tròn (mặc định 1đ)
    near: (name, got, want, tol = 1) => push(name, Math.abs(got - want) <= tol,
      `được ${fmt(got)} · phải ${fmt(want)} (cho lệch ≤${tol})`),
  };
}

const fmt = n => (Number(n) || 0).toLocaleString('vi-VN');

module.exports = { BASE, DB_URL, pool, req, login, serverUp, makeCtx, fmt };
