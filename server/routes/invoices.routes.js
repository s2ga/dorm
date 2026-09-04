const express = require('express');
const { query, pool, getSettings } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const billing = require('../billing');
const { recalcInvoice, roomRoster, studentElectric } = require('../invoice-calc');
const roomLeaders = require('../room-leaders');
const { isValidMonth } = require('../valid');
const vehCount = require('../vehicle-count');
const { applyFacilityFilter, isExecutive, assertFacility, userFacility } = require('../scope');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'staff'));

// Đa cơ sở: mọi thao tác trên /:id của một hoá đơn phải thuộc cơ sở người dùng được phép (qua HV).
router.param('id', async (req, res, next, id) => {
  try {
    if (isExecutive(req)) return next();
    if (!/^\d+$/.test(String(id))) return next();
    const row = (await query('SELECT s.facility_id FROM invoices i JOIN students s ON s.id=i.student_id WHERE i.id=$1', [id])).rows[0];
    if (!row) return next();
    const bad = assertFacility(req, row.facility_id);
    if (bad) return res.status(bad.status).json(bad);
    next();
  } catch (e) { next(e); }
});

// Mọi khoản tiền phải là số KHÔNG ÂM. Ô nhập có min=0 nhưng đó chỉ là thuộc tính HTML —
// gọi thẳng API thì room_charge=-99999999 vẫn lọt, kéo tụt doanh thu năm.
const MONEY_FIELDS = ['room_charge', 'electric_charge', 'water_charge', 'service_charge', 'washing_charge', 'parking_charge', 'other_charge', 'electric_kwh', 'days_stayed'];
function badMoney(b) {
  for (const k of MONEY_FIELDS) {
    if (b[k] === undefined || b[k] === null || b[k] === '') continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n)) return `"${k}" phải là số (đang nhận: "${b[k]}")`;
    if (n < 0) return `"${k}" không được âm (đang nhận: ${n})`;
  }
  return null;
}
// Số ngày trong một kỳ 'YYYY-MM'. Dùng để chặn days_stayed vô lý (TP-14): trước đây nhập 99999 ngày
// cho tháng 31 ngày cũng lưu, không có trần.
function daysInMonth(month) { const [y, m] = String(month).split('-').map(Number); return new Date(y, m, 0).getDate(); }
function badDays(b) {
  if (b.days_stayed == null || b.days_stayed === '' || !isValidMonth(b.month)) return null;
  const d = Number(b.days_stayed), dim = daysInMonth(b.month);
  if (Number.isFinite(d) && d > dim) return `Số ngày ở (${d}) vượt số ngày của tháng ${b.month} (${dim} ngày).`;
  return null;
}

// Tính lại 1 hóa đơn theo dữ liệu hiện tại (số ngày ở, dịch vụ...)
router.post('/:id/recalc', async (req, res, next) => {
  try {
    const inv = (await query('SELECT student_id, month, status FROM invoices WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!inv) return res.status(404).json({ error: 'Không tìm thấy hóa đơn' });
    // Bấm "Tính lại" trên phiếu ĐÃ THU -> chặn rõ ràng (TP-07). Trước đây recalc qua mặt khoá này,
    // total đổi sau lưng số đã chốt Bravo.
    if (inv.status === 'paid') return res.status(400).json({ error: 'Hoá đơn đã thu tiền — không tính lại được. Nếu cần điều chỉnh, chuyển trạng thái về "chưa thu" trước (thao tác này được ghi nhật ký).' });
    const updated = await recalcInvoice(inv.student_id, inv.month);
    res.json(updated);
  } catch (e) { next(e); }
});

const SELECT = `
  SELECT i.*, s.name AS student_name, s.code AS student_code, s.gender AS student_gender, r.name AS room_name
  FROM invoices i
  JOIN students s ON s.id = i.student_id
  LEFT JOIN rooms r ON r.id = i.room_id`;

router.get('/', async (req, res, next) => {
  try {
    const { month } = req.query;
    const cond = ['i.deleted_at IS NULL'];
    const params = [];
    if (month) { params.push(month); cond.push(`i.month=$${params.length}`); }
    // Đa cơ sở: điều hành lọc tuỳ chọn ?facility; quản lý cơ sở bị ÉP theo cơ sở của mình (theo HV).
    if (isExecutive(req)) {
      if (req.query.facility) { params.push(+req.query.facility); cond.push(`s.facility_id = $${params.length}`); }
    } else {
      applyFacilityFilter(req, 's.facility_id', cond, params);
    }
    const order = month ? 'ORDER BY s.name' : 'ORDER BY i.month DESC, s.name';
    const { rows } = await query(`${SELECT} WHERE ${cond.join(' AND ')} ${order}`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/months', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT DISTINCT month FROM invoices WHERE deleted_at IS NULL ORDER BY month DESC');
    res.json(rows.map(r => r.month));
  } catch (e) { next(e); }
});

// Tạo hóa đơn hàng loạt cho 1 tháng (dùng chỉ số điện + đơn giá + bộ tính tiền)
router.post('/generate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { month, readings } = req.body;
    const preview = !!req.body.preview; // xem trước: tính rồi ROLLBACK, không ghi gì
    // isValidMonth chứ không chỉ "!month": trước đây "xin-chao" làm sập 500 ở month.split('-'),
    // còn "9999-12" thì LƯU THẬT cả loạt phiếu rồi "9999" nhảy vào ô chọn năm của báo cáo (V2-69).
    if (!isValidMonth(month)) return res.status(400).json({ error: 'Kỳ (tháng) không hợp lệ — chọn dạng YYYY-MM.' });
    // Đa cơ sở: quản lý cơ sở chỉ ghi chỉ số cho phòng CƠ SỞ MÌNH (điều hành: mọi phòng).
    if (!isExecutive(req) && Array.isArray(readings) && readings.length) {
      const fid = userFacility(req);
      const roomFacs = (await query('SELECT id, facility_id FROM rooms WHERE id = ANY($1)', [readings.map(r => +r.room_id)])).rows;
      const outside = roomFacs.filter(x => x.facility_id !== fid).map(x => x.id);
      if (outside.length) { client.release(); return res.status(403).json({ error: `Có phòng không thuộc cơ sở bạn phụ trách (phòng #${outside.join(', #')}) — không lưu.` }); }
    }
    const fees = await getSettings();

    // TP-17: KIỂM chỉ số TRƯỚC transaction. Một phòng có chỉ số lùi (công-tơ vừa thay) trước đây làm
    // INSERT vi phạm ck_electric_sane -> ROLLBACK cả mẻ -> KHÔNG phiếu nào của cả KTX ra. Giờ báo 400
    // liệt kê phòng cần sửa, chưa động vào gì.
    const pmonth0 = (() => { const [py, pm2] = month.split('-').map(Number); const pd = new Date(py, pm2 - 2, 1); return `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`; })();
    if (Array.isArray(readings)) {
      const loi = [];
      for (const r of readings) {
        const end = Number(r.reading_end);
        if (!Number.isFinite(end) || end < 0) { loi.push(`phòng #${r.room_id}: chỉ số "${r.reading_end}" không hợp lệ`); continue; }
        const prev = await query('SELECT reading_end FROM electric_readings WHERE room_id=$1 AND month=$2', [r.room_id, pmonth0]);
        const start = r.reading_start != null && r.reading_start !== '' ? Number(r.reading_start) : (prev.rows[0] ? +prev.rows[0].reading_end : 0);
        if (!Number.isFinite(start) || start < 0 || end < start) loi.push(`phòng #${r.room_id}: chỉ số cuối (${end}) nhỏ hơn đầu kỳ (${start}) — kiểm lại`);
      }
      if (loi.length) {
        const ten = {}; (await query('SELECT id, name FROM rooms WHERE id = ANY($1)', [readings.map(r => r.room_id)])).rows.forEach(x => { ten[x.id] = x.name; });
        return res.status(400).json({ error: 'Chưa lập hoá đơn — có chỉ số điện chưa hợp lệ, sửa rồi làm lại:\n' + loi.map(l => l.replace(/phòng #(\d+)/, (m, id) => `phòng ${ten[id] || '#' + id}`)).join('\n') });
      }
    }

    await client.query('BEGIN');

    // Lưu chỉ số điện công-tơ (nếu gửi kèm): nhập số cuối, số đầu = số cuối tháng trước
    if (Array.isArray(readings)) {
      const pmonth = pmonth0;
      for (const r of readings) {
        const prev = await client.query('SELECT reading_end FROM electric_readings WHERE room_id=$1 AND month=$2', [r.room_id, pmonth]);
        const start = r.reading_start != null && r.reading_start !== '' ? Number(r.reading_start) : (prev.rows[0] ? +prev.rows[0].reading_end : 0);
        const end = Number(r.reading_end);
        const kwh = Math.max(0, end - start);
        await client.query(
          `INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (room_id, month) DO UPDATE SET reading_start=EXCLUDED.reading_start, reading_end=EXCLUDED.reading_end, kwh=EXCLUDED.kwh`,
          [r.room_id, month, start, end, kwh]
        );
      }
    }

    const mStart = billing.firstDay(month), mEnd = billing.lastDay(month);
    // Học viên có ở trong tháng (vào trước cuối tháng & chưa rời trước đầu tháng)
    // Chỉ lấy cột cần dùng (không kéo ảnh CCCD/base64) -> nhẹ RAM & băng thông.
    // Đa cơ sở: quản lý cơ sở chỉ lập hoá đơn cho HV CƠ SỞ MÌNH (điều hành: tất cả / lọc ?facility).
    const stCond = ['deleted_at IS NULL', 'check_in_date IS NOT NULL', 'check_in_date <= $1', '(check_out_date IS NULL OR check_out_date >= $2)'];
    const stParams = [mEnd, mStart];
    if (isExecutive(req)) {
      if (req.query.facility) { stParams.push(+req.query.facility); stCond.push(`facility_id = $${stParams.length}`); }
    } else {
      applyFacilityFilter(req, 'facility_id', stCond, stParams);
    }
    const students = (await client.query(
      `SELECT id, room_id, rental_type, check_in_date, check_out_date, uses_washing, uses_parking, room_fee_discount_pct
       FROM students
       WHERE ${stCond.join(' AND ')}`,
      stParams
    )).rows;

    // Chỉ số điện theo phòng
    const er = (await client.query('SELECT room_id, reading_start, reading_end, kwh FROM electric_readings WHERE month=$1', [month])).rows;
    const kwhByRoom = {}; er.forEach(r => { kwhByRoom[r.room_id] = Number(r.kwh); });

    // ---- TIỀN ĐIỆN TỪNG NGƯỜI: cắt chặng theo các lần chốt chỉ số giữa kỳ, cộng qua MỌI phòng họ ở ----
    // Hai chỗ cách cũ tính sai, cùng vì chỉ nhìn students.room_id (phòng HIỆN TẠI):
    //   1) người chuyển phòng giữa tháng -> phần điện ở phòng CŨ rơi mất, không ai trả;
    //   2) người ở lại phòng cũ -> gánh thay phần đó.
    const readsByRoom = {};
    (await client.query('SELECT room_id, read_date AS date, reading FROM meter_reads WHERE read_date >= $1 AND read_date <= $2 ORDER BY read_date', [mStart, mEnd]))
      .rows.forEach(r => { (readsByRoom[r.room_id] = readsByRoom[r.room_id] || []).push(r); });
    const staysByRoom = {};
    (await client.query(
      `SELECT rs.room_id, rs.student_id, rs.from_date AS from, rs.to_date AS to
         FROM room_stays rs JOIN students s ON s.id = rs.student_id
        WHERE s.deleted_at IS NULL AND rs.from_date <= $1 AND (rs.to_date IS NULL OR rs.to_date >= $2)`, [mEnd, mStart]))
      .rows.forEach(r => { (staysByRoom[r.room_id] = staysByRoom[r.room_id] || []).push(r); });

    const unit = Number(fees.electric_unit);
    const elecByStudent = {};
    for (const e of er) {
      const stays = staysByRoom[e.room_id];
      if (!stays || !stays.length) continue;
      const segs = billing.buildSegments({ month, startReading: e.reading_start, endReading: e.reading_end, reads: readsByRoom[e.room_id] || [], stays });
      const share = billing.splitElectricExact(segs.map(s => ({ electric: Number(s.kwh || 0) * unit, roster: s.roster })));
      // Ở phòng có chỉ số nhưng phần chia = 0 -> vẫn phải ghi 0, đừng để rơi về cách tính cũ
      stays.forEach(st => { if (elecByStudent[st.student_id] == null) elecByStudent[st.student_id] = 0; });
      for (const id of Object.keys(share)) elecByStudent[id] = (elecByStudent[id] || 0) + share[id];
    }

    // Danh sách người ở mỗi phòng KÈM SỐ NGÀY Ở (để chia điện theo ngày ở thực tế).
    // Trước đây chỉ đếm đầu người -> ai ở 1 ngày cũng gánh 1 suất điện như người ở cả tháng.
    const rosterByRoom = {};
    students.forEach(s => {
      if (!s.room_id) return;
      const d = billing.daysStayedInMonth(s, month);
      if (d > 0) (rosterByRoom[s.room_id] = rosterByRoom[s.room_id] || []).push({ student_id: s.id, days: d });
    });

    // Cache thông tin phòng
    const rooms = {};
    (await client.query('SELECT id, hang, monthly_fee, capacity FROM rooms')).rows.forEach(r => { rooms[r.id] = r; });

    // Số xe theo học viên CỦA THÁNG LẬP HOÁ ĐƠN (không phải số xe hôm nay) — xem vehicle-count.js
    const vehByStudent = await vehCount.countByStudentForMonth(month, (sql, p) => client.query(sql, p));

    // Số ngày làm PHÒNG TRƯỞNG trong kỳ, nạp 1 lần cho cả kỳ (đừng hỏi CSDL từng học viên một).
    // Cộng qua mọi nhiệm kỳ vì một người có thể làm trưởng 2 đoạn rời nhau trong cùng tháng.
    const leaderDaysByStudent = {};
    (await client.query(
      `SELECT student_id, from_date, to_date FROM room_leaders
        WHERE from_date <= $1 AND (to_date IS NULL OR to_date >= $2)`, [mEnd, mStart]))
      .rows.forEach(r => {
        const d = billing.daysStayedInRange(
          { check_in_date: String(r.from_date).slice(0, 10), check_out_date: r.to_date ? String(r.to_date).slice(0, 10) : null },
          mStart, mEnd);
        leaderDaysByStudent[r.student_id] = (leaderDaysByStudent[r.student_id] || 0) + d;
      });

    // Nạp sẵn hóa đơn hiện có của kỳ trong 1 truy vấn (diệt N+1: trước đây mỗi HV 1 SELECT)
    const existingByStudent = {};
    (await client.query('SELECT id, student_id, status, other_charge FROM invoices WHERE month=$1', [month])).rows
      .forEach(iv => { existingByStudent[iv.student_id] = iv; });

    let created = 0, updated = 0, skipped = 0;
    for (const s of students) {
      const dup = existingByStudent[s.id];
      if (dup && dup.status === 'paid') { skipped++; continue; } // đã đóng -> khóa, không sửa

      const room = s.room_id ? rooms[s.room_id] : null;
      const inv = billing.computeInvoice({
        student: s, room, month, fees,
        roster: s.room_id ? (rosterByRoom[s.room_id] || []) : [],
        electricCharge: elecByStudent[s.id] != null ? elecByStudent[s.id] : null,
        leaderDays: leaderDaysByStudent[s.id] || 0,
        kwh: s.room_id ? (kwhByRoom[s.room_id] || 0) : 0,
        vehicleCount: vehByStudent[s.id] || 0,
      });

      if (dup) {
        const other = Number(dup.other_charge) || 0;
        const total = billing.invoiceTotal({ ...inv, other_charge: other });  // 1 nguồn công thức (billing.js)
        await client.query(
          `UPDATE invoices SET days_stayed=$1, room_charge=$2, electric_kwh=$3, electric_charge=$4, water_charge=$5,
             service_charge=$6, washing_charge=$7, parking_charge=$8, leader_discount=$9, room_discount=$10,
             total=$11, deleted_at=NULL WHERE id=$12`,
          [inv.days_stayed, inv.room_charge, inv.electric_kwh, inv.electric_charge, inv.water_charge,
           inv.service_charge, inv.washing_charge, inv.parking_charge, inv.leader_discount, inv.room_discount, total, dup.id]
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, electric_kwh, electric_charge,
             water_charge, service_charge, washing_charge, parking_charge, leader_discount, room_discount, other_charge, total, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')`,
          [s.id, s.room_id, month, inv.days_stayed, inv.room_charge, inv.electric_kwh, inv.electric_charge,
           inv.water_charge, inv.service_charge, inv.washing_charge, inv.parking_charge,
           inv.leader_discount, inv.room_discount, inv.other_charge, inv.total]
        );
        created++;
      }
    }
    if (preview) {
      await client.query('ROLLBACK'); // xem trước: không lưu gì
      return res.json({ preview: true, created, updated, skipped, total: students.length });
    }
    await client.query('COMMIT');
    res.json({ created, updated, skipped, total: students.length });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

// Tạo/cập nhật hóa đơn TỰ TÍNH cho 1 học viên (vd HV mới vào giữa tháng)
router.post('/generate-one', async (req, res, next) => {
  try {
    const { student_id, month } = req.body;
    if (!student_id) return res.status(400).json({ error: 'Thiếu học viên' });
    if (!isValidMonth(month)) return res.status(400).json({ error: 'Kỳ (tháng) không hợp lệ — chọn dạng YYYY-MM.' });
    const fees = await getSettings();
    const s = (await query('SELECT * FROM students WHERE id=$1', [student_id])).rows[0];
    if (!s) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const badF = assertFacility(req, s.facility_id); if (badF) return res.status(badF.status).json(badF); // đa cơ sở
    const dup = (await query('SELECT id, status, other_charge FROM invoices WHERE student_id=$1 AND month=$2', [student_id, month])).rows[0];
    if (dup && dup.status === 'paid') return res.status(400).json({ error: 'Hóa đơn kỳ này đã đóng — không sửa' });

    const room = s.room_id ? (await query('SELECT * FROM rooms WHERE id=$1', [s.room_id])).rows[0] : null;
    // Danh sách người ở phòng kèm số ngày ở -> chia điện theo ngày ở thực tế
    const roster = await roomRoster(s.room_id, month);
    const kwhRow = s.room_id ? (await query('SELECT kwh FROM electric_readings WHERE room_id=$1 AND month=$2', [s.room_id, month])).rows[0] : null;
    const vehicleCnt = await vehCount.countForMonth(student_id, month);
    // Cộng phần điện ở MỌI phòng HV ở trong tháng (chuyển phòng giữa tháng vẫn tính đủ)
    const electricCharge = await studentElectric(student_id, month, Number(fees.electric_unit));
    const leaderDays = await roomLeaders.leaderDaysInMonth(null, student_id, month);

    const inv = billing.computeInvoice({ student: s, room, month, fees, roster, electricCharge, leaderDays, kwh: kwhRow ? Number(kwhRow.kwh) : 0, vehicleCount: vehicleCnt });
    let row;
    if (dup) {
      const other = Number(dup.other_charge) || 0;
      const total = billing.invoiceTotal({ ...inv, other_charge: other });  // 1 nguồn công thức (billing.js)
      row = (await query(
        `UPDATE invoices SET days_stayed=$1, room_charge=$2, electric_kwh=$3, electric_charge=$4, water_charge=$5,
           service_charge=$6, washing_charge=$7, parking_charge=$8, leader_discount=$9, room_discount=$10,
           total=$11, deleted_at=NULL WHERE id=$12 RETURNING *`,
        [inv.days_stayed, inv.room_charge, inv.electric_kwh, inv.electric_charge, inv.water_charge,
         inv.service_charge, inv.washing_charge, inv.parking_charge, inv.leader_discount, inv.room_discount, total, dup.id])).rows[0];
    } else {
      try {
        row = (await query(
          `INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, electric_kwh, electric_charge,
             water_charge, service_charge, washing_charge, parking_charge, leader_discount, room_discount, other_charge, total, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending') RETURNING *`,
          [student_id, s.room_id, month, inv.days_stayed, inv.room_charge, inv.electric_kwh, inv.electric_charge,
           inv.water_charge, inv.service_charge, inv.washing_charge, inv.parking_charge,
           inv.leader_discount, inv.room_discount, inv.other_charge, inv.total])).rows[0];
      } catch (e) {
        // TP-35: hai request cùng lúc -> cái sau va UNIQUE(student_id,month) (23505). Không để 500 thô;
        // trả về phiếu vừa được cái kia tạo (coi như thành công, không tạo trùng).
        if (e.code === '23505') {
          row = (await query('SELECT * FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL', [student_id, month])).rows[0];
          return res.json({ ok: true, invoice: row, created: false, race: true });
        }
        throw e;
      }
    }
    res.json({ ok: true, invoice: row, created: !dup });
  } catch (e) { next(e); }
});

// Hóa đơn lẻ (nhập tay từng khoản)
router.post('/', async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.student_id || !b.month) return res.status(400).json({ error: 'Thiếu học viên hoặc kỳ' });
    // Kỳ phải có thật (chặn "2026-13", "xyz" -> làm hỏng ràng buộc 1-HV-1-phiếu-mỗi-kỳ và báo cáo năm)
    if (!isValidMonth(b.month)) return res.status(400).json({ error: `Kỳ không hợp lệ: "${b.month}". Định dạng đúng: YYYY-MM (tháng 01–12).` });
    const neg = badMoney(b);
    if (neg) return res.status(400).json({ error: neg });
    const badD = badDays(b);
    if (badD) return res.status(400).json({ error: badD });
    const st = await query('SELECT room_id, facility_id FROM students WHERE id=$1', [b.student_id]);
    if (!st.rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const badF = assertFacility(req, st.rows[0].facility_id); if (badF) return res.status(badF.status).json(badF); // đa cơ sở
    const roomId = st.rows[0].room_id || null;
    const total = billing.invoiceTotal(b);  // 1 nguồn công thức (billing.js); body không có discount -> 0
    const vals = [b.student_id, roomId, b.month, +b.days_stayed || 0, +b.room_charge || 0,
      +b.electric_kwh || 0, +b.electric_charge || 0, +b.water_charge || 0, +b.service_charge || 0,
      +b.washing_charge || 0, +b.parking_charge || 0, +b.other_charge || 0, b.other_note || '', total];

    // Đã có hóa đơn kỳ này? (kể cả bản đã xóa mềm — tránh vi phạm ràng buộc UNIQUE)
    const ex = (await query('SELECT id, deleted_at FROM invoices WHERE student_id=$1 AND month=$2', [b.student_id, b.month])).rows[0];
    if (ex && !ex.deleted_at) return res.status(400).json({ error: 'Học viên đã có hóa đơn trong kỳ này' });
    if (ex && ex.deleted_at) {
      // hồi sinh hóa đơn đã xóa mềm bằng dữ liệu mới nhập
      const { rows } = await query(
        `UPDATE invoices SET room_id=$2, days_stayed=$4, room_charge=$5, electric_kwh=$6, electric_charge=$7,
           water_charge=$8, service_charge=$9, washing_charge=$10, parking_charge=$11, other_charge=$12,
           other_note=$13, total=$14, status='pending', paid_date=NULL, deleted_at=NULL WHERE id=$15 RETURNING *`,
        [...vals, ex.id]);
      return res.status(201).json(rows[0]);
    }
    const { rows } = await query(
      `INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, electric_kwh, electric_charge,
         water_charge, service_charge, washing_charge, parking_charge, other_charge, other_note, total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') RETURNING *`, vals);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Học viên đã có hóa đơn trong kỳ này' });
    next(e);
  }
});

// Sửa hóa đơn (tính lại tổng)
router.put('/:id', async (req, res, next) => {
  try {
    const b = req.body;
    const neg = badMoney(b);
    if (neg) return res.status(400).json({ error: neg });
    // KHÓA hoá đơn đã thu tiền: số đã chốt với Bravo không được sửa sau lưng
    const cur = (await query('SELECT status, leader_discount, room_discount, month FROM invoices WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy hóa đơn' });
    if (cur.status === 'paid') return res.status(400).json({ error: 'Hoá đơn đã thu tiền — không sửa được. Nếu cần điều chỉnh, chuyển trạng thái về "chưa thu" trước (thao tác này được ghi nhật ký).' });
    const badD = badDays({ days_stayed: b.days_stayed, month: cur.month });
    if (badD) return res.status(400).json({ error: badD });
    // total = tổng 7 phí − CÁC KHOẢN GIẢM (phòng trưởng, giảm %). Trước đây PUT KHÔNG trừ giảm nên
    // total lệch đúng bằng khoản giảm, và ba đường (generate/recalc/PUT) ra ba số (TP-08/11).
    // Hai cột giảm không nằm trong ô sửa nên GIỮ nguyên (lấy từ cur) và trừ vào total.
    const giam = (+cur.leader_discount || 0) + (+cur.room_discount || 0);
    // 1 nguồn công thức (billing.js). Discount không nằm trong ô sửa nên lấy từ bản ghi hiện tại (cur).
    const total = billing.invoiceTotal({ ...b, leader_discount: cur.leader_discount, room_discount: cur.room_discount });
    // BLK-7: total = Σphí − giảm có thể ÂM nếu giảm > tổng phí (vd sửa phí nhỏ trên phiếu phòng trưởng).
    // badMoney chỉ chặn từng cột phí <0, KHÔNG kiểm total. Chốt DB ck_invoices_no_negative có thể VẮNG
    // ở boot đầu của DB mới → chặn thẳng ở tầng API, không phụ thuộc DB.
    if (total < 0) return res.status(400).json({ error: `Tổng tiền âm (${total}đ): tổng 7 khoản phí (${total + giam}đ) nhỏ hơn khoản giảm (${giam}đ). Kiểm lại các khoản.` });
    const { rows } = await query(
      `UPDATE invoices SET days_stayed=$1, room_charge=$2, electric_kwh=$3, electric_charge=$4,
         water_charge=$5, service_charge=$6, washing_charge=$7, parking_charge=$8, other_charge=$9,
         other_note=$10, total=$11, note=$12 WHERE id=$13 RETURNING *`,
      [+b.days_stayed || 0, +b.room_charge || 0, +b.electric_kwh || 0, +b.electric_charge || 0,
       +b.water_charge || 0, +b.service_charge || 0, +b.washing_charge || 0, +b.parking_charge || 0,
       +b.other_charge || 0, b.other_note || '', total, b.note || '', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy hóa đơn' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Đánh dấu đã thu hàng loạt — CHỈ cho ĐÚNG MỘT KỲ, chỉ admin, bắt buộc xác nhận.
// Trước đây: bỏ trống month = đánh dấu đã thu TOÀN BỘ mọi kỳ, mọi HV, không hoàn tác (nhân viên cũng gọi được).
// Không có màn hình nào dùng chức năng này; giữ lại nhưng khoá chặt.
router.post('/mark-paid', requireRole('admin'), async (req, res, next) => {
  try {
    const month = String(req.body.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Phải chọn đúng một kỳ (dạng YYYY-MM). Không cho phép đánh dấu đã thu cho toàn bộ các kỳ.' });
    }
    if (req.body.confirm !== true) {
      const n = (await query(`SELECT COUNT(*)::int c FROM invoices WHERE month=$1 AND status<>'paid' AND deleted_at IS NULL`, [month])).rows[0].c;
      return res.status(400).json({ error: `Thao tác này sẽ đánh dấu ĐÃ THU cho ${n} phiếu của kỳ ${month} và KHÔNG hoàn tác được. Gửi lại kèm "confirm": true nếu chắc chắn.`, would_update: n, month });
    }
    const date = new Date().toISOString().slice(0, 10);
    const r = await query(
      `UPDATE invoices SET status='paid', paid_date=$1 WHERE month=$2 AND status<>'paid' AND deleted_at IS NULL RETURNING id`, [date, month]);
    res.json({ ok: true, updated: r.rows.length, month });
  } catch (e) { next(e); }
});

// Đổi trạng thái: pending | sent | paid
router.post('/:id/status', async (req, res, next) => {
  try {
    // TP-24: trạng thái LẠ ("PAID" hoa, "đã thu"...) trước đây âm thầm về 'pending' -> phiếu đã thu
    // bị lật về chưa thu mà không báo. Giờ báo lỗi rõ.
    if (!['pending', 'sent', 'paid'].includes(req.body.status))
      return res.status(400).json({ error: `Trạng thái không hợp lệ: "${req.body.status}" (chỉ 'pending', 'sent', 'paid').` });
    const status = req.body.status;
    const paidDate = status === 'paid' ? (req.body.date || new Date().toISOString().slice(0, 10)) : null;
    const cur = (await query('SELECT status, total FROM invoices WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy hóa đơn' });
    const { rows } = await query(
      `UPDATE invoices SET status=$1, paid_date=$2 WHERE id=$3 AND deleted_at IS NULL RETURNING *`,
      [status, paidDate, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy hóa đơn' });
    // TP-10: GỠ trạng thái "đã thu" là thao tác nhạy cảm (mở đường sửa số đã chốt). Ghi nhật ký kèm
    // total để về sau tra ra "số này từng là bao nhiêu, ai gỡ, khi nào". Đặc biệt paid -> chưa thu.
    if (cur.status !== status) {
      pool.query(
        `INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,'STATUS',$4,$5)`,
        [req.user?.id || null, req.user?.username || '', req.user?.role || '', `/api/invoices/${req.params.id}`,
         `Đổi trạng thái "${cur.status}" → "${status}" · total tại thời điểm đổi = ${cur.total}`]
      ).catch(() => {});
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Xóa mềm (lập lại hóa đơn kỳ này sẽ hồi sinh với số liệu mới)
router.delete('/:id', async (req, res, next) => {
  try {
    // Xoá phiếu ĐÃ THU = xoá doanh thu đã ghi nhận -> tổng "đã thu" tụt (TP-09). Chặn ở server, không
    // chỉ confirm() phía UI. Muốn bỏ phiếu đã thu thì chuyển "chưa thu" trước (có ghi nhật ký).
    const inv = (await query('SELECT status FROM invoices WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!inv) return res.status(404).json({ error: 'Không tìm thấy hóa đơn' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'Hoá đơn đã thu tiền — không xoá được. Nếu cần huỷ, chuyển trạng thái về "chưa thu" trước (thao tác này được ghi nhật ký).' });
    await query('UPDATE invoices SET deleted_at=now() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
