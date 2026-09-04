const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { recalcInvoice } = require('../invoice-calc');
const { isValidYmd } = require('../valid');
const roomStays = require('../room-stays');
const meter = require('../meter');
const { badCheckoutDate, finalizeCheckout } = require('../checkout');
const { applyFacilityFilter, isExecutive, assertFacility } = require('../scope');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'staff'));

// Đa cơ sở: WHERE lọc theo cơ sở (qua HV s.facility_id). Điều hành: tuỳ chọn ?facility. Quản lý: ép.
function facilityWhere(req) {
  const cond = [], params = [];
  if (isExecutive(req)) {
    if (req.query.facility) { params.push(+req.query.facility); cond.push(`s.facility_id = $${params.length}`); }
  } else {
    applyFacilityFilter(req, 's.facility_id', cond, params);
  }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}
// Đa cơ sở: chặn thao tác lên đơn trả phòng / báo hư hỏng NGOÀI cơ sở người dùng (trả true nếu đã chặn).
async function blockByCheckoutReq(req, res, id) {
  if (isExecutive(req)) return false;
  const row = (await query('SELECT s.facility_id FROM checkout_requests c LEFT JOIN students s ON s.id=c.student_id WHERE c.id=$1', [id])).rows[0];
  if (!row) return false;
  const bad = assertFacility(req, row.facility_id);
  if (bad) { res.status(bad.status).json(bad); return true; }
  return false;
}
async function blockByDamage(req, res, id) {
  if (isExecutive(req)) return false;
  const row = (await query('SELECT COALESCE(s.facility_id, r.facility_id) AS fid FROM damage_reports d LEFT JOIN students s ON s.id=d.student_id LEFT JOIN rooms r ON r.id=d.room_id WHERE d.id=$1', [id])).rows[0];
  if (!row) return false;
  const bad = assertFacility(req, row.fid);
  if (bad) { res.status(bad.status).json(bad); return true; }
  return false;
}

/* ---- Báo cáo hư hỏng ---- */
router.get('/damage', async (req, res, next) => {
  try {
    const { where, params } = facilityWhere(req);
    const { rows } = await query(`
      SELECT d.*, s.name AS student_name, r.name AS room_name
      FROM damage_reports d
      LEFT JOIN students s ON s.id = d.student_id
      LEFT JOIN rooms r ON r.id = d.room_id
      ${where}
      ORDER BY (d.status<>'done') DESC, d.created_at DESC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

const TASK_STATUS = ['new', 'processing', 'blocked', 'done'];
router.put('/damage/:id', async (req, res, next) => {
  try {
    if (await blockByDamage(req, res, req.params.id)) return; // đa cơ sở
    // Trạng thái: chỉ đổi khi CÓ gửi và HỢP LỆ. Không gửi -> GIỮ nguyên (trước đây thiếu status là
    // reset về 'new', nên admin chỉ sửa ghi chú cho việc đang 'blocked' cũng làm mất trạng thái + lý do).
    const hasStatus = req.body.status != null && req.body.status !== '';
    if (hasStatus && !TASK_STATUS.includes(req.body.status))
      return res.status(400).json({ error: `Trạng thái không hợp lệ: "${req.body.status}". Chỉ nhận: ${TASK_STATUS.join(', ')}.` });
    const hasNote = req.body.admin_note != null;
    const { rows } = await query(
      `UPDATE damage_reports
         SET status = COALESCE($1, status),
             admin_note = CASE WHEN $2 THEN $3 ELSE admin_note END,
             resolved_at = CASE WHEN COALESCE($1,status)='done' THEN COALESCE(resolved_at, now()) ELSE NULL END
       WHERE id=$4 RETURNING *`,
      [hasStatus ? req.body.status : null, hasNote, req.body.admin_note || '', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Duyệt & chuyển bộ phận bảo trì (chỉ áp dụng báo hư hỏng phòng)
router.post('/damage/:id/assign', async (req, res, next) => {
  try {
    if (await blockByDamage(req, res, req.params.id)) return; // đa cơ sở
    const { rows } = await query(
      `UPDATE damage_reports SET assigned_at=now(), status=CASE WHEN status='done' THEN status ELSE 'processing' END
       WHERE id=$1 AND category='damage' RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy báo hư hỏng (chỉ chuyển được mục hư hỏng phòng)' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---- Đơn đăng ký trả phòng ---- */
router.get('/checkout', async (req, res, next) => {
  try {
    const { where, params } = facilityWhere(req);
    const { rows } = await query(`
      SELECT c.*, s.name AS student_name, s.deposit_status, r.name AS room_name
      FROM checkout_requests c
      LEFT JOIN students s ON s.id = c.student_id
      LEFT JOIN rooms r ON r.id = s.room_id
      ${where}
      ORDER BY (c.status='pending') DESC, c.created_at DESC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Xác nhận trả phòng: thực hiện check-out thật cho học viên
router.post('/checkout/:id/confirm', async (req, res, next) => {
  try {
    if (await blockByCheckoutReq(req, res, req.params.id)) return; // đa cơ sở
    const cr = (await query('SELECT * FROM checkout_requests WHERE id=$1', [req.params.id])).rows[0];
    if (!cr) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    // CHỈ duyệt đơn ĐANG CHỜ. Đơn đã xử lý mà bấm lại -> check-out chạy lần nữa, ghi thêm
    // một dòng nhật ký ra/vào, dời ngày trả phòng, tính lại tiền — chạy được vô hạn lần.
    if (cr.status !== 'pending')
      return res.status(409).json({ error: `Đơn này đã được xử lý (${cr.status === 'done' ? 'đã duyệt' : 'đã từ chối'}) — không thể duyệt lại.` });
    // Ngày trả: sai định dạng -> chặn, đừng để "abc" rơi xuống dưới làm sập 500.
    const date = req.body.date || cr.desired_date || new Date().toISOString().slice(0, 10);
    if (!isValidYmd(date)) return res.status(400).json({ error: `Ngày trả phòng không hợp lệ: "${date}"` });
    const noticeDate = cr.created_at ? new Date(cr.created_at).toISOString().slice(0, 10) : null;
    const st = await query('SELECT room_id, check_in_date FROM students WHERE id=$1 AND deleted_at IS NULL', [cr.student_id]);
    if (!st.rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên của đơn này' });
    const roomId = st.rows[0].room_id || null;
    // Ngày trả KHÔNG được trước ngày nhận phòng / trước ngày bắt đầu lượt ở hiện tại (BLK-3). Nếu lọt,
    // roomStays.checkOut cắt chặng ở mốc trước cả lúc vào (hoặc trước ngày chuyển phòng) -> XOÁ lịch sử
    // ở phòng -> tiền điện cả phòng chia lại sai cho mọi người.
    const badDate = await badCheckoutDate(null, cr.student_id, date, st.rows[0].check_in_date);
    if (badDate) return res.status(400).json({ error: badDate });

    // Chốt chỉ số điện ngày trả phòng (nếu người duyệt có nhập) — kiểm tra trước khi ghi
    const mr = req.body.meter_reading;
    const hasMeter = mr != null && String(mr).trim() !== '';
    if (hasMeter) {
      if (!roomId) return res.status(400).json({ error: 'Học viên không ở phòng nào — không có công-tơ để chốt chỉ số' });
      const err = await meter.checkRead(null, { roomId, date, reading: mr });
      if (err) return res.status(400).json({ error: err });
    }

    // CLAIM NGUYÊN TỬ trước khi check-out: chỉ MỘT request thắng `WHERE status='pending'`. Hai người bấm
    // duyệt cùng lúc (hoặc double-click) trước đây đều đọc 'pending' ở trên rồi CẢ HAI chạy check-out ->
    // ghi 2 dòng nhật ký ra/vào, tính lại tiền 2 lần. Giờ người sau rowCount=0 -> 409, KHÔNG chạy tiếp.
    // (Validate đã xong ở trên nên đơn vẫn 'pending' nếu có lỗi -> sửa rồi duyệt lại được.)
    const claim = await query(`UPDATE checkout_requests SET status='done', handled_at=now() WHERE id=$1 AND status='pending' RETURNING id`, [req.params.id]);
    if (!claim.rows[0]) return res.status(409).json({ error: 'Đơn đã được xử lý bởi thao tác khác — tải lại để xem trạng thái mới nhất.' });

    await query(`UPDATE students SET status='out', check_out_date=$1, checkout_notice_date=$2, checkout_reason=$3 WHERE id=$4`,
      [date, noticeDate, cr.reason, cr.student_id]);
    if (hasMeter) {
      await meter.recordRead(null, {
        roomId, date, reading: mr, reason: 'checkout', studentId: cr.student_id,
        note: 'Chốt chỉ số lúc trả phòng (duyệt đơn HV)', by: req.user && req.user.username,
      });
    }
    // source='admin': người THỰC HIỆN check-out là cán bộ duyệt đơn, không phải học viên.
    // Ghi 'self' (học viên tự làm) là nói dối nhật ký — tra ra sai người chịu trách nhiệm.
    await query(`INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out',$2,$3,$4,'admin')`,
      [cr.student_id, date, roomId, `Trả phòng (duyệt đơn HV, bởi ${req.user && req.user.username || 'cán bộ'})`]);
    // (Trạng thái đơn đã được CLAIM='done' ở trên — không update lại ở đây nữa.)

    // BLK-1: đóng lượt ở + đóng phòng trưởng + dọn phiếu kỳ sau + tính lại (trước đây đường này ĐÓNG
    // room_stays nhưng QUÊN đóng phòng trưởng và QUÊN dọn phiếu kỳ sau).
    const fin = await finalizeCheckout(null, { studentId: cr.student_id, date });
    // Chốt giữa kỳ đổi phần chia của cả phòng -> tính lại cho bạn cùng phòng khi có chốt công-tơ
    if (hasMeter) {
      for (const sid of await meter.affectedStudents(null, roomId, date)) {
        if (sid === cr.student_id) continue;
        try { await recalcInvoice(sid, date.slice(0, 7)); } catch (e) {}
      }
    }
    res.json({ ok: true, dropped_future_invoices: fin.dropped });
  } catch (e) { next(e); }
});

router.put('/checkout/:id/note', async (req, res, next) => {
  try {
    if (await blockByCheckoutReq(req, res, req.params.id)) return; // đa cơ sở
    const { rows } = await query('UPDATE checkout_requests SET admin_note=$1 WHERE id=$2 RETURNING id', [req.body.note || '', req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/checkout/:id/reject', async (req, res, next) => {
  try {
    if (await blockByCheckoutReq(req, res, req.params.id)) return; // đa cơ sở
    // Từ chối NGUYÊN TỬ: chỉ đổi khi VẪN 'pending'. Chống đua với duyệt (confirm) chạy song song —
    // trước đây SELECT-rồi-UPDATE cho cả hai lọt, đơn thành 'rejected' NHƯNG học viên đã bị check-out
    // thật (confirm thắng) -> mâu thuẫn vĩnh viễn. WHERE status='pending' + kiểm rowCount chặn việc đó.
    const r = await query(`UPDATE checkout_requests SET status='rejected', handled_at=now() WHERE id=$1 AND status='pending' RETURNING id`, [req.params.id]);
    if (!r.rows[0]) {
      const cur = (await query('SELECT status FROM checkout_requests WHERE id=$1', [req.params.id])).rows[0];
      if (!cur) return res.status(404).json({ error: 'Không tìm thấy đơn' }); // đừng trả {ok:true} cho đơn không có thật
      return res.status(409).json({ error: `Đơn này đã được xử lý (${cur.status === 'done' ? 'đã duyệt — học viên đã trả phòng' : 'đã từ chối'}) — không thể từ chối.` });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
