const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { applyFacilityFilter, isExecutive } = require('../scope');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// Đa cơ sở cho báo cáo doanh thu: điều hành (facility_id null) thấy TỔNG mọi cơ sở (lọc tuỳ chọn
// ?facility); admin phụ trách một cơ sở chỉ thấy số liệu cơ sở mình. Trả điều kiện AND (qua HV).
function revenueFacility(req, params) {
  if (isExecutive(req)) {
    if (req.query.facility) { params.push(+req.query.facility); return ` AND s.facility_id = $${params.length}`; }
    return '';
  }
  const cond = []; applyFacilityFilter(req, 's.facility_id', cond, params);
  return cond.length ? ' AND ' + cond.join(' AND ') : '';
}

// Doanh thu theo tháng, tách từng dịch vụ. ?year=YYYY (mặc định: tất cả)
router.get('/revenue', async (req, res, next) => {
  try {
    const year = req.query.year;
    const params = [];
    // Loại phiếu đã xoá VÀ phiếu của HỌC VIÊN ĐÃ XOÁ.
    // Trước đây chỉ lọc i.deleted_at -> xoá học viên xong, tiền của họ VẪN nằm trong doanh thu:
    // báo cáo có khoản thu của người không còn tồn tại, không tra ra được là ai, không ai đi thu.
    let where = 'WHERE i.deleted_at IS NULL AND s.deleted_at IS NULL';
    // year phải đúng 4 chữ số. Trước đây ghép thẳng "year + '-%'" rồi LIKE -> "?year=%" thành "%-%"
    // khớp MỌI tháng, vô hiệu hoá bộ lọc năm (V2-70). Dùng so tiền tố chính xác thay vì LIKE.
    if (year != null && year !== '') {
      if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Năm không hợp lệ (cần 4 chữ số).' });
      params.push(year); where += ` AND substr(i.month,1,4) = $${params.length}`;
    }
    where += revenueFacility(req, params);
    const { rows } = await query(`
      SELECT i.month,
        COALESCE(SUM(i.room_charge),0) AS room,
        COALESCE(SUM(i.electric_charge),0) AS electric,
        COALESCE(SUM(i.water_charge),0) AS water,
        COALESCE(SUM(i.service_charge),0) AS service,
        COALESCE(SUM(i.washing_charge),0) AS washing,
        COALESCE(SUM(i.parking_charge),0) AS parking,
        COALESCE(SUM(i.other_charge),0) AS other,
        COALESCE(SUM(i.total),0) AS total,
        COUNT(*)::int AS count
      FROM invoices i JOIN students s ON s.id = i.student_id ${where}
      GROUP BY i.month ORDER BY i.month`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Các năm có dữ liệu hóa đơn — PHẢI lọc y hệt /revenue (JOIN students, loại HV đã xoá), nếu không
// năm mà toàn bộ phiếu thuộc HV đã xoá vẫn hiện trong ô chọn, bấm vào thì /revenue trả rỗng ->
// báo cáo trắng không lời giải thích (V2-69b). Hai đường phải cho cùng một câu trả lời.
router.get('/years', async (req, res, next) => {
  try {
    const params = [];
    const facWhere = revenueFacility(req, params);
    const { rows } = await query(
      `SELECT DISTINCT substr(i.month,1,4) AS y
         FROM invoices i JOIN students s ON s.id = i.student_id
        WHERE i.deleted_at IS NULL AND s.deleted_at IS NULL${facWhere}
        ORDER BY y DESC`, params);
    res.json(rows.map(r => r.y));
  } catch (e) { next(e); }
});

module.exports = router;
