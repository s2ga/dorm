// BL-134: hộp "Chưa lập phiếu báo" — chạy đúng đoạn code của app-exec-dashboard.js trên dữ liệu dựng sẵn.
// Không réo oan thành viên phòng nguyên căn (kể cả khi cả phòng đã trả, hay phòng đã đổi sang ghép sau kỳ đó),
// và không giấu người đã ở mà chưa có phiếu (kể cả mới vào hôm qua).
const fs = require('fs');
const path = require('path');

const js = f => fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', f), 'utf8');
const doan = (src, tu, den) => { const a = src.indexOf(tu), b = src.indexOf(den, a); return a >= 0 && b > a ? src.slice(a, b) : ''; };

module.exports = {
  name: 'Chưa lập phiếu báo — đúng dân số, không réo oan, không giấu người',

  run(t) {
    const khoi = doan(js('app-exec-dashboard.js'), 'const _vaoHieuLuc', 'async function billOverdueModal');
    const trangThai = doan(js('app-public-auth.js'), 'const _d10', 'const STATUS_INFO');
    t.ok('Rút được đoạn luật của hộp và hàm trạng thái', !!khoi && !!trangThai);
    if (!khoi || !trangThai) return;

    const HOM_NAY = '2026-10-12';
    const NGUYEN = new Set([1, 5]);   // phòng đang là thuê nguyên căn
    const ST = { settings: { water_fee: '100000', service_fee: '50000' }, students: [] };
    const { dsChuaLapPhieu } = new Function('ST', 'today', 'curMonth', 'DAY_MS', 'thueNguyenPhong',
      `${trangThai}\n${khoi}\nreturn { dsChuaLapPhieu };`)(
      ST, () => HOM_NAY, () => HOM_NAY.slice(0, 7), 86400000, s => NGUYEN.has(s.room_id));

    const hv = (id, room, x) => ({ id, name: 'HV' + id, room_id: room, deleted_at: null, contract_no: '',
      check_in_date: null, check_out_date: null, planned_check_in: null, planned_check_out: null, ...x });
    const roiT9 = { check_in_date: '2026-03-01', check_out_date: '2026-09-20' };
    ST.students = [
      // Phòng 1 nguyên căn, cả phòng đã trả 20/09, chưa ai có phiếu T9 -> chỉ người ký HĐ bị nhắc
      hv(10, 1, { ...roiT9, contract_no: '40/2026/HĐKTX-E2' }), hv(11, 1, roiT9), hv(12, 1, roiT9), hv(13, 1, roiT9),
      // Phòng 2 ghép, cả phòng đã trả 20/09, chưa ai có phiếu T9 -> cả 4 bị nhắc
      hv(20, 2, roiT9), hv(21, 2, roiT9), hv(22, 2, roiT9), hv(23, 2, roiT9),
      // Phòng 3 NAY là ghép nhưng T9 còn nguyên căn: người ký HĐ có phiếu T9 trọn phòng (4 suất nước)
      hv(40, 3, { check_in_date: '2026-03-01', check_out_date: '2026-09-30', contract_no: '10/2026' }),
      hv(41, 3, { check_in_date: '2026-03-01', check_out_date: '2026-09-30' }),
      // Phòng 6 ghép: người kia có phiếu T9 MỘT suất -> người không phiếu vẫn phải bị nhắc
      hv(50, 6, { check_in_date: '2026-03-01', check_out_date: '2026-09-30' }),
      hv(51, 6, { check_in_date: '2026-03-01', check_out_date: '2026-09-30' }),
      // Phòng 4 ghép, kỳ này
      hv(30, 4, { check_in_date: '2026-10-10' }),          // vào 2 ngày trước, chưa phiếu
      hv(31, 4, { planned_check_in: '2026-10-18' }),       // có lịch vào 18/10
      hv(70, 4, { check_in_date: '2026-05-01' }),          // có phiếu T10
      hv(80, 4, { check_in_date: '2026-05-01', deleted_at: '2026-10-01T00:00:00Z' }),   // hồ sơ đã khoá
      hv(90, 4, { check_in_date: '2026-04-01' }),          // ở lâu, chưa phiếu T10
      hv(91, 4, { check_in_date: '2026-03-01', check_out_date: '2026-10-05' }),   // đã ở rồi trả trong kỳ, chưa phiếu
      // Phòng 5 nguyên căn đang ở: người ký HĐ có phiếu T10, thành viên không có phiếu riêng
      hv(60, 5, { check_in_date: '2026-06-01', contract_no: '55/2026' }), hv(61, 5, { check_in_date: '2026-06-01' }),
    ];
    const phieuT10 = [{ student_id: 70, room_id: 4, water_charge: 100000, service_charge: 50000 },
      { student_id: 60, room_id: 5, water_charge: 200000, service_charge: 100000 }];
    const phieuT9 = [{ student_id: 40, room_id: 3, water_charge: 400000, service_charge: 200000 },
      { student_id: 50, room_id: 6, water_charge: 100000, service_charge: 50000 }];

    const { kyNay, sapVao, kyTruoc } = dsChuaLapPhieu(phieuT10, phieuT9);
    const ids = ds => ds.map(s => s.id).sort((a, b) => a - b);
    const truocPhong = room => ids(kyTruoc.filter(s => s.room_id === room));

    t.eq('Phòng nguyên căn cả phòng đã trả: chỉ người ký HĐ bị nhắc ở "rời kỳ trước"', truocPhong(1), [10]);
    t.eq('Phòng ghép cả phòng đã trả: cả 4 người đều bị nhắc', truocPhong(2), [20, 21, 22, 23]);
    t.eq('Phòng đã đổi sang ghép nhưng kỳ trước có phiếu TRỌN PHÒNG: thành viên không bị réo oan', truocPhong(3), []);
    t.eq('Phiếu của người kia chỉ MỘT suất: người không phiếu vẫn bị nhắc', truocPhong(6), [51]);
    t.ok('Người mới vào 2 ngày, chưa có phiếu: HIỆN ở "đã ở mà chưa có phiếu"', kyNay.some(s => s.id === 30), JSON.stringify(ids(kyNay)));
    t.ok('Đã ở rồi trả ngay trong kỳ, chưa có phiếu: vẫn hiện', kyNay.some(s => s.id === 91), JSON.stringify(ids(kyNay)));
    t.eq('Người chưa nhận phòng (có lịch vào) tách riêng nhóm "chưa nhận phòng"', ids(sapVao), [31]);
    t.ok('Người chưa nhận phòng KHÔNG lẫn vào nhóm "đã ở"', !kyNay.some(s => s.id === 31));
    t.ok('Người đã có phiếu kỳ này không bị nhắc', !kyNay.some(s => s.id === 70) && !sapVao.some(s => s.id === 70));
    t.ok('Hồ sơ đã khoá không bị nhắc', ![...kyNay, ...sapVao, ...kyTruoc].some(s => s.id === 80));
    t.ok('Thành viên phòng nguyên căn đang ở (người ký HĐ đã có phiếu) không bị nhắc', !kyNay.some(s => s.id === 61));
    t.eq('Nhóm "đã ở" đủ người: ở lâu + mới vào + trả trong kỳ', ids(kyNay), [30, 90, 91]);
    t.eq('Ở lâu nhất đứng đầu danh sách', kyNay[0] && kyNay[0].id, 91);
  },
};
