// ===== Lịch sử ở phòng =====
// Trước đây chuyển phòng chỉ ĐÈ students.room_id, nên sau khi chuyển thì hệ thống không còn biết
// người đó từng ở phòng cũ. Hậu quả: tiền điện nửa tháng đầu của họ bị đổ hết sang đầu người ở lại.
// Mọi thay đổi phòng đều phải đi qua đây để giữ lại dấu vết.
//
// Quy ước ngày:
//   - Trả phòng ngày D  -> lượt ở kết thúc NGÀY D (vẫn tính trọn ngày D, khớp với check_out_date).
//   - Chuyển phòng ngày D -> lượt CŨ kết thúc ngày D-1, lượt MỚI bắt đầu ngày D
//     (ngày D là ngày đầu tiên ở phòng mới -> không bị tính điện ở cả 2 phòng cùng một ngày).

const { query } = require('./db');
const { addDays } = require('./billing');

const run = (db, sql, params) => (db && db.query ? db.query(sql, params) : query(sql, params));

// Lượt ở đang mở (chưa có ngày kết thúc) của một học viên
async function openStayOf(db, studentId) {
  const { rows } = await run(db, 'SELECT * FROM room_stays WHERE student_id=$1 AND to_date IS NULL ORDER BY from_date DESC LIMIT 1', [studentId]);
  return rows[0] || null;
}

// Đóng lượt đang mở tại ngày `toDate` (tính trọn ngày đó)
async function closeStay(db, studentId, toDate) {
  const cur = await openStayOf(db, studentId);
  if (!cur) return null;
  // Ngày kết thúc trước ngày bắt đầu = lượt ở này chưa từng xảy ra -> bỏ hẳn, đừng để lại dòng vô nghĩa
  if (toDate < String(cur.from_date).slice(0, 10)) {
    await run(db, 'DELETE FROM room_stays WHERE id=$1', [cur.id]);
    return null;
  }
  const { rows } = await run(db, 'UPDATE room_stays SET to_date=$1 WHERE id=$2 RETURNING *', [toDate, cur.id]);
  return rows[0];
}

// Mở lượt ở mới
async function openStay(db, studentId, roomId, fromDate) {
  if (!roomId || !fromDate) return null;
  const { rows } = await run(db, 'INSERT INTO room_stays (student_id, room_id, from_date, to_date) VALUES ($1,$2,$3,NULL) RETURNING *', [studentId, roomId, fromDate]);
  return rows[0];
}

// Vào ở / nhận phòng ngày `date`
async function checkIn(db, studentId, roomId, date) {
  await closeStay(db, studentId, addDays(date, -1)); // dọn lượt cũ còn treo (nếu có)
  return openStay(db, studentId, roomId, date);
}

// Chuyển sang phòng khác ngày `date`: lượt cũ hết ngày D-1, lượt mới từ ngày D
async function transfer(db, studentId, newRoomId, date) {
  await closeStay(db, studentId, addDays(date, -1));
  return openStay(db, studentId, newRoomId, date);
}

// Trả phòng hẳn ngày `date` (tính trọn ngày D)
async function checkOut(db, studentId, date) {
  return closeStay(db, studentId, date);
}

// Đồng bộ lượt ở đang mở với hồ sơ — dùng cho đường SỬA HỒ SƠ.
// Sửa ô "Phòng" trong form hồ sơ KHÔNG kèm ngày chuyển, nên không thể coi là chuyển phòng thật
// (chuyển thật phải đi qua chức năng "Chuyển phòng" để còn chốt chỉ số điện). Ở đây hiểu là SỬA NHẦM:
// đính chính lượt đang mở chứ không đẻ ra một lượt mới trong lịch sử.
async function reconcile(db, studentId, roomId, checkInDate, checkOutDate) {
  const cur = await openStayOf(db, studentId);
  const closed = checkOutDate || null;

  if (!roomId || !checkInDate) { // hồ sơ không còn phòng -> lượt đang mở là vô nghĩa
    if (cur) await run(db, 'DELETE FROM room_stays WHERE id=$1', [cur.id]);
    return null;
  }
  if (!cur) {
    const st = await openStay(db, studentId, roomId, checkInDate);
    if (closed) await closeStay(db, studentId, closed);
    return st;
  }

  // Có lịch sử chuyển phòng -> from_date của lượt đang mở là NGÀY CHUYỂN, không phải ngày nhận phòng.
  // Đè check_in_date lên đó sẽ phá lịch sử, nên chỉ đính chính phòng.
  const n = (await run(db, 'SELECT COUNT(*)::int c FROM room_stays WHERE student_id=$1', [studentId])).rows[0].c;
  if (n > 1) await run(db, 'UPDATE room_stays SET room_id=$1 WHERE id=$2', [roomId, cur.id]);
  else await run(db, 'UPDATE room_stays SET room_id=$1, from_date=$2 WHERE id=$3', [roomId, checkInDate, cur.id]);

  if (closed) await closeStay(db, studentId, closed);
  return openStayOf(db, studentId);
}

module.exports = { openStayOf, openStay, closeStay, checkIn, transfer, checkOut, reconcile };
