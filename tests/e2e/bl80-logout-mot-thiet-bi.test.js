// BL-80: Logout thu hồi vé ở cấp TÀI KHOẢN (token_epoch += 1) nên bấm Thoát trên điện thoại là
// máy văn phòng cũng bị đá ra, không lời giải thích. Vé sống 30 ngày nên nhiều thiết bị cùng đăng
// nhập là chuyện bình thường. Thoát thường phải chỉ thoát máy đang dùng; đá tất cả là nút RIÊNG.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_bl80';
const clean = db => db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);

module.exports = {
  name: 'BL-80 · thoát một thiết bị không được đá mọi thiết bị',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const ten = P + '_nv';
    await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name) VALUES ($1,$2,'staff','NV hai máy')`,
      [ten, bcrypt.hashSync(pw, 10)]);
    try {
      const mayVanPhong = await t.login(ten, pw);
      const dienThoai = await t.login(ten, pw);

      t.eq('TC-80a · hai thiết bị cùng đăng nhập được', (await t.api('GET', '/api/auth/me', mayVanPhong)).status, 200);

      const thoat = await t.api('POST', '/api/auth/logout', dienThoai);
      t.eq('TC-80b · thoát trên điện thoại → 200', thoat.status, 200, `HTTP ${thoat.status}`);

      const vp = await t.api('GET', '/api/auth/me', mayVanPhong);
      t.eq('TC-80c · MÁY VĂN PHÒNG VẪN ĐĂNG NHẬP (trước đây bị đá ra cùng lúc)', vp.status, 200,
        `HTTP ${vp.status} — ${vp.json && vp.json.error}`);

      // all=false cũng phải là thoát-máy-này, không được hiểu nhầm thành thu hồi tất cả.
      const dt2 = await t.login(ten, pw);
      await t.api('POST', '/api/auth/logout', dt2, { all: false });
      t.eq('TC-80d · all=false → máy văn phòng vẫn sống',
        (await t.api('GET', '/api/auth/me', mayVanPhong)).status, 200);

      // Nút RIÊNG "Thoát khỏi mọi thiết bị" phải giết sạch — đây là cái dùng khi nghi lộ mật khẩu.
      const dt3 = await t.login(ten, pw);
      const tatCa = await t.api('POST', '/api/auth/logout', dt3, { all: true });
      t.eq('TC-80e · thoát mọi thiết bị → 200', tatCa.status, 200, `HTTP ${tatCa.status}`);
      const vp2 = await t.api('GET', '/api/auth/me', mayVanPhong);
      t.eq('TC-80f · … lúc này máy văn phòng MỚI bị đá ra (401)', vp2.status, 401,
        `HTTP ${vp2.status} — ${vp2.json && vp2.json.error}`);

      // Đổi mật khẩu vẫn phải giết sạch vé cũ — không được nới theo BL-80.
      const t1 = await t.login(ten, pw);
      const t2 = await t.login(ten, pw);
      const doi = await t.api('POST', '/api/auth/change-password', t1, { newPassword: 'test5678' });
      t.eq('TC-80g · đổi mật khẩu → 200', doi.status, 200, `HTTP ${doi.status} ${JSON.stringify(doi.json)}`);
      t.eq('TC-80h · … vé của thiết bị KHÁC chết theo (giữ nguyên, không nới)',
        (await t.api('GET', '/api/auth/me', t2)).status, 401);
    } finally {
      await clean(t.db);
    }
  },
};
