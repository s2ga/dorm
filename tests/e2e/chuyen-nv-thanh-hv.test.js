// Lỡ duyệt học viên vào vai NHÂN VIÊN: form Sửa không có vai "Học viên" (cố ý — học viên phải GHÉP
// HỒ SƠ, gán vai suông là đăng nhập vào trống trơn). Đường sửa là approve-student: nhận cả tài khoản
// đã mang vai thật (không riêng pending), ghép/tạo hồ sơ, đổi vai, thu hồi vé cũ. Admin thì chặn.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_nvhv';
const PW = 'nv123456';

async function clean(db) {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%' OR code LIKE '${P}%'`);
}

module.exports = {
  name: 'Chuyển tài khoản lỡ gán vai nhân viên thành học viên (approve-student)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const hash = bcrypt.hashSync(PW, 10);
    const uid = (await t.db.query(
      `INSERT INTO users (username, password_hash, role, full_name, approved) VALUES ($1,$2,'staff',$3,true) RETURNING id`,
      [P + '_u1', hash, P + ' Bùi Xuân Tùng'])).rows[0].id;

    const veCu = await t.login(P + '_u1', PW);
    t.ok('Tài khoản nhân viên (lỡ tay) đăng nhập được', !!veCu);

    // ── Chuyển thành học viên, TẠO hồ sơ mới ─────────────────────────────────────────────
    const r = await t.api('POST', `/api/admin/users/${uid}/approve-student`, T, {
      new_student: { name: P + ' Bùi Xuân Tùng', code: P + '_MA1', gender: 'male' },
    });
    t.eq('Tài khoản vai staff (không phải pending) → vẫn chuyển được', r.status, 200, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
    const u = (await t.db.query(`SELECT role, student_id, approved FROM users WHERE id=$1`, [uid])).rows[0];
    t.eq('Vai đổi thành student', u.role, 'student');
    t.ok('Đã gắn hồ sơ học viên', !!u.student_id, JSON.stringify(u));
    const hs = (await t.db.query(`SELECT name, room_id, check_in_date FROM students WHERE id=$1`, [u.student_id])).rows[0];
    t.ok('Hồ sơ mới đúng tên, TRỐNG phòng + ngày vào (duyệt không phải check-in)',
      !!hs && !hs.room_id && !hs.check_in_date, JSON.stringify(hs));
    const cu = await t.api('GET', '/api/auth/me', veCu);
    t.eq('Vé đăng nhập cũ (vai nhân viên) bị thu hồi ngay', cu.status, 401, `HTTP ${cu.status}`);

    // ── Ghép vào hồ sơ CÓ SẴN ────────────────────────────────────────────────────────────
    const uid2 = (await t.db.query(
      `INSERT INTO users (username, password_hash, role, approved) VALUES ($1,$2,'staff',true) RETURNING id`,
      [P + '_u2', hash])).rows[0].id;
    const sid2 = (await t.db.query(
      `INSERT INTO students (name, code, gender) VALUES ($1,$2,'female') RETURNING id`,
      [P + ' Có Sẵn', P + '_MA2'])).rows[0].id;
    const r2 = await t.api('POST', `/api/admin/users/${uid2}/approve-student`, T, { student_id: sid2 });
    t.eq('Ghép hồ sơ có sẵn → 200', r2.status, 200, `HTTP ${r2.status} ${r2.json && r2.json.error || ''}`);
    const u2 = (await t.db.query(`SELECT role, student_id FROM users WHERE id=$1`, [uid2])).rows[0];
    t.ok('Vai student + đúng hồ sơ đã chọn', u2.role === 'student' && u2.student_id === sid2, JSON.stringify(u2));

    // ── Hồ sơ ĐÃ CÓ tài khoản, bản thừa KHÔNG có Microsoft: hỏi rồi KHOÁ bản thừa ────────
    const emailThua = P.toLowerCase() + '_u3@kaizen.edu.vn';
    const uid3 = (await t.db.query(
      `INSERT INTO users (username, password_hash, role, approved, email) VALUES ($1,$2,'staff',true,$3) RETURNING id`,
      [P + '_u3@kaizen.edu.vn', hash, emailThua])).rows[0].id;
    const sid3 = (await t.db.query(
      `INSERT INTO students (name, code, gender) VALUES ($1,$2,'male') RETURNING id`,
      [P + ' Ngọc Quân', P + '_MA3'])).rows[0].id;
    const acc3 = (await t.db.query(
      `INSERT INTO users (username, password_hash, role, student_id, approved) VALUES ($1,$2,'student',$3,true) RETURNING id`,
      [P + '_0899000001', hash, sid3])).rows[0].id;
    const veThua = await t.login(P + '_u3@kaizen.edu.vn', PW);

    const r3 = await t.api('POST', `/api/admin/users/${uid3}/approve-student`, T, { student_id: sid3 });
    t.ok('Bản thừa không SSO → 409 hỏi xác nhận (không còn chết cứng 400)',
      r3.status === 409 && r3.json && r3.json.needs_merge === true && r3.json.khong_sso === true,
      `HTTP ${r3.status} — ${r3.json && r3.json.error}`);
    const r3b = await t.api('POST', `/api/admin/users/${uid3}/approve-student`, T, { student_id: sid3, merge: true });
    t.ok('Xác nhận → 200, trỏ về tài khoản sẵn có', r3b.status === 200 && r3b.json && r3b.json.merged_into === acc3,
      `HTTP ${r3b.status} ${JSON.stringify(r3b.json)}`);
    const thua = (await t.db.query(`SELECT deleted_at, email FROM users WHERE id=$1`, [uid3])).rows[0];
    t.ok('Bản thừa bị KHOÁ và nhả email', thua.deleted_at !== null && thua.email === null, JSON.stringify(thua));
    const giu = (await t.db.query(`SELECT role, student_id, deleted_at FROM users WHERE id=$1`, [acc3])).rows[0];
    t.ok('Tài khoản sẵn có giữ nguyên', giu.role === 'student' && giu.student_id === sid3 && !giu.deleted_at, JSON.stringify(giu));
    t.eq('Email bản thừa ghi vào hồ sơ (đang trống) — lần sau đăng nhập Microsoft khớp thẳng',
      (await t.db.query(`SELECT email FROM students WHERE id=$1`, [sid3])).rows[0].email, emailThua);
    t.eq('Vé của bản thừa bị thu hồi ngay', (await t.api('GET', '/api/auth/me', veThua)).status, 401);

    // ── Rào chắn giữ nguyên ─────────────────────────────────────────────────────────────
    const meId = (await t.db.query(`SELECT id FROM users WHERE username='admin'`)).rows[0].id;
    const rAdm = await t.api('POST', `/api/admin/users/${meId}/approve-student`, T, { student_id: sid2 });
    t.ok('Admin không tự chuyển chính mình thành học viên', rAdm.status === 400, `HTTP ${rAdm.status} — ${rAdm.json && rAdm.json.error}`);

    await clean(t.db);
  },
};
