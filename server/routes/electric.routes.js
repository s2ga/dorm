const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { isValidMonth } = require('../valid');
const { applyFacilityFilter, isExecutive, userFacility } = require('../scope');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'staff'));

// Tháng liền trước 'YYYY-MM'
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Chỉ số điện tất cả phòng trong 1 tháng: số đầu tự lấy = số cuối tháng trước
router.get('/', async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!isValidMonth(month)) return res.status(400).json({ error: 'Thiếu hoặc sai kỳ (tháng) — dạng YYYY-MM.' }); // TP-19: trước đây thiếu month -> 500 thô
    const pm = prevMonth(month);
    const cond = ['r.deleted_at IS NULL'];
    const params = [month, pm];
    // Đa cơ sở: điều hành lọc tuỳ chọn ?facility; quản lý cơ sở bị ÉP theo cơ sở của mình.
    if (isExecutive(req)) {
      if (req.query.facility) { params.push(+req.query.facility); cond.push(`r.facility_id = $${params.length}`); }
    } else {
      applyFacilityFilter(req, 'r.facility_id', cond, params);
    }
    const { rows } = await query(`
      SELECT r.id AS room_id, r.name AS room_name, r.floor, r.gender,
        COALESCE(e.reading_end, 0) AS reading_end,
        COALESCE(e.reading_start, prev.reading_end, 0) AS reading_start,
        COALESCE(e.kwh, 0) AS kwh,
        (SELECT COUNT(*) FROM students s WHERE s.room_id=r.id AND s.deleted_at IS NULL
           AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE))::int AS occupancy
      FROM rooms r
      LEFT JOIN electric_readings e ON e.room_id=r.id AND e.month=$1
      LEFT JOIN electric_readings prev ON prev.room_id=r.id AND prev.month=$2
      WHERE ${cond.join(' AND ')}
      ORDER BY r.floor, r.name`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Lịch sử tiêu thụ điện theo phòng (n tháng gần nhất) — để so sánh + vẽ biểu đồ
router.get('/history', async (req, res, next) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const n = Math.min(12, Math.max(2, +req.query.n || 6));
    const [y, m] = month.split('-').map(Number);
    const months = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(y, m - 1 - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const { rows } = await query(
      `SELECT er.room_id, er.month, er.kwh, r.name AS room_name, r.floor
       FROM electric_readings er JOIN rooms r ON r.id=er.room_id
       WHERE er.month = ANY($1) AND r.deleted_at IS NULL
       ORDER BY r.floor, r.name`, [months]);
    const byRoom = {};
    rows.forEach(x => {
      const b = byRoom[x.room_id] || (byRoom[x.room_id] = { room_id: x.room_id, room_name: x.room_name, floor: x.floor, kwh: {} });
      b.kwh[x.month] = Number(x.kwh);
    });
    const roomsOut = Object.values(byRoom)
      .map(r => ({ room_id: r.room_id, room_name: r.room_name, series: months.map(mo => ({ month: mo, kwh: r.kwh[mo] || 0 })) }))
      .filter(r => r.series.some(s => s.kwh > 0));
    res.json({ months, rooms: roomsOut });
  } catch (e) { next(e); }
});

// Lưu nhiều chỉ số điện cho 1 tháng (nhập số cuối; số đầu = số cuối tháng trước)
router.post('/bulk', async (req, res, next) => {
  try {
    const { month, readings } = req.body; // readings: [{room_id, reading_end}]
    if (!isValidMonth(month) || !Array.isArray(readings)) return res.status(400).json({ error: 'Thiếu hoặc sai dữ liệu (kỳ YYYY-MM + danh sách chỉ số).' });
    // Đa cơ sở: quản lý cơ sở chỉ ghi chỉ số cho phòng CƠ SỞ MÌNH (điều hành: mọi phòng).
    if (!isExecutive(req) && readings.length) {
      const fid = userFacility(req);
      const roomFacs = (await query('SELECT id, facility_id FROM rooms WHERE id = ANY($1)', [readings.map(r => +r.room_id)])).rows;
      const outside = roomFacs.filter(x => x.facility_id !== fid).map(x => x.id);
      if (outside.length) return res.status(403).json({ error: `Có phòng không thuộc cơ sở bạn phụ trách (phòng #${outside.join(', #')}) — không lưu.` });
    }
    const pm = prevMonth(month);

    // KIỂM TRƯỚC toàn bộ, gom lỗi, chưa ghi gì. Sai thì báo hết một lần, KHÔNG lưu nửa chừng (TP-18/20).
    const chuan = [];
    const loi = [];
    for (const r of readings) {
      const end = Number(r.reading_end);
      if (!Number.isFinite(end) || end < 0) { loi.push(`phòng #${r.room_id}: chỉ số "${r.reading_end}" không hợp lệ`); continue; }
      const prev = await query('SELECT reading_end FROM electric_readings WHERE room_id=$1 AND month=$2', [r.room_id, pm]);
      const start = r.reading_start != null && r.reading_start !== '' ? Number(r.reading_start) : (prev.rows[0] ? +prev.rows[0].reading_end : 0);
      if (!Number.isFinite(start) || start < 0) { loi.push(`phòng #${r.room_id}: số đầu kỳ không hợp lệ`); continue; }
      // Chỉ số LÙI (số cuối < số đầu) — công-tơ vừa thay hoặc gõ nhầm. Không tự nuốt thành kWh=0 (mất
      // tiền điện phòng đó), báo để sửa. Trước đây làm cả mẻ generate sập 500 (TP-17).
      if (end < start) { loi.push(`phòng #${r.room_id}: chỉ số cuối (${end}) NHỎ HƠN đầu kỳ (${start}) — công-tơ mới thay? kiểm lại`); continue; }
      chuan.push({ room_id: r.room_id, start, end, kwh: end - start });
    }
    if (loi.length) {
      // Kèm tên phòng cho dễ hiểu
      const ten = {}; (await query('SELECT id, name FROM rooms WHERE id = ANY($1)', [readings.map(r => r.room_id)])).rows.forEach(x => { ten[x.id] = x.name; });
      return res.status(400).json({ error: 'Không lưu — có chỉ số chưa hợp lệ, vui lòng sửa rồi lưu lại:\n' + loi.map(l => l.replace(/phòng #(\d+)/, (m, id) => `phòng ${ten[id] || '#' + id}`)).join('\n') });
    }
    // Ghi TẤT CẢ trong một giao dịch — all-or-nothing.
    await withTransaction(async (client) => {
      for (const r of chuan) {
        await client.query(
          `INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (room_id, month) DO UPDATE SET reading_start=EXCLUDED.reading_start, reading_end=EXCLUDED.reading_end, kwh=EXCLUDED.kwh`,
          [r.room_id, month, r.start, r.end, r.kwh]);
      }
    });
    res.json({ ok: true, saved: chuan.length });
  } catch (e) { next(e); }
});

module.exports = router;
