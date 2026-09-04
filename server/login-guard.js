// Chống dò mật khẩu theo TÀI KHOẢN (không chỉ theo IP) + ghi nhật ký mọi lần đăng nhập.
//
// Vì sao cần theo tài khoản: rate-limit theo IP (authLimiter trong index.js) hỏng cả hai chiều —
//  • kẻ xấu dò mật khẩu 'admin' từ 50 IP khác nhau thì mỗi IP một hạn mức mới -> không bị chặn;
//  • cả trường xài chung một wifi thì 20 lần gõ nhầm CỘNG DỒN của mọi người -> khoá cả trường.
// Khoá theo tài khoản bịt chiều thứ nhất; vẫn giữ authLimiter theo IP để chặn kẻ rải nhiều tài khoản.
//
// Lưu trong RAM: cố ý. Khoá đăng nhập chỉ cần sống vài phút; mất khi khởi động lại là chấp nhận được,
// và không đụng tới CSDL trên đường nóng. Server một tiến trình (Render 1 instance) nên RAM là đủ.

const MAX_FAIL = 10;               // số lần sai liên tiếp trước khi khoá tài khoản
const CUA_SO_MS = 15 * 60 * 1000;  // đếm trong cửa sổ 15 phút
const KHOA_MS = 15 * 60 * 1000;    // khoá 15 phút

const theoTaiKhoan = new Map();    // username(lower) -> { fails: [mốc thời gian...], khoaDen: ms }

function donRac(now) {
  // Xoá bản ghi cũ để Map không phình vô hạn. Rẻ, chạy mỗi lần kiểm.
  for (const [k, v] of theoTaiKhoan) {
    v.fails = v.fails.filter(t => now - t < CUA_SO_MS);
    if (!v.fails.length && (!v.khoaDen || v.khoaDen < now)) theoTaiKhoan.delete(k);
  }
}

// Gọi TRƯỚC khi thử mật khẩu. Trả { khoa: true, conLai: giây } nếu tài khoản đang bị khoá.
function truocKhiThu(username, now) {
  const k = String(username || '').toLowerCase().trim();
  const v = theoTaiKhoan.get(k);
  if (v && v.khoaDen && v.khoaDen > now) return { khoa: true, conLai: Math.ceil((v.khoaDen - now) / 1000) };
  return { khoa: false };
}

// Gọi SAU khi thử. success=true -> xoá lịch sử sai. false -> cộng một lần sai, đủ ngưỡng thì khoá.
function ghiNhanKetQua(username, success, now) {
  const k = String(username || '').toLowerCase().trim();
  if (!k) return { khoaMoi: false };
  if (success) { theoTaiKhoan.delete(k); return { khoaMoi: false }; }
  const v = theoTaiKhoan.get(k) || { fails: [], khoaDen: 0 };
  v.fails = v.fails.filter(t => now - t < CUA_SO_MS);
  v.fails.push(now);
  let khoaMoi = false;
  if (v.fails.length >= MAX_FAIL) { v.khoaDen = now + KHOA_MS; v.fails = []; khoaMoi = true; }
  theoTaiKhoan.set(k, v);
  donRac(now);
  return { khoaMoi };
}

// IP thật của client (đã có trust proxy=1 nên req.ip đúng sau proxy Render)
function ipCua(req) {
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || '?';
}

// Ghi nhật ký đăng nhập vào audit_log. Login KHÔNG đi qua middleware audit (middleware bỏ /auth/
// và đòi req.user — mà lúc đăng nhập thì chưa có ai). Nên phải ghi tay ở đây, gồm CẢ lần THẤT BẠI:
// đó mới là thứ cần khi điều tra "có ai đang dò mật khẩu không".
async function ghiNhatKyDangNhap(pool, { user, username, req, ketQua }) {
  const chiTiet = JSON.stringify({ ip: ipCua(req), ketQua, ua: (req.headers['user-agent'] || '').slice(0, 120) }).slice(0, 460);
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)',
      [user?.id || null, user?.username || username || '', user?.role || '', 'LOGIN', '/api/auth/login', chiTiet]);
  } catch (e) { /* nhật ký hỏng không được chặn đăng nhập, nhưng có log server để biết */
    console.error('[login-guard] không ghi được nhật ký đăng nhập:', e.message);
  }
}

module.exports = { truocKhiThu, ghiNhanKetQua, ghiNhatKyDangNhap, ipCua, MAX_FAIL, KHOA_MS };
