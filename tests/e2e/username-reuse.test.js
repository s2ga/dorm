// BL-73: xoá tài khoản là xoá MỀM, nên tên đăng nhập phải được trả lại cho người sau dùng.
// Trước đây bảng users còn ràng buộc UNIQUE(username) trần (không loại trừ hàng đã xoá mềm) → tầng
// ứng dụng kiểm trùng có loại trừ nên cho qua, rồi vỡ ở CSDL: 500 "Lỗi máy chủ", không ai đoán ra.
const P = '__test_reuse';
const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Tên đăng nhập dùng lại được sau khi xoá tài khoản (BL-73)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const ten = P + '_nv';
    try {
      const admin = await t.login('admin', process.env.ADMIN_P);

      const con = await t.db.query(
        `SELECT 1 FROM pg_constraint WHERE conrelid='users'::regclass AND conname='users_username_key'`);
      t.eq('TC-R0 · ràng buộc UNIQUE trần users_username_key đã được gỡ', con.rowCount, 0,
        'vẫn còn — migration 0002 chưa chạy?');

      const tao1 = await t.api('POST', '/api/admin/users', admin,
        { username: ten, password: pw, role: 'staff', full_name: 'NV cũ' });
      t.ok('TC-R1 · tạo tài khoản lần đầu', tao1.status === 200 || tao1.status === 201,
        `HTTP ${tao1.status} ${JSON.stringify(tao1.json)}`);
      const uid = (await t.db.query('SELECT id FROM users WHERE username=$1', [ten])).rows[0].id;

      const xoa = await t.api('DELETE', `/api/admin/users/${uid}`, admin);
      t.eq('TC-R2 · xoá (khoá mềm) tài khoản → 200', xoa.status, 200, `HTTP ${xoa.status}`);

      const tao2 = await t.api('POST', '/api/admin/users', admin,
        { username: ten, password: pw, role: 'staff', full_name: 'NV mới' });
      t.ok('TC-R3 · người mới dùng LẠI tên đó → tạo được (trước đây 500 "Lỗi máy chủ")',
        tao2.status === 200 || tao2.status === 201,
        `HTTP ${tao2.status} ${JSON.stringify(tao2.json)}`);

      const dem = (await t.db.query(
        'SELECT count(*)::int c FROM users WHERE username=$1 AND deleted_at IS NULL', [ten])).rows[0].c;
      t.eq('TC-R4 · chỉ MỘT tài khoản đang hoạt động mang tên đó', dem, 1, `đang có ${dem}`);

      const vao = await t.api('POST', '/api/auth/login', null, { username: ten, password: pw });
      t.eq('TC-R5 · người mới đăng nhập được bằng tên đó', vao.status, 200, `HTTP ${vao.status}`);

      // Tên đã cấp lại thì mở khoá bản cũ phải báo rõ, không được vỡ 500 vì đụng ràng buộc.
      const mo = await t.api('POST', `/api/admin/users/${uid}/unlock`, admin);
      t.eq('TC-R6 · mở khoá bản cũ khi tên đã có người dùng → 400 (báo rõ), không phải 500',
        mo.status, 400, `HTTP ${mo.status} ${JSON.stringify(mo.json)}`);
      t.ok('TC-R6a · … câu trả lời chỉ đúng đường xử lý',
        /đã có người khác dùng/i.test((mo.json && mo.json.error) || ''), JSON.stringify(mo.json));

      // Tạo tài khoản cho HỒ SƠ HỌC VIÊN đi đường khác — phải cùng quy tắc, không được 500.
      const sid = (await t.db.query(
        `INSERT INTO students (name, check_in_date) VALUES ($1, CURRENT_DATE) RETURNING id`, [P + '_hv'])).rows[0].id;
      const tenHv = P + '_hv1';
      const hv1 = await t.api('POST', `/api/students/${sid}/account`, admin, { username: tenHv, password: pw });
      t.eq('TC-R7 · tạo tài khoản học viên lần đầu', hv1.status, 200, `HTTP ${hv1.status} ${JSON.stringify(hv1.json)}`);
      const hvUid = (await t.db.query('SELECT id FROM users WHERE username=$1', [tenHv])).rows[0].id;
      await t.db.query('UPDATE users SET deleted_at=now() WHERE id=$1', [hvUid]);
      const sid2 = (await t.db.query(
        `INSERT INTO students (name, check_in_date) VALUES ($1, CURRENT_DATE) RETURNING id`, [P + '_hv2'])).rows[0].id;
      const hv2 = await t.api('POST', `/api/students/${sid2}/account`, admin, { username: tenHv, password: pw });
      t.eq('TC-R8 · học viên khác dùng lại tên đó → 200 (cùng quy tắc với đường nhân viên)',
        hv2.status, 200, `HTTP ${hv2.status} ${JSON.stringify(hv2.json)}`);
    } finally {
      await clean(t.db);
    }
  },
};
