const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { applyFacilityFilter, isExecutive, assertFacility } = require('../scope');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'staff'));

// Đa cơ sở: thao tác trên /:id của một xe phải thuộc cơ sở người dùng (qua HV chủ xe).
router.param('id', async (req, res, next, id) => {
  try {
    if (isExecutive(req)) return next();
    if (!/^\d+$/.test(String(id))) return next();
    const row = (await query('SELECT s.facility_id FROM vehicles v JOIN students s ON s.id=v.student_id WHERE v.id=$1', [id])).rows[0];
    if (!row) return next();
    const bad = assertFacility(req, row.facility_id);
    if (bad) return res.status(bad.status).json(bad);
    next();
  } catch (e) { next(e); }
});

// Chuẩn hoá biển số để so trùng: bỏ mọi ký tự không phải chữ/số, viết hoa.
// "63-B4 508.58" và "63B450858" là CÙNG một xe -> phải nhận ra là trùng (V2-22).
const chuanBien = p => String(p || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// Danh sách xe (kèm thông tin học viên + phòng + trạng thái ở)
router.get('/', async (req, res, next) => {
  try {
    // Đa cơ sở: điều hành lọc tuỳ chọn ?facility; quản lý cơ sở bị ÉP theo cơ sở của mình (qua HV).
    const cond = ['v.deleted_at IS NULL', 's.deleted_at IS NULL'];
    const params = [];
    if (isExecutive(req)) {
      if (req.query.facility) { params.push(+req.query.facility); cond.push(`s.facility_id = $${params.length}`); }
    } else {
      applyFacilityFilter(req, 's.facility_id', cond, params);
    }
    const { rows } = await query(`
      SELECT v.*, s.name AS student_name, s.status AS student_status, s.check_out_date,
        r.name AS room_name, r.gender AS room_gender
      FROM vehicles v
      JOIN students s ON s.id = v.student_id
      LEFT JOIN rooms r ON r.id = s.room_id
      WHERE ${cond.join(' AND ')}
      ORDER BY r.name, s.name`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { student_id, plate, vehicle_type, sticker, note } = req.body;
    const sid = +student_id;
    if (!sid) return res.status(400).json({ error: 'Thiếu học viên' });
    // Học viên phải TỒN TẠI + chưa xoá. Trước đây student_id=99999 hoặc "abc" -> FK ném 23503 -> 500;
    // giờ báo 400 có nghĩa (V2-25).
    const st = (await query(
      `SELECT id, facility_id, status, check_in_date, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL`, [sid])).rows[0];
    if (!st) return res.status(400).json({ error: 'Học viên không tồn tại hoặc đã xoá' });
    const badF = assertFacility(req, st.facility_id); if (badF) return res.status(badF.status).json(badF); // đa cơ sở
    // Không đăng ký xe cho HV đã TRẢ PHÒNG (đang ở = status 'in' + đã tới ngày nhận & chưa tới ngày trả).
    // Khác /me/washing, /me/damage đã chặn — đường này trước đây chỉ kiểm deleted_at nên tạo được xe rác.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const occupying = st.status === 'in'
      && (!st.check_in_date || String(st.check_in_date).slice(0, 10) <= today)
      && (!st.check_out_date || String(st.check_out_date).slice(0, 10) > today);
    if (!occupying) return res.status(400).json({ error: 'Học viên đã trả phòng (hoặc chưa tới ngày nhận phòng) — không đăng ký xe.' });

    // Biển số BẮT BUỘC — không cho biển rỗng (biển rỗng lọt qua unique index, nhân phí gửi xe
    // tuỳ ý: 10 xe biển rỗng = +1.000.000đ/tháng) (V2-21).
    if (!plate || !plate.trim()) return res.status(400).json({ error: 'Biển số xe là bắt buộc' });
    // Trùng biển (kể cả khác format dấu chấm/gạch) -> 400 có nghĩa thay vì 500 do unique index (V2-22).
    const bien = chuanBien(plate);
    const trung = await query(
      `SELECT s.name FROM vehicles v JOIN students s ON s.id=v.student_id
        WHERE v.deleted_at IS NULL AND regexp_replace(upper(v.plate),'[^0-9A-Z]','','g') = $1`, [bien]);
    if (trung.rows.length) return res.status(400).json({ error: `Biển số này đã đăng ký cho học viên ${trung.rows[0].name}` });
    try {
      const { rows } = await query(
        `INSERT INTO vehicles (student_id, plate, vehicle_type, sticker, note, from_date) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE) RETURNING *`,
        [sid, plate.trim(), vehicle_type || '', sticker || '', note || '']
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: 'Biển số này đã tồn tại' });
      throw e;
    }
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const b = req.body;
    // Chỉ đổi field CÓ gửi lên (COALESCE) — trước đây sửa mỗi "loại xe" cũng ghi đè biển số + mã
    // dán về rỗng vì luôn ghi cả 4 cột (V2-25).
    if (b.plate != null && !String(b.plate).trim()) return res.status(400).json({ error: 'Biển số không được để trống' });
    if (b.plate != null) {
      const bien = chuanBien(b.plate);
      const trung = await query(
        `SELECT s.name FROM vehicles v JOIN students s ON s.id=v.student_id
          WHERE v.deleted_at IS NULL AND v.id<>$2 AND regexp_replace(upper(v.plate),'[^0-9A-Z]','','g') = $1`, [bien, req.params.id]);
      if (trung.rows.length) return res.status(400).json({ error: `Biển số này đã đăng ký cho học viên ${trung.rows[0].name}` });
    }
    try {
      const { rows } = await query(
        `UPDATE vehicles SET
           plate = CASE WHEN $1::text IS NULL THEN plate ELSE $1 END,
           vehicle_type = CASE WHEN $2::text IS NULL THEN vehicle_type ELSE $2 END,
           sticker = CASE WHEN $3::text IS NULL THEN sticker ELSE $3 END,
           note = CASE WHEN $4::text IS NULL THEN note ELSE $4 END
         WHERE id=$5 AND deleted_at IS NULL RETURNING *`,
        [b.plate != null ? String(b.plate).trim() : null, b.vehicle_type != null ? String(b.vehicle_type) : null,
         b.sticker != null ? String(b.sticker) : null, b.note != null ? String(b.note) : null, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy xe' });
      res.json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: 'Biển số này đã tồn tại' });
      throw e;
    }
  } catch (e) { next(e); }
});

// Xóa mềm — ghi to_date để hoá đơn các tháng xe còn hiệu lực vẫn tính đúng, tháng sau thì thôi.
router.delete('/:id', async (req, res, next) => {
  try { await query('UPDATE vehicles SET deleted_at=now(), to_date=CURRENT_DATE WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { next(e); }
});

module.exports = router;
