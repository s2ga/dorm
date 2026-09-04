require('./load-env'); // nạp .env khi chạy local (phải trước khi đọc process.env)
// BLK-5: ghim múi giờ tiến trình = giờ Việt Nam TRƯỚC mọi lần dùng Date. Render/Docker (node-alpine)
// mặc định UTC nên new Date().toISOString().slice(0,10) trả NGÀY HÔM QUA khung 00:00–07:00 giờ VN →
// lệch ngày nhận/trả phòng, cọc, vi phạm... Node đọc lại process.env.TZ khi tính Date nên đặt ở đây là
// đủ; cho phép biến môi trường có sẵn ghi đè (|| ). Tầng Postgres đặt riêng ở db.js.
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { generateIcons } = require('./gen-icons');

try { generateIcons(); } catch (e) { console.warn('Không sinh được icon:', e.message); }

const app = express();
app.set('trust proxy', 1); // sau proxy Render → lấy đúng IP client cho rate-limit

// Security headers + CSP. scriptSrc KHÔNG còn 'unsafe-inline' (CHẶNG 5: đã bỏ hết inline onclick/on* →
// event delegation trong app-actions.js) → chặn được XSS chèn <script>/onclick. styleSrc VẪN giữ
// 'unsafe-inline' vì app còn nhiều style="..." nội tuyến. KHÔNG dùng upgradeInsecureRequests (giữ http localhost).
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ['https://www.google.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));

// Body JSON: route nhận ảnh base64 (CCCD/giới thiệu) cần body lớn; các route còn lại siết nhỏ để giảm DoS.
// Parser lớn chạy TRƯỚC cho các path upload → parser nhỏ phía sau tự bỏ qua (body đã parse).
const jsonBig = express.json({ limit: '16mb' });
app.use(['/api/public', '/api/students', '/api/applications', '/api/media', '/api/invoices', '/api/settings'], jsonBig);
app.use(express.json({ limit: '2mb' }));

// Rate-limit: chặn brute-force login + lạm dụng API
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau ít phút.' } });
// Chống dò mật khẩu = đếm lần ĐĂNG NHẬP SAI. skipSuccessfulRequests: đăng nhập ĐÚNG không bị tính.
// Trước đây đếm cả lần đúng -> người dùng thật đăng nhập nhiều thiết bị / hết phiên vài lần là bị khoá,
// mà câu báo lỗi lại nói "đăng nhập sai quá nhiều lần" — sai sự thật, không ai hiểu tại sao mình bị chặn.
// M-3: đếm theo IP + TÊN ĐĂNG NHẬP, không chỉ theo IP. Cả KTX (~240 người) ra Internet bằng MỘT IP
// NAT — nếu khoá theo IP thì vài người gõ nhầm mật khẩu là KHOÁ CẢ NHÀ đăng nhập (sáng đầu tháng
// nhiều người quên mật khẩu = kẹt hết). Rào THẬT chống dò mật khẩu là login-guard.js (khoá theo TỪNG
// tài khoản: 10 sai/15ph). Limiter này chỉ là net phụ, nên tách theo tài khoản để không phạt hàng xóm.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, skipSuccessfulRequests: true,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String((req.body && req.body.username) || (req.user && req.user.username) || '').toLowerCase().trim()}`,
  message: { error: 'Đăng nhập sai quá nhiều lần với tài khoản này. Vui lòng đợi vài phút rồi thử lại.' },
});
// Nộp đơn đăng ký: đường DUY NHẤT cho người HOÀN TOÀN ẨN DANH ghi vào CSDL và đẩy ảnh lên S3,
// lại đi qua parser 16MB. Trần chung 600/phút quá rộng: đo thật thấy 40 đơn giống hệt nhau
// lọt hết trong 142ms.
// Chặn theo PHÚT chứ không theo giờ, và để rộng tay: học viên thường nộp đơn từ wifi chung
// của trường — cả phòng máy đi ra Internet bằng MỘT IP. Siết theo giờ thì mùa tuyển sinh
// người thứ 7 trở đi bị chặn oan mà không hiểu vì sao. Chặn theo phút cắt được trận dồn dập
// (thứ mà máy làm) nhưng không cản nổi người thật gõ tay (thứ mà người làm).
// Việc chống "một người gửi lại nhiều lần" là của chốt chống trùng tên+SĐT trong public.routes.js.
const applyLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Có quá nhiều đơn gửi lên cùng lúc từ mạng của bạn. Vui lòng đợi một phút rồi thử lại, hoặc gọi hotline để được hỗ trợ.' },
});
app.use('/api', apiLimiter);
app.use('/api/public/apply', applyLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/change-password', authLimiter);

// Log gọn các request API
app.use('/api', (req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

// Đường GET NHẠY CẢM cần ghi vết việc ĐỌC (không chỉ việc ghi): xem ảnh CCCD, đọc trang sức khoẻ
// dữ liệu (lộ danh sách CCCD/tên), đọc chính nhật ký. Với dữ liệu cá nhân (Nghị định 13),
// việc ĐỌC mới là thứ cần lưu vết.
const GET_NHAY_CAM = [/\/cccd\//i, /\/data-health/i, /\/admin\/audit/i];
const ipCua = req => (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || '?';

// Nhật ký thao tác (audit)
app.use('/api', (req, res, next) => {
  const method = req.method;
  const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  const isSensitiveGet = method === 'GET' && GET_NHAY_CAM.some(re => re.test(req.path));
  // /auth/* tự ghi nhật ký đăng nhập riêng (login-guard) -> bỏ ở đây để không ghi trùng.
  if ((!isWrite && !isSensitiveGet) || /^\/auth\//.test(req.path)) return next();
  res.on('finish', () => {
    try {
      const denied = res.statusCode === 401 || res.statusCode === 403;
      if (req.body && req.body.preview === true) return;       // xem trước hóa đơn (ROLLBACK) -> không ghi
      if (!req.user) {
        // Chưa gắn được danh tính. Vẫn ghi khi BỊ TỪ CHỐI mà có mang token/cookie — đó là dấu hiệu
        // DÒ token / dùng vé đã thu hồi (V2-64). Yêu cầu ẩn danh bình thường (không token) thì bỏ qua.
        const coToken = !!(req.headers.authorization || /(?:^|;\s*)ktx_token=/.test(req.headers.cookie || ''));
        if (!(denied && coToken)) return;
      } else if (!denied && res.statusCode >= 400) {
        return;                                                // lỗi không-phải-từ-chối (400 validate) -> bỏ cho đỡ nhiễu
      }
      let detail = '';
      try {
        const b = req.body || {}, c = {};
        for (const k of Object.keys(b)) {
          if (/password|cccd|image|data|smtp_pass|token/i.test(k)) c[k] = '***';
          else if (typeof b[k] === 'string' && b[k].length > 100) c[k] = b[k].slice(0, 100) + '…';
          else c[k] = b[k];
        }
        const tag = denied ? `[TỪ CHỐI ${res.statusCode}] ` : (isSensitiveGet ? '[ĐỌC] ' : '');
        detail = tag + JSON.stringify({ ...c, ip: ipCua(req) }).slice(0, 460);
      } catch (e) {}
      db.pool.query(
        'INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user?.id || null, req.user?.username || '(chưa đăng nhập)', req.user?.role || '', method, req.originalUrl.split('?')[0], detail]
      ).catch(() => {});
    } catch (e) {}
  });
  next();
});

// ---- API ----
app.use('/api/public', require('./routes/public.routes')); // không cần đăng nhập
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/applications', require('./routes/applications.routes'));
app.use('/api/requests', require('./routes/requests.routes'));
app.use('/api/violations', require('./routes/violations.routes'));
app.use('/api/media', require('./routes/media.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/settings', require('./routes/settings.routes'));
app.use('/api/facilities', require('./routes/facilities.routes'));
app.use('/api/rooms', require('./routes/rooms.routes'));
app.use('/api/students', require('./routes/students.routes'));
app.use('/api/electric', require('./routes/electric.routes'));
app.use('/api/vehicles', require('./routes/vehicles.routes'));
app.use('/api/assets', require('./routes/assets.routes'));
app.use('/api/invoices', require('./routes/invoices.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/logs', require('./routes/logs.routes'));
app.use('/api/me', require('./routes/me.routes'));
app.use('/api/maintenance', require('./routes/maintenance.routes'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- PWA / Frontend tĩnh ----
const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub));

// SPA fallback: mọi đường dẫn không phải /api trả về index.html
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(pub, 'index.html'));
});

// Xử lý lỗi tập trung. Lỗi có err.status 4xx -> trả message cho client; còn lại -> 500 chung (không lộ chi tiết nội bộ).
app.use((err, req, res, next) => {
  const status = (err && Number(err.status) >= 400 && Number(err.status) < 500) ? Number(err.status) : 500;
  if (status >= 500) console.error('❌', err);
  // Body vượt trần parser -> body-parser ném 413 với message TIẾNG ANH "request entity too large".
  // Dịch sang tiếng Việt: toàn app tiếng Việt, đừng để riêng lúc lỗi lại nói tiếng Anh khó hiểu.
  if (status === 413 || (err && err.type === 'entity.too.large'))
    return res.status(413).json({ error: 'Tệp tải lên quá lớn. Vui lòng chọn tệp nhỏ hơn (ảnh ~6MB, PDF ~10MB).' });
  res.status(status).json({ error: status >= 500 ? 'Lỗi máy chủ' : (err.message || 'Yêu cầu không hợp lệ') });
});

const PORT = process.env.PORT || 3000;

db.init()
  .then(() => {
    const server = app.listen(PORT, () => console.log(`🚀 Ứng dụng chạy tại http://localhost:${PORT}`));
    // Graceful shutdown: ngừng nhận request mới, đóng pool, thoát sạch (khi Render redeploy/SIGTERM)
    const shutdown = (sig) => {
      console.log(`\n${sig} — đang tắt máy chủ...`);
      server.close(() => { db.pool.end().catch(() => {}).finally(() => process.exit(0)); });
      setTimeout(() => process.exit(1), 10000).unref(); // ép thoát nếu treo quá 10s
    };
    ['SIGTERM', 'SIGINT'].forEach(s => process.on(s, () => shutdown(s)));
  })
  .catch(err => {
    console.error('Không khởi động được:', err);
    process.exit(1);
  });
