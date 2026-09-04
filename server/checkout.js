// ===== TRẢ PHÒNG — phần dùng CHUNG cho cả 3 đường =====
// Có 3 đường cùng "trả phòng": admin check-out (students.routes), duyệt đơn HV (requests.routes),
// bảo trì xác nhận (maintenance.routes). TRƯỚC ĐÂY mỗi đường làm một kiểu — đường này đóng lượt ở,
// đường kia quên; đường này đóng nhiệm kỳ phòng trưởng, đường kia quên; chỉ 1 đường dọn phiếu kỳ sau.
// Thiếu bước nào là dữ liệu lệch (BLK-1):
//   - không đóng room_stays  -> người đã đi vẫn trong roster chia điện MỌI THÁNG SAU -> chia điện sai cả phòng
//   - không đóng phòng trưởng -> miễn nước+dịch vụ VĨNH VIỄN + phòng cũ không cử được người mới
//   - không dọn phiếu kỳ sau  -> vẫn phát và vẫn đòi tiền người đã rời
// Gom về đây để 3 đường luôn làm ĐỦ và GIỐNG nhau.
const { query } = require('./db');
const roomStays = require('./room-stays');
const roomLeaders = require('./room-leaders');
const { recalcInvoice } = require('./invoice-calc');

const run = (db, sql, params) => (db && db.query ? db.query(sql, params) : query(sql, params));

// Chặn ngày trả phòng phi lý. KHÔNG chỉ so ngày nhận phòng: với HV đã CHUYỂN phòng, lượt ở đang mở
// bắt đầu từ NGÀY CHUYỂN (> ngày nhận). Nếu ngày trả nằm giữa ngày nhận và ngày chuyển thì closeStay
// gặp to_date < from_date -> XOÁ lượt phòng mới (room-stays.js:27) -> chia điện phòng mới sai (BLK-3).
// Trả chuỗi lỗi nếu sai, null nếu hợp lệ.
async function badCheckoutDate(db, studentId, date, checkInDate) {
  if (checkInDate && date < String(checkInDate).slice(0, 10))
    return `Ngày trả phòng (${date}) không thể trước ngày nhận phòng (${String(checkInDate).slice(0, 10)}).`;
  const open = await roomStays.openStayOf(db, studentId);
  if (open && date < String(open.from_date).slice(0, 10))
    return `Ngày trả phòng (${date}) không thể trước ngày bắt đầu lượt ở hiện tại (${String(open.from_date).slice(0, 10)}) — học viên đã chuyển phòng ngày đó, chọn ngày ≥ ngày chuyển.`;
  return null;
}

// Hoàn tất trả phòng. Gọi SAU khi route đã UPDATE students.status='out'/check_out_date, ghi log và ghi
// công-tơ (nếu có). Làm 4 việc chung: đóng lượt ở + đóng nhiệm kỳ phòng trưởng + dọn phiếu các kỳ SAU
// + tính lại phiếu tháng trả. (Recalc cho BẠN CÙNG PHÒNG khi có chốt công-tơ vẫn để ở route vì phụ
// thuộc danh sách phòng bị ảnh hưởng của lần chốt đó.)
async function finalizeCheckout(db, { studentId, date }) {
  await roomStays.checkOut(db, studentId, date);        // đóng lượt ở (chốt chia điện đúng)
  await roomLeaders.closeStudent(db, studentId, date);  // hết làm phòng trưởng
  const mo = String(date).slice(0, 7);
  const dropped = await run(db,
    `UPDATE invoices SET deleted_at=now() WHERE student_id=$1 AND month > $2 AND deleted_at IS NULL RETURNING month`,
    [studentId, mo]);
  let recalced = null;
  try { recalced = await recalcInvoice(studentId, mo); } catch (e) {}
  return { dropped: dropped.rows.map(r => r.month), recalced };
}

module.exports = { badCheckoutDate, finalizeCheckout };
