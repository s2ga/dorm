// Thẻ Máy giặt của cổng An ninh & Bảo trì.
// An ninh XEM danh sách máy giặt (kèm ngày đăng ký) và BÁO CÁO người chưa đăng ký mà có máy trong
// phòng; hồ sơ CHỈ đổi khi quản trị viên duyệt. An ninh không tự ghi được vào danh sách.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_mgan';
const PW = 'quanly2026a';

const clean = async db => {
  await db.query(`DELETE FROM washing_requests WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Máy giặt ở cổng an ninh — xem, báo cáo, quản trị duyệt mới vào danh sách',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const ADMIN = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const hash = bcrypt.hashSync(PW, 10);
    const hnay = new Date().toISOString().slice(0, 10);

    const fA = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_A','Cơ sở A') RETURNING id`)).rows[0].id;
    const fB = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_B','Cơ sở B') RETURNING id`)).rows[0].id;
    const mkRoom = (ten, fac, tang) => t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee,floor) VALUES ($1,$2,6,'male','B',1200000,$3) RETURNING id`,
      [ten, fac, tang]).then(r => r.rows[0].id);
    const rA = await mkRoom(P + '_rA', fA, 3);
    const rB = await mkRoom(P + '_rB', fB, 5);

    // giat = uses_washing · ci/co = ngày vào/ra THẬT · pci/pco = dự kiến (BL-117)
    const mkHV = (ten, room, fac, giat, { ci = '2026-05-01', co = null, pci = null, pco = null, xoa = false, tuNgay = null } = {}) => t.db.query(
      `INSERT INTO students (code,name,gender,room_id,facility_id,check_in_date,check_out_date,planned_check_in,planned_check_out,
         uses_washing,washing_from,status,rental_type,residency_status,deleted_at)
       VALUES ($1,$1,'male',$2,$3,$4,$5,$6,$7,$8,$9,$10,'ghep','unregistered',$11) RETURNING id`,
      [P + '_' + ten, room, fac, ci, co, pci, pco, giat, tuNgay, co ? 'out' : 'in', xoa ? new Date() : null]).then(r => r.rows[0].id);

    const dangO = await mkHV('dangO', rA, fA, true, { tuNgay: '2026-06-15' });
    const sapTra = await mkHV('sapTra', rA, fA, true, { pco: '2099-12-31' });
    const khongGiat = await mkHV('khongGiat', rA, fA, false);
    const daTra = await mkHV('daTra', rA, fA, true, { ci: '2026-05-01', co: '2026-06-30' });
    const chuaVao = await mkHV('chuaVao', rA, fA, true, { ci: null, pci: '2026-09-01' });
    const daXoa = await mkHV('daXoa', rA, fA, true, { xoa: true });
    const coSoB = await mkHV('coSoB', rB, fB, true);

    const mkUser = (uname, role, fac) => t.db.query(
      `INSERT INTO users (username,password_hash,role,facility_id,must_change_password) VALUES ($1,$2,$3,$4,false)`,
      [P + '_' + uname, hash, role, fac]);
    await mkUser('anninhA', 'maintenance', fA);
    await mkUser('anninhB', 'maintenance', fB);
    await mkUser('nhanvienA', 'staff', fA);
    await mkUser('thuky', 'secretary', fA);
    await mkUser('giaovien', 'teacher', fA);

    try {
      const anA = await t.login(P + '_anninhA', PW);
      t.ok('An ninh đăng nhập được', !!anA);

      /* ===== 1. XEM DANH SÁCH ===== */
      const r = await t.api('GET', '/api/maintenance/washing', anA);
      t.eq('GET /maintenance/washing → 200', r.status, 200, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
      const ds = (r.json && r.json.dang_dung) || [], chua = (r.json && r.json.chua_dang_ky) || [];
      const co = id => ds.some(x => x.id === id);

      t.ok('Thấy người đang ở có đăng ký máy giặt', co(dangO), JSON.stringify(ds));
      t.ok('Thấy người đang ở đã có lịch trả trong tương lai (vẫn còn máy trong phòng)', co(sapTra));
      t.ok('KHÔNG thấy người đã trả phòng', !co(daTra));
      t.ok('KHÔNG thấy người chưa xác nhận nhận phòng', !co(chuaVao));
      t.ok('KHÔNG thấy hồ sơ đã xoá', !co(daXoa));
      t.ok('KHÔNG thấy người của cơ sở khác', !co(coSoB));
      t.ok('Người chưa đăng ký nằm ở nhóm riêng để báo cáo', chua.some(x => x.id === khongGiat), JSON.stringify(chua));
      t.ok('Người đã đăng ký KHÔNG lọt vào nhóm chưa đăng ký', !chua.some(x => x.id === dangO));

      const hang = ds.find(x => x.id === dangO) || {};
      t.eq('Có tên phòng để an ninh đi đối chiếu', hang.room_name, P + '_rA', JSON.stringify(hang));
      t.eq('Có tầng', String(hang.floor), '3', JSON.stringify(hang));
      t.eq('Có mã học viên để phân biệt người trùng tên', hang.code, P + '_dangO', JSON.stringify(hang));
      t.eq('Có NGÀY ĐĂNG KÝ máy giặt', String(hang.washing_from).slice(0, 10), '2026-06-15', JSON.stringify(hang));
      t.ok('KHÔNG kèm dữ liệu nhạy cảm (CCCD, SĐT, ngày sinh, tiền)',
        !['cccd', 'phone', 'dob', 'birth_date', 'parent_phone', 'deposit_amount', 'bank_account'].some(k => k in hang),
        Object.keys(hang).join(','));

      /* ===== 2. CÁCH LY CƠ SỞ ===== */
      const anB = await t.login(P + '_anninhB', PW);
      const rB2 = await t.api('GET', '/api/maintenance/washing', anB);
      const dsB = (rB2.json && rB2.json.dang_dung) || [];
      t.ok('An ninh cơ sở B thấy người cơ sở B', dsB.some(x => x.id === coSoB), JSON.stringify(dsB));
      t.ok('An ninh cơ sở B KHÔNG thấy người cơ sở A', !dsB.some(x => x.id === dangO));
      t.ok('An ninh cơ sở B KHÔNG thấy người cơ sở A ở nhóm chưa đăng ký',
        !((rB2.json && rB2.json.chua_dang_ky) || []).some(x => x.id === khongGiat));

      const rAd = await t.api('GET', '/api/maintenance/washing', ADMIN);
      const dsAd = (rAd.json && rAd.json.dang_dung) || [];
      t.eq('Điều hành → 200', rAd.status, 200, `HTTP ${rAd.status}`);
      t.ok('Điều hành thấy cả hai cơ sở', dsAd.some(x => x.id === dangO) && dsAd.some(x => x.id === coSoB));
      const dsLoc = ((await t.api('GET', `/api/maintenance/washing?facility=${fB}`, ADMIN)).json || {}).dang_dung || [];
      t.ok('Điều hành lọc ?facility → chỉ còn cơ sở đó',
        dsLoc.some(x => x.id === coSoB) && !dsLoc.some(x => x.id === dangO), JSON.stringify(dsLoc));

      /* ===== 3. AN NINH KHÔNG TỰ GHI VÀO DANH SÁCH ===== */
      t.eq('An ninh gọi đường bật máy giặt của quản trị → 403',
        (await t.api('POST', `/api/students/${khongGiat}/washing`, anA, { on: true })).status, 403);
      t.eq('An ninh gọi đường duyệt báo cáo → 403',
        (await t.api('POST', '/api/washing-requests/1/approve', anA)).status, 403);
      t.eq('An ninh không xem được danh sách báo cáo của quản trị → 403',
        (await t.api('GET', '/api/washing-requests', anA)).status, 403);

      /* ===== 4. GỬI BÁO CÁO ===== */
      const xau = async (ten, body, mong) => {
        const x = await t.api('POST', '/api/maintenance/washing/requests', anA, body);
        t.eq(ten, x.status, mong, `HTTP ${x.status} ${x.json && x.json.error || ''}`);
      };
      await xau('Không chọn học viên → 400', { seen_date: hnay }, 400);
      await xau('Ngày sai định dạng → 400', { student_id: khongGiat, seen_date: '20/09/2026' }, 400);
      await xau('Ngày thấy máy ở tương lai → 400', { student_id: khongGiat, seen_date: '2099-01-01' }, 400);
      await xau('Báo người đã trả phòng → 400', { student_id: daTra, seen_date: hnay }, 400);
      await xau('Báo người đã có trong danh sách → 400', { student_id: dangO, seen_date: hnay }, 400);
      await xau('Báo người của cơ sở khác → 403', { student_id: coSoB, seen_date: hnay }, 403);
      t.eq('Chưa có báo cáo nào được tạo từ các lần sai',
        (await t.db.query(`SELECT COUNT(*)::int c FROM washing_requests WHERE student_id IN
           (SELECT id FROM students WHERE code LIKE '${P}%')`)).rows[0].c, 0);

      const gui = await t.api('POST', '/api/maintenance/washing/requests', anA,
        { student_id: khongGiat, seen_date: hnay, note: 'HV nói sẽ mang máy lên tuần này' });
      t.eq('Gửi báo cáo hợp lệ → 200', gui.status, 200, `HTTP ${gui.status} ${gui.json && gui.json.error || ''}`);
      const reqID = gui.json && gui.json.id;
      t.ok('Trả về mã báo cáo', !!reqID, JSON.stringify(gui.json));
      t.eq('GỬI BÁO CÁO KHÔNG ĐƯỢC ĐỔI HỒ SƠ — vẫn chưa vào danh sách máy giặt',
        (await t.db.query('SELECT uses_washing FROM students WHERE id=$1', [khongGiat])).rows[0].uses_washing, false);
      t.eq('Gửi lần hai khi còn chờ duyệt → 409',
        (await t.api('POST', '/api/maintenance/washing/requests', anA, { student_id: khongGiat, seen_date: hnay })).status, 409);

      const lai = await t.api('GET', '/api/maintenance/washing', anA);
      const dongCho = (((lai.json || {}).chua_dang_ky) || []).find(x => x.id === khongGiat) || {};
      t.eq('An ninh thấy dòng đó đang chờ duyệt', dongCho.de_nghi_status, 'pending', JSON.stringify(dongCho));

      /* ===== 5. QUẢN TRỊ DUYỆT / TỪ CHỐI ===== */
      const dsBC = await t.api('GET', '/api/washing-requests', ADMIN);
      t.eq('Quản trị xem danh sách báo cáo → 200', dsBC.status, 200, `HTTP ${dsBC.status}`);
      const bc = ((dsBC.json && dsBC.json.rows) || []).find(x => x.id === reqID) || {};
      t.eq('Báo cáo có tên học viên', bc.student_name, P + '_khongGiat', JSON.stringify(bc));
      t.eq('Báo cáo có phòng', bc.room_name, P + '_rA', JSON.stringify(bc));
      t.eq('Báo cáo giữ đúng ghi chú của an ninh', bc.note, 'HV nói sẽ mang máy lên tuần này');
      t.eq('Báo cáo ghi ai đã báo', bc.requested_by, P + '_anninhA');

      t.eq('Từ chối mà không nêu lý do → 400',
        (await t.api('POST', `/api/washing-requests/${reqID}/reject`, ADMIN, { note: '' })).status, 400);

      const duyet = await t.api('POST', `/api/washing-requests/${reqID}/approve`, ADMIN, {});
      t.eq('Duyệt báo cáo → 200', duyet.status, 200, `HTTP ${duyet.status} ${duyet.json && duyet.json.error || ''}`);
      const sau = (await t.db.query('SELECT uses_washing, washing_from::text AS tu FROM students WHERE id=$1', [khongGiat])).rows[0];
      t.eq('DUYỆT RỒI mới vào danh sách máy giặt', sau.uses_washing, true, JSON.stringify(sau));
      t.eq('Duyệt thì ghi luôn ngày đăng ký = hôm nay', sau.tu, hnay, JSON.stringify(sau));
      t.eq('Duyệt lại lần hai → 409',
        (await t.api('POST', `/api/washing-requests/${reqID}/approve`, ADMIN, {})).status, 409);

      const sauDuyet = await t.api('GET', '/api/maintenance/washing', anA);
      t.ok('An ninh thấy người đó đã chuyển sang nhóm đang dùng',
        (((sauDuyet.json || {}).dang_dung) || []).some(x => x.id === khongGiat));

      // Từ chối: hồ sơ KHÔNG đổi, an ninh đọc được lý do và báo lại được
      const gui2 = await t.api('POST', '/api/maintenance/washing/requests', anA, { student_id: sapTra, seen_date: hnay });
      t.eq('Người đã có máy giặt thì không báo được nữa → 400', gui2.status, 400);

      await t.db.query('UPDATE students SET uses_washing=false, washing_from=NULL WHERE id=$1', [sapTra]);
      const gui3 = await t.api('POST', '/api/maintenance/washing/requests', anA, { student_id: sapTra, seen_date: hnay });
      const req3 = gui3.json && gui3.json.id;
      t.eq('Gửi báo cáo cho người vừa bị ngưng máy giặt → 200', gui3.status, 200, `HTTP ${gui3.status}`);
      const tc = await t.api('POST', `/api/washing-requests/${req3}/reject`, ADMIN, { note: 'Máy của phòng bên cạnh' });
      t.eq('Từ chối có lý do → 200', tc.status, 200, `HTTP ${tc.status} ${tc.json && tc.json.error || ''}`);
      t.eq('TỪ CHỐI thì hồ sơ vẫn không có máy giặt',
        (await t.db.query('SELECT uses_washing FROM students WHERE id=$1', [sapTra])).rows[0].uses_washing, false);
      const sauTC = (((await t.api('GET', '/api/maintenance/washing', anA)).json || {}).chua_dang_ky || [])
        .find(x => x.id === sapTra) || {};
      t.eq('An ninh thấy báo cáo bị từ chối', sauTC.de_nghi_status, 'rejected', JSON.stringify(sauTC));
      t.eq('An ninh đọc được lý do từ chối', sauTC.de_nghi_decision_note, 'Máy của phòng bên cạnh');
      // Form của an ninh KHÔNG có ô ngày — gửi thiếu seen_date phải tự lấy hôm nay, không được 400.
      const guiTrong = await t.api('POST', '/api/maintenance/washing/requests', anA, { student_id: sapTra });
      t.eq('Bị từ chối rồi vẫn báo lại được, không cần gửi ngày', guiTrong.status, 200, `HTTP ${guiTrong.status}`);
      t.eq('Thiếu ngày thì máy chủ tự điền hôm nay',
        (await t.db.query('SELECT seen_date::text d FROM washing_requests WHERE id=$1', [guiTrong.json.id])).rows[0].d, hnay);

      /* ===== 6. VAI KHÁC ===== */
      const cam = async (ten, uname, method, path, body, mong = 403) => {
        const tk = await t.login(P + '_' + uname, PW);
        t.eq(ten, (await t.api(method, path, tk, body)).status, mong);
      };
      await cam('Nhân viên quản lý không vào cổng an ninh → 403', 'nhanvienA', 'GET', '/api/maintenance/washing');
      await cam('Thư ký → 403', 'thuky', 'GET', '/api/maintenance/washing');
      await cam('Giáo viên ProSkills → 403', 'giaovien', 'GET', '/api/maintenance/washing');
      await cam('Giáo viên không duyệt được báo cáo → 403', 'giaovien', 'POST', `/api/washing-requests/${reqID}/approve`, {});
      await cam('Nhân viên quản lý DUYỆT được (cùng việc với quản trị) → 409 vì đã xử lý',
        'nhanvienA', 'POST', `/api/washing-requests/${reqID}/approve`, {}, 409);
      t.eq('Chưa đăng nhập → 401', (await t.api('GET', '/api/maintenance/washing', null)).status, 401);
    } finally {
      await clean(t.db);
    }
  },
};
