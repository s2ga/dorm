// BL-78: GET /students trả 207 bản ghi × 43 trường, gồm CCCD, SĐT phụ huynh, số tài khoản ngân hàng.
// Danh sách về trình duyệt sau MỖI thao tác lưu và nằm thường trực trong bộ nhớ JS suốt phiên —
// một chỗ sót esc() là hút trọn cả khối. Bảng danh sách không cần những trường đó để vẽ ra nó.
const P = '__test_bl78';
const clean = db => db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);

// Trường CHỈ được có ở hồ sơ chi tiết, không được nằm trong danh sách.
const RIENG_TU = ['id_card', 'birth_date', 'parent_phone', 'deposit_bank', 'deposit_account', 'note'];
// Trường bảng danh sách THẬT SỰ dùng — cắt nhầm là vỡ màn Học viên.
const PHAI_CO = ['id', 'code', 'name', 'gender', 'phone', 'room_id', 'room_name', 'status',
  'check_in_date', 'rental_type', 'residency_status', 'deposit_amount', 'deposit_status',
  'uses_washing', 'vehicle_count', 'violation_count', 'has_cccd_front', 'has_cccd_back',
  'is_leader', 'facility_id', 'login_username'];

module.exports = {
  name: 'BL-78 · danh sách học viên không mang dữ liệu cá nhân',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const T = await t.login('admin', process.env.ADMIN_P);
    const sid = (await t.db.query(
      `INSERT INTO students (name, code, phone, id_card, birth_date, parent_phone, deposit_bank, deposit_account, note, check_in_date)
       VALUES ($1,$2,'0900000078','079200000078','2000-01-15','0911000078','VIETCOMBANK','0123456789','ghi chú riêng',CURRENT_DATE)
       RETURNING id`, [P + '_hv', P + '_c'])).rows[0].id;
    try {
      const ds = await t.api('GET', '/api/students', T);
      t.eq('TC-78a · lấy được danh sách', ds.status, 200, `HTTP ${ds.status}`);
      const hv = (ds.json || []).find(x => x.id === sid);
      t.ok('TC-78b · hồ sơ vừa tạo có trong danh sách', !!hv, 'không thấy');

      const loLot = RIENG_TU.filter(k => hv && Object.prototype.hasOwnProperty.call(hv, k));
      t.eq('TC-78c · danh sách KHÔNG trả CCCD / ngày sinh / SĐT phụ huynh / số tài khoản / ghi chú',
        loLot, [], `còn lọt: ${loLot.join(', ') || 'không'}`);

      const thieu = PHAI_CO.filter(k => hv && !Object.prototype.hasOwnProperty.call(hv, k));
      t.eq('TC-78d · vẫn đủ trường bảng danh sách cần (cắt nhầm là vỡ màn Học viên)',
        thieu, [], `thiếu: ${thieu.join(', ') || 'không'}`);

      // Tìm kiếm theo SĐT vẫn chạy ở SERVER, không phụ thuộc việc trường đó có về hay không.
      const tim = await t.api('GET', '/api/students?q=0900000078', T);
      t.ok('TC-78e · tìm theo số điện thoại vẫn ra kết quả', (tim.json || []).some(x => x.id === sid),
        `được ${(tim.json || []).length} kết quả`);

      // Mở hồ sơ chi tiết thì PHẢI đủ — chỗ nào cần thì lấy ở đây.
      const ct = await t.api('GET', `/api/students/${sid}`, T);
      t.eq('TC-78f · hồ sơ chi tiết trả 200', ct.status, 200, `HTTP ${ct.status}`);
      const thieuCT = RIENG_TU.filter(k => !ct.json || ct.json[k] == null || ct.json[k] === '');
      t.eq('TC-78g · … và có ĐỦ dữ liệu cá nhân (không phải cắt mất, chỉ đổi chỗ lấy)',
        thieuCT, [], `thiếu ở chi tiết: ${thieuCT.join(', ') || 'không'}`);

      // Lớp chặn XSS thứ hai ở tầng GHI (esc() phía trình duyệt là lớp duy nhất, dễ sót).
      const xau = await t.api('PUT', `/api/students/${sid}`, T,
        { name: '<img src=x onerror=alert(1)>' + P });
      t.eq('TC-78h · ghi tên có mã HTML → 400 (chặn ở tầng ghi, không chỉ trông vào esc)',
        xau.status, 400, `HTTP ${xau.status} ${JSON.stringify(xau.json)}`);
      const conNguyen = (await t.db.query('SELECT name FROM students WHERE id=$1', [sid])).rows[0].name;
      t.eq('TC-78i · … và tên cũ không bị ghi đè', conNguyen, P + '_hv', conNguyen);

      const lanh = await t.api('PUT', `/api/students/${sid}`, T, { name: P + '_Nguyễn Văn A < B' });
      t.eq('TC-78j · tên tiếng Việt bình thường (có dấu <) vẫn lưu được — không chặn nhầm',
        lanh.status, 200, `HTTP ${lanh.status} ${JSON.stringify(lanh.json)}`);
    } finally {
      await clean(t.db);
    }
  },
};
