// Kiểm tra hợp lệ dùng chung cho input người dùng (chống ngày ảo làm sập DB, SĐT rác...).

// Ngày 'YYYY-MM-DD' PHẢI là ngày có thật trên lịch (chặn 2026-02-30, 2026-13-01, 0000-00-00...).
function isValidYmd(s) {
  s = String(s == null ? '' : s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// Chuẩn hoá: ngày hợp lệ -> giữ nguyên chuỗi; không hợp lệ -> null (để lưu NULL thay vì sập)
function ymdOrNull(s) { return isValidYmd(s) ? String(s) : null; }
const digits = s => String(s == null ? '' : s).replace(/\D/g, '');
// SĐT hợp lệ: 8–15 chữ số (cho phép có dấu cách, +, -, ...)
function isValidPhone(s) { const d = digits(s); return d.length >= 8 && d.length <= 15; }

// Giới tính: CHỈ 'male' | 'female'. Không đoán, không mặc định.
// Trước đây `b.gender === 'male' ? 'male' : 'female'` biến MỌI thứ khác thành 'female' —
// gửi "Male" (M hoa) hay bỏ trống trường này thì nam bị ghi thành nữ, rồi luật chặn giới tính
// lúc duyệt đơn so nữ-với-nữ và kết luận "hợp lệ" -> NAM VÀO PHÒNG NỮ. Luật không sai;
// dữ liệu đã sai từ trước khi luật nhìn thấy nó.
function isValidGender(s) { return s === 'male' || s === 'female'; }

// Kỳ hoá đơn: bắt buộc YYYY-MM và tháng 01..12 (chặn "2026-13", "xyz")
function isValidMonth(s) {
  s = String(s == null ? '' : s);
  if (!/^\d{4}-\d{2}$/.test(s)) return false;
  const [y, m] = s.split('-').map(Number);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12;
}

// Các khoá Cài đặt BẮT BUỘC là số + khoảng hợp lệ.
// Trước đây mọi giá trị lưu thành chuỗi, không kiểm gì -> electric_unit="abc" làm tiền điện về 0,
// room_fee="-1200000" làm hoá đơn âm, ngưỡng gửi mail = 0/-5 làm báo trường mọi vi phạm đầu tiên.
const SETTING_NUM = {
  room_fee: { min: 0, max: 100000000 }, water_fee: { min: 0, max: 100000000 },
  electric_unit: { min: 0, max: 1000000 }, service_fee: { min: 0, max: 100000000 },
  washing_fee: { min: 0, max: 100000000 }, parking_fee: { min: 0, max: 100000000 },
  deposit_fee: { min: 0, max: 100000000 },
  room_price_A: { min: 0, max: 100000000 }, room_price_B: { min: 0, max: 100000000 },
  room_price_C: { min: 0, max: 100000000 }, room_price_D: { min: 0, max: 100000000 },
  partial_half_min: { min: 0, max: 31 }, partial_full_min: { min: 0, max: 31 },
  due_day_from: { min: 1, max: 31 }, due_day_to: { min: 1, max: 31 },
  violation_mail_threshold: { min: 1, max: 100 },
  smtp_port: { min: 1, max: 65535 },
  // Ngưỡng nhắc / nghiệp vụ (Đợt 3 — dọn hard-code)
  overdue_remind_days: { min: 1, max: 365 }, shortterm_max_days: { min: 1, max: 365 },
  deposit_notice_min_days: { min: 0, max: 365 }, partial_half_factor: { min: 0, max: 1 },
  room_cap_A: { min: 1, max: 20 }, room_cap_B: { min: 1, max: 20 }, room_cap_C: { min: 1, max: 20 }, room_cap_D: { min: 1, max: 20 },
  checkout_max_future_days: { min: 1, max: 3650 }, max_cccd_mb: { min: 1, max: 15 }, // max_cccd_mb <= body parser 16MB
};
// Trả về chuỗi lỗi nếu sai, null nếu hợp lệ
function checkSetting(key, raw) {
  const spec = SETTING_NUM[key];
  if (!spec) return null;
  const s = String(raw).trim();
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return `"${key}" phải là số (đang nhận: "${raw}")`;
  const n = Number(s);
  if (!Number.isFinite(n)) return `"${key}" phải là số`;
  if (n < spec.min) return `"${key}" không được nhỏ hơn ${spec.min} (đang nhận: ${n})`;
  if (n > spec.max) return `"${key}" không được lớn hơn ${spec.max} (đang nhận: ${n})`;
  return null;
}

// Chỉ cho phép đúng các field đã khai báo. Field lạ -> báo lỗi thay vì NUỐT IM LẶNG.
// (Trước đây gửi "check_out_date" thay vì "date" thì app trả 200 rồi tự lấy ngày hôm nay.)
function rejectUnknown(body, allowed) {
  const extra = Object.keys(body || {}).filter(k => !allowed.includes(k));
  return extra.length ? `Trường không hợp lệ: ${extra.join(', ')}. Chỉ chấp nhận: ${allowed.join(', ')}` : null;
}

// Chính sách mật khẩu — MỘT chỗ cho MỌI nơi đặt mật khẩu (admin tạo tài khoản, admin đặt lại,
// người dùng tự đổi). Trước đây admin tạo với tối thiểu 4 ký tự ("1234" hợp lệ) trong khi tự đổi
// đòi 6 — mắt xích yếu nhất của cả hệ thống nằm ở đường lỏng nhất. Mọi lớp xác thực phía sau
// vô nghĩa nếu mật khẩu là "1234".
// Trả về chuỗi lỗi nếu yếu, null nếu đạt. `context` để loại mật khẩu trùng tên đăng nhập / tên người.
const MAT_KHAU_PHO_BIEN = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty', 'qwertyuiop',
  'abc12345', '11111111', '00000000', 'iloveyou', 'admin123', 'esuhai123', '88888888',
  '12341234', 'aa123456', 'a1234567', 'matkhau', 'ktx12345',
]);
// NỚI LỎNG 23/07/2026 (chốt owner) — xem chú thích ở internal/valid/valid.go CheckPassword.
// Mật khẩu local chỉ là TẠM (SSO Microsoft sẽ là chính, vẫn chấp nhận mật khẩu local). Chỉ giữ
// 2 ràng buộc kỹ thuật: tối thiểu 6 ký tự, tối đa 72 (trần bcrypt). Bỏ hết ràng buộc "đoán được"
// — rào bảo mật thật là khoá-tài-khoản-khi-sai-nhiều + nhật ký đăng nhập, không ở độ phức tạp.
// (context giữ trong chữ ký cho tương thích nơi gọi; hiện không dùng.)
function checkPassword(pw, context = []) {
  const s = String(pw == null ? '' : pw);
  if (s.length < 6) return 'Mật khẩu tối thiểu 6 ký tự';
  if (s.length > 72) return 'Mật khẩu tối đa 72 ký tự';   // trần của bcrypt
  return null;
}

// Email hợp lệ (đơn giản, đủ chặn "abc"). Dùng cho school_email, smtp_from...
function isValidEmail(s) {
  s = String(s == null ? '' : s).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

// Host NỘI BỘ / loopback / link-local — chặn để server không bị dùng làm công cụ quét cổng
// nội bộ hay đọc metadata cloud (169.254.169.254). Chỉ chặn IP literal + tên loopback;
// không chống được DNS rebinding nhưng bịt được đường tấn công trực tiếp.
function isPrivateHost(host) {
  const h = String(host == null ? '' : host).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  if (/^127\./.test(h)) return true;                       // loopback
  if (/^169\.254\./.test(h)) return true;                  // link-local + metadata cloud
  if (/^10\./.test(h)) return true;                        // private A
  if (/^192\.168\./.test(h)) return true;                  // private C
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;   // private B 172.16–31
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true;         // IPv6 unique-local
  if (/^fe80:/.test(h)) return true;                       // IPv6 link-local
  return false;
}

// Cổng TCP hợp lệ: số nguyên 1..65535
function isValidPort(p) {
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// Chuẩn hoá boolean từ cài đặt: "true"/"1"/"yes"/"on" -> true (không âm thầm nuốt thành false).
function normalizeBool(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

// Trường TEXT tự do: chặn độ dài. Postgres TEXT không giới hạn -> người lạ ẩn danh
// nhét 2 triệu ký tự vào ô "ghi chú" của đơn đăng ký là chuyện đã đo được.
function tooLong(body, limits) {
  for (const [k, max] of Object.entries(limits)) {
    const v = body[k];
    if (v != null && String(v).length > max)
      return `Trường "${k}" quá dài (tối đa ${max} ký tự, đang nhận ${String(v).length})`;
  }
  return null;
}

// Mật khẩu CẤP NHANH cho tài khoản học viên (thường là SĐT) — tối thiểu chung MỘT chỗ. Yếu hơn
// checkPassword (>=8) là CỐ Ý, nhưng luôn kèm must_change_password=true để buộc đổi sang mật khẩu mạnh
// (checkPassword) ở lần đăng nhập đầu. Trước đây rải rác 4/6 không nhất quán.
const INITIAL_PASSWORD_MIN = 6;

module.exports = { isValidYmd, ymdOrNull, isValidPhone, digits, isValidMonth, isValidGender, checkPassword, isValidEmail, isPrivateHost, isValidPort, normalizeBool, tooLong, checkSetting, rejectUnknown, SETTING_NUM, INITIAL_PASSWORD_MIN };
