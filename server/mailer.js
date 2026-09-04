// ===== Gửi email cho nhà trường khi học viên vi phạm nhiều lần =====
// nodemailer nạp động: nếu chưa cài (npm i nodemailer) hoặc chưa cấu hình SMTP,
// hàm trả về { sent:false, reason } thay vì làm sập app.
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* chưa cài — bỏ qua */ }

const { getSettings } = require('./db');
const { isPrivateHost, isValidPort, normalizeBool, isValidEmail } = require('./valid');

const SEV = { minor: 'Nhẹ', major: 'Nặng', severe: 'Nghiêm trọng' };
const fmt = d => { if (!d) return '—'; const p = String(d).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };

function smtpReady(s) {
  // Kiểm school_email ĐÚNG ĐỊNH DẠNG, không chỉ "có tồn tại": trước đây school_email="abc" vẫn
  // báo "sẵn sàng", cảnh báo biến mất, nhưng mọi lần gửi đều fail -> nhà trường không nhận được
  // gì mà không ai biết (V2-16).
  return !!(s.smtp_host && s.smtp_user && s.smtp_pass && isValidEmail(s.school_email));
}

// Tạo transporter với timeout ngắn (tránh treo request khi SMTP không phản hồi)
function buildTransport(s) {
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: +s.smtp_port || 587,
    secure: normalizeBool(s.smtp_secure),   // "True"/"1"/"yes" cũng hiểu là bật (V2-17)
    auth: { user: s.smtp_user, pass: s.smtp_pass },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  });
}

// Kiểm tra có gửi được không (dùng để hiển thị cảnh báo trên UI)
async function mailStatus() {
  const s = await getSettings();
  if (!nodemailer) return { ready: false, reason: 'Server chưa cài nodemailer (chạy: npm i nodemailer)' };
  if (!smtpReady(s)) return { ready: false, reason: 'Chưa cấu hình SMTP / email nhà trường trong Cài đặt' };
  return { ready: true };
}

// Thử kết nối SMTP (nút "Kiểm tra kết nối" trong Cài đặt).
// override: cấu hình nhập trực tiếp trên form; nếu bỏ trống smtp_pass thì dùng mật khẩu đã lưu.
async function testConnection(override = {}) {
  if (!nodemailer) return { ok: false, reason: 'Server chưa cài nodemailer' };
  const saved = await getSettings();
  const host = override.smtp_host ?? saved.smtp_host;
  const user = override.smtp_user ?? saved.smtp_user;
  const overridePass = (override.smtp_pass && override.smtp_pass.trim()) ? override.smtp_pass : null;

  // V2-12 (CHẶN PHÁT HÀNH): CHỈ được mượn mật khẩu đã lưu khi test ĐÚNG host+user đã lưu.
  // Nếu người gọi đổi host/user đích thì BẮT BUỘC nhập lại mật khẩu — không ghép credential
  // của KTX với một host do người gọi chỉ định, vì host đó sẽ bắt được mật khẩu ngay trên dây.
  const sameTarget = host === saved.smtp_host && user === saved.smtp_user;
  const pass = overridePass || (sameTarget ? saved.smtp_pass : null);
  if (!pass) {
    return { ok: false, reason: 'Đổi máy chủ hoặc tài khoản SMTP thì phải nhập lại mật khẩu (không dùng lại mật khẩu đã lưu cho máy chủ khác).' };
  }

  // V2-13: chặn host nội bộ/loopback/link-local -> không biến server thành máy quét cổng nội bộ.
  if (isPrivateHost(host)) {
    return { ok: false, reason: 'Máy chủ SMTP không hợp lệ (không nhận địa chỉ nội bộ/loopback).' };
  }
  // V2-14: cổng phải hợp lệ (đường /smtp/test trước đây không kiểm, chỉ đường PUT lưu mới kiểm).
  const port = override.smtp_port ?? saved.smtp_port;
  if (port != null && String(port).trim() !== '' && !isValidPort(port)) {
    return { ok: false, reason: 'Cổng SMTP không hợp lệ (1–65535).' };
  }

  const s = {
    smtp_host: host, smtp_port: port,
    smtp_secure: override.smtp_secure ?? saved.smtp_secure,
    smtp_user: user, smtp_pass: pass,
  };
  if (!s.smtp_host || !s.smtp_user || !s.smtp_pass) {
    return { ok: false, reason: 'Thiếu host / tài khoản / mật khẩu SMTP' };
  }
  try {
    await buildTransport(s).verify();
    return { ok: true };
  } catch (e) {
    // KHÔNG trả nguyên văn lỗi gốc (ECONNREFUSED/timeout/greeting) — phân biệt được các lỗi này
    // là vẽ được sơ đồ mạng nội bộ. Chỉ báo chung là kết nối không thành công.
    return { ok: false, reason: 'Không kết nối được tới máy chủ SMTP với cấu hình này. Kiểm tra lại host, cổng, tài khoản, mật khẩu.' };
  }
}

// Gửi thông báo vi phạm cho nhà trường
// student: { name, code, class_name, phone }, violations: [{date,type_name,severity,note}]
async function sendViolationMail(student, violations) {
  const s = await getSettings();
  if (!nodemailer) return { sent: false, reason: 'Server chưa cài nodemailer (npm i nodemailer)' };
  if (!smtpReady(s)) return { sent: false, reason: 'Chưa cấu hình SMTP / email nhà trường' };

  const list = (violations || []).map((v, i) =>
    `${i + 1}. ${fmt(v.date)} — ${v.type_name || 'Vi phạm'} [${SEV[v.severity] || v.severity}]${v.note ? ': ' + v.note : ''}`
  ).join('\n');

  const dorm = s.dorm_name || 'Ký túc xá';
  const subject = `[${dorm}] Thông báo vi phạm nội trú — Học viên ${student.name}`;
  const text =
`Kính gửi ${s.school_name || 'Nhà trường'},

Ban quản lý ${dorm} xin thông báo: học viên ${student.name}` +
`${student.code ? ' (MSHV ' + student.code + ')' : ''}${student.class_name ? ', lớp ' + student.class_name : ''}` +
` đã vi phạm nội quy ký túc xá ${violations.length} lần:

${list}

Kính đề nghị Nhà trường phối hợp nhắc nhở, xử lý. Trân trọng cảm ơn.

--
Ban quản lý ${dorm}${s.hotline ? '\nHotline: ' + s.hotline : ''}`;

  // M-4: escape HTML TRƯỚC rồi mới đổi xuống dòng thành <br>. Nếu không, tên học viên / ghi chú vi phạm
  // (do staff hoặc người nộp đơn nhập) chứa <a>, <img onerror> sẽ chèn thẳng vào email HTML gửi RA NGOÀI
  // cho nhà trường -> vector phishing/nội dung giả mạo trong thư "từ KTX". Escape sau khi đã nội suy biến,
  // trước khi thêm thẻ <br> (để thẻ br giữ nguyên, còn mọi ký tự trong biến thành text an toàn).
  const escHtml = str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = escHtml(text).replace(/\n/g, '<br>');

  try {
    const transporter = buildTransport(s);
    await transporter.sendMail({
      from: s.smtp_from || s.smtp_user,
      to: s.school_email,
      subject, text, html,
    });
    return { sent: true, to: s.school_email };
  } catch (e) {
    return { sent: false, reason: 'Lỗi gửi mail: ' + (e.message || e) };
  }
}

module.exports = { sendViolationMail, mailStatus, testConnection };
