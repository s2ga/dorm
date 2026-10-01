// === tu-ngu.js — chữ dùng chung toàn app: tên vai, trạng thái đơn, tên các khoản tiền. Classic script, nạp ngay sau
// icons.js (GEN_NHAN ở app-invoices-settings.js dựng từ KHOAN_TIEN lúc nạp). Đổi thuật ngữ thì sửa ở đây; các từ đã
// bỏ (hoá đơn, Check-in, khách thuê, QTV…) do tests/unit/thuat-ngu.test.js canh.

// Tên vai: [nhãn, màu badge].
const ROLE_LABEL = {
  admin: ['Quản trị viên', 'gray'], staff: ['Nhân viên', 'blue'], maintenance: ['An ninh / Bảo trì', 'amber'],
  secretary: ['Thư ký', 'green'], teacher: ['Giáo viên ProSkills', 'sage'], student: ['Học viên', 'gray'],
};

// Trạng thái đơn đăng ký và đơn trả phòng (đơn trả phòng duyệt xong lưu là 'done'): [nhãn, màu badge].
const TT_DON = {
  pending: ['Chờ duyệt', 'amber'], approved: ['Đã duyệt', 'green'], done: ['Đã duyệt', 'green'], rejected: ['Từ chối', 'gray'],
};
const nhanTTDon = st => (TT_DON[st] || [st || '—', 'gray']);

// Các khoản trên phiếu báo: [tên đầy đủ, tên ngắn cho cột bảng hẹp].
const KHOAN_TIEN = {
  room_charge: ['Tiền phòng', 'Tiền phòng'], electric_charge: ['Tiền điện', 'Điện'], water_charge: ['Tiền nước', 'Nước'],
  service_charge: ['Phí dịch vụ', 'Dịch vụ'], washing_charge: ['Máy giặt', 'Giặt'], parking_charge: ['Gửi xe', 'Xe'],
  deposit_charge: ['Tiền cọc', 'Cọc'],
};
const tenKhoan = k => (KHOAN_TIEN[k] || [k])[0];
const tenKhoanNgan = k => (KHOAN_TIEN[k] || [k, k])[1];
