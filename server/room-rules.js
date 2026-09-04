// LUẬT XẾP PHÒNG — MỘT NƠI DUY NHẤT.
// Trước đây luật chỉ nằm trên giao diện: server ai gửi gì cũng nhận, và mỗi đường
// (tạo mới / sửa hồ sơ / chuyển phòng / check-in lại / duyệt đơn) lại hành xử một kiểu.
// Mọi đường xếp phòng PHẢI gọi checkRoomAssignment() ở đây.
const { query } = require('./db');

// Lỗi CHẶN (errors)  -> trả 400, không cho lưu.
// CẢNH BÁO (warnings) -> cho phép lưu NHƯNG người xếp phải xác nhận, và được GHI VẾT.
//
// Quá tải KHÔNG chặn: nghiệp vụ cho phép HV mới vào ở chờ HV cũ xuất cảnh (chốt 15/07/2026).
async function checkRoomAssignment({ studentId, gender, rentalType, roomId }) {
  const errors = [], warnings = [];
  if (!roomId) return { errors, warnings, room: null };

  const room = (await query(
    `SELECT id, name, gender, capacity, COALESCE(room_type,'shared') AS room_type FROM rooms WHERE id=$1 AND deleted_at IS NULL`,
    [roomId])).rows[0];
  if (!room) { errors.push('Phòng không tồn tại hoặc đã bị xoá'); return { errors, warnings, room: null }; }

  // 1) Giới tính — KHÔNG có ngoại lệ hợp lệ nào cho việc nam ở phòng nữ
  if (gender && room.gender && gender !== room.gender) {
    errors.push(`Phòng ${room.name} là phòng ${room.gender === 'female' ? 'NỮ' : 'NAM'}, không xếp được học viên ${gender === 'female' ? 'nữ' : 'nam'}`);
  }

  // Những người đang ở phòng (không tính chính học viên này khi sửa hồ sơ)
  const others = (await query(
    `SELECT id, name, rental_type FROM students
     WHERE room_id=$1 AND deleted_at IS NULL AND status='in' AND ($2::int IS NULL OR id <> $2)`,
    [roomId, studentId || null])).rows;

  // 2) Thuê nguyên phòng — 1 phòng chỉ 1 người thuê nguyên, và không ở ghép chung
  const nguyenPhong = others.find(o => o.rental_type === 'phong');
  if (rentalType === 'phong' && others.length) {
    errors.push(`Phòng ${room.name} đang có ${others.length} người ở — không thể cho thuê NGUYÊN PHÒNG. (Thuê nguyên phòng = thu trọn giá phòng; để 2 người cùng thuê nguyên phòng là thu 2 lần tiền cho 1 phòng.)`);
  } else if (rentalType !== 'phong' && nguyenPhong) {
    errors.push(`Phòng ${room.name} đã cho ${nguyenPhong.name} thuê NGUYÊN PHÒNG — không xếp thêm người ở ghép.`);
  }

  // 3) Quá tải — CẢNH BÁO, không chặn
  if (room.room_type === 'shared' && room.capacity > 0) {
    const sau = others.length + 1;
    if (sau > room.capacity) {
      warnings.push({
        code: 'OVER_CAPACITY',
        message: `Phòng ${room.name} đã đủ ${others.length}/${room.capacity} chỗ — xếp thêm sẽ thành QUÁ TẢI ${sau}/${room.capacity} (vượt ${sau - room.capacity} người).`,
        room_name: room.name, occupancy_after: sau, capacity: room.capacity, over_by: sau - room.capacity,
      });
    }
  }
  return { errors, warnings, room };
}

// Ghi vết riêng cho việc xếp gây QUÁ TẢI: ai xếp · lúc nào · HV nào · phòng nào · vượt mấy người.
// Ghi vào nhật ký hệ thống với dấu [QUÁ TẢI] để tra cứu được, không lẫn vào nhật ký chung.
async function logOverload(req, { studentId, studentName, warning }) {
  if (!warning || warning.code !== 'OVER_CAPACITY') return;
  const detail = `[QUÁ TẢI] Xếp học viên ${studentName || '#' + studentId} vào phòng ${warning.room_name} — ` +
    `${warning.occupancy_after}/${warning.capacity}, vượt ${warning.over_by} người`;
  try {
    await query(
      `INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user?.id || null, req.user?.username || '', req.user?.role || '', req.method, (req.originalUrl || '').split('?')[0], detail]);
  } catch (e) { /* ghi vết hỏng không được chặn nghiệp vụ */ }
}

// Dùng trong route: trả về response 400/409 nếu cần, hoặc null nếu được phép đi tiếp.
// - Có lỗi chặn        -> 400
// - Có cảnh báo mà chưa xác nhận -> 409 kèm danh sách cảnh báo (client hiện hộp xác nhận rồi gửi lại confirm_overload:true)
function blockOrConfirm(res, { errors, warnings }, confirmed) {
  if (errors.length) { res.status(400).json({ error: errors.join(' · ') }); return true; }
  if (warnings.length && !confirmed) {
    res.status(409).json({
      error: warnings.map(w => w.message).join(' · '),
      needs_confirm: true, warnings,
      hint: 'Gửi lại kèm "confirm_overload": true để xác nhận vẫn xếp. Việc này sẽ được ghi vào nhật ký.',
    });
    return true;
  }
  return false;
}

module.exports = { checkRoomAssignment, logOverload, blockOrConfirm };
