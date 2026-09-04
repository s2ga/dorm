const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { recalcInvoice } = require('../invoice-calc');
const { isValidYmd } = require('../valid');
const { badCheckoutDate, finalizeCheckout } = require('../checkout');
const { isExecutive, userFacility, assertFacility } = require('../scope');

const router = express.Router();
router.use(requireAuth, requireRole('maintenance', 'admin'));

// Đa cơ sở: bảo trì/an ninh CHỈ thấy việc thuộc cơ sở mình. Trả thêm mệnh đề AND (append params).
//   col: cột facility_id trong truy vấn (vd 's.facility_id' hoặc 'facility_id' khi không join).
// Điều hành (admin, facility_id null): thấy tất cả (lọc tuỳ chọn ?facility). Bảo trì/quản lý: ÉP.
function facClause(req, params, col) {
  if (isExecutive(req)) {
    if (req.query.facility) { params.push(+req.query.facility); return ` AND ${col} = $${params.length}`; }
    return '';
  }
  params.push(userFacility(req)); return ` AND ${col} = $${params.length}`;
}

const curMonth = () => new Date().toISOString().slice(0, 7);
const isMonth = m => /^\d{4}-\d{2}$/.test(m || '');
// Vòng đời việc bảo trì — MỘT bộ trạng thái dùng chung. 'blocked' = chưa xử lý được (kèm lý do).
// Admin sửa ghi chú (requests.routes PUT /damage/:id) phải chấp nhận CÙNG bộ này, nếu không
// việc đang 'blocked' bị admin đụng vào là rơi về 'new', mất luôn lý do (V2-40c).
const TASK_STATUS = ['new', 'processing', 'blocked', 'done'];

// Danh sách bàn giao phòng theo tháng — bảo trì CHỈ thấy: tên, phòng, ngày, xác nhận, ghi chú
router.get('/handovers', async (req, res, next) => {
  try {
    const month = isMonth(req.query.month) ? req.query.month : curMonth();
    const pIn = [month]; const facIn = facClause(req, pIn, 's.facility_id');
    const checkins = (await query(`
      SELECT s.id, s.name, r.name AS room_name, s.check_in_date AS date,
             s.checkin_confirmed_at, s.checkin_confirm_note
      FROM students s LEFT JOIN rooms r ON r.id = s.room_id
      WHERE s.deleted_at IS NULL AND to_char(s.check_in_date,'YYYY-MM')=$1${facIn}
      ORDER BY s.check_in_date, s.name`, pIn)).rows;
    const pOut = [month]; const facOut = facClause(req, pOut, 's.facility_id');
    const checkouts = (await query(`
      SELECT s.id, s.name, r.name AS room_name, s.check_out_date AS date,
             s.checkout_confirmed_at, s.checkout_actual_date, s.checkout_confirm_note
      FROM students s LEFT JOIN rooms r ON r.id = s.room_id
      WHERE s.deleted_at IS NULL AND to_char(s.check_out_date,'YYYY-MM')=$1${facOut}
      ORDER BY s.check_out_date, s.name`, pOut)).rows;
    res.json({ month, checkins, checkouts });
  } catch (e) { next(e); }
});

// Số việc bàn giao chưa xác nhận (tháng này) — cho thông báo
router.get('/handovers/summary', async (req, res, next) => {
  try {
    const m = curMonth();
    const pCi = [m]; const fCi = facClause(req, pCi, 'facility_id');
    const ci = (await query(`SELECT COUNT(*)::int c FROM students WHERE deleted_at IS NULL AND to_char(check_in_date,'YYYY-MM')=$1 AND checkin_confirmed_at IS NULL${fCi}`, pCi)).rows[0].c;
    const pCo = [m]; const fCo = facClause(req, pCo, 'facility_id');
    const co = (await query(`SELECT COUNT(*)::int c FROM students WHERE deleted_at IS NULL AND to_char(check_out_date,'YYYY-MM')=$1 AND checkout_confirmed_at IS NULL${fCo}`, pCo)).rows[0].c;
    res.json({ month: m, pendingCheckin: ci, pendingCheckout: co, pending: ci + co });
  } catch (e) { next(e); }
});

// Bảo trì xác nhận ĐÃ NHẬN phòng (bàn giao phòng cho HV)
router.post('/handovers/:id/checkin', async (req, res, next) => {
  try {
    const note = (req.body.note || '').trim();
    const cur = (await query('SELECT checkin_confirmed_at, facility_id FROM students WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const badF = assertFacility(req, cur.facility_id); if (badF) return res.status(badF.status).json(badF); // đa cơ sở
    // Xác nhận MỘT LẦN. Xác nhận lại sẽ ghi đè mốc bàn giao thật và (nếu note rỗng) xoá trắng ghi chú.
    if (cur.checkin_confirmed_at)
      return res.status(409).json({ error: 'Đã xác nhận nhận phòng trước đó — không xác nhận lại (tránh mất dấu lần bàn giao thật).' });
    await query(
      `UPDATE students SET checkin_confirmed_at=now(), checkin_confirm_note=$1
       WHERE id=$2 AND deleted_at IS NULL`, [note, req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Bảo trì xác nhận ĐÃ TRẢ phòng (kiểm tài sản, thu chìa khóa) — ghi ngày thực tế, cập nhật để tính phiếu đúng
router.post('/handovers/:id/checkout', async (req, res, next) => {
  try {
    const note = (req.body.note || '').trim();
    const actual = isValidYmd(req.body.actual_date) ? req.body.actual_date : null;
    if (!actual) return res.status(400).json({ error: 'Chọn ngày trả phòng thực tế hợp lệ' });
    const today = new Date().toISOString().slice(0, 10);
    // Đây là xác nhận ĐÃ TRẢ phòng THỰC TẾ — theo định nghĩa việc đó đã xảy ra rồi, KHÔNG thể ở
    // tương lai. Trước đây nhận ngày 2199 -> ghi vào CSDL, tính lại phiếu tháng "2199-12" (không có)
    // nên tiền không tính lại, dữ liệu một đằng tiền một nẻo.
    if (actual > today)
      return res.status(400).json({ error: 'Ngày trả phòng thực tế không thể ở tương lai.' });
    // Ngày trả không thể TRƯỚC ngày nhận phòng / trước ngày bắt đầu lượt ở hiện tại (BLK-3)
    const cur = (await query('SELECT check_in_date, facility_id, checkout_confirmed_at, status FROM students WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const badF = assertFacility(req, cur.facility_id); if (badF) return res.status(badF.status).json(badF); // đa cơ sở
    // Xác nhận MỘT LẦN (giống đường checkin). Xác nhận lại sẽ ghi đè ngày trả thật + chạy finalizeCheckout
    // lần nữa (đóng lượt ở/dọn phiếu lại) -> dữ liệu lệch. Chặn ngay khi đã 'out'/đã xác nhận.
    if (cur.checkout_confirmed_at || cur.status === 'out')
      return res.status(409).json({ error: 'Đã xác nhận trả phòng trước đó — không xác nhận lại (tránh mất dấu lần bàn giao thật).' });
    const badDate = await badCheckoutDate(null, +req.params.id, actual, cur.check_in_date);
    if (badDate) return res.status(400).json({ error: badDate });
    // WHERE checkout_confirmed_at IS NULL: CLAIM nguyên tử — 2 người xác nhận cùng lúc thì chỉ 1 thắng.
    const { rows } = await query(
      `UPDATE students SET checkout_confirmed_at=now(), checkout_actual_date=$1, checkout_confirm_note=$2,
         check_out_date=$1, status='out'
       WHERE id=$3 AND deleted_at IS NULL AND checkout_confirmed_at IS NULL RETURNING id, room_id`, [actual, note, req.params.id]);
    if (!rows[0]) return res.status(409).json({ error: 'Đơn vừa được xác nhận bởi thao tác khác.' });
    // source theo VAI người thực hiện — bảo trì thì ghi 'maintenance', không ghi cứng 'admin' (V2-43)
    const src = req.user && req.user.role === 'maintenance' ? 'maintenance' : 'admin';
    try { await query(`INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out',$2,$3,$4,$5)`,
      [req.params.id, actual, rows[0].room_id || null, 'Bảo trì xác nhận trả phòng thực tế', src]); } catch (e) {}
    // BLK-1: trước đây đường bảo trì CHỈ recalc — bỏ đóng lượt ở (room_stays), bỏ đóng phòng trưởng,
    // bỏ dọn phiếu kỳ sau. Giờ gọi phần CHUNG như 2 đường kia.
    const fin = await finalizeCheckout(null, { studentId: +req.params.id, date: actual });
    res.json({ ok: true, actual_date: actual, dropped_future_invoices: fin.dropped });
  } catch (e) { next(e); }
});

// Danh sách công việc bảo trì (báo hư hỏng đã được admin chuyển)
router.get('/tasks', async (req, res, next) => {
  try {
    const params = []; const fac = facClause(req, params, 'COALESCE(s.facility_id, r.facility_id)');
    const { rows } = await query(`
      SELECT d.*, s.name AS student_name, s.phone AS student_phone, r.name AS room_name
      FROM damage_reports d
      LEFT JOIN students s ON s.id = d.student_id
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.category='damage' AND d.assigned_at IS NOT NULL${fac}
      ORDER BY (d.status<>'done') DESC, d.assigned_at DESC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Số việc cần xử lý (cho thông báo)
router.get('/summary', async (req, res, next) => {
  try {
    const params = []; const fac = facClause(req, params, 'COALESCE(s.facility_id, r.facility_id)');
    const n = (await query(
      `SELECT COUNT(*)::int c FROM damage_reports d
         LEFT JOIN students s ON s.id=d.student_id LEFT JOIN rooms r ON r.id=d.room_id
        WHERE d.category='damage' AND d.assigned_at IS NOT NULL AND d.status<>'done'${fac}`, params)).rows[0].c;
    res.json({ pending: n });
  } catch (e) { next(e); }
});

// Bảo trì cập nhật tiến độ: đang xử lý / chưa xử lý được (kèm lý do) / đã xong (kèm ghi chú)
router.post('/tasks/:id/status', async (req, res, next) => {
  try {
    // Trạng thái LẠ (gõ sai "donee") -> BÁO LỖI, đừng lặng lẽ ép về 'processing': làm vậy thì
    // việc ĐÃ XONG bị lùi về đang xử lý và ngày hoàn thành bị xoá mà không ai biết.
    if (!TASK_STATUS.includes(req.body.status))
      return res.status(400).json({ error: `Trạng thái không hợp lệ: "${req.body.status}". Chỉ nhận: ${TASK_STATUS.join(', ')}.` });
    const status = req.body.status;
    const note = (req.body.note || '').trim();
    if (status === 'blocked' && !note) return res.status(400).json({ error: 'Nhập lý do chưa xử lý được' });
    // Đa cơ sở: bảo trì chỉ cập nhật việc thuộc cơ sở mình.
    const tf = (await query(`SELECT COALESCE(s.facility_id, r.facility_id) AS fid FROM damage_reports d
      LEFT JOIN students s ON s.id=d.student_id LEFT JOIN rooms r ON r.id=d.room_id
      WHERE d.id=$1 AND d.category='damage' AND d.assigned_at IS NOT NULL`, [req.params.id])).rows[0];
    if (!tf) return res.status(404).json({ error: 'Không tìm thấy công việc' });
    const badF = assertFacility(req, tf.fid); if (badF) return res.status(badF.status).json(badF);
    // Ghi chú: chỉ ĐÈ khi có nhập; note rỗng -> GIỮ ghi chú cũ (trước đây luôn ghi đè -> xoá trắng).
    // resolved_at: chỉ đặt khi 'done'; rời khỏi 'done' thì xoá (đúng), nhưng vì đã chặn trạng thái lạ
    // ở trên nên việc done không bị vô cớ lùi nữa.
    const { rows } = await query(
      `UPDATE damage_reports
         SET status=$1,
             admin_note = CASE WHEN $2='' THEN admin_note ELSE $2 END,
             resolved_at = CASE WHEN $1='done' THEN now() ELSE NULL END
       WHERE id=$3 AND category='damage' AND assigned_at IS NOT NULL RETURNING *`,
      [status, note, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy công việc' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
