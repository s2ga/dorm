// QA-001: tài khoản học viên KHÔNG còn mật khẩu mặc định đoán được. Không gửi mật khẩu = máy tự sinh,
// trả về MỘT LẦN cho nhân viên. Owner chốt 17/09: giữ luật tối thiểu 6 ký tự khi có người tự đặt.
const P = '__test_mkkt';

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%' OR username IN (SELECT phone FROM students WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM applications WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Mật khẩu khởi tạo do máy sinh (không còn 123456)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const dangNhap = async (u, p) => (await t.api('POST', '/api/auth/login', null, { username: u, password: p })).status;
    const mk = new Set();
    try {
      // ── Duyệt đơn: không gửi mật khẩu → máy sinh, trả về một lần ───────────────────────
      const don = (await t.db.query(
        `INSERT INTO applications (name, phone, gender, status) VALUES ($1,$2,'male','pending') RETURNING id`,
        [P + ' An', P + '_sdt1'])).rows[0].id;
      const duyet = await t.api('POST', `/api/applications/${don}/approve`, T, { create_login: true, login_username: P + '_u1' });
      t.eq('Duyệt đơn không gửi mật khẩu → 200', duyet.status, 200, `HTTP ${duyet.status} ${duyet.json && duyet.json.error || ''}`);
      const acc = (duyet.json || {}).account || {};
      t.ok('Trả về tài khoản kèm mật khẩu để đưa học viên', !!acc.username && !!acc.password, JSON.stringify({ u: acc.username, dai: (acc.password || '').length }));
      t.ok('Mật khẩu KHÔNG phải 123456 và đủ dài', acc.password !== '123456' && (acc.password || '').length >= 10, `dài ${(acc.password || '').length}`);
      t.ok('Mật khẩu không chứa ký tự dễ đọc nhầm (0 O I l 1)', !/[0OIl1]/.test(acc.password || ''), String(acc.password || '').replace(/./g, '*'));
      mk.add(acc.password);
      t.eq('Mật khẩu 123456 KHÔNG đăng nhập được vào tài khoản vừa tạo', await dangNhap(acc.username, '123456'), 401);
      t.eq('Mật khẩu máy cấp thì đăng nhập được', await dangNhap(acc.username, acc.password), 200);
      const buoc = (await t.db.query('SELECT must_change_password FROM users WHERE lower(username)=lower($1)', [acc.username])).rows[0];
      t.eq('Tài khoản bị buộc đổi mật khẩu lần đầu', buoc.must_change_password, true);

      // ── Tạo hồ sơ kèm tài khoản ────────────────────────────────────────────────────────
      const hs = await t.api('POST', '/api/students', T, {
        name: P + ' Binh', gender: 'male', check_in_date: '2026-07-01', rental_type: 'ghep',
        code: P + '_ma2', create_login: true, login_username: P + '_u2',
      });
      t.eq('Tạo hồ sơ kèm tài khoản, không gửi mật khẩu → 201', hs.status, 201, `HTTP ${hs.status} ${hs.json && hs.json.error || ''}`);
      const acc2 = (hs.json || {}).account || {};
      t.ok('Hồ sơ mới trả mật khẩu máy sinh', !!acc2.password && acc2.password !== '123456', `dài ${(acc2.password || '').length}`);
      t.eq('Đăng nhập được bằng mật khẩu đó', await dangNhap(acc2.username, acc2.password), 200);
      mk.add(acc2.password);

      // ── Cấp lại mật khẩu cho tài khoản cũ ─────────────────────────────────────────────
      const sid = (await t.db.query('SELECT student_id FROM users WHERE lower(username)=lower($1)', [acc2.username])).rows[0].student_id;
      const capLai = await t.api('POST', `/api/students/${sid}/account`, T, {});
      t.eq('Cấp lại mật khẩu (không gửi gì) → 200', capLai.status, 200, `HTTP ${capLai.status} ${capLai.json && capLai.json.error || ''}`);
      t.ok('Trả mật khẩu mới để đưa học viên', !!capLai.json.password && capLai.json.password !== acc2.password, `dài ${(capLai.json.password || '').length}`);
      mk.add(capLai.json.password);
      t.eq('Mật khẩu CŨ hết dùng được', await dangNhap(acc2.username, acc2.password), 401);
      t.eq('Mật khẩu mới dùng được', await dangNhap(acc2.username, capLai.json.password), 200);
      t.eq('Mỗi lần cấp là một mật khẩu khác nhau', mk.size, 3, `${mk.size} mật khẩu khác nhau trên 3 lần cấp`);

      // ── Người dùng tự đặt mật khẩu thì luật cũ giữ nguyên ─────────────────────────────
      const ngan = await t.api('POST', `/api/students/${sid}/account`, T, { password: '12345' });
      t.eq('Tự đặt mật khẩu 5 ký tự → 400', ngan.status, 400, `HTTP ${ngan.status}`);
      const dat = await t.api('POST', `/api/students/${sid}/account`, T, { password: 'matkhau6' });
      t.eq('Tự đặt mật khẩu 8 ký tự → 200 (giữ luật tối thiểu 6 của owner)', dat.status, 200, `HTTP ${dat.status}`);
      t.ok('Không echo lại mật khẩu do người dùng tự gõ', !dat.json.password, JSON.stringify(dat.json));
      t.eq('Mật khẩu tự đặt dùng được', await dangNhap(acc2.username, 'matkhau6'), 200);

      // ── Kiểm dữ liệu liệt kê tài khoản còn mật khẩu khởi tạo ─────────────────────────
      const dh = await t.api('GET', '/api/admin/data-health', T);
      const muc = ((dh.json && dh.json.checks) || []).find(c => c.ma === 'hv_con_mat_khau_khoi_tao') || {};
      t.ok('Kiểm dữ liệu có mục "Tài khoản học viên còn mật khẩu khởi tạo"', !!muc.ma, JSON.stringify(Object.keys(muc)));
      t.ok('Tài khoản vừa cấp lại nằm trong danh sách', JSON.stringify(muc.rows || []).includes(acc2.username), String(muc.so_luong));
    } finally {
      await clean(t.db);
    }
  },
};
