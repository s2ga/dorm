// KHOÁ tài khoản thay vì XOÁ: DELETE /admin/users/:id chỉ chặn đăng nhập + đá phiên, GIỮ dữ liệu và
// GIỮ NGUYÊN username; POST /admin/users/:id/unlock cho đăng nhập lại. Đây là hành vi xác thực nên
// phải khoá bằng test: khoá xong KHÔNG vào được, mở khoá xong VÀO ĐƯỢC, và tài khoản đã khoá vẫn
// hiện trong danh sách (cờ locked) để admin còn đường mở lại.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_lock';
const clean = db => db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);

module.exports = {
  name: 'Khoá / mở khoá tài khoản (không xoá thật)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const uid = (await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name) VALUES ($1,$2,'staff','NV bi khoa') RETURNING id`,
      [P + '_nv', bcrypt.hashSync(pw, 10)])).rows[0].id;

    try {
      const admin = await t.login('admin', process.env.ADMIN_P);

      // Trước khi khoá: đăng nhập được
      const tr = await t.api('POST', '/api/auth/login', null, { username: P + '_nv', password: pw });
      t.eq('TC-L1 · trước khi khoá: đăng nhập được', tr.status, 200, `HTTP ${tr.status}`);

      // KHOÁ
      const del = await t.api('DELETE', `/api/admin/users/${uid}`, admin);
      t.eq('TC-L2 · khoá tài khoản → 200', del.status, 200, `HTTP ${del.status} ${JSON.stringify(del.json)}`);

      const row = (await t.db.query('SELECT username, deleted_at FROM users WHERE id=$1', [uid])).rows[0];
      t.ok('TC-L3 · KHÔNG xoá thật — bản ghi vẫn còn (deleted_at được đặt)', !!row && row.deleted_at !== null,
        JSON.stringify(row));
      t.eq('TC-L4 · GIỮ NGUYÊN username (không còn đổi thành "#da-xoa-") → mở khoá được', row.username, P + '_nv', row.username);

      const sau = await t.api('POST', '/api/auth/login', null, { username: P + '_nv', password: pw });
      t.ok('TC-L5 · đã khoá → KHÔNG đăng nhập được', sau.status === 401, `HTTP ${sau.status} (phải 401)`);

      // Vẫn thấy trong danh sách + có cờ locked (nếu không, admin mất dấu, hết đường mở khoá)
      const ds = await t.api('GET', '/api/admin/users', admin);
      const me = (ds.json || []).find(x => x.id === uid);
      t.ok('TC-L6 · tài khoản đã khoá VẪN hiện ở /admin/users', !!me, 'biến mất khỏi danh sách');
      t.ok('TC-L7 · … kèm cờ locked=true', !!(me && me.locked === true), JSON.stringify(me && { u: me.username, locked: me.locked }));

      // MỞ KHOÁ
      const un = await t.api('POST', `/api/admin/users/${uid}/unlock`, admin);
      t.eq('TC-L8 · mở khoá → 200', un.status, 200, `HTTP ${un.status} ${JSON.stringify(un.json)}`);
      const lai = await t.api('POST', '/api/auth/login', null, { username: P + '_nv', password: pw });
      t.eq('TC-L9 · mở khoá xong → đăng nhập lại được', lai.status, 200, `HTTP ${lai.status}`);

      // Mở khoá tài khoản đang hoạt động -> báo lỗi rõ, không âm thầm
      const lan2 = await t.api('POST', `/api/admin/users/${uid}/unlock`, admin);
      t.eq('TC-L10 · mở khoá tài khoản đang hoạt động → 400 (báo rõ)', lan2.status, 400, `HTTP ${lan2.status}`);

      // Di sản bản cũ: username đã bị đổi thành 'ten#da-xoa-<id>' -> mở khoá phải CẮT hậu tố
      await t.db.query(`UPDATE users SET deleted_at=now(), username=$2 WHERE id=$1`, [uid, P + '_nv#da-xoa-' + uid]);
      const cu = await t.api('POST', `/api/admin/users/${uid}/unlock`, admin);
      t.eq('TC-L11 · bản ghi cũ (#da-xoa-) mở khoá → 200', cu.status, 200, `HTTP ${cu.status} ${JSON.stringify(cu.json)}`);
      const ten = (await t.db.query('SELECT username FROM users WHERE id=$1', [uid])).rows[0].username;
      t.eq('TC-L12 · … trả lại ĐÚNG tên gốc (cắt hậu tố)', ten, P + '_nv', ten);
      const lai2 = await t.api('POST', '/api/auth/login', null, { username: P + '_nv', password: pw });
      t.eq('TC-L13 · … và đăng nhập lại được bằng tên gốc', lai2.status, 200, `HTTP ${lai2.status}`);
    } finally {
      await clean(t.db);
    }
  },
};
