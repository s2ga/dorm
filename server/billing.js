// ===== Bộ tính tiền phòng (thuần, dễ kiểm thử) =====

// Tổng tiền một phiếu = Σ 7 khoản phí − các khoản GIẢM. MỘT nguồn duy nhất cho mọi nơi (billing,
// invoice-calc, invoices.routes: generate/POST/PUT) để 3–5 đường không lệch nhau khi sửa công thức.
// f: object chứa các cột phí + giảm; thiếu cột nào coi như 0 (vd phiếu tự tính không có other_charge;
// đường POST/PUT không có discount trong body -> truyền kèm từ bản ghi hiện tại).
const INVOICE_FEE_FIELDS = ['room_charge', 'electric_charge', 'water_charge', 'service_charge', 'washing_charge', 'parking_charge', 'other_charge'];
function invoiceTotal(f) {
  const fee = INVOICE_FEE_FIELDS.reduce((a, k) => a + (+f[k] || 0), 0);
  return fee - (+f.leader_discount || 0) - (+f.room_discount || 0);
}

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function firstDay(month) { return `${month}-01`; }
function lastDay(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 0).getDate(); // số ngày trong tháng (local, không lệch múi giờ)
  return `${month}-${String(d).padStart(2, '0')}`;
}
function diffDaysInclusive(a, b) {
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000) + 1);
}
function addDays(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Số ngày ở thực tế trong một khoảng [from..to] (tính cả 2 đầu)
function daysStayedInRange(student, from, to) {
  const ci = student.check_in_date, co = student.check_out_date;
  if (ci && ci > to) return 0;   // chưa vào
  if (co && co < from) return 0; // đã rời trước khoảng này
  const inD = ci && ci > from ? ci : from;
  const outD = co && co < to ? co : to;
  return diffDaysInclusive(inD, outD);
}

// Số ngày ở thực tế trong tháng
function daysStayedInMonth(student, month) {
  return daysStayedInRange(student, firstDay(month), lastDay(month));
}

// Hệ số cho các phí cố định khi ở tháng lẻ:
//  ≤ half   -> 0
//  > half   -> 0.5
//  > full   -> 1
//  ở đủ tháng -> 1
function partialFactor(days, dim, halfMin, fullMin, halfFactor = 0.5) {
  if (days >= dim) return 1;
  if (days > fullMin) return 1;
  if (days > halfMin) return Number.isFinite(halfFactor) ? halfFactor : 0.5;
  return 0;
}

const r0 = n => Math.round(Number(n) || 0);

// Chia tiền điện của PHÒNG theo SỐ NGÀY Ở THỰC TẾ của từng người.
// roster: [{ student_id, days }] — mọi người ở phòng đó trong kỳ.
//
// Trước đây: chia đều đầu người, không nhân ngày -> người ở 1 ngày trả bằng người ở cả tháng,
// còn người ở lại thì được giảm sai vì bị chia thêm suất.
// Dùng phương pháp "phần dư lớn nhất" để TỔNG các phần khớp TUYỆT ĐỐI với tiền điện của phòng
// (không hụt/dư đồng nào, kể cả khi đơn giá không chia hết).
function splitElectricByDays(roomElectric, roster) {
  const out = splitElectricExact([{ electric: roomElectric, roster }]);
  (roster || []).forEach(r => { if (out[r.student_id] === undefined) out[r.student_id] = 0; });
  return out;
}

// Chia tiền điện theo TỪNG CHẶNG giữa 2 lần chốt chỉ số công-tơ.
// segments: [{ electric, roster:[{student_id, days}] }] — electric = tiền điện CHÍNH XÁC (chưa làm tròn) của chặng.
//
// Vì sao phải cắt chặng: người rời phòng giữa tháng chỉ được tính phần điện ĐÃ CHỐT tới ngày họ đi
// (chặng trước), còn điện dùng sau đó là của người ở lại. Chia thẳng cả tháng theo ngày ở sẽ bắt
// người ở lại gánh thay — hoặc ngược lại, tùy phòng dùng nhiều điện vào nửa nào của tháng.
//
// Làm tròn 1 LẦN DUY NHẤT ở cuối trên tổng của cả người (cộng qua mọi chặng), theo "phần dư lớn nhất",
// nên tổng các phần khớp TUYỆT ĐỐI với tiền điện của phòng — không dư/hụt đồng nào.
function splitElectricExact(segments) {
  const exact = {};   // student_id -> số tiền chính xác (số thực, chưa làm tròn)
  let totalExact = 0;
  for (const seg of segments || []) {
    const list = (seg.roster || []).filter(r => (r.days || 0) > 0);
    const totalDays = list.reduce((a, r) => a + r.days, 0);
    if (!(seg.electric > 0) || totalDays <= 0) continue;
    totalExact += seg.electric;
    for (const r of list) exact[r.student_id] = (exact[r.student_id] || 0) + (seg.electric * r.days) / totalDays;
  }
  const parts = Object.keys(exact).map(id => {
    const base = Math.floor(exact[id]);
    return { id: Number(id), base, frac: exact[id] - base };
  });
  let rem = r0(totalExact) - parts.reduce((a, p) => a + p.base, 0);
  parts.slice().sort((a, b) => (b.frac - a.frac) || (a.id - b.id)).forEach(p => { if (rem > 0) { p.base += 1; rem -= 1; } });
  const out = {};
  parts.forEach(p => { out[p.id] = p.base; });
  return out;
}

// Cắt tháng thành các CHẶNG theo những lần chốt chỉ số GIỮA KỲ (lúc có người trả phòng / chuyển đi).
//   startReading / endReading : chỉ số đầu & cuối tháng của phòng
//   reads   : [{date, reading}] các lần chốt trong tháng
//   stays   : [{student_id, from, to}] ai ở phòng này từ ngày nào đến ngày nào (to=null nghĩa là còn ở)
// Chốt ngày D tính TRỌN ngày D vào chặng trước (người trả phòng ngày D vẫn được tính ở hết ngày D).
// -> [{ from, to, kwh, roster:[{student_id, days}] }]
function buildSegments({ month, startReading, endReading, reads, stays }) {
  const mStart = firstDay(month), mEnd = lastDay(month);
  const start = Number(startReading) || 0, end = Number(endReading) || 0;

  // Chỉ lấy các lần chốt NẰM TRONG tháng và TRƯỚC ngày cuối tháng (chốt đúng ngày cuối = chỉ số cuối tháng)
  const mids = [];
  for (const r of (reads || [])) {
    const date = String(r.date).slice(0, 10);
    if (date < mStart || date >= mEnd) continue;
    const i = mids.findIndex(x => x.date === date);
    if (i >= 0) mids[i] = { date, reading: Number(r.reading) }; // trùng ngày -> lấy lần chốt sau cùng
    else mids.push({ date, reading: Number(r.reading) });
  }
  mids.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const roster = (from, to) => (stays || [])
    .map(s => ({ student_id: s.student_id, days: daysStayedInRange({ check_in_date: s.from, check_out_date: s.to }, from, to) }))
    .filter(r => r.days > 0)
    // 1 người có thể có 2 lượt ở cùng phòng (đi rồi quay lại) -> cộng dồn, không tạo 2 dòng
    .reduce((acc, r) => { const h = acc.find(x => x.student_id === r.student_id); h ? (h.days += r.days) : acc.push(r); return acc; }, []);

  const segs = [];
  let prev = start, from = mStart;
  for (const p of [...mids, { date: mEnd, reading: end }]) {
    segs.push({ from, to: p.date, kwh: p.reading - prev, roster: roster(from, p.date) });
    prev = p.reading;
    from = addDays(p.date, 1);
  }

  // Chỉ số phải TĂNG DẦN. Nếu dữ liệu chốt mâu thuẫn (chốt giữa kỳ > chỉ số cuối tháng, hoặc lùi số),
  // thà quay về chia cả tháng còn hơn xuất ra con số sai mà không ai biết.
  const bad = segs.some(s => s.kwh < 0) || Math.abs(segs.reduce((a, s) => a + s.kwh, 0) - (end - start)) > 0.05;
  if (bad) return [{ from: mStart, to: mEnd, kwh: end - start, roster: roster(mStart, mEnd), fellback: true }];
  return segs.filter(s => s.from <= s.to);
}

// Giá thuê nguyên phòng theo hạng
function roomPriceByHang(hang, fees) {
  return Number(fees['room_price_' + (hang || 'B')] || fees.room_fee);
}

// Tính 1 hóa đơn tháng cho 1 học viên
// opts: { student, room, month, fees, roster, occupants, kwh, vehicleCount }
//   roster = [{student_id, days}] của TẤT CẢ người ở cùng phòng trong kỳ -> chia điện theo ngày ở (đúng).
//   occupants = số người (CÁCH CŨ: chia đều đầu người) — chỉ dùng khi không truyền roster.
//   electricCharge = tiền điện ĐÃ TÍNH SẴN của riêng học viên này (cộng qua mọi phòng họ ở trong tháng,
//     cắt theo từng chặng chốt chỉ số) — ưu tiên cao nhất, đúng nhất. Xem invoice-calc.studentElectric.
//   leaderDays = số ngày làm PHÒNG TRƯỞNG trong tháng -> miễn nước + dịch vụ theo tỉ lệ ngày làm.
function computeInvoice({ student, room, month, fees, occupants, roster, electricCharge, leaderDays, kwh, vehicleCount }) {
  const dim = daysInMonth(month);
  const days = daysStayedInMonth(student, month);

  // Tiền phòng: thuê ghép -> giá/người; thuê nguyên phòng -> giá theo hạng
  let roomFee;
  if (student.rental_type === 'phong') {
    roomFee = roomPriceByHang(room && room.hang, fees);
  } else {
    // Phòng CHƯA đặt giá riêng (null/0) -> dùng đơn giá "Tiền phòng" trong Cài đặt.
    // (Trước đây coi 0 là "giá thật = miễn phí" -> mọi HV thuê ghép bị tính tiền phòng = 0)
    const rf = room && Number(room.monthly_fee) > 0 ? Number(room.monthly_fee) : Number(fees.room_fee);
    roomFee = rf;
  }
  const room_charge = r0((roomFee / dim) * days); // chia đúng theo số ngày ở

  // Giảm tiền phòng theo % riêng của từng người (vd quản lý KTX ở phòng 104 được giảm 50%).
  // Để ở HỒ SƠ HỌC VIÊN chứ không viết cứng số phòng vào code: đổi phòng hay đổi người thì
  // chị quản lý tự sửa được, không phải gọi lập trình viên.
  const pct = Math.min(100, Math.max(0, Number(student.room_fee_discount_pct) || 0));
  const room_discount = r0((room_charge * pct) / 100);

  // Hệ số phí cố định (nước, dịch vụ, máy giặt, xe)
  const f = partialFactor(days, dim, +fees.partial_half_min, +fees.partial_full_min,
    fees.partial_half_factor != null && fees.partial_half_factor !== '' ? Number(fees.partial_half_factor) : 0.5);
  const water_charge = r0(Number(fees.water_fee) * f);
  const service_charge = r0(Number(fees.service_fee) * f);
  const washing_charge = student.uses_washing ? r0(Number(fees.washing_fee) * f) : 0;
  const nVehicles = vehicleCount != null ? vehicleCount : (student.uses_parking ? 1 : 0);
  const parking_charge = r0(Number(fees.parking_fee) * nVehicles * f);

  // Điện: tổng kWh phòng × đơn giá, chia theo SỐ NGÀY Ở của từng người
  const unit = Number(fees.electric_unit);
  const roomElectric = r0(Number(kwh || 0) * unit);
  let electric_charge;
  if (electricCharge != null) {
    // ĐÚNG NHẤT: đã cộng phần của HV ở MỌI phòng họ ở trong tháng, cắt theo từng chặng chốt chỉ số.
    // Người chuyển phòng giữa tháng phải trả cả phần ở phòng cũ — cách cũ (chỉ nhìn phòng hiện tại) làm rơi mất.
    electric_charge = r0(electricCharge);
  } else if (Array.isArray(roster) && roster.length) {
    // Không có lần chốt giữa kỳ -> cả tháng là 1 chặng, chia theo ngày ở
    const share = splitElectricByDays(roomElectric, roster);
    electric_charge = share[student.id] != null ? share[student.id] : 0;
  } else {
    // Không có roster -> quay về cách cũ (chia đều đầu người). Chỉ còn dùng cho script/di sản.
    electric_charge = occupants > 0 ? r0(roomElectric / occupants) : 0;
  }

  const leader_discount = leaderDiscount({ leaderDays, days, water_charge, service_charge });

  // Mọi khoản giảm đều ghi RIÊNG một dòng, không âm thầm hạ tiền phòng/tiền nước xuống —
  // học viên thấy được ưu đãi, cấp trên thống kê được chế độ này tốn bao nhiêu.
  const total = invoiceTotal({ room_charge, electric_charge, water_charge, service_charge, washing_charge, parking_charge, leader_discount, room_discount });

  return {
    days_stayed: days,
    room_charge,
    // kWh HIỂN THỊ trên phiếu = phần của RIÊNG học viên (suy từ tiền điện của họ ÷ đơn giá),
    // KHÔNG phải kWh cả phòng. Trước đây hiện kWh cả phòng (vd 300) nhưng chỉ thu 1/3 -> HV đọc
    // "300 kWh sao chỉ trả 1/3?" tưởng app tính sai (TP-27). Giờ hiện ~100 kWh, khớp số tiền.
    // Giữ ĐÚNG 2 số lẻ — hệ thống tài chính bên đối tác chỉ nhận tới 2 số lẻ.
    electric_kwh: unit > 0 ? Math.round((electric_charge / unit) * 100) / 100 : 0,
    electric_charge,
    water_charge,
    service_charge,
    washing_charge,
    parking_charge,
    leader_discount,
    room_discount,
    other_charge: 0,
    total,
  };
}

// Khoản giảm cho PHÒNG TRƯỞNG (sếp chốt 15/07/2026).
//   giảm = (tiền nước + phí dịch vụ) × (số ngày làm phòng trưởng ÷ số ngày ở)
//
// Vì sao tính theo TỈ LỆ của chính tiền nước+dịch vụ, chứ không trừ một số cố định 150.000:
//   - Làm phòng trưởng trọn tháng -> giảm = đúng 100% -> MIỄN HẲN, kể cả sau này sếp tăng giá nước.
//   - Người ở nửa tháng chỉ bị tính 75.000 nước+dịch vụ -> giảm 75.000 -> về 0.
//     Trừ cứng 150.000 ở đây sẽ ra ÂM 75.000, tức là app đi TRẢ TIỀN cho học viên.
//   - Đổi phòng trưởng giữa tháng: người cũ 20 ngày + người mới 11 ngày -> tổng giảm vẫn đúng
//     bằng MỘT suất, không phát thành hai.
function leaderDiscount({ leaderDays, days, water_charge, service_charge }) {
  const ld = Math.min(Number(leaderDays) || 0, days); // không thể làm phòng trưởng nhiều ngày hơn số ngày ở
  if (ld <= 0 || days <= 0) return 0;
  return r0(((water_charge + service_charge) * ld) / days);
}

// Xét điều kiện hoàn cọc khi trả phòng
// eligible nếu: xuất cảnh (đi Nhật), HOẶC báo trước >= 30 ngày.
// Xuất cảnh ĐỘT XUẤT (có visa gấp) = lý do 'departure' -> đã được miễn ở dòng dưới; nhánh 'urgent_visa'
// cũ ĐÃ GỠ vì enum checkout_reason (me.routes/students.routes) không sinh giá trị đó (nhánh chết). Nếu
// cần hoàn ngoại lệ cho trường hợp khác, admin dùng override_reason ở deposit-settle (có ghi nhật ký).
function depositRefundEligible({ noticeDate, checkoutDate, reason }, minDays = 30) {
  const minD = Number.isFinite(+minDays) && +minDays > 0 ? +minDays : 30;
  if (reason === 'departure') return { eligible: true, reason: 'Xuất cảnh đi Nhật — hoàn cọc' };
  if (!noticeDate || !checkoutDate) return { eligible: false, reason: 'Chưa có ngày báo trả phòng' };
  const noticeDays = Math.round((new Date(checkoutDate) - new Date(noticeDate)) / 86400000);
  if (noticeDays >= minD) return { eligible: true, reason: `Báo trước ${noticeDays} ngày (≥ ${minD} ngày)` };
  return { eligible: false, reason: `Chỉ báo trước ${noticeDays} ngày (< ${minD} ngày)` };
}

// Trạng thái tự tính theo ngày: upcoming(Sắp vào) | staying(Đang ở) | leaving(Sắp trả) | left(Đã trả)
function liveStatus(s, today) {
  const ci = s.check_in_date, co = s.check_out_date;
  if (co && co <= today) return 'left';
  if (ci && ci > today) return 'upcoming';
  if (co && co > today) return 'leaving';
  return 'staying';
}
// Đang chiếm giường (tính occupancy): đang ở hoặc sắp trả
function isOccupying(s, today) { const st = liveStatus(s, today); return st === 'staying' || st === 'leaving'; }

module.exports = {
  daysInMonth, firstDay, lastDay, addDays, daysStayedInMonth, daysStayedInRange,
  partialFactor, computeInvoice, depositRefundEligible, invoiceTotal,
  roomPriceByHang, liveStatus, isOccupying,
  splitElectricByDays, splitElectricExact, buildSegments, leaderDiscount,
};
