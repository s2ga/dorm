const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { query } = db;
const { signToken, requireAuth, setAuthCookie, clearAuthCookie, revokeTokens, readToken } = require('../auth');
const { checkPassword } = require('../valid');
const guard = require('../login-guard');
const jwt = require('jsonwebtoken');

const router = express.Router();

const publicUser = u => ({
  id: u.id, username: u.username, role: u.role, full_name: u.full_name,
  student_id: u.student_id, must_change_password: !!u.must_change_password,
  // Đa cơ sở: null = điều hành (thấy tất cả); có id = quản lý/bảo trì cơ sở đó. Frontend dùng để
  // ẩn/hiện bộ chọn cơ sở + cột "Cơ sở".
  facility_id: u.facility_id != null ? u.facility_id : null,
  // Đăng nhập Microsoft: giao diện dùng để hiện email đã liên kết + trạng thái chờ duyệt.
  email: u.email || null,
  auth_provider: u.auth_provider || 'local',
  approved: u.approved !== false,
});

// KHÔNG còn khái niệm "cổng đăng nhập".
// Loại người dùng (nhân viên / học viên) là THUỘC TÍNH CỦA TÀI KHOẢN trong CSDL — server tự biết
// sau khi xác thực. Bắt người đăng nhập tự khai mình thuộc loại nào vừa thừa, vừa sinh ra lỗi
// "đúng mật khẩu nhưng nhầm cổng" hoàn toàn nhân tạo. Giao diện đổi theo `user.role` SAU khi vào.

// Đăng nhập — đặt token vào cookie httpOnly, KHÔNG trả token cho client
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Nhập tên đăng nhập và mật khẩu' });
    const now = Date.now();

    // Tài khoản này có đang bị khoá vì sai quá nhiều lần không? Kiểm TRƯỚC khi so mật khẩu.
    const khoa = guard.truocKhiThu(username, now);
    if (khoa.khoa) {
      const phut = Math.ceil(khoa.conLai / 60);
      await guard.ghiNhatKyDangNhap(db.pool, { username: username.trim(), req, ketQua: 'bị khoá (đang trong thời gian khoá)' });
      return res.status(429).json({ error: `Tài khoản tạm khoá do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${phut} phút.` });
    }

    const { rows } = await query('SELECT * FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL', [username.trim()]);
    const user = rows[0];
    // Tài khoản SSO THUẦN không có mật khẩu (password_hash NULL). Trả về đúng câu lỗi chung với
    // "sai mật khẩu" để ô đăng nhập không thành máy dò xem tài khoản nào dùng SSO.
    if (user && !user.password_hash) {
      guard.ghiNhanKetQua(username, false, now);
      await guard.ghiNhatKyDangNhap(db.pool, { user, req, ketQua: 'tài khoản chỉ đăng nhập bằng Microsoft (không có mật khẩu)' });
      return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      const { khoaMoi } = guard.ghiNhanKetQua(username, false, now);
      await guard.ghiNhatKyDangNhap(db.pool, { user: user || null, username: username.trim(), req, ketQua: khoaMoi ? 'SAI mật khẩu — vượt ngưỡng, KHOÁ tài khoản' : 'SAI mật khẩu' });
      if (khoaMoi) return res.status(429).json({ error: `Đăng nhập sai quá nhiều lần. Tài khoản tạm khoá ${Math.round(guard.KHOA_MS / 60000)} phút để bảo vệ.` });
      return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    // Học viên đã bị xoá hồ sơ (deleted_at) thì không cho đăng nhập nữa
    if (user.role === 'student' && user.student_id) {
      const s = (await query('SELECT 1 FROM students WHERE id=$1 AND deleted_at IS NULL', [user.student_id])).rows[0];
      if (!s) {
        await guard.ghiNhatKyDangNhap(db.pool, { user, req, ketQua: 'tài khoản học viên đã bị xoá hồ sơ' });
        return res.status(401).json({ error: 'Tài khoản không còn hiệu lực' });
      }
    }
    // Tài khoản do SSO tự tạo, admin CHƯA duyệt -> chưa cho vào (nói rõ để người ta khỏi thử lại mãi).
    if (user.approved === false) {
      guard.ghiNhanKetQua(username, true, now);
      await guard.ghiNhatKyDangNhap(db.pool, { user, req, ketQua: 'tài khoản chờ admin duyệt' });
      return res.status(403).json({ error: 'Tài khoản đang chờ quản trị viên duyệt. Vui lòng liên hệ ban quản lý.' });
    }
    // Thành công: xoá bộ đếm sai, ghi nhật ký, cấp vé.
    guard.ghiNhanKetQua(username, true, now);
    await guard.ghiNhatKyDangNhap(db.pool, { user, req, ketQua: 'đăng nhập thành công' });
    setAuthCookie(res, signToken(user));
    // /login CHỈ xác thực + đặt cookie. Thông tin user lấy qua GET /auth/me — MỘT nguồn duy nhất,
    // tránh chuyện login trả một bản, /me trả một bản, rồi hai bản trôi khỏi nhau (yêu cầu 21/07).
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Đăng xuất — THU HỒI vé (không chỉ xoá cookie ở máy client).
// Trước đây chỉ clearCookie -> ai đã copy được token thì vẫn dùng tiếp 30 ngày sau khi chủ tài khoản đăng xuất.
router.post('/logout', async (req, res) => {
  try {
    const t = readToken(req);
    if (t) { const p = jwt.verify(t, require('../auth').JWT_SECRET); await revokeTokens(p.id); }
  } catch (e) { /* token hỏng/hết hạn -> không cần thu hồi */ }
  clearAuthCookie(res);
  res.json({ ok: true });
});

// Thông tin người đang đăng nhập (dùng khi tải lại trang — nguồn xác thực là cookie)
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, username, role, full_name, student_id, facility_id, must_change_password, email, auth_provider, approved FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(401).json({ error: 'Tài khoản không tồn tại' });
    res.json(publicUser(rows[0]));
  } catch (e) { next(e); }
});

// Đổi mật khẩu (chính mình) — xóa cờ bắt buộc đổi mật khẩu sau khi thành công
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    // NỚI LỎNG 23/07/2026: bỏ yêu cầu mật khẩu cũ (đã xác thực bằng cookie; lần đổi bắt buộc vừa
    // đăng nhập bằng mật khẩu khởi tạo xong). Vẫn chặn đặt lại y hệt mật khẩu hiện tại.
    const { newPassword } = req.body;
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    const loiMk = checkPassword(newPassword, []);
    if (loiMk) return res.status(400).json({ error: loiMk });
    if (user.password_hash && bcrypt.compareSync(newPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại' });
    }
    await query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
      [bcrypt.hashSync(newPassword, 10), user.id]);
    // Đổi mật khẩu -> thu hồi mọi vé cũ (ai đang dùng token cũ bị đá ra), rồi cấp vé mới cho CHÍNH phiên này
    await revokeTokens(user.id);
    const fresh = (await query('SELECT id, username, role, student_id, token_epoch FROM users WHERE id=$1', [user.id])).rows[0];
    setAuthCookie(res, signToken(fresh));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ==================== ĐĂNG NHẬP MICROSOFT (SSO) ====================
   Luồng: /sso/start  -> 302 sang Microsoft
          /sso/callback <- Microsoft trả về ?code&state -> đổi mã, kiểm id_token, cấp cookie phiên
   Sau khi xác thực xong dùng LẠI NGUYÊN setAuthCookie(signToken(user)) — SSO không có
   đường phiên/quyền riêng, chỉ là một cách chứng minh danh tính khác. */
const sso = require('../sso');

// Giao diện đăng nhập hỏi: có hiện nút "Đăng nhập bằng Microsoft" không? (công khai, không lộ gì)
router.get('/sso/config', async (req, res) => {
  try { const c = await sso.ssoConfig(); res.json({ enabled: c.enabled }); }
  catch (e) { res.json({ enabled: false }); }
});

// Rate-limit riêng: mỗi lần bấm là một vòng chuyển hướng ra ngoài; không chặn thì thành công cụ
// bắn lưu lượng vào IdP của công ty.
const ssoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn đã thử đăng nhập Microsoft quá nhiều lần. Vui lòng đợi vài phút.' },
});

router.get('/sso/start', ssoLimiter, async (req, res, next) => {
  try {
    const { url, stateToken } = await sso.buildAuthRequest(req);
    res.cookie(sso.STATE_COOKIE, stateToken, {
      httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true',
      path: '/api/auth/sso', maxAge: sso.STATE_TTL_SEC * 1000,
    });
    res.redirect(url);
  } catch (e) {
    if (e.status === 503) return res.status(503).send('Đăng nhập Microsoft chưa được cấu hình.');
    next(e);
  }
});

// Người dùng quay về từ Microsoft. Đây là ĐIỂM VÀO CÔNG KHAI -> mọi lỗi đều trả về trang đăng nhập
// kèm thông báo tiếng Việt, không phơi chi tiết kỹ thuật.
router.get('/sso/callback', ssoLimiter, async (req, res, next) => {
  const veTrang = msg => {
    res.clearCookie(sso.STATE_COOKIE, { path: '/api/auth/sso' });
    return res.redirect('/?sso_error=' + encodeURIComponent(msg));
  };
  try {
    if (req.query.error) {
      console.warn('[SSO] Microsoft trả lỗi:', req.query.error, req.query.error_description);
      return veTrang('Microsoft từ chối yêu cầu đăng nhập.');
    }
    if (!req.query.code) return veTrang('Thiếu mã đăng nhập từ Microsoft.');

    let danhTinh;
    try { danhTinh = await sso.exchangeAndVerify(req, { code: req.query.code, state: req.query.state }); }
    catch (e) { return veTrang(e.message || 'Không xác thực được với Microsoft.'); }

    const { subject, email, fullName } = danhTinh;
    // 1) Đã liên kết trước đó -> vào thẳng (khoá theo sso_subject vì email đổi được)
    let user = (await query('SELECT * FROM users WHERE sso_subject = $1 AND deleted_at IS NULL', [subject])).rows[0];
    let ketQua = 'đăng nhập Microsoft';

    if (!user) {
      // 2) Có tài khoản mang đúng email -> LIÊN KẾT lần đầu. Đây chính là "sau khi được đăng ký
      //    mail thì thêm đăng nhập bằng SSO": tài khoản vẫn giữ mật khẩu cũ (auth_provider='both').
      const byEmail = (await query('SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [email])).rows[0];
      if (byEmail) {
        await query(`UPDATE users SET sso_subject = $1, auth_provider = CASE WHEN password_hash IS NULL THEN 'sso' ELSE 'both' END WHERE id = $2`, [subject, byEmail.id]);
        user = (await query('SELECT * FROM users WHERE id = $1', [byEmail.id])).rows[0];
        ketQua = 'liên kết Microsoft lần đầu + đăng nhập';
      } else {
        // 3) Người trong tenant nhưng chưa có hồ sơ -> TỰ TẠO vai 'pending' + approved=false.
        //    'pending' không khớp bất kỳ requireRole nào và approved=false bị chặn ngay ở requireAuth,
        //    nên tài khoản này KHÔNG thấy được dữ liệu gì cho tới khi admin gán vai + duyệt.
        const uname = email;
        const ins = await query(
          `INSERT INTO users (username, password_hash, role, full_name, email, sso_subject, auth_provider, approved)
           VALUES ($1, NULL, 'pending', $2, $3, $4, 'sso', false) RETURNING *`,
          [uname, fullName || email, email, subject]);
        user = ins.rows[0];
        ketQua = 'Microsoft: TỰ TẠO tài khoản mới, chờ admin duyệt';
      }
    }

    await guard.ghiNhatKyDangNhap(db.pool, { user, username: user.username, req, ketQua });
    if (user.approved === false) {
      res.clearCookie(sso.STATE_COOKIE, { path: '/api/auth/sso' });
      return res.redirect('/?sso_pending=1');
    }
    res.clearCookie(sso.STATE_COOKIE, { path: '/api/auth/sso' });
    setAuthCookie(res, signToken(user));
    res.redirect('/');
  } catch (e) { next(e); }
});

module.exports = router;
