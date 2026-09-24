// Đổi vai tài khoản phải đi được CẢ HAI CHIỀU. Chiều xuôi (nhân viên -> học viên) có sẵn; chiều
// ngược trước đây KHÔNG có: vai 'student' nằm ngoài danh sách vai quản lý được nên PUT /admin/users/:id
// trả 404 và dòng biến mất khỏi /admin/users — chuyển nhầm một cái là phải sửa thẳng CSDL.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_doivai';

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Đổi vai tài khoản đi được cả hai chiều (học viên -> nhân viên)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const pw = 'test1234';
    const hang = async uid => (await t.db.query('SELECT role, student_id, facility_id, approved FROM users WHERE id=$1', [uid])).rows[0];
    // Tài khoản nhân viên + hồ sơ học viên rời, dựng thẳng bằng SQL để không phụ thuộc màn khác.
    const taoNV = async hau => (await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name) VALUES ($1,$2,'staff',$3) RETURNING id`,
      [P + hau, bcrypt.hashSync(pw, 10), P + ' Nhân Viên'])).rows[0].id;

    try {
      // ── Chiều xuôi: nhân viên -> học viên (ghép hồ sơ mới) ──────────────────────────
      const u1 = await taoNV('_a');
      const xuoi = await t.api('POST', `/api/admin/users/${u1}/approve-student`, T, {
        new_student: { name: P + ' Hồ Sơ Một', gender: 'male' },
      });
      t.eq('TC-1 · nhân viên -> học viên → 200', xuoi.status, 200, `HTTP ${xuoi.status} ${JSON.stringify(xuoi.json)}`);
      const sauXuoi = await hang(u1);
      t.ok('TC-2 · … CSDL: vai student + đã gắn hồ sơ', sauXuoi.role === 'student' && !!sauXuoi.student_id, JSON.stringify(sauXuoi));

      // ── Bằng chứng cửa một chiều: đường cũ KHÔNG đổi ngược được ─────────────────────
      const cuaCu = await t.api('PUT', `/api/admin/users/${u1}`, T, { role: 'staff' });
      t.eq('TC-3 · đường cũ PUT /admin/users vẫn từ chối (404) — đây là lý do phải có endpoint riêng',
        cuaCu.status, 404, `HTTP ${cuaCu.status} ${JSON.stringify(cuaCu.json)}`);

      // ── Chiều ngược, GỠ hồ sơ ───────────────────────────────────────────────────────
      const sid1 = sauXuoi.student_id;
      const nguoc = await t.api('POST', `/api/admin/users/${u1}/to-staff`, T, { role: 'staff', keep_student: false });
      t.eq('TC-4 · học viên -> nhân viên → 200', nguoc.status, 200, `HTTP ${nguoc.status} ${JSON.stringify(nguoc.json)}`);
      const sauNguoc = await hang(u1);
      t.eq('TC-5 · … vai về staff', sauNguoc.role, 'staff', JSON.stringify(sauNguoc));
      t.ok('TC-6 · … hồ sơ được gỡ khỏi tài khoản', sauNguoc.student_id === null, `student_id=${sauNguoc.student_id}`);
      t.ok('TC-7 · … approved vẫn bật (không đẩy người ta về màn chờ duyệt)', sauNguoc.approved === true, JSON.stringify(sauNguoc));
      const hoSoConNguyen = (await t.db.query('SELECT name, deleted_at FROM students WHERE id=$1', [sid1])).rows[0];
      t.ok('TC-8 · … hồ sơ học viên KHÔNG bị xoá lây', !!hoSoConNguyen && hoSoConNguyen.deleted_at === null, JSON.stringify(hoSoConNguyen));

      // ── Hiện lại ở màn Tài khoản và sửa được như mọi tài khoản nhân viên ───────────
      const ds = await t.api('GET', '/api/admin/users', T);
      t.ok('TC-9 · tài khoản hiện LẠI trong /admin/users', (ds.json || []).some(x => x.id === u1), 'vẫn không thấy dòng nào');
      const sua = await t.api('PUT', `/api/admin/users/${u1}`, T, { role: 'secretary' });
      t.eq('TC-10 · … và PUT /admin/users đổi vai được bình thường', sua.status, 200, `HTTP ${sua.status} ${JSON.stringify(sua.json)}`);

      // ── Chiều ngược, GIỮ hồ sơ (nhân viên kiêm khách thuê phòng) ────────────────────
      const u2 = await taoNV('_b');
      const xuoi2 = await t.api('POST', `/api/admin/users/${u2}/approve-student`, T, {
        new_student: { name: P + ' Hồ Sơ Hai', gender: 'female' },
      });
      t.eq('TC-11 · dựng tài khoản học viên thứ hai → 200', xuoi2.status, 200, `HTTP ${xuoi2.status}`);
      const sid2 = (await hang(u2)).student_id;
      const giu = await t.api('POST', `/api/admin/users/${u2}/to-staff`, T, { role: 'maintenance', keep_student: true });
      t.eq('TC-12 · đổi ngược kèm GIỮ hồ sơ → 200', giu.status, 200, `HTTP ${giu.status} ${JSON.stringify(giu.json)}`);
      const sauGiu = await hang(u2);
      t.ok('TC-13 · … vai maintenance mà hồ sơ vẫn gắn (kiêm khách thuê phòng)',
        sauGiu.role === 'maintenance' && sauGiu.student_id === sid2, JSON.stringify(sauGiu));

      // ── Cơ sở phụ trách: nhận đúng giá trị gửi lên, không âm thầm thành điều hành ───
      const fac = (await t.db.query('SELECT id FROM facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1')).rows[0];
      if (fac) {
        const u3 = await taoNV('_c');
        await t.api('POST', `/api/admin/users/${u3}/approve-student`, T, { new_student: { name: P + ' Hồ Sơ Ba', gender: 'male' } });
        const co = await t.api('POST', `/api/admin/users/${u3}/to-staff`, T, { role: 'staff', facility_id: fac.id });
        t.eq('TC-14 · đổi ngược kèm cơ sở phụ trách → 200', co.status, 200, `HTTP ${co.status} ${JSON.stringify(co.json)}`);
        t.eq('TC-15 · … facility_id đúng cơ sở đã chọn (không mặc định thành điều hành)',
          (await hang(u3)).facility_id, fac.id, JSON.stringify(await hang(u3)));
      }

      // ── Chặn: không nâng thẳng lên quản trị, không đổi nhầm tài khoản nhân viên ─────
      const u4 = await taoNV('_d');
      await t.api('POST', `/api/admin/users/${u4}/approve-student`, T, { new_student: { name: P + ' Hồ Sơ Bốn', gender: 'male' } });
      const lenAdmin = await t.api('POST', `/api/admin/users/${u4}/to-staff`, T, { role: 'admin' });
      t.eq('TC-16 · xin thẳng vai admin → 400 (đường này không nâng quyền quản trị)', lenAdmin.status, 400,
        `HTTP ${lenAdmin.status} ${JSON.stringify(lenAdmin.json)}`);
      t.eq('TC-17 · … và CSDL không đổi gì', (await hang(u4)).role, 'student', JSON.stringify(await hang(u4)));
      const vaiLa = await t.api('POST', `/api/admin/users/${u4}/to-staff`, T, { role: 'giam-doc' });
      t.eq('TC-18 · vai không có thật → 400', vaiLa.status, 400, `HTTP ${vaiLa.status} ${JSON.stringify(vaiLa.json)}`);

      const u5 = await taoNV('_e');
      const nhamNV = await t.api('POST', `/api/admin/users/${u5}/to-staff`, T, { role: 'staff' });
      t.eq('TC-19 · gọi trên tài khoản NHÂN VIÊN (không phải học viên) → 400', nhamNV.status, 400,
        `HTTP ${nhamNV.status} ${JSON.stringify(nhamNV.json)}`);
      const khongCo = await t.api('POST', '/api/admin/users/99999999/to-staff', T, { role: 'staff' });
      t.eq('TC-20 · tài khoản không tồn tại → 404', khongCo.status, 404, `HTTP ${khongCo.status}`);

      // ── Phân quyền: chỉ quản trị mới đi được đường này ──────────────────────────────
      const u6 = await taoNV('_f');
      await t.api('POST', `/api/admin/users/${u6}/approve-student`, T, { new_student: { name: P + ' Hồ Sơ Sáu', gender: 'male' } });
      const nvT = await t.login(P + '_e', pw);
      const nvThu = await t.api('POST', `/api/admin/users/${u6}/to-staff`, nvT, { role: 'admin' });
      t.ok('TC-21 · nhân viên thường gọi thẳng API → 401/403, không tự nâng mình lên được',
        nvThu.status === 401 || nvThu.status === 403, `HTTP ${nvThu.status} ${JSON.stringify(nvThu.json)}`);
      const khach = await t.api('POST', `/api/admin/users/${u6}/to-staff`, null, { role: 'staff' });
      t.ok('TC-22 · chưa đăng nhập → 401/403', khach.status === 401 || khach.status === 403, `HTTP ${khach.status}`);
    } finally {
      await clean(t.db);
    }
  },
};
