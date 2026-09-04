// ===== Chốt chỉ số công-tơ giữa kỳ =====
// Khi có người rời phòng giữa tháng, ghi lại chỉ số điện của phòng NGAY HÔM ĐÓ.
// Nhờ vậy điện dùng TRƯỚC lúc họ đi và SAU lúc họ đi được tách bạch, thay vì chia bừa cả tháng.

const { query } = require('./db');
const billing = require('./billing');

const run = (db, sql, params) => (db && db.query ? db.query(sql, params) : query(sql, params));

// Kiểm tra một chỉ số có hợp lệ không. Trả về câu lỗi tiếng Việt, hoặc null nếu ổn.
// Công-tơ chỉ QUAY TỚI: chỉ số mới không được nhỏ hơn lần chốt trước, cũng không lớn hơn lần chốt sau.
async function checkRead(db, { roomId, date, reading }) {
  const v = Number(reading);
  if (!Number.isFinite(v) || v < 0) return 'Chỉ số công-tơ phải là số không âm';
  const month = String(date).slice(0, 7);

  const er = (await run(db, 'SELECT reading_start, reading_end FROM electric_readings WHERE room_id=$1 AND month=$2', [roomId, month])).rows[0];
  if (er && v < Number(er.reading_start))
    return `Chỉ số ${v} nhỏ hơn chỉ số đầu tháng (${Number(er.reading_start)}) — công-tơ không quay ngược được`;
  if (er && Number(er.reading_end) > 0 && v > Number(er.reading_end))
    return `Chỉ số ${v} lớn hơn chỉ số cuối tháng đã ghi (${Number(er.reading_end)})`;

  const prev = (await run(db, 'SELECT read_date, reading FROM meter_reads WHERE room_id=$1 AND read_date < $2 ORDER BY read_date DESC LIMIT 1', [roomId, date])).rows[0];
  if (prev && v < Number(prev.reading))
    return `Chỉ số ${v} nhỏ hơn lần chốt ngày ${String(prev.read_date).slice(0, 10)} (${Number(prev.reading)})`;

  const next = (await run(db, 'SELECT read_date, reading FROM meter_reads WHERE room_id=$1 AND read_date > $2 ORDER BY read_date LIMIT 1', [roomId, date])).rows[0];
  if (next && v > Number(next.reading))
    return `Chỉ số ${v} lớn hơn lần chốt ngày ${String(next.read_date).slice(0, 10)} (${Number(next.reading)})`;

  return null;
}

// Ghi nhận chỉ số. Chốt lại cùng ngày cùng phòng thì ĐÈ lên (sửa số nhập nhầm), không đẻ dòng mới.
async function recordRead(db, { roomId, date, reading, reason, studentId, note, by }) {
  const { rows } = await run(db,
    `INSERT INTO meter_reads (room_id, read_date, reading, reason, student_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (room_id, read_date) DO UPDATE
       SET reading=EXCLUDED.reading, reason=EXCLUDED.reason, student_id=EXCLUDED.student_id,
           note=EXCLUDED.note, created_by=EXCLUDED.created_by, created_at=now()
     RETURNING *`,
    [roomId, date, Number(reading), reason || 'manual', studentId || null, note || '', by || '']);
  return rows[0];
}

// Những học viên khác sẽ bị TÍNH LẠI tiền điện vì lần chốt này (cùng phòng, cùng tháng).
// Chốt giữa kỳ làm đổi phần chia của MỌI người trong phòng, không riêng người vừa đi.
async function affectedStudents(db, roomId, date) {
  const month = String(date).slice(0, 7);
  const { rows } = await run(db,
    `SELECT DISTINCT rs.student_id
       FROM room_stays rs JOIN students s ON s.id = rs.student_id
      WHERE rs.room_id=$1 AND s.deleted_at IS NULL
        AND rs.from_date <= $2 AND (rs.to_date IS NULL OR rs.to_date >= $3)`,
    [roomId, billing.lastDay(month), billing.firstDay(month)]);
  return rows.map(r => r.student_id);
}

module.exports = { checkRead, recordRead, affectedStudents };
