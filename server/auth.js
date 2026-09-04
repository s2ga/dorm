const jwt = require('jsonwebtoken');

// Fail-fast: không dùng secret mặc định. Bắt buộc đặt JWT_SECRET ở mọi môi trường.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  throw new Error('Thiếu JWT_SECRET (hoặc quá ngắn < 16). Sinh chuỗi ngẫu nhiên rồi đặt vào ENV/.env.');
}
const JWT_SECRET = process.env.JWT_SECRET;
// Cookie Secure bật theo kết nối HTTPS thật, khai báo tường minh — KHÔNG suy theo NODE_ENV.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

// tv = token_epoch tại thời điểm cấp vé. Không khớp với DB nữa -> vé bị thu hồi.
// KHÔNG dùng role trong token để phân quyền — role luôn đọc lại từ DB ở requireAuth.
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, student_id: user.student_id || null, tv: user.token_epoch || 0 },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Tăng số hiệu phiên -> thu hồi NGAY mọi token cũ của tài khoản này.
async function revokeTokens(userId) {
  const { query } = require('./db');
  await query('UPDATE users SET token_epoch = token_epoch + 1 WHERE id = $1', [userId]);
}

const COOKIE_NAME = 'ktx_token';
const COOKIE_MAX_AGE = 30 * 24 * 3600 * 1000; // 30 ngày

// Lấy token: ưu tiên cookie httpOnly; fallback header Authorization (cho script/kiểm thử)
function readToken(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)ktx_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Đặt cookie phiên (httpOnly để JS client không đọc được -> chống XSS đánh cắp token)
function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}
function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Khi tài khoản đang bị BẮT BUỘC đổi mật khẩu, chỉ cho phép đúng 3 đường này.
const MUST_CHANGE_ALLOW = ['/api/auth/change-password', '/api/auth/logout', '/api/auth/me'];
// Tài khoản do SSO tự tạo còn CHỜ DUYỆT: chỉ đủ để giao diện biết mình đang chờ và thoát ra.
const PENDING_ALLOW = ['/api/auth/logout', '/api/auth/me'];

// Middleware: yêu cầu đã đăng nhập.
// Vé (token) CHỈ dùng để biết "ai" — còn "còn quyền không / vai trò gì" thì HỎI LẠI DB MỖI REQUEST.
// Trước đây chỉ jwt.verify rồi tin thẳng vào vé -> giáng chức / xoá tài khoản / đăng xuất đều vô nghĩa trong 30 ngày.
async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  let p;
  try { p = jwt.verify(token, JWT_SECRET); }
  catch (err) { return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' }); }
  try {
    const { query } = require('./db');
    const { rows } = await query(
      `SELECT id, username, role, full_name, student_id, facility_id, must_change_password, token_epoch, approved
       FROM users WHERE id = $1 AND deleted_at IS NULL`, [p.id]);
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Tài khoản không còn hiệu lực' });
    if ((p.tv || 0) !== (u.token_epoch || 0)) {
      return res.status(401).json({ error: 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.' });
    }
    // Học viên bị xoá hồ sơ -> tài khoản hết hiệu lực
    if (u.role === 'student' && u.student_id) {
      const s = await query('SELECT 1 FROM students WHERE id=$1 AND deleted_at IS NULL', [u.student_id]);
      if (!s.rows[0]) return res.status(401).json({ error: 'Tài khoản không còn hiệu lực' });
    }
    req.user = { id: u.id, username: u.username, role: u.role, full_name: u.full_name, student_id: u.student_id, facility_id: u.facility_id };
    // Tài khoản SSO tự tạo, admin chưa duyệt -> chưa chạm được dữ liệu nào. Chặn ở SERVER: dù ai
    // gọi thẳng API cũng không qua, không phụ thuộc giao diện.
    if (u.approved === false && !PENDING_ALLOW.includes((req.originalUrl || '').split('?')[0])) {
      return res.status(403).json({ error: 'Tài khoản đang chờ quản trị viên duyệt.' });
    }
    // Bắt buộc đổi mật khẩu: chặn ở SERVER, không chỉ ở giao diện
    if (u.must_change_password && !MUST_CHANGE_ALLOW.includes((req.originalUrl || '').split('?')[0])) {
      return res.status(403).json({ error: 'Bạn phải đổi mật khẩu trước khi sử dụng hệ thống.' });
    }
    next();
  } catch (e) { next(e); }
}

// Middleware: yêu cầu vai trò cụ thể
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole, revokeTokens, readToken, JWT_SECRET, setAuthCookie, clearAuthCookie };
