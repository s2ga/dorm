// BL-09 — sửa tên học viên phải ĐỒNG BỘ sang users.full_name (tài khoản đăng nhập). Nếu không, cổng
// HV vẫn chào bằng tên cũ (/me đọc users.full_name) và sai VĨNH VIỄN trong CSDL — đăng xuất/vào lại
// không cứu được.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_bl09';

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'BL-09 · sửa tên HV đồng bộ sang users.full_name',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const sid = (await t.db.query(
      `INSERT INTO students (name, check_in_date) VALUES ($1, CURRENT_DATE) RETURNING id`, [P + '_ten_cu'])).rows[0].id;
    await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name,student_id) VALUES ($1,$2,'student',$3,$4)`,
      [P + '_hv', bcrypt.hashSync('test1234', 10), P + '_ten_cu', sid]);

    try {
      const admin = await t.login('admin', process.env.ADMIN_P);
      const r = await t.api('PUT', `/api/students/${sid}`, admin, { name: P + '_ten_moi' });
      t.eq('TC-09.1 · PUT đổi tên HV → 200', r.status, 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);

      const fn = (await t.db.query(`SELECT full_name FROM users WHERE student_id=$1`, [sid])).rows[0].full_name;
      t.eq('TC-09.2 · users.full_name ĐỒNG BỘ tên mới (không lệch vĩnh viễn)', fn, P + '_ten_moi', `users.full_name = ${fn}`);

      // /me của chính HV cũng trả tên mới (vì /me đọc users.full_name) → cổng HV chào đúng tên
      const hv = await t.login(P + '_hv', 'test1234');
      const me = await t.api('GET', '/api/auth/me', hv);
      t.eq('TC-09.3 · /me trả tên mới (cổng HV chào đúng tên)', me.json && me.json.full_name, P + '_ten_moi',
        JSON.stringify(me.json && me.json.full_name));
    } finally {
      await clean(t.db);
    }
  },
};
