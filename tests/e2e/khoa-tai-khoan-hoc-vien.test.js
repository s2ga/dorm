// Khoá ĐĂNG NHẬP của học viên là việc riêng, không phải khoá hồ sơ: chặn vào app nhưng hồ sơ, tiền
// phòng, phiếu thu giữ nguyên. Và phải mở lại được — kể cả khi trạng thái khoá do bước XÁC NHẬN TRẢ
// PHÒNG đặt ra, vì đường mở khoá cũ (POST /admin/users/:id/unlock) chỉ nhận tài khoản nhân viên.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_khoahv';

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Khoá / mở khoá đăng nhập của học viên (không đụng hồ sơ)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const pw = 'test1234';
    const khoaTrongCSDL = async uid =>
      (await t.db.query('SELECT deleted_at IS NOT NULL AS k FROM users WHERE id=$1', [uid])).rows[0].k;
    const dsTaiKhoan = async () => (await t.api('GET', '/api/admin/student-accounts', T)).json || [];

    try {
      const sid = (await t.db.query(
        `INSERT INTO students (name, gender, check_in_date, status) VALUES ($1,'male',CURRENT_DATE,'in') RETURNING id`,
        [P + ' Trần Văn Khoá'])).rows[0].id;
      const uid = (await t.db.query(
        `INSERT INTO users (username,password_hash,role,full_name,student_id,approved) VALUES ($1,$2,'student',$3,$4,true) RETURNING id`,
        [P + '_hv', bcrypt.hashSync(pw, 10), P + ' Trần Văn Khoá', sid])).rows[0].id;

      const vaoTruoc = await t.api('POST', '/api/auth/login', null, { username: P + '_hv', password: pw });
      t.eq('TC-1 · trước khi khoá: học viên đăng nhập được', vaoTruoc.status, 200, `HTTP ${vaoTruoc.status}`);

      // ── KHOÁ ────────────────────────────────────────────────────────────────────────
      const khoa = await t.api('POST', `/api/admin/student-accounts/${uid}/lock`, T);
      t.eq('TC-2 · khoá đăng nhập → 200', khoa.status, 200, `HTTP ${khoa.status} ${JSON.stringify(khoa.json)}`);
      t.ok('TC-3 · … CSDL ghi nhận đã khoá', await khoaTrongCSDL(uid), 'deleted_at vẫn rỗng — báo thành công giả');
      const vaoSau = await t.api('POST', '/api/auth/login', null, { username: P + '_hv', password: pw });
      t.eq('TC-4 · … học viên KHÔNG đăng nhập được nữa (403, không phải 401 "sai mật khẩu")',
        vaoSau.status, 403, `HTTP ${vaoSau.status} — ${vaoSau.json && vaoSau.json.error}`);

      // Khoá đăng nhập KHÔNG được đụng tới hồ sơ — nếu đụng là mất tiền phòng của người đang ở.
      const hs = (await t.db.query('SELECT status, deleted_at, room_id, check_out_date FROM students WHERE id=$1', [sid])).rows[0];
      t.ok('TC-5 · hồ sơ học viên KHÔNG bị khoá lây', hs.deleted_at === null, JSON.stringify(hs));
      t.eq('TC-6 · … vẫn đang ở (tiền phòng tính như thường)', hs.status, 'in', JSON.stringify(hs));

      // ── Vẫn NHÌN THẤY sau khi khoá, kèm cờ locked ───────────────────────────────────
      const ds = await dsTaiKhoan();
      const dong = ds.find(x => x.id === uid);
      t.ok('TC-7 · tài khoản đã khoá VẪN hiện ở bảng Tài khoản học viên', !!dong,
        'biến mất khỏi danh sách → không còn nút nào mở khoá được');
      t.ok('TC-8 · … kèm cờ locked=true', !!(dong && dong.locked === true), JSON.stringify(dong && { u: dong.username, locked: dong.locked }));

      // ── Khoá hai lần / khoá nhầm tài khoản nhân viên → 404, KHÔNG báo thành công giả ─
      const lan2 = await t.api('POST', `/api/admin/student-accounts/${uid}/lock`, T);
      t.eq('TC-9 · khoá lại tài khoản đang khoá → 404 (không gật đầu suông)', lan2.status, 404, `HTTP ${lan2.status}`);
      const nvId = (await t.db.query(
        `INSERT INTO users (username,password_hash,role,full_name) VALUES ($1,$2,'staff',$3) RETURNING id`,
        [P + '_nv', bcrypt.hashSync(pw, 10), P + ' Nhân Viên'])).rows[0].id;
      const nhamNV = await t.api('POST', `/api/admin/student-accounts/${nvId}/lock`, T);
      t.eq('TC-10 · gọi trên tài khoản NHÂN VIÊN → 404', nhamNV.status, 404, `HTTP ${nhamNV.status}`);
      t.ok('TC-11 · … và tài khoản nhân viên đó KHÔNG bị khoá', !(await khoaTrongCSDL(nvId)), 'đã bị khoá nhầm');

      // ── MỞ KHOÁ ─────────────────────────────────────────────────────────────────────
      const mo = await t.api('POST', `/api/admin/student-accounts/${uid}/unlock`, T);
      t.eq('TC-12 · mở khoá → 200', mo.status, 200, `HTTP ${mo.status} ${JSON.stringify(mo.json)}`);
      const vaoLai = await t.api('POST', '/api/auth/login', null, { username: P + '_hv', password: pw });
      t.eq('TC-13 · … học viên đăng nhập lại được bằng mật khẩu cũ', vaoLai.status, 200,
        `HTTP ${vaoLai.status} — ${vaoLai.json && vaoLai.json.error}`);
      // 400 "đang hoạt động" — cùng một lời với mở khoá tài khoản nhân viên (admin.go UnlockUser).
      const moLan2 = await t.api('POST', `/api/admin/student-accounts/${uid}/unlock`, T);
      t.eq('TC-14 · mở khoá tài khoản đang hoạt động → 400 (báo rõ, không gật suông)', moLan2.status, 400,
        `HTTP ${moLan2.status} ${JSON.stringify(moLan2.json)}`);

      // ── Khoá do XÁC NHẬN TRẢ PHÒNG cũng mở lại được ────────────────────────────────
      // Đây là đường sinh ra trạng thái khoá nhiều nhất trong thực tế; trước đây kẹt vĩnh viễn vì
      // POST /admin/users/:id/unlock chỉ nhận vai nhân viên.
      await t.db.query(`UPDATE users SET deleted_at=now() WHERE id=$1`, [uid]);
      const duongCu = await t.api('POST', `/api/admin/users/${uid}/unlock`, T);
      t.eq('TC-15 · đường mở khoá CŨ vẫn từ chối tài khoản học viên (404) — lý do phải có đường riêng',
        duongCu.status, 404, `HTTP ${duongCu.status} ${JSON.stringify(duongCu.json)}`);
      const moSauTraPhong = await t.api('POST', `/api/admin/student-accounts/${uid}/unlock`, T);
      t.eq('TC-16 · mở khoá tài khoản bị khoá do trả phòng → 200', moSauTraPhong.status, 200,
        `HTTP ${moSauTraPhong.status} ${JSON.stringify(moSauTraPhong.json)}`);
      t.ok('TC-17 · … CSDL đã mở', !(await khoaTrongCSDL(uid)), 'vẫn còn khoá');

      // ── HỒ SƠ KHOÁ thì KHÔNG mở khoá tài khoản được (owner chốt 24/09) ─────────────
      // Mở tài khoản trong lúc hồ sơ đang khoá là mở suông: đăng nhập vẫn bị chặn vì hồ sơ.
      await t.api('POST', `/api/admin/student-accounts/${uid}/lock`, T);
      await t.db.query(`UPDATE students SET deleted_at=now() WHERE id=$1`, [sid]);
      const moKhiHoSoKhoa = await t.api('POST', `/api/admin/student-accounts/${uid}/unlock`, T);
      t.eq('TC-21 · hồ sơ đang khoá → mở khoá tài khoản bị từ chối (400)', moKhiHoSoKhoa.status, 400,
        `HTTP ${moKhiHoSoKhoa.status} ${JSON.stringify(moKhiHoSoKhoa.json)}`);
      t.ok('TC-22 · … lời từ chối chỉ đúng việc phải làm trước (mở khoá hồ sơ)',
        /hồ sơ/i.test((moKhiHoSoKhoa.json && moKhiHoSoKhoa.json.error) || ''), JSON.stringify(moKhiHoSoKhoa.json));
      t.ok('TC-23 · … tài khoản VẪN khoá, không mở suông', await khoaTrongCSDL(uid), 'đã mở dù hồ sơ còn khoá');
      const dsKhiHoSoKhoa = (await dsTaiKhoan()).find(x => x.id === uid);
      t.ok('TC-24 · … vẫn hiện ở bảng kèm cờ hồ sơ đã khoá (để biết phải mở hồ sơ trước)',
        !!dsKhiHoSoKhoa && dsKhiHoSoKhoa.locked === true && dsKhiHoSoKhoa.student_deleted === true,
        JSON.stringify(dsKhiHoSoKhoa && { locked: dsKhiHoSoKhoa.locked, hs: dsKhiHoSoKhoa.student_deleted }));

      await t.db.query(`UPDATE students SET deleted_at=NULL WHERE id=$1`, [sid]);
      const moSauKhiMoHoSo = await t.api('POST', `/api/admin/student-accounts/${uid}/unlock`, T);
      t.eq('TC-25 · mở khoá hồ sơ xong → mở khoá tài khoản được', moSauKhiMoHoSo.status, 200,
        `HTTP ${moSauKhiMoHoSo.status} ${JSON.stringify(moSauKhiMoHoSo.json)}`);
      const vaoSauCung = await t.api('POST', '/api/auth/login', null, { username: P + '_hv', password: pw });
      t.eq('TC-26 · … và học viên đăng nhập lại được', vaoSauCung.status, 200,
        `HTTP ${vaoSauCung.status} — ${vaoSauCung.json && vaoSauCung.json.error}`);

      // ── Phân quyền: chỉ quản trị ────────────────────────────────────────────────────
      const nvT = await t.login(P + '_nv', pw);
      const nvKhoa = await t.api('POST', `/api/admin/student-accounts/${uid}/lock`, nvT);
      t.ok('TC-18 · nhân viên thường gọi thẳng API khoá → 401/403',
        nvKhoa.status === 401 || nvKhoa.status === 403, `HTTP ${nvKhoa.status} ${JSON.stringify(nvKhoa.json)}`);
      const khach = await t.api('POST', `/api/admin/student-accounts/${uid}/unlock`, null);
      t.ok('TC-19 · chưa đăng nhập gọi API mở khoá → 401/403', khach.status === 401 || khach.status === 403, `HTTP ${khach.status}`);
      t.ok('TC-20 · … sau hai lần gọi trái phép, tài khoản vẫn nguyên trạng (không khoá)', !(await khoaTrongCSDL(uid)), 'trạng thái bị đổi bởi người không có quyền');
    } finally {
      await clean(t.db);
    }
  },
};
