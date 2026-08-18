// ---- Lớp gọi API ----
// Xác thực bằng cookie httpOnly (server tự đặt/xóa). Client CHỈ giữ thông tin hiển thị
// (tên, vai trò) trong localStorage — KHÔNG còn giữ token.
const Auth = {
  get user() { try { return JSON.parse(localStorage.getItem('ktx_user')); } catch { return null; } },
  set user(v) { v ? localStorage.setItem('ktx_user', JSON.stringify(v)) : localStorage.removeItem('ktx_user'); },
  // moiThietBi=true: thu hồi vé ở cấp tài khoản, đá cả máy khác. Mặc định chỉ thoát máy này.
  async logout(moiThietBi) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: !!moiThietBi }),
      });
    } catch {}
    this.user = null;
    try { localStorage.removeItem('ktx_portal'); } catch {}   // lựa chọn cổng là của người vừa thoát
    location.reload();
  },
};

// Đa cơ sở: bộ lọc cơ sở của ĐIỀU HÀNH (0 = tất cả). Áp vào MỌI truy vấn danh sách bên dưới.
// Quản lý/bảo trì bị backend bó theo cơ sở nên tham số này với họ vô hại (server bỏ qua).
let _apiFacility = 0;
const facAmp = has => _apiFacility ? (has ? '&' : '?') + 'facility=' + _apiFacility : '';

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  let res;
  try {
    res = await fetch('/api' + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin', // gửi kèm cookie phiên
    });
  } catch (e) {
    // Mất mạng: trình duyệt ném "Failed to fetch" / "NetworkError" — tiếng Anh, người dùng
    // đọc không hiểu. Toàn app tiếng Việt, riêng lúc hỏng nhất lại nói tiếng Anh.
    throw new Error('Mất kết nối — chưa gửi được. Kiểm tra mạng rồi thử lại (dữ liệu bạn vừa nhập vẫn còn).');
  }
  // Phiên hết hạn khi đang đăng nhập -> xóa hint + lựa chọn cổng + tải lại về màn đăng nhập
  if (res.status === 401 && Auth.user) {
    Auth.user = null;
    try { localStorage.removeItem('ktx_portal'); } catch {}
    location.reload(); throw new Error('Hết phiên đăng nhập');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    // Gắn kèm status + dữ liệu trả về để nơi gọi xử lý được các trường hợp cần hỏi lại
    // (vd 409 "phòng quá tải — cần xác nhận"), thay vì chỉ hiện một dòng lỗi đỏ rồi bế tắc.
    const err = new Error((data && data.error) || 'Lỗi kết nối máy chủ');
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// Người này đã có hồ sơ (trùng mã HV / CCCD). Đừng chỉ hiện dòng lỗi đỏ rồi bỏ mặc —
// nhân viên tạo hồ sơ mới là vì họ CẦN đổi phòng cho bạn ấy, nên phải chỉ thẳng sang chức năng đúng.
async function withDuplicateGuide(run) {
  try { return await run(); }
  catch (e) {
    if (e && e.status === 409 && e.data && e.data.duplicate) { duplicateModal(e.data); return null; }
    // Người khác vừa sửa hồ sơ này -> báo rõ, đừng để đè mất công của họ trong im lặng
    if (e && e.status === 409 && e.data && e.data.conflict) { alert(e.data.error); return null; }
    throw e;
  }
}

// Chạy một thao tác xếp phòng. Nếu server báo QUÁ TẢI (409) thì hỏi người dùng,
// đồng ý thì gửi lại kèm xác nhận. Nghiệp vụ CHO PHÉP quá tải (HV vào ở chờ bạn xuất cảnh),
// nhưng bắt buộc người xếp phải thấy cảnh báo và tự xác nhận — việc này được ghi vào nhật ký.
async function withOverloadConfirm(run) {
  try { return await run(false); }
  catch (e) {
    if (e && e.status === 409 && e.data && e.data.needs_confirm) {
      if (!confirm(`${e.data.error}\n\nVẫn xếp vào phòng này?\n(Việc xếp quá tải sẽ được ghi vào nhật ký kèm tên người xếp.)`)) return null;
      return await run(true);
    }
    throw e;
  }
}

const API = {
  // KHÔNG gửi "cổng": loại tài khoản (nhân viên/học viên) là thuộc tính của user trong CSDL.
  login: (username, password) => api('/auth/login', { method: 'POST', body: { username, password } }),
  ssoConfig: () => api('/auth/sso/config'),
  ssoExchangeParams: state => api('/auth/sso/exchange-params', { method: 'POST', body: { state } }),
  ssoVerify: idToken => api('/auth/sso/verify', { method: 'POST', body: { id_token: idToken } }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  me: () => api('/auth/me'),
  changePassword: (newPassword) => api('/auth/change-password', { method: 'POST', body: { newPassword } }),

  settings: () => api('/settings'),
  updateSettings: b => api('/settings', { method: 'PUT', body: b }),
  testSmtp: b => api('/settings/smtp/test', { method: 'POST', body: b }),

  setFacility: f => { _apiFacility = +f || 0; },   // đa cơ sở: đặt bộ lọc cơ sở toàn cục (điều hành)
  facilities: () => api('/facilities'),
  createFacility: b => api('/facilities', { method: 'POST', body: b }),
  updateFacility: (id, b) => api('/facilities/' + id, { method: 'PUT', body: b }),
  deleteFacility: id => api('/facilities/' + id, { method: 'DELETE' }),

  rooms: deleted => api('/rooms' + (deleted ? '?deleted=1' : '') + facAmp(!!deleted)),
  // BL-107: sức chứa tính theo MỘT MỐC NGÀY, không phải hôm nay — dùng cho ô Xếp phòng.
  roomsAtDate: ngay => api('/rooms?date=' + encodeURIComponent(ngay) + facAmp(true)),
  createRoom: b => api('/rooms', { method: 'POST', body: b }),
  updateRoom: (id, b) => api('/rooms/' + id, { method: 'PUT', body: b }),
  deleteRoom: id => api('/rooms/' + id, { method: 'DELETE' }),
  restoreRoom: id => api('/rooms/' + id + '/restore', { method: 'POST' }),
  roomLeader: id => api('/rooms/' + id + '/leader'),
  setLeader: (id, b) => api('/rooms/' + id + '/leader', { method: 'POST', body: b }),
  unsetLeader: (id, date) => api('/rooms/' + id + '/leader?date=' + encodeURIComponent(date || ''), { method: 'DELETE' }),

  students: deleted => api('/students' + (deleted ? '?deleted=1' : '') + facAmp(!!deleted)),
  studentsArchive: () => api('/students/archive'),
  student: id => api('/students/' + id),
  createStudent: b => api('/students', { method: 'POST', body: b }),
  updateStudent: (id, b) => api('/students/' + id, { method: 'PUT', body: b }),
  deleteStudent: (id, reason) => api('/students/' + id, { method: 'DELETE', body: { reason: reason || '' } }),
  restoreStudent: id => api('/students/' + id + '/restore', { method: 'POST' }),
  uploadContractScan: (id, data) => api('/students/' + id + '/contract-scan', { method: 'POST', body: { data } }),
  deleteContractScan: id => api('/students/' + id + '/contract-scan', { method: 'DELETE' }),
  // studentId: cấp số RIÊNG cho hồ sơ đó (mỗi hồ sơ một số); bỏ trống = số kế tiếp chung của pháp nhân.
  contractNoNext: (gender, date, studentId) => api('/students/contract-no/next?gender=' + encodeURIComponent(gender)
    + '&date=' + encodeURIComponent(date || '') + (studentId ? '&student_id=' + studentId : '')),
  setWashing: (id, on) => api('/students/' + id + '/washing', { method: 'POST', body: { on: !!on } }),
  checkIn: (id, b) => api('/students/' + id + '/checkin', { method: 'POST', body: b }),
  checkOut: (id, b) => api('/students/' + id + '/checkout', { method: 'POST', body: b }),
  suaNgayTra: (id, b) => api('/students/' + id + '/checkout-date', { method: 'PUT', body: b }),
  roomStays: id => api('/rooms/' + id + '/stays'),
  transfer: (id, b) => api('/students/' + id + '/transfer', { method: 'POST', body: b }),
  setAccount: (id, b) => api('/students/' + id + '/account', { method: 'POST', body: b }),
  setDeposit: (id, b) => api('/students/' + id + '/deposit', { method: 'POST', body: b }),
  settleDeposit: (id, b) => api('/students/' + id + '/deposit-settle', { method: 'POST', body: b }),

  vehicles: () => api('/vehicles' + facAmp(false)),
  createVehicle: b => api('/vehicles', { method: 'POST', body: b }),
  updateVehicle: (id, b) => api('/vehicles/' + id, { method: 'PUT', body: b }),
  deleteVehicle: id => api('/vehicles/' + id, { method: 'DELETE' }),

  // Điểm danh bãi xe (an ninh đi kiểm hằng ngày)
  parkingList: date => api('/maintenance/parking?date=' + encodeURIComponent(date || '') + facAmp(true)),
  parkingMark: b => api('/maintenance/parking/mark', { method: 'POST', body: b }),
  parkingStranger: b => api('/maintenance/parking/stranger', { method: 'POST', body: b }),
  parkingFinish: date => api('/maintenance/parking/finish', { method: 'POST', body: { date } }),
  parkingUndo: id => api('/maintenance/parking/' + id, { method: 'DELETE' }),
  parkingReport: (from, to) => api('/maintenance/parking/report?from=' + encodeURIComponent(from || '')
    + '&to=' + encodeURIComponent(to || '') + facAmp(true)),

  assets: () => api('/assets'),
  createAsset: b => api('/assets', { method: 'POST', body: b }),
  updateAsset: (id, b) => api('/assets/' + id, { method: 'PUT', body: b }),
  deleteAsset: id => api('/assets/' + id, { method: 'DELETE' }),

  // Nhận chuỗi type (tương thích cũ: API.logs('in')) HOẶC object { type, student_id, limit }.
  // BL-11: student_id để SERVER lọc (không tải 500 dòng rồi .filter ở client).
  logs: opts => {
    const o = (opts && typeof opts === 'object') ? opts : { type: opts };
    const p = new URLSearchParams();
    if (o.type) p.set('type', o.type);
    if (o.student_id) p.set('student_id', o.student_id);
    if (o.limit) p.set('limit', o.limit);
    const s = p.toString();
    return api('/logs' + (s ? '?' + s : '') + facAmp(!!s));
  },

  electric: month => api('/electric?month=' + month),
  electricHistory: (month, n) => api('/electric/history?month=' + month + (n ? '&n=' + n : '')),
  saveElectric: b => api('/electric/bulk', { method: 'POST', body: b }),
  stays: id => api('/students/' + id + '/stays'),
  electricReads: month => api('/electric/reads?month=' + month),
  saveMeterRead: b => api('/electric/reads', { method: 'POST', body: b }),
  deleteMeterRead: id => api('/electric/reads/' + id, { method: 'DELETE' }),
  electricSegments: (roomId, month) => api('/electric/segments?room_id=' + roomId + '&month=' + month),

  // Nhận chuỗi month (tương thích cũ: API.invoices('2026-07')) HOẶC object { month, student_id }.
  invoices: opts => {
    const o = (opts && typeof opts === 'object') ? opts : { month: opts };
    const p = new URLSearchParams();
    if (o.month) p.set('month', o.month);
    if (o.student_id) p.set('student_id', o.student_id);
    const s = p.toString();
    return api('/invoices' + (s ? '?' + s : '') + facAmp(!!s));
  },
  invoiceMonths: () => api('/invoices/months'),
  generateInvoices: b => api('/invoices/generate', { method: 'POST', body: b }),
  generateOneInvoice: b => api('/invoices/generate-one', { method: 'POST', body: b }),
  createInvoice: b => api('/invoices', { method: 'POST', body: b }),
  updateInvoice: (id, b) => api('/invoices/' + id, { method: 'PUT', body: b }),
  setInvoiceStatus: (id, status) => api('/invoices/' + id + '/status', { method: 'POST', body: { status } }),
  recalcInvoice: id => api('/invoices/' + id + '/recalc', { method: 'POST' }),
  // Bắt buộc có kỳ + xác nhận. KHÔNG bao giờ gửi rỗng (rỗng = đánh dấu đã thu toàn bộ mọi kỳ).
  markPaid: (month, confirm) => api('/invoices/mark-paid', { method: 'POST', body: { month, confirm: confirm === true } }),
  deleteInvoice: id => api('/invoices/' + id, { method: 'DELETE' }),

  revenue: year => api('/reports/revenue' + (year ? '?year=' + year : '')),
  revenueYears: () => api('/reports/years'),

  // Vi phạm / nhắc nhở
  violations: () => api('/violations' + facAmp(false)),
  violationsByStudent: id => api('/violations/student/' + id),
  violationStats: year => api('/violations/stats' + (year ? '?year=' + year : '') + facAmp(!!year)),
  createViolation: b => api('/violations', { method: 'POST', body: b }),
  updateViolation: (id, b) => api('/violations/' + id, { method: 'PUT', body: b }),
  deleteViolation: id => api('/violations/' + id, { method: 'DELETE' }),
  notifyViolation: id => api('/violations/student/' + id + '/notify', { method: 'POST' }),
  violationMailStatus: () => api('/violations/mail-status'),
  violationTypes: () => api('/violations/types'),
  createVType: b => api('/violations/types', { method: 'POST', body: b }),
  updateVType: (id, b) => api('/violations/types/' + id, { method: 'PUT', body: b }),
  deleteVType: id => api('/violations/types/' + id, { method: 'DELETE' }),

  // Admin: nhật ký + tài khoản nhân viên
  auditLog: (q = {}) => {
    const p = new URLSearchParams();
    for (const k of ['limit', 'offset', 'user', 'from', 'to', 'method', 'path'])
      if (q[k] != null && q[k] !== '') p.set(k, q[k]);
    const s = p.toString();
    return api('/admin/audit' + (s ? '?' + s : ''));
  },
  dataHealth: () => api('/admin/data-health'),
  pendingCount: () => api('/admin/pending-count'),
  adminUsers: () => api('/admin/users'),
  // Tài khoản đăng nhập của HỌC VIÊN (tab Người dùng). Chỉ đọc + thu hồi phiên; đổi vai/xoá không có.
  studentAccounts: () => api('/admin/student-accounts'),
  revokeStudentSession: id => api('/admin/student-accounts/' + id + '/revoke', { method: 'POST' }),
  createUser: b => api('/admin/users', { method: 'POST', body: b }),
  updateUser: (id, b) => api('/admin/users/' + id, { method: 'PUT', body: b }),
  // Duyệt tài khoản chờ thành HỌC VIÊN: b = {student_id} ghép hồ sơ có sẵn, hoặc {new_student:{...}} tạo mới.
  approveUserAsStudent: (id, b) => api('/admin/users/' + id + '/approve-student', { method: 'POST', body: b }),
  // Nhân viên KIÊM khách thuê phòng: gắn/gỡ hồ sơ, vai giữ nguyên (khác approveUserAsStudent — ghi đè vai).
  linkStudent: (id, student_id) => api('/admin/users/' + id + '/link-student', { method: 'POST', body: { student_id } }),
  unlinkStudent: id => api('/admin/users/' + id + '/link-student', { method: 'DELETE' }),
  resetUserPw: (id, password) => api('/admin/users/' + id + '/password', { method: 'POST', body: { password } }),
  // DELETE = KHOÁ tài khoản (chặn đăng nhập, giữ nguyên dữ liệu) — mở lại bằng unlockUser.
  deleteUser: id => api('/admin/users/' + id, { method: 'DELETE' }),
  unlockUser: id => api('/admin/users/' + id + '/unlock', { method: 'POST' }),

  meProfile: () => api('/me/profile'),
  meRoommates: () => api('/me/roommates'),
  meAssets: () => api('/me/assets'),
  meChores: () => api('/me/chores'),
  uploadDoc: (key, data) => api('/media/doc/' + key, { method: 'POST', body: { data } }),
  meWashing: on => api('/me/washing', { method: 'POST', body: { on } }),
  meInvoices: () => api('/me/invoices'),
  meLogs: () => api('/me/logs'),
  meViolations: () => api('/me/violations'),
  meDamage: () => api('/me/damage'),
  createMeDamage: b => api('/me/damage', { method: 'POST', body: b }),
  meCheckoutReq: () => api('/me/checkout-request'),
  createMeCheckoutReq: b => api('/me/checkout-request', { method: 'POST', body: b }),
  meNotifications: () => api('/me/notifications'),
  meNotifSeen: () => api('/me/notifications/seen', { method: 'POST' }),

  // Ảnh trang giới thiệu (upload trong Cài đặt)
  mediaList: () => api('/media'),
  uploadMedia: (key, data) => api('/media/' + key, { method: 'POST', body: { data } }),
  deleteMedia: key => api('/media/' + key, { method: 'DELETE' }),

  // Công khai (không cần đăng nhập)
  publicInfo: () => api('/public/info'),
  publicStats: () => api('/public/stats'),
  publicRooms: () => api('/public/available-rooms'),
  publicApply: b => api('/public/apply', { method: 'POST', body: b }),

  // Admin: đơn từ học viên
  applications: () => api('/applications' + facAmp(false)),
  approveApplication: (id, b) => api('/applications/' + id + '/approve', { method: 'POST', body: b }),
  rejectApplication: id => api('/applications/' + id + '/reject', { method: 'POST' }),
  setAppNote: (id, note) => api('/applications/' + id + '/note', { method: 'PUT', body: { note } }),
  setCoutNote: (id, note) => api('/requests/checkout/' + id + '/note', { method: 'PUT', body: { note } }),
  deleteApplication: id => api('/applications/' + id, { method: 'DELETE' }),
  damageAll: () => api('/requests/damage' + facAmp(false)),
  updateDamage: (id, b) => api('/requests/damage/' + id, { method: 'PUT', body: b }),
  assignMaintenance: id => api('/requests/damage/' + id + '/assign', { method: 'POST' }),

  // Bảo trì
  maintenanceTasks: () => api('/maintenance/tasks'),
  maintenanceSummary: () => api('/maintenance/summary'),
  maintenanceTaskStatus: (id, status, note) => api('/maintenance/tasks/' + id + '/status', { method: 'POST', body: { status, note } }),
  handovers: month => api('/maintenance/handovers' + (month ? '?month=' + month : '')),
  handoverSummary: () => api('/maintenance/handovers/summary'),
  maintSuaBienSo: (id, plate) => api('/maintenance/vehicles/' + id + '/plate', { method: 'PUT', body: { plate } }),
  maintSuaNgayNhan: (id, date) => api('/maintenance/handovers/' + id + '/checkin-date', { method: 'PUT', body: { date } }),
  confirmHandoverCheckin: (id, note) => api('/maintenance/handovers/' + id + '/checkin', { method: 'POST', body: { note } }),
  confirmHandoverCheckout: (id, actual_date, note) => api('/maintenance/handovers/' + id + '/checkout', { method: 'POST', body: { actual_date, note } }),
  checkoutReqs: () => api('/requests/checkout' + facAmp(false)),
  confirmCheckoutReq: (id, b) => api('/requests/checkout/' + id + '/confirm', { method: 'POST', body: b }),
  rejectCheckoutReq: id => api('/requests/checkout/' + id + '/reject', { method: 'POST' }),
};
