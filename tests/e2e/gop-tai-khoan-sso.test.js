// Học viên đã có tài khoản mật khẩu, sau đó đăng nhập Microsoft -> sinh một bản CHỜ DUYỆT riêng.
// Duyệt bản đó vào đúng hồ sơ cũ phải GỘP hai lối đăng nhập vào MỘT tài khoản,
// chứ không chặn cứng "mỗi hồ sơ chỉ một tài khoản" rồi bỏ mặc admin.
const P = '__test_gop';

async function clean(db) {
  await db.query(`DELETE FROM users    WHERE username LIKE '${P}%' OR email LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'`);
}

module.exports = {
  name: 'Gộp tài khoản SSO vào tài khoản mật khẩu sẵn có',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);

    const sid = (await t.db.query(
      `INSERT INTO students (name, code, gender) VALUES ($1,$2,'male') RETURNING id`, [P + ' An', P + '_MA'])).rows[0].id;
    // Tài khoản mật khẩu có sẵn của hồ sơ (admin cấp lúc check-in).
    const cu = (await t.db.query(
      `INSERT INTO users (username, password_hash, role, full_name, student_id, auth_provider, approved)
       VALUES ($1,'x','student',$2,$3,'local',true) RETURNING id`, [P + '_local', P + ' An', sid])).rows[0].id;
    // Bản chờ duyệt do đăng nhập Microsoft lần đầu sinh ra.
    const cho = (await t.db.query(
      `INSERT INTO users (username, password_hash, role, full_name, email, sso_subject, auth_provider, approved)
       VALUES ($1,NULL,'pending',$2,$3,$4,'sso',false) RETURNING id`,
      [P + '_sso', P + ' An', P + '@kaizen.edu.vn', P + '_subject'])).rows[0].id;

    // ── Chưa đồng ý gộp -> 409 hỏi lại, KHÔNG đụng dữ liệu ────────────────────────────
    const hoi = await t.api('POST', `/api/admin/users/${cho}/approve-student`, T, { student_id: sid });
    t.eq('Hồ sơ đã có tài khoản → 409 hỏi gộp, không phải 400 bế tắc', hoi.status, 409, `HTTP ${hoi.status}`);
    t.ok('Trả cờ needs_merge để giao diện biết mà hỏi', !!(hoi.json && hoi.json.needs_merge), JSON.stringify(hoi.json));
    t.ok('Trả kèm tài khoản sẽ gộp vào', !!(hoi.json.account && hoi.json.account.username === P + '_local'),
      JSON.stringify(hoi.json.account));
    const chuaDoi = (await t.db.query('SELECT sso_subject, deleted_at FROM users WHERE id=$1', [cho])).rows[0];
    t.eq('Hỏi mà chưa đồng ý thì KHÔNG đụng bản chờ', chuaDoi.deleted_at, null);
    t.ok('sso_subject của bản chờ còn nguyên', !!chuaDoi.sso_subject, String(chuaDoi.sso_subject));

    // ── Đồng ý gộp ───────────────────────────────────────────────────────────────────
    const gop = await t.api('POST', `/api/admin/users/${cho}/approve-student`, T, { student_id: sid, merge: true });
    t.eq('Đồng ý gộp → 200', gop.status, 200, `HTTP ${gop.status} ${gop.json && gop.json.error || ''}`);
    t.eq('Trả về id tài khoản đã gộp vào', gop.json.merged_into, cu);

    const sau = (await t.db.query('SELECT sso_subject, auth_provider, email, approved FROM users WHERE id=$1', [cu])).rows[0];
    t.eq('Danh tính Microsoft chuyển sang tài khoản cũ', sau.sso_subject, P + '_subject');
    t.eq('Còn mật khẩu nên dùng được CẢ HAI cách đăng nhập', sau.auth_provider, 'both');
    t.eq('Email lấy theo tài khoản Microsoft', sau.email, P + '@kaizen.edu.vn');
    t.eq('Tài khoản gộp xong là đã duyệt', sau.approved, true);

    const ban = (await t.db.query('SELECT sso_subject, deleted_at FROM users WHERE id=$1', [cho])).rows[0];
    t.ok('Bản chờ bị gỡ', !!ban.deleted_at, String(ban.deleted_at));
    t.eq('Bản chờ phải NHẢ sso_subject — ux_users_sso_subject không loại trừ dòng đã xoá', ban.sso_subject, null);

    const dem = (await t.db.query(
      'SELECT COUNT(*)::int c FROM users WHERE student_id=$1 AND deleted_at IS NULL', [sid])).rows[0].c;
    t.eq('Hồ sơ vẫn chỉ MỘT tài khoản còn sống — khoá nó là chặn cả hai lối vào', dem, 1);

    // ── Không gộp vào tài khoản đang bị khoá ─────────────────────────────────────────
    await t.db.query('UPDATE users SET deleted_at=now() WHERE id=$1', [cu]);
    const cho2 = (await t.db.query(
      `INSERT INTO users (username, password_hash, role, full_name, email, sso_subject, auth_provider, approved)
       VALUES ($1,NULL,'pending',$2,$3,$4,'sso',false) RETURNING id`,
      [P + '_sso2', P + ' An', P + '2@kaizen.edu.vn', P + '_subject2'])).rows[0].id;
    const khoa = await t.api('POST', `/api/admin/users/${cho2}/approve-student`, T, { student_id: sid, merge: true });
    t.eq('Tài khoản đích đang bị khoá → chặn, không gộp lén vào', khoa.status, 400, `HTTP ${khoa.status}`);
    t.ok('Báo rõ phải mở khoá trước', /KHOÁ/i.test((khoa.json && khoa.json.error) || ''), (khoa.json || {}).error);
  },
};
