// SSO tài khoản CHỜ DUYỆT: sau khi đăng nhập Microsoft, người dùng phải được CẤP VÉ để giao diện gọi
// /me và hiện màn "chờ duyệt" — KHÔNG còn trả 401 {"error":"Chưa đăng nhập"}. pendingAllow cho pending
// gọi /me + /logout, mọi endpoint khác 403. Và admin phải ĐẾM được số chờ duyệt để hiện thông báo.
const bcrypt = require('../../node_modules/bcryptjs');
const { BASE } = require('../lib/harness');
const P = '__test_pending';
const clean = db => db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);

module.exports = {
  name: 'SSO chờ duyệt — pending có vé thì /me chạy + admin đếm được (thông báo duyệt)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const admin = await t.login('admin', process.env.ADMIN_P);
    const before = (await t.api('GET', '/api/admin/pending-count', admin)).json.pending;

    // Tạo user (tạm approved để LẤY VÉ qua /login), rồi hạ xuống pending — mô phỏng đúng trạng thái
    // sau SSOCallback: tài khoản role='pending', approved=false NHƯNG ĐÃ có vé trong cookie.
    const uid = (await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name,email,auth_provider,approved)
       VALUES ($1,$2,'staff','SSO cho duyet',$3,'sso',true) RETURNING id`,
      [P + '_a', bcrypt.hashSync('test1234', 10), P + '_a@esuhai.com'])).rows[0].id;

    try {
      const tok = await t.login(P + '_a', 'test1234');              // lấy vé khi còn approved
      await t.db.query(`UPDATE users SET role='pending', approved=false WHERE id=$1`, [uid]); // -> chờ duyệt

      const me = await t.api('GET', '/api/auth/me', tok);
      t.eq('pending CÓ VÉ: /me chạy 200 (không còn 401 "Chưa đăng nhập")', me.status, 200, `HTTP ${me.status} ${JSON.stringify(me.json)}`);
      t.ok('… /me báo approved=false để giao diện hiện màn "chờ duyệt"', me.json && me.json.approved === false, JSON.stringify(me.json));

      const stu = await t.api('GET', '/api/students', tok);
      t.eq('… pending vẫn bị chặn 403 ở endpoint khác (an toàn)', stu.status, 403, `HTTP ${stu.status}`);

      const after = (await t.api('GET', '/api/admin/pending-count', admin)).json.pending;
      t.eq('admin /pending-count đếm được tài khoản chờ duyệt (+1)', after, before + 1, `${before} → ${after}`);

      const noauth = await t.api('GET', '/api/admin/pending-count');
      t.eq('… /pending-count phải yêu cầu đăng nhập (khách → 401)', noauth.status, 401, `HTTP ${noauth.status}`);
    } finally {
      await clean(t.db);
    }
  },
};
