// Nhân viên KIÊM khách thuê phòng: admin gắn hồ sơ (users.student_id) vào tài khoản nhân viên,
// role giữ nguyên, cổng /me/* mở theo liên kết hồ sơ. Kiểm cửa mở (vào /me/* + giữ quyền nghiệp vụ)
// và cửa đóng (hồ sơ đã thuộc tài khoản khác / tài khoản học viên, chờ duyệt / hồ sơ bị khoá).
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_kiem';
const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Nhân viên kiêm khách thuê phòng — gắn/gỡ hồ sơ + quyền hai cổng',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const hash = bcrypt.hashSync(pw, 10);

    // Hồ sơ: s1 tự do, s2 đã có tài khoản học viên, s3 bị khoá (xoá mềm), s4 tự do
    const sid = async (name, extra = '') =>
      (await t.db.query(`INSERT INTO students (name, phone${extra ? ', deleted_at' : ''})
        VALUES ($1, '0900000009'${extra ? `, ${extra}` : ''}) RETURNING id`, [name])).rows[0].id;
    const s1 = await sid(P + '_hv1');
    const s2 = await sid(P + '_hv2');
    const s3 = await sid(P + '_hv3', 'now()');
    const s4 = await sid(P + '_hv4');

    const uid = async (username, role, extra = {}) =>
      (await t.db.query(
        `INSERT INTO users (username, password_hash, role, full_name, student_id, approved)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [username, hash, role, username, extra.student_id || null, extra.approved !== false])).rows[0].id;
    const uStaff = await uid(P + '_nv1', 'staff');
    const uStaff2 = await uid(P + '_nv2', 'staff');
    const uHV2 = await uid(P + '_hv2', 'student', { student_id: s2 });
    const uPending = await uid(P + '_cho', 'pending', { approved: false });

    try {
      const admin = await t.login('admin', process.env.ADMIN_P);

      // ===== Gắn hồ sơ: cửa MỞ
      const gan = await t.api('POST', `/api/admin/users/${uStaff}/link-student`, admin, { student_id: s1 });
      t.eq('TC-KN1 · admin gắn hồ sơ tự do vào tài khoản staff → 200', gan.status, 200, `HTTP ${gan.status} ${JSON.stringify(gan.json)}`);

      const nv = await t.login(P + '_nv1', pw);
      const prof = await t.api('GET', '/api/me/profile', nv);
      t.ok('TC-KN2 · staff kiêm nhiệm mở được cổng khách thuê: GET /me/profile → 200, đúng hồ sơ',
        prof.status === 200 && prof.json && prof.json.name === P + '_hv1',
        `HTTP ${prof.status} · name=${prof.json && prof.json.name}`);
      const inv = await t.api('GET', '/api/me/invoices', nv);
      t.ok('TC-KN3 · GET /me/invoices → 200 (danh sách, dù rỗng)', inv.status === 200 && Array.isArray(inv.json), `HTTP ${inv.status}`);
      const dsHV = await t.api('GET', '/api/students', nv);
      const dsP = await t.api('GET', '/api/rooms', nv);
      t.ok('TC-KN4 · vai nhân viên còn nguyên: GET /students & /rooms vẫn 200',
        dsHV.status === 200 && dsP.status === 200, `students=${dsHV.status} rooms=${dsP.status}`);

      const ds = await t.api('GET', '/api/admin/users', admin);
      const hang = (ds.json || []).find(u => u.username === P + '_nv1');
      t.ok('TC-KN5 · /admin/users trả kèm thông tin hồ sơ kiêm nhiệm (student_id + tên)',
        !!hang && hang.student_id === s1 && hang.student_name === P + '_hv1',
        JSON.stringify(hang && { student_id: hang.student_id, student_name: hang.student_name }));

      // ===== Bất biến: cửa ĐÓNG
      const cacCa = [
        [uStaff2, s2, 'hồ sơ đã thuộc tài khoản học viên khác'],
        [uHV2, s4, 'tài khoản role student không gắn kiêm nhiệm'],
        [uPending, s4, 'tài khoản chờ duyệt không gắn kiêm nhiệm'],
        [uStaff, s4, 'tài khoản đã gắn hồ sơ phải gỡ trước'],
        [uStaff2, s3, 'hồ sơ bị khoá (xoá mềm) không gắn được'],
      ];
      for (const [u, s, ten] of cacCa) {
        const r = await t.api('POST', `/api/admin/users/${u}/link-student`, admin, { student_id: s });
        t.eq(`TC-KN6 · chặn: ${ten} → 400`, r.status, 400, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
      }
      const thieu = await t.api('POST', `/api/admin/users/${uStaff2}/link-student`, admin, {});
      t.eq('TC-KN7 · thiếu student_id → 400', thieu.status, 400, `HTTP ${thieu.status}`);
      const nvGan = await t.api('POST', `/api/admin/users/${uStaff2}/link-student`, nv, { student_id: s4 });
      t.eq('TC-KN8 · staff (không phải admin) gọi gắn hồ sơ → 403', nvGan.status, 403, `HTTP ${nvGan.status}`);

      // ===== Gỡ liên kết
      const go = await t.api('DELETE', `/api/admin/users/${uStaff}/link-student`, admin);
      t.eq('TC-KN9 · gỡ liên kết → 200', go.status, 200, `HTTP ${go.status}`);
      const profSau = await t.api('GET', '/api/me/profile', nv);
      t.eq('TC-KN10 · gỡ xong cổng khách thuê đóng lại ngay: /me/profile → 403', profSau.status, 403, `HTTP ${profSau.status}`);
      const dsSau = await t.api('GET', '/api/students', nv);
      t.eq('TC-KN11 · quyền nghiệp vụ không suy suyển sau khi gỡ: /students → 200', dsSau.status, 200, `HTTP ${dsSau.status}`);
      const goHV = await t.api('DELETE', `/api/admin/users/${uHV2}/link-student`, admin);
      t.eq('TC-KN12 · KHÔNG rút được hồ sơ khỏi tài khoản học viên thuần → 404', goHV.status, 404, `HTTP ${goHV.status}`);
      const goRong = await t.api('DELETE', `/api/admin/users/${uStaff2}/link-student`, admin);
      t.eq('TC-KN13 · gỡ tài khoản chưa gắn gì → 404', goRong.status, 404, `HTTP ${goRong.status}`);

      // ===== Học viên thuần không đổi hành vi
      const hv = await t.login(P + '_hv2', pw);
      const hvProf = await t.api('GET', '/api/me/profile', hv);
      const hvDs = await t.api('GET', '/api/students', hv);
      const hvAdm = await t.api('GET', '/api/admin/users', hv);
      t.ok('TC-KN14 · học viên thuần: /me/profile 200, /students 403, /admin/users 403',
        hvProf.status === 200 && hvDs.status === 403 && hvAdm.status === 403,
        `me=${hvProf.status} students=${hvDs.status} admin=${hvAdm.status}`);

      // ===== Admin cũng kiêm nhiệm được, luật "admin = mọi cơ sở" không đổi
      const taoQT = await t.api('POST', '/api/admin/users', admin,
        { username: P + '_qt', password: 'matkhau6', role: 'admin', full_name: 'QT kiêm nhiệm' });
      t.eq('TC-KN15 · tạo tài khoản admin phụ → 201', taoQT.status, 201, `HTTP ${taoQT.status}`);
      const uQT = taoQT.json && taoQT.json.id;
      const ganQT = await t.api('POST', `/api/admin/users/${uQT}/link-student`, admin, { student_id: s1 });
      t.eq('TC-KN16 · gắn hồ sơ vào tài khoản admin → 200', ganQT.status, 200, `HTTP ${ganQT.status} ${JSON.stringify(ganQT.json)}`);
      const ds2 = await t.api('GET', '/api/admin/users', admin);
      const hangQT = (ds2.json || []).find(u => u.username === P + '_qt');
      t.ok('TC-KN17 · admin kiêm nhiệm vẫn là "Tất cả cơ sở" (facility_id NULL), vai không đổi',
        !!hangQT && hangQT.role === 'admin' && hangQT.facility_id == null && hangQT.student_id === s1,
        JSON.stringify(hangQT && { role: hangQT.role, facility_id: hangQT.facility_id, student_id: hangQT.student_id }));
    } finally {
      await clean(t.db);
    }
  },
};
