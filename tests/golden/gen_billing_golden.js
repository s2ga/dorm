// Sinh GOLDEN FIXTURES cho parity billing Node↔Go.
// Chạy billing.js (NGUỒN CHÂN LÝ) trên ma trận case — phần lớn tái dùng nguyên tests/unit/billing.test.js —
// rồi ghi CẢ input lẫn output ra JSON. Go test đọc lại, chạy billing.go trên cùng input, so khớp từng đồng.
//   node .runtime/node/node.exe tests/golden/gen_billing_golden.js tests/golden/billing_golden.json
const path = require('path');
const fs = require('fs');
const b = require(path.join('c:/Users/thuyhien/quan-ly-ktx', 'server/billing'));

// fees dạng CHUỖI (khớp settings thật + Fees map[string]string bên Go). billing.js tự Number() nên OK.
const F = { room_fee: '1200000', electric_unit: '3500', water_fee: '100000', service_fee: '50000', washing_fee: '0', parking_fee: '0', partial_half_min: '10', partial_full_min: '15' };
const U = 3500;

const out = {
  computeInvoice: [], buildSegments: [], splitElectricExact: [], splitElectricByDays: [],
  partialFactor: [], leaderDiscount: [], depositRefundEligible: [], daysStayedInMonth: [], daysInMonth: [], invoiceTotal: [],
};

// ---- computeInvoice ----
const ci = (name, inp) => {
  const full = {
    student: { id: 1, rental_type: 'ghep', check_in_date: '2026-07-01', check_out_date: null, ...(inp.student || {}) },
    room: inp.room !== undefined ? inp.room : { monthly_fee: 1200000 },
    month: inp.month || '2026-07', fees: inp.fees || F,
    occupants: inp.occupants != null ? inp.occupants : 0,
    roster: inp.roster || [],
    electricCharge: inp.electricCharge != null ? inp.electricCharge : null,
    leaderDays: inp.leaderDays != null ? inp.leaderDays : 0,
    kwh: inp.kwh != null ? inp.kwh : 0,
    vehicleCount: inp.vehicleCount != null ? inp.vehicleCount : null,
  };
  out.computeInvoice.push({ name, in: full, out: b.computeInvoice(full) });
};
ci('phòng trưởng cả tháng', { leaderDays: 31 });
ci('không phải phòng trưởng', { leaderDays: 0 });
ci('ở nửa tháng, làm trưởng 14 ngày', { student: { check_out_date: '2026-07-14' }, leaderDays: 14 });
ci('đổi trưởng A 20 ngày', { leaderDays: 20 });
ci('đổi trưởng B 11 ngày', { leaderDays: 11 });
ci('leaderDays 999 (dữ liệu hỏng)', { leaderDays: 999 });
ci('leaderDays âm (dữ liệu hỏng)', { leaderDays: -5 });
ci('giảm 50% tiền phòng', { student: { room_fee_discount_pct: 50 } });
ci('giảm % > 100 chặn ở 100', { student: { room_fee_discount_pct: 500 } });
ci('giảm % âm', { student: { room_fee_discount_pct: -50 } });
ci('vừa trưởng vừa giảm 100%', { student: { room_fee_discount_pct: 100 }, leaderDays: 31 });
ci('TC-14 phòng giá 0 -> lấy đơn giá Cài đặt', {
  student: { id: 1, rental_type: 'ghep', check_in_date: '2026-07-01', check_out_date: null }, room: { monthly_fee: 0 },
  fees: { room_fee: '1200000', electric_unit: '3500', water_fee: '0', service_fee: '0', washing_fee: '0', parking_fee: '0', partial_half_min: '5', partial_full_min: '20' },
});
ci('thuê nguyên phòng theo hạng B', { student: { rental_type: 'phong' }, room: { hang: 'B', monthly_fee: 0 }, fees: { ...F, room_price_B: '4800000' } });
ci('điện tính sẵn electricCharge', { electricCharge: 123456, kwh: 300 });
ci('điện theo roster ngày ở', { roster: [{ student_id: 1, days: 31 }, { student_id: 2, days: 15 }], kwh: 300, fees: { ...F, electric_unit: '3500' } });
ci('điện chia đều occupants (không roster)', { occupants: 4, kwh: 300 });
ci('có xe: vehicleCount 2', { vehicleCount: 2, fees: { ...F, parking_fee: '100000' } });
ci('dùng máy giặt nửa tháng', { student: { check_out_date: '2026-07-14', uses_washing: true }, fees: { ...F, washing_fee: '70000' } });

// ---- buildSegments ----
const staysA = [{ student_id: 1, from: '2026-07-01', to: null }, { student_id: 2, from: '2026-07-01', to: null }, { student_id: 3, from: '2026-07-01', to: '2026-07-15' }];
const bs = (name, inp) => { const o = b.buildSegments(inp); out.buildSegments.push({ name, in: inp, out: o }); };
bs('TC-10 cắt 2 chặng', { month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-15', reading: 100 }], stays: staysA });
bs('không chốt giữa kỳ', { month: '2026-07', startReading: 0, endReading: 300, reads: [], stays: staysA });
bs('chỉ số mâu thuẫn -> fallback', { month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-15', reading: 400 }], stays: staysA });
bs('chốt đúng ngày cuối tháng', { month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-31', reading: 300 }], stays: staysA });
bs('phòng không dùng điện', { month: '2026-07', startReading: 500, endReading: 500, reads: [], stays: staysA });
bs('2 người rời, chốt sai thứ tự', {
  month: '2026-07', startReading: 0, endReading: 300,
  reads: [{ date: '2026-07-20', reading: 200 }, { date: '2026-07-10', reading: 90 }],
  stays: [{ student_id: 1, from: '2026-07-01', to: null }, { student_id: 2, from: '2026-07-01', to: '2026-07-10' }, { student_id: 3, from: '2026-07-01', to: '2026-07-20' }],
});
bs('chốt trùng ngày lấy lần sau', { month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-15', reading: 80 }, { date: '2026-07-15', reading: 100 }], stays: staysA });
bs('người vào ngày 25', { month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-15', reading: 100 }], stays: [{ student_id: 1, from: '2026-07-01', to: null }, { student_id: 9, from: '2026-07-25', to: null }] });

// ---- splitElectricExact ----
const se = (name, segs) => out.splitElectricExact.push({ name, in: segs, out: b.splitElectricExact(segs) });
se('TC-10 shares', b.buildSegments({ month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-15', reading: 100 }], stays: staysA }).map(s => ({ electric: s.kwh * U, roster: s.roster })));

// ---- splitElectricByDays ----
const sbd = (name, roomElectric, roster) => out.splitElectricByDays.push({ name, in: { roomElectric, roster }, out: b.splitElectricByDays(roomElectric, roster) });
[[33, 3500, 3], [7, 999, 3], [1, 1, 7], [100, 3333, 6]].forEach(([kwh, unit, n]) =>
  sbd(`${kwh}kWh x ${unit} chia ${n}`, kwh * unit, Array.from({ length: n }, (_, i) => ({ student_id: i + 1, days: 10 }))));
sbd('TC-10 cả tháng 1 chặng', 300 * U, [{ student_id: 1, days: 31 }, { student_id: 2, days: 31 }, { student_id: 3, days: 15 }]);

// ---- partialFactor ----
const pf = (name, args) => out.partialFactor.push({ name, in: args, out: b.partialFactor(...args) });
pf('giữa half-full -> 0.5', [12, 31, 10, 15]);
pf('hệ số nửa 0.6', [12, 31, 10, 15, 0.6]);
pf('dưới half -> 0', [8, 31, 10, 15, 0.6]);
pf('trên full -> 1', [20, 31, 10, 15, 0.6]);
pf('đủ tháng -> 1', [31, 31, 10, 15]);

// ---- leaderDiscount ----
const ld = (name, args) => out.leaderDiscount.push({ name, in: args, out: b.leaderDiscount(args) });
ld('trưởng cả tháng', { leaderDays: 31, days: 31, water_charge: 100000, service_charge: 50000 });
ld('nửa tháng', { leaderDays: 14, days: 14, water_charge: 50000, service_charge: 25000 });
ld('vượt số ngày ở', { leaderDays: 999, days: 31, water_charge: 100000, service_charge: 50000 });

// ---- depositRefundEligible ----
const dr = (name, arg, minDays) => out.depositRefundEligible.push({ name, in: { arg, minDays: minDays != null ? minDays : null }, out: b.depositRefundEligible(arg, minDays) });
dr('báo 30 ngày đủ (mặc định)', { noticeDate: '2026-07-01', checkoutDate: '2026-07-31', reason: 'other' });
dr('minDays 45 không đủ', { noticeDate: '2026-07-01', checkoutDate: '2026-07-31', reason: 'other' }, 45);
dr('minDays 20 đủ', { noticeDate: '2026-07-01', checkoutDate: '2026-07-26', reason: 'other' }, 20);
dr('xuất cảnh luôn đủ', { noticeDate: null, checkoutDate: '2026-07-10', reason: 'departure' });

// ---- daysStayedInMonth ----
const dsm = (name, ci_, co_, month) => out.daysStayedInMonth.push({ name, in: { ci: ci_, co: co_, month }, out: b.daysStayedInMonth({ check_in_date: ci_, check_out_date: co_ }, month) });
dsm('trọn tháng 7', '2026-07-01', null, '2026-07');
dsm('vào ngày cuối = 1', '2026-07-31', null, '2026-07');
dsm('vào-ra cùng ngày = 1', '2026-07-15', '2026-07-15', '2026-07');
dsm('rời trước tháng = 0', '2026-05-01', '2026-06-30', '2026-07');
dsm('vào sau tháng = 0', '2026-08-01', null, '2026-07');

// ---- daysInMonth ----
const dim = (name, m) => out.daysInMonth.push({ name, in: m, out: b.daysInMonth(m) });
dim('nhuận 2028-02', '2028-02'); dim('thường 2026-02', '2026-02'); dim('tháng 7', '2026-07'); dim('tháng 4', '2026-04');

// ---- invoiceTotal ----
const it = (name, f) => out.invoiceTotal.push({ name, in: f, out: b.invoiceTotal(f) });
it('Σ7 - 2 giảm', { room_charge: 1200000, electric_charge: 350000, water_charge: 100000, service_charge: 50000, washing_charge: 70000, parking_charge: 100000, other_charge: 30000, leader_discount: 150000, room_discount: 600000 });
it('thiếu field coi như 0', { room_charge: 1200000, water_charge: 100000 });

const dest = process.argv[2];
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
const n = Object.values(out).reduce((a, c) => a + c.length, 0);
console.log(`✅ Ghi ${n} case golden -> ${dest}`);
