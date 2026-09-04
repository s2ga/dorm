const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, getSettings } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { testConnection } = require('../mailer');
const { checkSetting, isValidEmail, normalizeBool } = require('../valid');

const router = express.Router();

// Các khóa bí mật KHÔNG bao giờ trả về client (chỉ trả cờ "đã cấu hình")
const SECRET_KEYS = ['smtp_pass', 'sso_client_secret'];
// Khoá chỉ ADMIN được xem (staff không cần biết cấu hình máy chủ mail / email nhà trường).
// sanitize dùng ALLOW-LIST cho staff thay vì deny-list: thêm secret mới mà quên bổ sung thì
// mặc định KHÔNG lộ, an toàn hơn (V2-19).
const ADMIN_ONLY_KEYS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'school_email', 'school_name', 'violation_mail_threshold',
  'sso_enabled', 'sso_tenant_id', 'sso_client_id', 'sso_allowed_domains'];

// Bỏ secret khỏi object cấu hình, thêm cờ <key>_set để UI biết đã cấu hình hay chưa.
// isAdmin=false -> bỏ luôn các khoá chỉ dành cho admin.
function sanitize(s, isAdmin) {
  const out = { ...s };
  for (const k of SECRET_KEYS) { out[k + '_set'] = !!(s[k] && String(s[k]).trim()); delete out[k]; }
  if (!isAdmin) for (const k of ADMIN_ONLY_KEYS) delete out[k];
  return out;
}

// Cấu hình (mọi người đăng nhập đều xem được đơn giá) — ẩn secret + ẩn khoá admin với staff
router.get('/', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try { res.json(sanitize(await getSettings(), req.user.role === 'admin')); } catch (e) { next(e); }
});

// V2-15: limiter riêng cho nút Test SMTP — mỗi verify() là một lần AUTH thật từ IP của KTX.
// Không giới hạn thì server KTX thành công cụ dò mật khẩu SMTP của bên thứ ba.
const smtpTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, reason: 'Bạn đã thử kết nối SMTP quá nhiều lần. Vui lòng đợi vài phút.' },
});

// Kiểm tra kết nối SMTP (chỉ admin) — không lưu gì, chỉ verify
router.post('/smtp/test', requireAuth, requireRole('admin'), smtpTestLimiter, async (req, res, next) => {
  try {
    const b = req.body || {};
    const r = await testConnection({
      smtp_host: b.smtp_host, smtp_port: b.smtp_port, smtp_secure: b.smtp_secure,
      smtp_user: b.smtp_user, smtp_pass: b.smtp_pass,
    });
    res.json(r);
  } catch (e) { next(e); }
});

// Cập nhật cấu hình (chỉ admin)
router.put('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const allowed = ['dorm_name', 'hotline', 'room_fee', 'water_fee', 'electric_unit', 'service_fee',
      'washing_fee', 'parking_fee', 'deposit_fee', 'partial_half_min', 'partial_full_min',
      'legal_female', 'legal_male', 'due_day_from', 'due_day_to',
      'overdue_remind_days', 'shortterm_max_days', 'deposit_notice_min_days', 'partial_half_factor',
      'room_cap_A', 'room_cap_B', 'room_cap_C', 'room_cap_D', 'checkout_max_future_days', 'max_cccd_mb',
      'room_price_A', 'room_price_B', 'room_price_C', 'room_price_D',
      'bravo_fee_type', 'bravo_room', 'bravo_water', 'bravo_service', 'bravo_electric', 'bravo_parking', 'bravo_washing', 'bravo_other',
      'school_name', 'school_email', 'violation_mail_threshold',
      'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
      'sso_enabled', 'sso_tenant_id', 'sso_client_id', 'sso_client_secret', 'sso_allowed_domains',
      'intro_hero_title', 'intro_hero_desc', 'intro_about_eyebrow', 'intro_about_title', 'intro_about_desc',
      'intro_rooms_eyebrow', 'intro_rooms_title', 'intro_rooms_desc', 'intro_amenities_title',
      'intro_price_title', 'intro_price_desc', 'intro_contact_title', 'intro_contact_desc',
      'imgcap_khuon-vien-1', 'imgcap_khuon-vien-2', 'imgcap_khuon-vien-3',
      'imgcap_phong-1', 'imgcap_phong-2', 'imgcap_phong-3'];
    // V2-18: gõ nhầm tên cài đặt (vd "electric_price" thay vì "electric_unit") -> trước đây trả
    // 200 "đã lưu" mà KHÔNG lưu gì. Giờ báo lỗi rõ những khoá không nhận ra.
    const unknown = Object.keys(req.body).filter(k => !allowed.includes(k) && k !== 'preview');
    if (unknown.length) return res.status(400).json({ error: `Tên cài đặt không hợp lệ: ${unknown.join(', ')}` });

    // Kiểm KIỂU trước khi ghi: đơn giá / ngưỡng phải là số trong khoảng hợp lệ.
    // Sai 1 ký tự ở ô đơn giá điện từng làm toàn bộ tiền điện về 0 mà không cảnh báo.
    const errs = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      const e = checkSetting(key, req.body[key]);
      if (e) errs.push(e);
    }
    // V2-16: email nhà trường / smtp_from phải đúng định dạng (không rỗng thì phải hợp lệ) —
    // nếu không, mọi mail vi phạm gửi đi đều fail âm thầm mà UI vẫn báo "sẵn sàng".
    for (const key of ['school_email', 'smtp_from']) {
      const v = req.body[key];
      if (v !== undefined && String(v).trim() !== '' && !isValidEmail(v)) errs.push(`"${key}" phải là email hợp lệ (đang nhận: "${v}")`);
    }
    if (errs.length) return res.status(400).json({ error: errs.join(' · ') });

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        // Không ghi đè mật khẩu SMTP bằng chuỗi rỗng (form ẩn pass, để trống = giữ nguyên)
        if (SECRET_KEYS.includes(key) && !String(req.body[key]).trim()) continue;
        // V2-17: smtp_secure lưu dạng chuẩn 'true'/'false' — "True"/"1"/"yes" không âm thầm thành false.
        const val = (key === 'smtp_secure' || key === 'sso_enabled') ? String(normalizeBool(req.body[key])) : String(req.body[key]);
        await query(
          `INSERT INTO settings (key, value) VALUES ($1,$2)
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
          [key, val]
        );
      }
    }
    res.json(sanitize(await getSettings(), true));
  } catch (e) { next(e); }
});

module.exports = router;
