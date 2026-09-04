// ===== Đa cơ sở: lọc & cách ly dữ liệu theo cơ sở của người đăng nhập =====
//
// Nguyên tắc (chốt 18/07):
//   • req.user.facility_id === null  -> ĐIỀU HÀNH: thấy & thao tác MỌI cơ sở, không lọc.
//   • req.user.facility_id === <id>  -> QUẢN LÝ CƠ SỞ: chỉ thấy & thao tác đúng cơ sở đó.
//   • Học viên: khoá theo facility_id của hồ sơ chính mình (xử lý ở cổng HV).
//
// Vai (role) quyết định LÀM ĐƯỢC GÌ; facility_id quyết định THẤY DỮ LIỆU NÀO. Hai trục độc lập.

// Cơ sở hiệu lực của người dùng: số id, hoặc null = điều hành (thấy tất cả).
// CHÍNH SÁCH (chốt 18/07): ADMIN LUÔN là điều hành, bất kể DB có lỡ lưu facility_id — chốt chặn kép
// cùng với việc admin.routes ép facility_id=null khi tạo/sửa admin. Chỉ staff/maintenance mới bị bó cơ sở.
function userFacility(req) {
  if (!req || !req.user) return null;
  if (req.user.role === 'admin') return null;
  return req.user.facility_id != null ? Number(req.user.facility_id) : null;
}

// True nếu người dùng là điều hành (không bị giới hạn cơ sở).
function isExecutive(req) {
  return userFacility(req) === null;
}

// ĐỌC: thêm điều kiện lọc cơ sở vào mảng `cond`/`params` đang dựng (kiểu dùng phổ biến trong repo).
//   column: cột facility_id trong truy vấn (vd 'r.facility_id', 's.facility_id').
// Điều hành -> không thêm gì (thấy tất cả). Quản lý cơ sở -> thêm `column = $n`.
function applyFacilityFilter(req, column, cond, params) {
  const fid = userFacility(req);
  if (fid === null) return;            // điều hành: không lọc
  params.push(fid);
  cond.push(`${column} = $${params.length}`);
}

// GHI/ĐỌC-CHI-TIẾT: người dùng có được chạm tới cơ sở này không?
//   facilityId null (bản ghi chưa gắn cơ sở) -> quản lý cơ sở KHÔNG được chạm; điều hành thì được.
function canAccessFacility(req, facilityId) {
  const fid = userFacility(req);
  if (fid === null) return true;                 // điều hành: toàn quyền
  if (facilityId == null) return false;          // bản ghi vô chủ cơ sở -> quản lý cơ sở không đụng
  return Number(facilityId) === fid;
}

// Chốt chặn ghi: trả { status, error } để route trả về, hoặc null nếu hợp lệ.
//   Dùng: const bad = assertFacility(req, row.facility_id); if (bad) return res.status(bad.status).json(bad);
function assertFacility(req, facilityId) {
  if (!canAccessFacility(req, facilityId)) {
    return { status: 403, error: 'Bạn không có quyền với dữ liệu của cơ sở này' };
  }
  return null;
}

// TẠO MỚI: cơ sở mà bản ghi mới nên nhận.
//   Quản lý cơ sở -> LUÔN ép về cơ sở của họ (bỏ qua giá trị client gửi, chống lách).
//   Điều hành      -> theo giá trị yêu cầu (có thể null nếu chưa chọn).
function resolveFacilityForCreate(req, requested) {
  const fid = userFacility(req);
  if (fid !== null) return fid;
  return requested != null && requested !== '' ? Number(requested) : null;
}

module.exports = {
  userFacility, isExecutive, applyFacilityFilter,
  canAccessFacility, assertFacility, resolveFacilityForCreate,
};
