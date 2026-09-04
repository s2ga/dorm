const express = require('express');
const { query, getSettings } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { cccdUrls } = require('../cccd-url');
const { isValidYmd } = require('../valid');
const chores = require('../chores');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

// Chặn tài khoản role='student' nhưng KHÔNG gắn hồ sơ học viên nào (student_id NULL).
// Nếu lọt, mọi truy vấn "WHERE student_id=$1" với $1=NULL không khớp gì (NULL=NULL là UNKNOWN),
// nên chốt "1 đơn chờ duyệt" vô hiệu -> gửi vô hạn đơn (V2-49); và các trang khác trả rỗng vô nghĩa.
router.use((req, res, next) => {
  if (req.user.student_id == null)
    return res.status(403).json({ error: 'Tài khoản chưa được gắn với hồ sơ học viên. Vui lòng liên hệ ban quản lý.' });
  next();
});

// Cột GHI CHÚ NỘI BỘ của staff — KHÔNG bao giờ trả cho học viên. Trước đây /profile dùng SELECT s.*
// nên lộ "note" (ghi chú của staff về HV), "deposit_deduction_note", các ghi chú bàn giao.
const CHU_NOI_BO = ['note', 'deposit_deduction_note', 'checkin_confirm_note', 'checkout_confirm_note'];
function boChuNoiBo(row) {
  if (!row) return row;
  for (const k of CHU_NOI_BO) delete row[k];
  return row;
}

// Hồ sơ của chính học viên đang đăng nhập
router.get('/profile', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT s.*, r.name AS room_name, r.floor AS room_floor, r.monthly_fee,
        EXISTS (SELECT 1 FROM room_leaders rl
                 WHERE rl.student_id=s.id AND rl.room_id=s.room_id AND rl.to_date IS NULL) AS is_leader
      FROM students s LEFT JOIN rooms r ON r.id = s.room_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`, [req.user.student_id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy hồ sơ học viên' });
    // Kèm đơn giá máy giặt/gửi xe để hiển thị dịch vụ tự đăng ký (HV không được gọi /settings)
    const s = await getSettings();
    // Có nội quy chưa — trả kèm ở đây thay vì để client đi thử gọi file rồi ăn 404.
    // Chưa tải nội quy thì MỌI học viên mở trang đều dính một lỗi 404 đỏ lòm trong console.
    const rules = (await query(`SELECT 1 FROM media WHERE key='noi-quy' AND path IS NOT NULL`)).rows[0];
    res.json({ ...boChuNoiBo(cccdUrls(rows[0])), washing_fee: s.washing_fee, parking_fee: s.parking_fee, has_rules: !!rules });
  } catch (e) { next(e); }
});

// Bạn cùng phòng (chỉ tên) — HV đang ở cùng phòng, không lộ SĐT/thông tin khác
router.get('/roommates', async (req, res, next) => {
  try {
    const me = (await query('SELECT room_id FROM students WHERE id=$1 AND deleted_at IS NULL', [req.user.student_id])).rows[0];
    if (!me || !me.room_id) return res.json([]);
    // Kèm cờ phòng trưởng để học viên biết trong phòng ai là người BQL giao quản lý.
    // Sắp phòng trưởng lên đầu — đó là thông tin người ta cần tìm trước tiên.
    const { rows } = await query(
      `SELECT s.name,
         EXISTS (SELECT 1 FROM room_leaders rl
                  WHERE rl.student_id=s.id AND rl.room_id=$1 AND rl.to_date IS NULL) AS is_leader
       FROM students s
       WHERE s.room_id=$1 AND s.id<>$2 AND s.deleted_at IS NULL
         AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE)
       ORDER BY is_leader DESC, s.name`, [me.room_id, req.user.student_id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// Cơ sở vật chất trong phòng. Học viên KHÔNG gọi được /api/assets (chỉ admin/staff) nên mở đường riêng.
// Chỉ trả những gì họ cần biết — đặc biệt là PHÍ BỒI HOÀN, vì khoản này bị trừ thẳng vào tiền cọc
// lúc trả phòng. Không cho biết trước rồi lúc trừ tiền mới nói là không sòng phẳng.
router.get('/assets', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT name, unit, category, quantity, fee, note FROM assets
        WHERE deleted_at IS NULL ORDER BY category DESC, sort, name`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Lịch trực nhật của phòng — 4 tuần tới, xoay vòng theo tuần
router.get('/chores', async (req, res, next) => {
  try {
    const me = (await query('SELECT room_id FROM students WHERE id=$1 AND deleted_at IS NULL', [req.user.student_id])).rows[0];
    if (!me || !me.room_id) return res.json([]);
    const { rows } = await query(
      `SELECT id, name, check_in_date, check_out_date FROM students
        WHERE room_id=$1 AND deleted_at IS NULL AND check_in_date IS NOT NULL
          AND (check_out_date IS NULL OR check_out_date >= CURRENT_DATE)`, [me.room_id]);
    const today = new Date().toISOString().slice(0, 10);
    const list = chores.schedule({ members: rows, today, weeks: 4 });
    res.json(list.map(w => ({ ...w, is_me: w.student_id === req.user.student_id })));
  } catch (e) { next(e); }
});

// Tự đăng ký / hủy dịch vụ máy giặt (khi vào ở mới phát sinh nhu cầu)
router.post('/washing', async (req, res, next) => {
  try {
    // Chỉ HV đang ở mới được thay đổi dịch vụ (đã trả phòng thì không)
    const st = (await query('SELECT status, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL', [req.user.student_id])).rows[0];
    const today = new Date().toISOString().slice(0, 10);
    const occupying = st && st.status === 'in' && (!st.check_out_date || String(st.check_out_date).slice(0, 10) > today);
    if (!occupying) return res.status(400).json({ error: 'Bạn không còn ở ký túc xá nên không thể thay đổi dịch vụ.' });
    const on = req.body.on !== false; // mặc định = đăng ký (true)
    await query('UPDATE students SET uses_washing=$1 WHERE id=$2 AND deleted_at IS NULL', [on, req.user.student_id]);
    res.json({ ok: true, uses_washing: on });
  } catch (e) { next(e); }
});

// Hóa đơn của học viên
router.get('/invoices', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM invoices WHERE student_id=$1 AND deleted_at IS NULL ORDER BY month DESC', [req.user.student_id]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/logs', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM logs WHERE student_id=$1 ORDER BY date DESC, id DESC LIMIT 100', [req.user.student_id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// Vi phạm / nhắc nhở của chính học viên (chỉ đọc)
router.get('/violations', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT date, type_name, severity, level, note, status FROM violations WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date DESC, id DESC', [req.user.student_id]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ---- Báo cáo hư hỏng ---- */
router.get('/damage', async (req, res, next) => {
  try {
    // Liệt kê cột tường minh, BỎ admin_note (ghi chú xử lý nội bộ, vd "khong cho gia han").
    // SELECT * từng lộ thẳng cho học viên — giống cách /violations đã cố ý tránh.
    const { rows } = await query(
      `SELECT id, category, title, description, status, assigned_at, resolved_at, created_at
       FROM damage_reports WHERE student_id=$1 ORDER BY created_at DESC`, [req.user.student_id]);
    res.json(rows);
  } catch (e) { next(e); }
});
router.post('/damage', async (req, res, next) => {
  try {
    const { title, description } = req.body;
    const category = ['damage', 'violation', 'other'].includes(req.body.category) ? req.body.category : 'damage';
    if (!title || !title.trim()) return res.status(400).json({ error: 'Nhập nội dung yêu cầu hỗ trợ' });
    if (title.length > 200) return res.status(400).json({ error: 'Tiêu đề quá dài (tối đa 200 ký tự)' });
    if (description && description.length > 5000) return res.status(400).json({ error: 'Nội dung quá dài (tối đa 5000 ký tự)' });
    // Đã trả phòng thì không gửi báo hỏng nữa (giống /washing đã chặn). Trước đây đường này bỏ ngỏ,
    // HV đã đi vẫn spam được báo hỏng với mô tả 200KB.
    const st = (await query('SELECT room_id, status, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL', [req.user.student_id])).rows[0];
    const today = new Date().toISOString().slice(0, 10);
    const occupying = st && st.status === 'in' && (!st.check_out_date || String(st.check_out_date).slice(0, 10) > today);
    if (!occupying) return res.status(400).json({ error: 'Bạn không còn ở ký túc xá nên không thể gửi yêu cầu hỗ trợ.' });
    const { rows } = await query(
      `INSERT INTO damage_reports (student_id, room_id, category, title, description) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.student_id, st.room_id || null, category, title.trim(), description || '']
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

/* ---- Đơn đăng ký trả phòng ---- */
router.get('/checkout-request', async (req, res, next) => {
  try {
    // Bỏ admin_note (vd "nghi ngo bo tron") — ghi chú nội bộ, không cho học viên đọc.
    const { rows } = await query(
      `SELECT id, desired_date, reason, note, status, created_at, handled_at
       FROM checkout_requests WHERE student_id=$1 ORDER BY created_at DESC`, [req.user.student_id]);
    res.json(rows);
  } catch (e) { next(e); }
});
router.post('/checkout-request', async (req, res, next) => {
  try {
    const { desired_date, reason, note } = req.body;
    if (note && note.length > 2000) return res.status(400).json({ error: 'Ghi chú quá dài (tối đa 2000 ký tự)' });
    if (desired_date && !isValidYmd(desired_date)) return res.status(400).json({ error: 'Ngày trả phòng không hợp lệ' });
    if (desired_date && desired_date < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Ngày trả phòng phải từ hôm nay trở đi' });
    // Chặn trên: ngày trả xa quá N ngày là gõ nhầm (vd 2199). Nếu nhận, HV tự khoá mình —
    // đơn "đang chờ" đó chặn mọi đơn thật sau này, mà HV không tự gỡ được. N = Cài đặt (mặc định 365).
    if (desired_date) {
      const maxDays = +(await getSettings()).checkout_max_future_days || 365;
      const max = new Date(); max.setDate(max.getDate() + maxDays);
      if (desired_date > max.toISOString().slice(0, 10))
        return res.status(400).json({ error: `Ngày trả phòng quá xa (chỉ nhận trong vòng ${maxDays} ngày tới). Vui lòng kiểm tra lại.` });
    }
    // Chặn HV chưa nhận phòng (ngày vào ở tương lai) — chưa ở thì không thể "trả phòng"
    const st = (await query('SELECT check_in_date FROM students WHERE id=$1 AND deleted_at IS NULL', [req.user.student_id])).rows[0];
    const today = new Date().toISOString().slice(0, 10);
    if (st && st.check_in_date && String(st.check_in_date).slice(0, 10) > today) {
      return res.status(400).json({ error: 'Bạn chưa đến ngày nhận phòng nên chưa thể gửi đơn trả phòng.' });
    }
    const pending = await query(`SELECT 1 FROM checkout_requests WHERE student_id=$1 AND status='pending'`, [req.user.student_id]);
    if (pending.rows.length) return res.status(400).json({ error: 'Bạn đã có đơn trả phòng đang chờ duyệt' });
    const { rows } = await query(
      `INSERT INTO checkout_requests (student_id, desired_date, reason, note) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.student_id, desired_date || null, ['departure', 'personal', 'facility', 'dropout', 'reserve', 'other'].includes(reason) ? reason : 'other', note || '']
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
