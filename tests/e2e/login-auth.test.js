// Đăng nhập một cổng (bỏ khái niệm "cổng"): loại tài khoản là thuộc tính của user trong CSDL.
// Đo 3 nhóm: (1) một form cho mọi người, tham số `portal` cũ bị bỏ qua · (2) tài khoản SSO thuần /
// chờ duyệt không lọt qua form mật khẩu · (3) BL-08: đặt lại mật khẩu học viên đủ 2 chốt như nhân viên.
const bcrypt = require('../../node_modules/bcryptjs');
const { BASE } = require('../lib/harness');
const P = '__test_auth';

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

// Gọi thẳng /login để đọc được set-cookie — t.login() của harness chỉ trả token.
const dangNhap = (username, password, extra) =>
  fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, ...(extra || {}) }),
  }).then(async r => ({
    status: r.status,
    cookie: /ktx_token=/.test(r.headers.get('set-cookie') || ''),
    json: await r.json().catch(() => null),
  }));

module.exports = {
  name: 'Đăng nhập gộp một cổng · SSO · BL-08 (đặt lại MK học viên)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const hash = bcrypt.hashSync(pw, 10);
    await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name,must_change_password)
       VALUES ($1,$3,'staff','Test NV',false), ($2,$3,'student','Test HV',false)`,
      [P + '_nv', P + '_hv', hash]);
    // Tài khoản SSO THUẦN: không có mật khẩu
    await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name,email,sso_subject,auth_provider,approved)
       VALUES ($1,NULL,'staff','Test SSO',$2,$3,'sso',true)`,
      [P + '_sso', P + '_sso@esuhai.com', P + '_subject']);
    // Tài khoản do SSO tự tạo, CHỜ DUYỆT (có mật khẩu để chứng minh: chặn là do approved, không phải do thiếu MK)
    await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name,approved)
       VALUES ($1,$2,'pending','Test chờ duyệt',false)`,
      [P + '_pending', hash]);

    try {
      // ===== (1) MỘT CỔNG DUY NHẤT =====
      const nv = await dangNhap(P + '_nv', pw);
      t.eq('TC-A1 · nhân viên đăng nhập (không khai cổng) → 200', nv.status, 200, `HTTP ${nv.status}`);
      t.ok('TC-A1b · … và được cấp vé', nv.cookie === true, nv.cookie ? 'có set-cookie' : 'KHÔNG cấp vé!');
      // /login chỉ xác thực + đặt cookie; thông tin user lấy qua /me (MỘT nguồn duy nhất) — yêu cầu 21/07.
      t.ok('TC-A1c · /login KHÔNG trả object user (client lấy qua /auth/me)',
        nv.json && !('user' in nv.json), `body = ${JSON.stringify(nv.json)}`);

      const hv = await dangNhap(P + '_hv', pw);
      t.eq('TC-A2 · học viên đăng nhập CÙNG form đó → 200 (không còn "nhầm cổng")', hv.status, 200, `HTTP ${hv.status}`);

      // Client cũ còn cache vẫn gửi kèm portal — phải BỎ QUA, tuyệt đối không 403 trở lại
      const cu = await dangNhap(P + '_nv', pw, { portal: 'student' });
      t.eq('TC-A3 · client cũ gửi portal="student" cho tài khoản NV → BỎ QUA, vẫn 200', cu.status, 200,
        `HTTP ${cu.status}${cu.status === 403 ? ' — vẫn còn chốt cổng, chưa gỡ hết' : ''}`);

      for (const rac of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        const r = await dangNhap(P + '_hv', pw, { portal: rac });
        t.ok(`TC-A4 · portal rác "${rac}" → không được 5xx`, r.status < 500, `HTTP ${r.status}`);
      }

      // ===== (2) SSO THUẦN / CHỜ DUYỆT KHÔNG LỌT FORM MẬT KHẨU =====
      const sso = await dangNhap(P + '_sso', pw);
      t.eq('TC-A5 · tài khoản SSO thuần (không có mật khẩu) → 401', sso.status, 401, `HTTP ${sso.status}`);
      t.ok('TC-A5b · … và KHÔNG cấp vé', sso.cookie === false, sso.cookie ? 'CÓ set-cookie — thủng!' : 'không có (đúng)');
      t.eq('TC-A5c · … câu lỗi phải CHUNG CHUNG, không tiết lộ tài khoản này dùng SSO',
        sso.json && sso.json.error, 'Sai tên đăng nhập hoặc mật khẩu', sso.json && sso.json.error);

      const pend = await dangNhap(P + '_pending', pw);
      t.eq('TC-A6 · tài khoản chờ admin duyệt → 403 dù mật khẩu ĐÚNG', pend.status, 403, `HTTP ${pend.status}`);
      t.ok('TC-A6b · … và KHÔNG cấp vé', pend.cookie === false, pend.cookie ? 'CÓ set-cookie — thủng!' : 'không có (đúng)');

      // ===== (3) SSO config công khai, không lộ bí mật =====
      const cfg = await t.api('GET', '/api/auth/sso/config');
      t.eq('TC-A7 · /auth/sso/config trả 200 cho khách chưa đăng nhập', cfg.status, 200, `HTTP ${cfg.status}`);
      t.ok('TC-A7b · … chỉ trả cờ enabled, KHÔNG kèm client_id/secret',
        cfg.json && typeof cfg.json.enabled === 'boolean' && !('clientSecret' in cfg.json) && !('clientId' in cfg.json),
        JSON.stringify(cfg.json));

      // Bí mật SSO không được lọt ra qua màn Cài đặt
      const admToken = await t.login('admin', process.env.ADMIN_P);
      const st = await t.api('GET', '/api/settings', admToken);
      t.ok('TC-A8 · GET /settings KHÔNG trả sso_client_secret (chỉ cờ _set)',
        st.json && !('sso_client_secret' in st.json) && ('sso_client_secret_set' in st.json),
        `có secret=${st.json && 'sso_client_secret' in st.json} · có cờ=${st.json && 'sso_client_secret_set' in st.json}`);

      // ===== (4) BL-08 — đặt lại mật khẩu HỌC VIÊN phải đủ 2 chốt như nhân viên =====
      const stu = (await t.db.query(
        `INSERT INTO students (name, check_in_date) VALUES ($1, CURRENT_DATE) RETURNING id`, [P + '_hv_profile'])).rows[0];
      const uid = (await t.db.query(
        `INSERT INTO users (username,password_hash,role,full_name,student_id,must_change_password)
         VALUES ($1,$2,'student','HV BL08',$3,false) RETURNING id`,
        [P + '_bl08', hash, stu.id])).rows[0].id;
      const epochTruoc = (await t.db.query('SELECT token_epoch FROM users WHERE id=$1', [uid])).rows[0].token_epoch;

      const r8 = await t.api('POST', `/api/students/${stu.id}/account`, admToken, { password: 'newpass123' });
      t.eq('TC-A9 · admin đặt lại mật khẩu học viên → 200', r8.status, 200, `HTTP ${r8.status} ${JSON.stringify(r8.json)}`);

      const sau = (await t.db.query('SELECT must_change_password, token_epoch FROM users WHERE id=$1', [uid])).rows[0];
      t.eq('TC-A9b · BL-08 chốt 1: buộc đổi mật khẩu ở lần đăng nhập kế', sau.must_change_password, true,
        `must_change_password=${sau.must_change_password}`);
      t.ok('TC-A9c · BL-08 chốt 2: THU HỒI vé cũ (token_epoch tăng) — không thì kẻ xem trộm dùng tiếp tới 30 ngày',
        sau.token_epoch > epochTruoc, `token_epoch ${epochTruoc} → ${sau.token_epoch}`);

      // ===== (5) /auth/me trả đủ trường mới (BL-06 dùng để làm mới thông tin user) =====
      const me = await t.api('GET', '/api/auth/me', admToken);
      t.eq('TC-A10 · /auth/me trả 200', me.status, 200, `HTTP ${me.status}`);
      t.ok('TC-A10b · … kèm các trường mới (email, auth_provider, approved) cho giao diện',
        me.json && 'email' in me.json && 'auth_provider' in me.json && 'approved' in me.json,
        JSON.stringify(me.json));
    } finally {
      await clean(t.db);
    }
  },
};
