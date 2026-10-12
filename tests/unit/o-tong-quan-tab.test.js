// 4 ô đầu Tổng quan: số trên ô = tổng các tab (E2 / S2 / Nhân viên / An ninh), không sót ai, không đếm trùng.
// Chạy đúng đoạn kpiNhom của app-exec-dashboard.js trên dữ liệu dựng sẵn.
const fs = require('fs');
const path = require('path');

const js = f => fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', f), 'utf8');
const doan = (src, tu, den) => { const a = src.indexOf(tu), b = src.indexOf(den, a); return a >= 0 && b > a ? src.slice(a, b) : ''; };
const dong = (src, ten) => (src.match(new RegExp(`^const ${ten} = .*$`, 'm')) || [''])[0];

module.exports = {
  name: 'Tổng quan — 4 ô tách tab E2/S2/Nhân viên/An ninh, tổng khớp từng tab',

  run(t) {
    const auth = js('app-public-auth.js');
    const khoi = doan(js('app-exec-dashboard.js'), 'const KPI_NHOM', 'let _kpiTab');
    const phan = [
      dong(auth, 'legalEntity'),
      doan(auth, 'const ROOM_TYPE', 'const phongConCho'),
      doan(auth, 'const _d10', 'const choXacNhanVao'),
      doan(auth, 'function trongSoGiuong', '// ---- Rule hợp đồng'),
      dong(auth, 'studentRoomKind'),
    ];
    t.ok('Rút được đoạn kpiNhom và các hàm phòng/trạng thái', !!khoi && phan.every(Boolean));
    if (!khoi || !phan.every(Boolean)) return;

    const HOM_NAY = '2026-10-12';
    const ST = { settings: {}, rooms: [], students: [] };
    const roomById = id => ST.rooms.find(r => r.id === id);
    const f = new Function('ST', 'today', 'roomById',
      `${phan.join('\n')}\n${khoi}\nreturn { kpiNhom, KPI_NHOM, tongChiSo, isOccupying, dangOTinhGiuong, dangONgoaiSoGiuong, sapTraPhong, sapNhanPhong };`)(
      ST, () => HOM_NAY, roomById);

    const p = (id, gender, room_type, capacity, occupancy, upcoming = 0) => ({ id, name: 'P' + id, gender, room_type, capacity, occupancy, upcoming, leaving: 0 });
    ST.rooms = [
      p(1, 'female', 'shared', 4, 3),        // còn 1
      p(2, 'female', 'whole', 4, 0, 2),      // trống 4, đã đặt 2 -> còn 2
      p(3, 'male', 'shared', 4, 4),          // đầy
      p(4, 'male', 'shared', 5, 6),          // quá tải (được phép) -> còn 0, không âm
      p(5, 'male', 'shared', 4, 1, 5),       // đặt chỗ vượt giường trống -> còn 0, không âm
      p(6, 'female', 'security', 2, 1),      // phòng an ninh: không vào tổng giường
      p(7, 'male', 'staff', 3, 1),           // phòng nhân viên: không vào tổng giường
      p(8, 'male', 'loai-la', 3, 1),         // loại lạ coi như thuê ghép -> còn 2
    ];
    const hv = (id, room_id, gender, x) => ({ id, name: 'HV' + id, room_id, gender, deleted_at: null,
      check_in_date: null, check_out_date: null, planned_check_in: null, planned_check_out: null, ...x });
    const o = { check_in_date: '2026-03-01' };
    ST.students = [
      hv(1, 1, 'female', o),                                             // E2 đang ở
      hv(2, 3, 'male', o),                                               // S2 đang ở
      hv(3, 6, 'female', o),                                             // nữ ở phòng an ninh -> An ninh, không phải E2
      hv(4, 7, 'male', o),                                               // phòng nhân viên
      hv(5, 7, 'female', { ...o, planned_check_out: '2026-10-20' }),     // phòng nhân viên, sắp trả
      hv(6, null, 'male', o),                                            // chưa xếp phòng -> theo giới tính
      hv(7, 3, '', o),                                                   // thiếu giới tính -> S2 như legalEntity
      hv(8, 1, 'female', { check_in_date: '2026-03-01', check_out_date: '2026-09-30' }),   // đã trả
      hv(9, 1, 'female', { planned_check_in: '2026-10-20' }),            // sắp vào
      hv(10, 3, 'male', { planned_check_in: '2026-10-01' }),             // quá ngày vào, chờ xác nhận vào
      hv(11, 3, 'male', { ...o, planned_check_out: '2026-10-01' }),      // quá ngày trả, chờ xác nhận trả
      hv(12, 1, 'female', { ...o, deleted_at: '2026-10-01T00:00:00Z' }), // hồ sơ đã khoá
      hv(13, 6, 'male', { planned_check_in: '2026-10-25' }),             // sắp vào phòng an ninh
      hv(14, 2, 'female', { ...o, planned_check_out: '2026-11-30' }),    // thuê nguyên phòng, sắp trả
    ];

    const ids = ds => ds.map(s => s.id).sort((a, b) => a - b);
    const tongTab = d => Object.values(d.so).reduce((a, n) => a + n, 0);

    t.eq('Nhãn tab theo pháp nhân trong Cài đặt rồi tới Nhân viên, An ninh',
      f.KPI_NHOM().map(([, ten]) => ten), ['E2', 'S2', 'Nhân viên', 'An ninh']);
    ST.settings = { legal_female: 'E2-HCM', legal_male: 'S2-HCM' };
    t.eq('Đổi tên pháp nhân trong Cài đặt thì tab đổi theo', f.KPI_NHOM().slice(0, 2).map(([, ten]) => ten), ['E2-HCM', 'S2-HCM']);
    ST.settings = {};

    const dangO = f.kpiNhom('dang_o');
    t.eq('Đang ở: số trên ô bằng tổng các tab', dangO.tong, tongTab(dangO));
    t.eq('Đang ở: không sót ai đang chiếm giường, kể cả phòng an ninh/nhân viên',
      dangO.tong, ST.students.filter(s => !s.deleted_at && f.isOccupying(s)).length);
    t.eq('Đang ở: bằng số cũ của ô cộng số "tính riêng" trước đây',
      dangO.tong, ST.students.filter(s => !s.deleted_at && (f.dangOTinhGiuong(s) || f.dangONgoaiSoGiuong(s))).length);
    t.eq('Tab E2 đang ở', ids(dangO.nhom.nu), [1, 14]);
    t.eq('Tab S2 đang ở (gồm chưa xếp phòng, thiếu giới tính, chờ xác nhận trả)', ids(dangO.nhom.nam), [2, 6, 7, 11]);
    t.eq('Tab Nhân viên đang ở', ids(dangO.nhom.nhan_vien), [4, 5]);
    t.eq('Nữ ở phòng an ninh nằm ở tab An ninh, không lẫn vào E2', ids(dangO.nhom.an_ninh), [3]);
    t.ok('Người đã trả, sắp vào, hồ sơ khoá không nằm trong "Đang ở"',
      ![8, 9, 10, 12, 13].some(id => Object.values(dangO.nhom).flat().some(s => s.id === id)));

    const sapTra = f.kpiNhom('sap_tra');
    t.eq('Sắp trả: số trên ô bằng tổng các tab', sapTra.tong, tongTab(sapTra));
    t.eq('Sắp trả: gồm người phòng nhân viên, thuê nguyên phòng và người quá hẹn chờ xác nhận',
      ids(Object.values(sapTra.nhom).flat()), [5, 11, 14]);
    t.ok('Sắp trả: không sót người mà ô cũ đếm', ST.students.filter(f.sapTraPhong).every(s => Object.values(sapTra.nhom).flat().includes(s)));

    const sapVao = f.kpiNhom('sap_vao');
    t.eq('Sắp vào: số trên ô bằng tổng các tab', sapVao.tong, tongTab(sapVao));
    t.eq('Sắp vào: gồm người chờ xác nhận vào và người sắp vào phòng an ninh', ids(Object.values(sapVao.nhom).flat()), [9, 10, 13]);
    t.eq('Người sắp vào phòng an ninh nằm ở tab An ninh', ids(sapVao.nhom.an_ninh), [13]);
    t.ok('Sắp vào: không sót người mà ô cũ đếm', ST.students.filter(f.sapNhanPhong).every(s => Object.values(sapVao.nhom).flat().includes(s)));

    const giuong = f.kpiNhom('giuong');
    t.eq('Giường trống chỉ có hai tab E2, S2', Object.keys(giuong.so), ['nu', 'nam']);
    t.eq('Giường trống: E2 + S2 bằng đúng số trên ô (tongChiSo)', giuong.tong, f.tongChiSo(ST.rooms).thucCon);
    t.eq('Giường trống E2 = phòng 1 (1) + phòng nguyên căn 2 (4 trống - 2 đặt)', giuong.so.nu, 3);
    t.eq('Giường trống S2: phòng quá tải và phòng đặt chỗ vượt không làm âm, loại lạ tính như ghép', giuong.so.nam, 2);
    t.ok('Phòng an ninh, phòng nhân viên không nằm trong tab nào',
      ![6, 7].some(id => [...giuong.nhom.nu, ...giuong.nhom.nam].some(x => x.r.id === id)));
  },
};
