// Vai "secretary" (ban thư ký): CHỈ xem hồ sơ lưu trữ — /students/archive trả đúng các trường cho
// phép + mở được tệp scan HĐ/CCCD; mọi cửa khác (danh sách HV đầy đủ, phòng, phiếu thu, cài đặt,
// mọi thao tác GHI) phải 403; trường cấm (SĐT, email, tiền cọc...) phải bị cắt từ server.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_thuky';
const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Ban thư ký — chỉ xem hồ sơ lưu trữ',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const hash = bcrypt.hashSync(pw, 10);

    const f1 = (await t.db.query(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_cs1'])).rows[0].id;
    const f2 = (await t.db.query(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_cs2'])).rows[0].id;
    const s1 = (await t.db.query(
      `INSERT INTO students (name, birth_date, class_name, contract_no, check_in_date, check_out_date, phone, facility_id)
       VALUES ($1, '2003-05-20', 'Lớp K25A', '12/2026/HDKTX-TEST', '2026-01-10', '2026-06-30', '0900000001', $2) RETURNING id`,
      [P + '_hv1', f1])).rows[0].id;
    await t.db.query(
      `INSERT INTO students (name, birth_date, class_name, phone, facility_id)
       VALUES ($1, '2004-11-02', 'Lớp K26B', '0900000002', $2)`, [P + '_hv2', f2]);
    await t.db.query(
      `INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,'secretary','Thư ký toàn cục')`,
      [P + '_tk', hash]);
    await t.db.query(
      `INSERT INTO users (username, password_hash, role, full_name, facility_id) VALUES ($1,$2,'secretary','Thư ký cơ sở 1',$3)`,
      [P + '_tk_cs1', hash, f1]);

    try {
      // ===== Cửa MỞ: đăng nhập + hồ sơ lưu trữ
      const tk = await t.login(P + '_tk', pw);
      t.ok('TC-TK1 · thư ký đăng nhập được', !!tk);

      const arc = await t.api('GET', '/api/students/archive', tk);
      t.eq('TC-TK2 · GET /students/archive → 200', arc.status, 200, `HTTP ${arc.status}`);
      const rows = Array.isArray(arc.json) ? arc.json : [];
      const hv1 = rows.find(r => r.name === P + '_hv1');
      t.ok('TC-TK3 · thấy học viên kèm đủ trường được phép (ngày sinh, lớp, số HĐ, ngày nhận/trả phòng)',
        !!hv1 && hv1.birth_date === '2003-05-20' && hv1.class_name === 'Lớp K25A'
        && hv1.contract_no === '12/2026/HDKTX-TEST' && hv1.check_in_date === '2026-01-10'
        && hv1.check_out_date === '2026-06-30', JSON.stringify(hv1));
      t.ok('TC-TK4 · có cờ giấy tờ (chưa nộp gì → cả 3 đều false)',
        !!hv1 && hv1.has_contract_scan === false && hv1.has_cccd_front === false && hv1.has_cccd_back === false,
        JSON.stringify(hv1 && { scan: hv1.has_contract_scan, truoc: hv1.has_cccd_front, sau: hv1.has_cccd_back }));

      // Trường cấm phải bị cắt từ server — kiểm TỪNG KHOÁ trả về, không chỉ vài khoá đoán trước
      const choPhep = ['id', 'name', 'birth_date', 'class_name', 'contract_no',
        'check_in_date', 'check_out_date', 'has_contract_scan', 'has_cccd_front', 'has_cccd_back'];
      const thua = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => !choPhep.includes(k));
      t.eq('TC-TK5 · KHÔNG lộ trường ngoài danh sách cho phép (SĐT, email, tiền cọc, phòng...)',
        thua.length, 0, thua.length ? 'đang lộ: ' + thua.join(', ') : 'chỉ có đúng các trường cho phép ✔');

      // Tệp giấy tờ: qua được cửa QUYỀN (không 403). Chưa có tệp/S3 nên 404/501 là đúng.
      const scan = await t.api('GET', `/api/students/${s1}/contract-scan`, tk);
      t.ok('TC-TK6 · mở tệp scan HĐ: KHÔNG bị chặn quyền (403)', scan.status !== 403, `HTTP ${scan.status}`);
      const cccd = await t.api('GET', `/api/students/${s1}/cccd/front`, tk);
      t.ok('TC-TK7 · mở ảnh CCCD: KHÔNG bị chặn quyền (403)', cccd.status !== 403, `HTTP ${cccd.status}`);

      // ===== Cửa ĐÓNG: mọi thứ ngoài hồ sơ lưu trữ
      const cuaDong = [
        ['GET', '/api/students', 'danh sách HV đầy đủ (có SĐT, tiền cọc...)'],
        ['GET', `/api/students/${s1}`, 'hồ sơ chi tiết một HV'],
        ['GET', '/api/rooms', 'danh sách phòng'],
        ['GET', '/api/invoices', 'phiếu thu'],
        ['GET', '/api/settings', 'cài đặt'],
        ['GET', '/api/logs', 'nhật ký check-in/out'],
        ['GET', '/api/admin/users', 'quản lý tài khoản'],
        ['POST', '/api/students', 'tạo HV'],
        ['PUT', `/api/students/${s1}`, 'sửa HV'],
        ['POST', `/api/students/${s1}/contract-scan`, 'nộp scan HĐ'],
        ['DELETE', `/api/students/${s1}/contract-scan`, 'xoá scan HĐ'],
      ];
      for (const [m, duong, ten] of cuaDong) {
        const r = await t.api(m, duong, tk, m === 'GET' ? undefined : {});
        t.eq(`TC-TK8 · thư ký bị chặn: ${m} ${duong} (${ten}) → 403`, r.status, 403, `HTTP ${r.status}`);
      }

      // ===== Bó theo cơ sở: thư ký gắn cơ sở 1 không được thấy hồ sơ cơ sở 2
      const tkCs1 = await t.login(P + '_tk_cs1', pw);
      const arcCs1 = await t.api('GET', '/api/students/archive', tkCs1);
      const ten = (arcCs1.json || []).filter(r => String(r.name).startsWith(P)).map(r => r.name);
      t.eq('TC-TK9 · thư ký cơ sở 1 chỉ thấy HV cơ sở 1', JSON.stringify(ten), JSON.stringify([P + '_hv1']),
        'thấy: ' + JSON.stringify(ten));

      // ===== Học viên KHÔNG chui được vào kho lưu trữ
      await t.db.query(
        `INSERT INTO users (username, password_hash, role, full_name, student_id) VALUES ($1,$2,'student',$3,$4)`,
        [P + '_hv1', hash, P + '_hv1', s1]);
      const hv = await t.login(P + '_hv1', pw);
      const arcHv = await t.api('GET', '/api/students/archive', hv);
      t.eq('TC-TK10 · học viên gọi /students/archive → 403', arcHv.status, 403, `HTTP ${arcHv.status}`);

      // ===== Admin tạo/quản lý được tài khoản thư ký qua API
      const admin = await t.login('admin', process.env.ADMIN_P);
      const tao = await t.api('POST', '/api/admin/users', admin,
        { username: P + '_tk_moi', password: 'matkhau6', role: 'secretary', full_name: 'Thư ký mới' });
      t.eq('TC-TK11 · admin tạo tài khoản vai thư ký → 201', tao.status, 201, `HTTP ${tao.status} ${JSON.stringify(tao.json)}`);
      const ds = await t.api('GET', '/api/admin/users', admin);
      const moi = (ds.json || []).find(u => u.username === P + '_tk_moi');
      t.ok('TC-TK12 · tài khoản thư ký hiện ở /admin/users với đúng vai', !!moi && moi.role === 'secretary',
        JSON.stringify(moi && { u: moi.username, role: moi.role }));
      const bay = await t.api('POST', '/api/admin/users', admin,
        { username: P + '_bay', password: 'matkhau6', role: 'hacker' });
      t.eq('TC-TK13 · vai lạ vẫn bị chặn 400 (không vì thêm vai mới mà mở toang)', bay.status, 400, `HTTP ${bay.status}`);
    } finally {
      await clean(t.db);
    }
  },
};
