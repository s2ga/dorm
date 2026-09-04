// Lõi tính tiền — thuần, không cần máy chủ/CSDL.
// TC-11, TC-12, TC-10: tiền điện phải theo SỐ NGÀY Ở, cắt theo các lần chốt chỉ số,
// và TỔNG các phần phải khớp TUYỆT ĐỐI với tiền điện của phòng (không dư/hụt đồng nào).
const b = require('../../server/billing');
const { fmt } = require('../lib/harness');

const U = 3500; // đơn giá điện — cố tình chọn số KHÔNG chia hết để lòi lỗi làm tròn
const share = segs => b.splitElectricExact(segs.map(s => ({ electric: s.kwh * U, roster: s.roster })));
const sum = o => Object.values(o).reduce((a, c) => a + c, 0);

module.exports = {
  name: 'Lõi tính tiền điện — chia theo ngày ở & cắt chặng chốt chỉ số',
  needsServer: false,

  async run(t) {
    // ===== TC-10: A1, A2 ở cả tháng; X rời phòng 15/07. Phòng dùng 300 kWh, chốt 100 kWh ngày 15.
    const stays = [
      { student_id: 1, from: '2026-07-01', to: null },
      { student_id: 2, from: '2026-07-01', to: null },
      { student_id: 3, from: '2026-07-01', to: '2026-07-15' },
    ];
    const segs = b.buildSegments({ month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-15', reading: 100 }], stays });

    t.eq('TC-10 · cắt đúng 2 chặng, đúng biên ngày & số kWh',
      segs.map(s => [s.from, s.to, s.kwh]),
      [['2026-07-01', '2026-07-15', 100], ['2026-07-16', '2026-07-31', 200]]);

    const s1 = share(segs);
    // Chặng 1: 350.000 chia 3 người × 15 ngày -> 116.666,67 mỗi người
    // Chặng 2: 700.000 chia 2 người × 16 ngày -> 350.000 mỗi người
    t.near('TC-10 · X chỉ trả phần điện TỚI ngày rời (≈116.667)', s1[3], 116667);
    t.near('TC-10 · A1 không gánh thay (≈466.667)', s1[1], 466667);
    t.near('TC-10 · A2 không gánh thay (≈466.667)', s1[2], 466667);
    t.eq('TC-10 · TỔNG khớp TUYỆT ĐỐI tiền điện phòng', sum(s1), 300 * U, `tổng ${fmt(sum(s1))} · phải ${fmt(300 * U)}`);
    t.ok('TC-10 · hai người ở như nhau thì trả như nhau (lệch ≤1đ do làm tròn)',
      Math.abs(s1[1] - s1[2]) <= 1, `lệch ${s1[1] - s1[2]}đ`);

    // ===== Không chốt giữa kỳ -> phải y hệt cách cũ (không được đổi hành vi ngoài ý muốn)
    const segsNo = b.buildSegments({ month: '2026-07', startReading: 0, endReading: 300, reads: [], stays });
    const old = b.splitElectricByDays(300 * U, [{ student_id: 1, days: 31 }, { student_id: 2, days: 31 }, { student_id: 3, days: 15 }]);
    t.eq('Không chốt giữa kỳ · cả tháng là 1 chặng', segsNo.length, 1);
    t.eq('Không chốt giữa kỳ · kết quả y hệt cách chia theo ngày ở', share(segsNo), old);

    // ===== TC-12: đơn giá không chia hết -> không được dư/hụt đồng nào
    for (const [kwh, unit, n] of [[33, 3500, 3], [7, 999, 3], [1, 1, 7], [100, 3333, 6]]) {
      const r = b.splitElectricByDays(kwh * unit, Array.from({ length: n }, (_, i) => ({ student_id: i + 1, days: 10 })));
      t.eq(`TC-12 · ${kwh}kWh × ${fmt(unit)} chia ${n} người — tổng khớp tuyệt đối`, sum(r), Math.round(kwh * unit));
    }

    // ===== Chỉ số MÂU THUẪN (nhập nhầm) -> thà chia cả tháng còn hơn xuất số sai mà không ai biết
    const bad = b.buildSegments({ month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-15', reading: 400 }], stays });
    t.ok('Chốt giữa kỳ > chỉ số cuối tháng · tự quay về chia cả tháng', bad.length === 1 && bad[0].fellback === true);
    t.eq('Chốt lùi số · tổng vẫn không sai', sum(share(bad)), 300 * U);

    // ===== Biên
    const segsEnd = b.buildSegments({ month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-31', reading: 300 }], stays });
    t.eq('Chốt đúng ngày cuối tháng · không đẻ chặng rỗng', segsEnd.length, 1);

    const segsZero = b.buildSegments({ month: '2026-07', startReading: 500, endReading: 500, reads: [], stays });
    t.eq('Phòng không dùng điện · không ai bị tính đồng nào', sum(share(segsZero)), 0);

    // ===== Nhiều người rời nhiều ngày khác nhau, chốt gửi lên SAI thứ tự
    const stays3 = [
      { student_id: 1, from: '2026-07-01', to: null },
      { student_id: 2, from: '2026-07-01', to: '2026-07-10' },
      { student_id: 3, from: '2026-07-01', to: '2026-07-20' },
    ];
    const segs3 = b.buildSegments({
      month: '2026-07', startReading: 0, endReading: 300,
      reads: [{ date: '2026-07-20', reading: 200 }, { date: '2026-07-10', reading: 90 }], stays: stays3,
    });
    t.eq('2 người rời · cắt 3 chặng, tự sắp đúng thứ tự ngày',
      segs3.map(s => [s.from, s.to, s.kwh]),
      [['2026-07-01', '2026-07-10', 90], ['2026-07-11', '2026-07-20', 110], ['2026-07-21', '2026-07-31', 100]]);
    const s3 = share(segs3);
    t.eq('2 người rời · TỔNG vẫn khớp tuyệt đối', sum(s3), 300 * U);
    t.ok('2 người rời · ai ở lâu hơn trả nhiều hơn', s3[1] > s3[3] && s3[3] > s3[2],
      `ở cả tháng ${fmt(s3[1])} > rời 20/07 ${fmt(s3[3])} > rời 10/07 ${fmt(s3[2])}`);

    // ===== Chốt TRÙNG NGÀY -> lấy lần sau cùng, không đẻ chặng 0 ngày
    const dup = b.buildSegments({
      month: '2026-07', startReading: 0, endReading: 300,
      reads: [{ date: '2026-07-15', reading: 80 }, { date: '2026-07-15', reading: 100 }], stays,
    });
    t.eq('Chốt 2 lần cùng ngày · lấy lần sau cùng, vẫn 2 chặng', dup.map(s => s.kwh), [100, 200]);

    // ===== Người vào GIỮA tháng không được tính điện chặng chưa ở
    const late = b.buildSegments({
      month: '2026-07', startReading: 0, endReading: 300, reads: [{ date: '2026-07-15', reading: 100 }],
      stays: [{ student_id: 1, from: '2026-07-01', to: null }, { student_id: 9, from: '2026-07-25', to: null }],
    });
    const sL = share(late);
    t.eq('Vào ngày 25 · KHÔNG dính điện chặng 1 (lúc chưa ở)', late[0].roster.map(r => r.student_id), [1]);
    t.eq('Vào ngày 25 · TỔNG vẫn khớp', sum(sL), 300 * U);

    // ===== Số ngày ở — biên tháng
    t.eq('Ở trọn tháng 7 = 31 ngày', b.daysStayedInMonth({ check_in_date: '2026-07-01', check_out_date: null }, '2026-07'), 31);
    t.eq('Vào đúng ngày cuối tháng = 1 ngày (không phải 0)', b.daysStayedInMonth({ check_in_date: '2026-07-31', check_out_date: null }, '2026-07'), 1);
    t.eq('Vào và ra cùng một ngày = 1 ngày', b.daysStayedInMonth({ check_in_date: '2026-07-15', check_out_date: '2026-07-15' }, '2026-07'), 1);
    t.eq('Rời trước khi tháng bắt đầu = 0 ngày', b.daysStayedInMonth({ check_in_date: '2026-05-01', check_out_date: '2026-06-30' }, '2026-07'), 0);
    t.eq('Vào sau khi tháng kết thúc = 0 ngày', b.daysStayedInMonth({ check_in_date: '2026-08-01', check_out_date: null }, '2026-07'), 0);
    t.eq('Tháng 2 năm nhuận = 29 ngày', b.daysInMonth('2028-02'), 29);
    t.eq('Tháng 2 năm thường = 28 ngày', b.daysInMonth('2026-02'), 28);

    // ===== PHÒNG TRƯỞNG — miễn nước + dịch vụ theo tỉ lệ ngày làm (sếp chốt 15/07/2026)
    const F = { room_fee: 1200000, electric_unit: U, water_fee: 100000, service_fee: 50000, washing_fee: 0, parking_fee: 0, partial_half_min: 10, partial_full_min: 15 };
    const inv = o => b.computeInvoice({
      student: { id: 1, rental_type: 'ghep', check_in_date: '2026-07-01', check_out_date: null, ...o.student },
      room: { monthly_fee: 1200000 }, month: '2026-07', fees: F, roster: [], kwh: 0, ...o,
    });

    const full = inv({ leaderDays: 31 });
    t.eq('Phòng trưởng cả tháng · giảm ĐÚNG 150.000 (miễn hẳn nước + dịch vụ)', full.leader_discount, 150000, `giảm ${fmt(full.leader_discount)}`);
    t.eq('Phòng trưởng cả tháng · nước + dịch vụ thực trả = 0',
      full.water_charge + full.service_charge - full.leader_discount, 0);
    t.eq('Phòng trưởng cả tháng · nhưng phiếu VẪN ghi nước 100.000 (để thấy được ưu đãi)', full.water_charge, 100000);

    const none = inv({ leaderDays: 0 });
    t.eq('Không phải phòng trưởng · không giảm đồng nào', none.leader_discount, 0);
    t.eq('Không phải phòng trưởng · tổng cao hơn phòng trưởng đúng 150.000', none.total - full.total, 150000,
      `chênh ${fmt(none.total - full.total)}`);

    // Ở nửa tháng: hệ số phí cố định 0.5 -> nước 50.000 + dịch vụ 25.000 = 75.000
    const half = inv({ student: { check_out_date: '2026-07-14' }, leaderDays: 14 });
    t.eq('Ở nửa tháng, làm trưởng cả 14 ngày · giảm 75.000 — KHÔNG âm', half.leader_discount, 75000, `giảm ${fmt(half.leader_discount)}`);
    t.eq('Ở nửa tháng · nước + dịch vụ thực trả = 0', half.water_charge + half.service_charge - half.leader_discount, 0);
    t.ok('Ở nửa tháng · TỔNG không âm (trừ cứng 150.000 sẽ ra ÂM — app đi trả tiền cho HV)',
      half.total >= 0, `tổng = ${fmt(half.total)}`);

    // Đổi phòng trưởng giữa tháng: A làm 20 ngày, B làm 11 ngày -> tổng giảm = ĐÚNG 1 suất
    const A = inv({ leaderDays: 20 }), B = inv({ leaderDays: 11 });
    t.eq('Đổi trưởng giữa tháng · tổng giảm của A + B = đúng 1 suất 150.000, không phát 2 suất',
      A.leader_discount + B.leader_discount, 150000, `A ${fmt(A.leader_discount)} + B ${fmt(B.leader_discount)}`);

    t.eq('Làm trưởng nhiều ngày hơn số ngày ở (dữ liệu hỏng) · vẫn không giảm quá 1 suất',
      inv({ leaderDays: 999 }).leader_discount, 150000);
    t.eq('Số ngày làm trưởng âm (dữ liệu hỏng) · không giảm', inv({ leaderDays: -5 }).leader_discount, 0);

    // ===== GIẢM TIỀN PHÒNG THEO % (quản lý KTX ở phòng 104 được giảm 50%)
    const mgr = inv({ student: { room_fee_discount_pct: 50 } });
    t.eq('Giảm 50% tiền phòng · giảm đúng 600.000', mgr.room_discount, 600000, `giảm ${fmt(mgr.room_discount)}`);
    t.eq('Giảm 50% tiền phòng · phiếu VẪN ghi tiền phòng đủ 1.200.000', mgr.room_charge, 1200000);
    t.eq('Giảm 50% tiền phòng · tiền phòng thực trả = 600.000', mgr.room_charge - mgr.room_discount, 600000);
    t.eq('Không đặt % · không giảm tiền phòng', none.room_discount, 0);
    t.eq('Đặt % > 100 (nhập bậy) · chặn ở 100%, không giảm quá tiền phòng',
      inv({ student: { room_fee_discount_pct: 500 } }).room_discount, 1200000);
    t.eq('Đặt % âm (nhập bậy) · không giảm', inv({ student: { room_fee_discount_pct: -50 } }).room_discount, 0);
    t.eq('Đặt % là chữ (nhập bậy) · không giảm', inv({ student: { room_fee_discount_pct: 'abc' } }).room_discount, 0);
    t.ok('Vừa là phòng trưởng vừa được giảm phòng · cộng cả hai, tổng vẫn không âm',
      inv({ student: { room_fee_discount_pct: 100 }, leaderDays: 31 }).total >= 0);

    // ===== TC-14 (tiền phòng): phòng chưa đặt giá riêng -> KHÔNG được tính 0đ
    const fees = { room_fee: 1200000, electric_unit: U, water_fee: 0, service_fee: 0, washing_fee: 0, parking_fee: 0, partial_half_min: 5, partial_full_min: 20 };
    const inv0 = b.computeInvoice({
      student: { id: 1, rental_type: 'ghep', check_in_date: '2026-07-01' },
      room: { monthly_fee: 0 }, month: '2026-07', fees, roster: [], kwh: 0,
    });
    t.eq('TC-14 · phòng để giá 0 -> lấy đơn giá trong Cài đặt, KHÔNG tính 0đ', inv0.room_charge, 1200000,
      `tiền phòng = ${fmt(inv0.room_charge)} · phải ${fmt(1200000)}`);

    // ===== Đợt 2.4: invoiceTotal — MỘT nguồn công thức, khớp mọi đường
    t.eq('invoiceTotal · Σ7 phí − 2 giảm', b.invoiceTotal({
      room_charge: 1200000, electric_charge: 350000, water_charge: 100000, service_charge: 50000,
      washing_charge: 70000, parking_charge: 100000, other_charge: 30000, leader_discount: 150000, room_discount: 600000,
    }), 1200000 + 350000 + 100000 + 50000 + 70000 + 100000 + 30000 - 150000 - 600000);
    t.eq('invoiceTotal · thiếu other_charge & discount coi như 0', b.invoiceTotal({ room_charge: 1200000, water_charge: 100000 }), 1300000);
    // Khớp với total của computeInvoice (không có other) — phiếu phòng trưởng
    t.eq('invoiceTotal khớp computeInvoice (phòng trưởng)', b.invoiceTotal(full), full.total);

    // ===== Đợt 3: partialFactor nhận hệ số "nửa" từ tham số (mặc định 0.5)
    t.eq('partialFactor · ngày ở giữa half và full → hệ số mặc định 0.5', b.partialFactor(12, 31, 10, 15), 0.5);
    t.eq('partialFactor · hệ số "nửa" tuỳ chỉnh 0.6 (từ Cài đặt)', b.partialFactor(12, 31, 10, 15, 0.6), 0.6);
    t.eq('partialFactor · dưới ngưỡng half → 0 (không đổi)', b.partialFactor(8, 31, 10, 15, 0.6), 0);
    t.eq('partialFactor · trên full → 1 (không đổi)', b.partialFactor(20, 31, 10, 15, 0.6), 1);

    // ===== Đợt 3: depositRefundEligible nhận ngưỡng minDays từ tham số (mặc định 30)
    t.ok('hoàn cọc · báo trước 30 ngày đủ (mặc định)', b.depositRefundEligible({ noticeDate: '2026-07-01', checkoutDate: '2026-07-31', reason: 'other' }).eligible);
    t.ok('hoàn cọc · minDays=45: báo trước 30 ngày KHÔNG đủ', !b.depositRefundEligible({ noticeDate: '2026-07-01', checkoutDate: '2026-07-31', reason: 'other' }, 45).eligible);
    t.ok('hoàn cọc · minDays=20: báo trước 25 ngày ĐỦ', b.depositRefundEligible({ noticeDate: '2026-07-01', checkoutDate: '2026-07-26', reason: 'other' }, 20).eligible);
    t.ok('hoàn cọc · xuất cảnh (departure) luôn đủ, không cần báo trước', b.depositRefundEligible({ noticeDate: null, checkoutDate: '2026-07-10', reason: 'departure' }).eligible);
  },
};
