// Khoá tài khoản thay vì xoá: DELETE /admin/users/:id chặn đăng nhập + đá phiên, giữ dữ liệu và
// username; POST /unlock cho vào lại. Đăng nhập khi đang khoá phải là 403 "đã bị khoá" — không phải
// 401 (sai mật khẩu) và không phải màn "chờ duyệt". Sai mật khẩu vẫn 401 chung, không thì thành máy dò.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_lock';
const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Khoá / mở khoá tài khoản (không xoá thật)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const uid = (await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name) VALUES ($1,$2,'staff','NV bị khoá') RETURNING id`,
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
      t.eq('TC-L5 · đã khoá + mật khẩu ĐÚNG → 403 (cửa đóng), không phải 401 "sai mật khẩu"',
        sau.status, 403, `HTTP ${sau.status} — ${sau.json && sau.json.error}`);
      // KHÔNG khoá theo câu chữ (câu này còn được sửa lời) — khoá theo NGHĨA: không được nói "chờ duyệt"
      // (trạng thái khác hẳn), không được gợi là gõ sai mật khẩu, và phải chỉ đường liên hệ.
      const cauKhoa = (sau.json && sau.json.error) || '';
      t.ok('TC-L5a · … câu trả lời KHÔNG nói "chờ duyệt", KHÔNG nói "sai mật khẩu", có chỉ đường liên hệ',
        !!cauKhoa && !/chờ duyệt/i.test(cauKhoa) && !/sai/i.test(cauKhoa) && /liên hệ/i.test(cauKhoa),
        JSON.stringify(sau.json));
      const saiMk = await t.api('POST', '/api/auth/login', null, { username: P + '_nv', password: 'sai-be-bet' });
      t.eq('TC-L5b · đã khoá + mật khẩu SAI → vẫn 401 chung (403 không được thành máy dò tài khoản)',
        saiMk.status, 401, `HTTP ${saiMk.status} — ${saiMk.json && saiMk.json.error}`);

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

      // ===== HỌC VIÊN bị KHOÁ hồ sơ (students.deleted_at) — trang Học viên gọi đúng là "Đã khoá"
      const sid = (await t.db.query(
        `INSERT INTO students (name, check_in_date) VALUES ($1, CURRENT_DATE) RETURNING id`, [P + '_hv'])).rows[0].id;
      await t.db.query(
        `INSERT INTO users (username,password_hash,role,full_name,student_id) VALUES ($1,$2,'student',$3,$4)`,
        [P + '_hv', bcrypt.hashSync(pw, 10), P + '_hv', sid]);
      const hvTruoc = await t.api('POST', '/api/auth/login', null, { username: P + '_hv', password: pw });
      t.eq('TC-L14 · học viên bình thường: đăng nhập được', hvTruoc.status, 200, `HTTP ${hvTruoc.status}`);
      await t.db.query(`UPDATE students SET deleted_at=now() WHERE id=$1`, [sid]);
      const hvSau = await t.api('POST', '/api/auth/login', null, { username: P + '_hv', password: pw });
      t.eq('TC-L15 · hồ sơ học viên bị KHOÁ → 403 (cùng nghĩa với khoá tài khoản, không phải 401)',
        hvSau.status, 403, `HTTP ${hvSau.status} — ${hvSau.json && hvSau.json.error}`);
      t.eq('TC-L16 · … CÙNG một câu với khoá tài khoản (hai kiểu khoá, một cách nói)',
        (hvSau.json && hvSau.json.error) || '', cauKhoa, JSON.stringify(hvSau.json));
      await t.db.query(`UPDATE students SET deleted_at=NULL WHERE id=$1`, [sid]);
      const hvMo = await t.api('POST', '/api/auth/login', null, { username: P + '_hv', password: pw });
      t.eq('TC-L17 · mở khoá hồ sơ → học viên đăng nhập lại được', hvMo.status, 200, `HTTP ${hvMo.status}`);

      // ===== DI SẢN lỗi cũ: vai THẬT nhưng approved=false (đăng nhập Microsoft lại sau khi bị khoá
      // từng tự hạ cờ này). Người ta kẹt ở màn "chờ duyệt" mà admin bấm duyệt cũng không lên.
      await t.db.query(`UPDATE users SET approved=false WHERE id=$1`, [uid]);
      const kep = await t.api('POST', '/api/auth/login', null, { username: P + '_nv', password: pw });
      t.eq('TC-L18 · vai thật + approved=false → 403 "chờ duyệt" (bằng chứng có thật cái kẹt này)', kep.status, 403, `HTTP ${kep.status}`);
      const duyet = await t.api('PUT', `/api/admin/users/${uid}`, admin, { role: 'staff', full_name: 'NV bị khoá' });
      t.eq('TC-L19 · admin gán lại vai → 200', duyet.status, 200, `HTTP ${duyet.status} ${JSON.stringify(duyet.json)}`);
      const apr = (await t.db.query('SELECT approved FROM users WHERE id=$1', [uid])).rows[0].approved;
      t.ok('TC-L20 · … gán vai THẬT là DUYỆT: approved bật lại (trước đây chỉ bật khi vai cũ là "pending" → kẹt vĩnh viễn)',
        apr === true, `approved=${apr}`);
      const vao = await t.api('POST', '/api/auth/login', null, { username: P + '_nv', password: pw });
      t.eq('TC-L21 · … và vào được', vao.status, 200, `HTTP ${vao.status} — ${vao.json && vao.json.error}`);

      // Mở khoá cũng phải trả lại approved cho vai thật, không thì mở khoá xong vẫn kẹt "chờ duyệt"
      await t.db.query(`UPDATE users SET deleted_at=now(), approved=false WHERE id=$1`, [uid]);
      await t.api('POST', `/api/admin/users/${uid}/unlock`, admin);
      const apr2 = (await t.db.query('SELECT approved, deleted_at FROM users WHERE id=$1', [uid])).rows[0];
      t.ok('TC-L22 · mở khoá tài khoản vai thật → approved=true (mở khoá là trả lại nguyên trạng)',
        apr2.approved === true && apr2.deleted_at === null, JSON.stringify(apr2));
    } finally {
      await clean(t.db);
    }
  },
};
