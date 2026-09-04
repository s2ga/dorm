// ===== Lịch trực nhật =====
// Xoay vòng theo TUẦN giữa những người đang ở phòng (sếp chốt 15/07/2026).
//
// KHÔNG cần bảng lưu: lịch tính thẳng ra từ danh sách người ở + số tuần kể từ một mốc cố định.
// Lưu vào bảng thì phải sinh lịch trước cho từng tuần, rồi có người vào/ra là lịch cũ sai —
// lại phải đi vá. Tính ra thì lúc nào cũng khớp danh sách hiện tại.
//
// Tuần bắt đầu THỨ HAI (thói quen VN). Mốc 05/01/1970 là một thứ Hai.

const billing = require('./billing');

const EPOCH_MONDAY = '1970-01-05';

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Thứ Hai của tuần chứa ngày `ymd`
function mondayOf(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // 0 = thứ Hai ... 6 = Chủ nhật
  dt.setDate(dt.getDate() - dow);
  return fmt(dt);
}
// Số tuần trọn vẹn giữa 2 thứ Hai
const weeksSinceEpoch = monday => Math.round((new Date(monday) - new Date(EPOCH_MONDAY)) / (7 * 86400000));

// Lịch trực nhật của một phòng.
//   members : [{ id, name, check_in_date, check_out_date }] — người ở phòng đó
//   today   : 'YYYY-MM-DD'
//   weeks   : số tuần muốn xem trước
// Thứ tự xoay vòng theo NGÀY VÀO Ở rồi tới id: ai vào trước trực trước, và thứ tự này
// không đổi giữa 2 lần mở trang (đừng bao giờ sắp theo tên — đổi tên là đổi cả lịch).
function schedule({ members, today, weeks = 4 }) {
  const order = (members || []).slice().sort((a, b) =>
    String(a.check_in_date || '').localeCompare(String(b.check_in_date || '')) || (a.id - b.id));
  if (!order.length) return [];

  const out = [];
  const m0 = mondayOf(today);
  for (let i = 0; i < weeks; i++) {
    const from = billing.addDays(m0, i * 7);
    const to = billing.addDays(from, 6);
    // Chỉ xoay vòng giữa những người CÒN Ở trong tuần đó — xếp lịch cho người đã trả phòng
    // thì tới tuần đó phòng không ai trực.
    const here = order.filter(s => billing.daysStayedInRange(s, from, to) > 0);
    if (!here.length) continue;
    const idx = ((weeksSinceEpoch(from) % here.length) + here.length) % here.length;
    out.push({ from, to, student_id: here[idx].id, name: here[idx].name });
  }
  return out;
}

module.exports = { schedule, mondayOf, weeksSinceEpoch, EPOCH_MONDAY };
