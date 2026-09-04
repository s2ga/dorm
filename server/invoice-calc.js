const { query, getSettings } = require('./db');
const billing = require('./billing');
const roomLeaders = require('./room-leaders');
const vehicleCount = require('./vehicle-count');

// Danh sách người ở 1 phòng trong kỳ + SỐ NGÀY Ở của từng người.
// Dùng để chia tiền điện theo ngày ở thực tế (thay cho cách chia đều đầu người).
async function roomRoster(roomId, month) {
  if (!roomId) return [];
  const { rows } = await query(
    `SELECT id, check_in_date, check_out_date FROM students
     WHERE room_id=$1 AND deleted_at IS NULL
       AND check_in_date <= $2 AND (check_out_date IS NULL OR check_out_date >= $3)`,
    [roomId, billing.lastDay(month), billing.firstDay(month)]);
  return rows
    .map(s => ({ student_id: s.id, days: billing.daysStayedInMonth(s, month) }))
    .filter(r => r.days > 0);
}

// Các CHẶNG tính điện của 1 phòng trong tháng, cắt theo những lần chốt chỉ số giữa kỳ.
// Dựa trên room_stays (lịch sử ở phòng) nên người đã CHUYỂN ĐI vẫn được tính đúng phần của họ
// ở phòng cũ — thứ mà cách cũ (đọc students.room_id hiện tại) làm mất dấu hoàn toàn.
async function roomSegments(roomId, month) {
  if (!roomId) return null;
  const er = (await query('SELECT reading_start, reading_end FROM electric_readings WHERE room_id=$1 AND month=$2', [roomId, month])).rows[0];
  if (!er) return null;

  const reads = (await query(
    'SELECT read_date AS date, reading FROM meter_reads WHERE room_id=$1 AND read_date >= $2 AND read_date <= $3 ORDER BY read_date',
    [roomId, billing.firstDay(month), billing.lastDay(month)])).rows;

  const stays = (await query(
    `SELECT rs.student_id, rs.from_date AS from, rs.to_date AS to
       FROM room_stays rs JOIN students s ON s.id = rs.student_id
      WHERE rs.room_id=$1 AND s.deleted_at IS NULL
        AND rs.from_date <= $2 AND (rs.to_date IS NULL OR rs.to_date >= $3)`,
    [roomId, billing.lastDay(month), billing.firstDay(month)])).rows;
  if (!stays.length) return null;

  return billing.buildSegments({
    month, startReading: er.reading_start, endReading: er.reading_end, reads, stays,
  });
}

// Tiền điện của MỘT học viên trong tháng = TỔNG phần của họ ở MỌI phòng họ từng ở trong tháng đó.
//
// Vì sao phải quét nhiều phòng: chuyển phòng giữa tháng thì students.room_id chỉ còn phòng MỚI.
// Tính theo phòng hiện tại -> phần điện họ đã dùng ở phòng CŨ rơi mất, không ai trả, tổng thu hụt.
//
// Làm tròn TỪNG PHÒNG RIÊNG (không gộp rồi mới làm tròn) để giữ đồng thời 2 điều:
//   - mỗi phòng: tổng các phần đúng bằng tiền điện của phòng đó;
//   - mỗi người: tiền điện = tổng phần của họ ở các phòng.
// Trả về null nếu chưa có dữ liệu chỉ số -> để bên gọi dùng cách tính cũ.
async function studentElectric(studentId, month, unit) {
  const { rows } = await query(
    `SELECT DISTINCT room_id FROM room_stays
      WHERE student_id=$1 AND from_date <= $2 AND (to_date IS NULL OR to_date >= $3)`,
    [studentId, billing.lastDay(month), billing.firstDay(month)]);
  let sum = 0, found = false;
  for (const r of rows) {
    const segs = await roomSegments(r.room_id, month);
    if (!segs) continue;
    found = true;
    const share = billing.splitElectricExact(segs.map(s => ({ electric: Number(s.kwh || 0) * unit, roster: s.roster })));
    sum += share[studentId] || 0;
  }
  return found ? sum : null;
}

// Tính lại 1 hóa đơn theo dữ liệu hiện tại: số ngày ở, hình thức thuê, dịch vụ,
// và tiền điện từ chỉ số công-tơ tháng đó (chia theo số ngày ở). Giữ khoản khác.
async function recalcInvoice(studentId, month) {
  const inv = (await query('SELECT * FROM invoices WHERE student_id=$1 AND month=$2', [studentId, month])).rows[0];
  if (!inv) return null;
  // KHOÁ "đã thu": hoá đơn đã thu tiền (đã chốt) thì KHÔNG tính lại — số đã chốt không đổi sau lưng.
  // recalc bị 9 nơi gọi tự động (bạn cùng phòng chuyển đi, trả phòng...) nên ở đây chỉ BỎ QUA (trả
  // phiếu nguyên trạng), không ném lỗi để khỏi làm gãy thao tác của người khác. Đường bấm "Tính lại"
  // trực tiếp thì báo 400 rõ ràng ở endpoint. Nếu số thật cần đổi -> chuyển "chưa thu" rồi tính lại.
  if (inv.status === 'paid') return inv;
  const s = (await query('SELECT * FROM students WHERE id=$1', [studentId])).rows[0];
  if (!s) return null;
  const room = s.room_id ? (await query('SELECT * FROM rooms WHERE id=$1', [s.room_id])).rows[0] : null;
  const fees = await getSettings();
  // Số xe CỦA THÁNG này (không phải số xe hôm nay): xe đã bán không sống lại, xe mua sau không
  // hồi tố vào tháng cũ. Trước đây thiếu cả deleted_at lẫn kỳ hiệu lực -> tính lại là tiền sai (V2-20/23).
  const veh = await vehicleCount.countForMonth(studentId, month);

  // Chỉ số điện + danh sách người ở phòng (kèm số ngày ở) để chia điện theo ngày
  let kwh = 0, roster = [];
  if (s.room_id) {
    const er = (await query('SELECT kwh FROM electric_readings WHERE room_id=$1 AND month=$2', [s.room_id, month])).rows[0];
    kwh = er ? Number(er.kwh) : 0;
    roster = await roomRoster(s.room_id, month);
  }
  // Quét MỌI phòng HV từng ở trong tháng (không chỉ phòng hiện tại) -> chuyển phòng giữa tháng vẫn tính đủ
  const electricCharge = await studentElectric(studentId, month, Number(fees.electric_unit));
  const leaderDays = await roomLeaders.leaderDaysInMonth(null, studentId, month);

  const c = billing.computeInvoice({ student: s, room, month, fees, roster, electricCharge, leaderDays, kwh, vehicleCount: veh });
  const other = Number(inv.other_charge) || 0;
  const total = billing.invoiceTotal({ ...c, other_charge: other });  // 1 nguồn công thức (billing.js)

  const { rows } = await query(
    `UPDATE invoices SET days_stayed=$1, room_charge=$2, electric_kwh=$3, electric_charge=$4, water_charge=$5,
       service_charge=$6, washing_charge=$7, parking_charge=$8, leader_discount=$9, room_discount=$10, total=$11
     WHERE id=$12 RETURNING *`,
    [c.days_stayed, c.room_charge, c.electric_kwh, c.electric_charge, c.water_charge, c.service_charge, c.washing_charge,
     c.parking_charge, c.leader_discount, c.room_discount, total, inv.id]
  );
  return rows[0];
}

module.exports = { recalcInvoice, roomRoster, roomSegments, studentElectric };
