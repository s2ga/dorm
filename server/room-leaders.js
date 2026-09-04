// ===== Phòng trưởng =====
// Mỗi phòng có 1 phòng trưởng giúp BQL quản lý trong phòng. Đổi lại: MIỄN tiền nước + phí dịch vụ,
// tính theo TỈ LỆ SỐ NGÀY LÀM (xem billing.leaderDiscount).
//
// Lưu có ngày bắt đầu/kết thúc chứ không phải một ô đánh dấu: đổi phòng trưởng giữa tháng thì mỗi
// người chỉ được giảm theo số ngày mình làm. Dùng ô đánh dấu thì tính lại hoá đơn tháng cũ sẽ lấy
// phòng trưởng HÔM NAY và trả nhầm ưu đãi cho người khác — đúng lỗi TC-10 vừa sửa xong.

const { query } = require('./db');
const billing = require('./billing');

const run = (db, sql, params) => (db && db.query ? db.query(sql, params) : query(sql, params));
const ymd = d => (d ? String(d).slice(0, 10) : null);

// Phòng trưởng đang đương nhiệm của một phòng
async function currentOf(db, roomId) {
  const { rows } = await run(db,
    `SELECT rl.*, s.name AS student_name FROM room_leaders rl
       JOIN students s ON s.id = rl.student_id
      WHERE rl.room_id=$1 AND rl.to_date IS NULL LIMIT 1`, [roomId]);
  return rows[0] || null;
}

// Kết thúc nhiệm kỳ đang mở của một phòng, tính hết ngày `toDate`
async function closeRoom(db, roomId, toDate) {
  const cur = await currentOf(db, roomId);
  if (!cur) return null;
  // Kết thúc trước cả ngày bắt đầu = nhiệm kỳ chưa từng xảy ra -> xoá hẳn, đừng để lại dòng vô nghĩa
  if (toDate < ymd(cur.from_date)) {
    await run(db, 'DELETE FROM room_leaders WHERE id=$1', [cur.id]);
    return null;
  }
  await run(db, 'UPDATE room_leaders SET to_date=$1 WHERE id=$2', [toDate, cur.id]);
  return cur;
}

// Kết thúc mọi nhiệm kỳ đang mở của một HỌC VIÊN (khi họ trả phòng / chuyển phòng)
async function closeStudent(db, studentId, toDate) {
  const { rows } = await run(db, 'SELECT id, from_date FROM room_leaders WHERE student_id=$1 AND to_date IS NULL', [studentId]);
  for (const r of rows) {
    if (toDate < ymd(r.from_date)) await run(db, 'DELETE FROM room_leaders WHERE id=$1', [r.id]);
    else await run(db, 'UPDATE room_leaders SET to_date=$1 WHERE id=$2', [toDate, r.id]);
  }
  return rows.length;
}

// Cử phòng trưởng mới từ ngày `date`. Người cũ (nếu có) kết thúc hết ngày D-1.
// Trả về { error } nếu không hợp lệ — kiểm TRƯỚC khi ghi.
async function setLeader(db, { roomId, studentId, date, note, by }) {
  const s = (await run(db, 'SELECT id, name, room_id, check_in_date, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL', [studentId])).rows[0];
  if (!s) return { error: 'Không tìm thấy học viên' };
  if (String(s.room_id) !== String(roomId)) return { error: `${s.name} không ở phòng này — chỉ cử phòng trưởng trong số người đang ở phòng` };
  if (s.check_out_date && ymd(s.check_out_date) < date)
    return { error: `${s.name} đã trả phòng ngày ${ymd(s.check_out_date)} — không thể cử làm phòng trưởng` };

  const cur = await currentOf(db, roomId);
  if (cur && cur.student_id === studentId) return { leader: cur, already: true };

  await closeRoom(db, roomId, billing.addDays(date, -1));
  const { rows } = await run(db,
    `INSERT INTO room_leaders (room_id, student_id, from_date, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [roomId, studentId, date, note || '', by || '']);
  return { leader: rows[0], replaced: cur };
}

// Số ngày làm phòng trưởng trong tháng (cộng qua mọi nhiệm kỳ, mọi phòng).
// Dùng chính hàm đếm ngày của billing để không lệch quy ước với số ngày ở.
async function leaderDaysInMonth(db, studentId, month) {
  const { rows } = await run(db,
    `SELECT from_date, to_date FROM room_leaders
      WHERE student_id=$1 AND from_date <= $2 AND (to_date IS NULL OR to_date >= $3)`,
    [studentId, billing.lastDay(month), billing.firstDay(month)]);
  return rows.reduce((a, r) =>
    a + billing.daysStayedInRange({ check_in_date: ymd(r.from_date), check_out_date: ymd(r.to_date) },
      billing.firstDay(month), billing.lastDay(month)), 0);
}

module.exports = { currentOf, closeRoom, closeStudent, setLeader, leaderDaysInMonth };
