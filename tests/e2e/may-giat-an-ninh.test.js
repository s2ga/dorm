// Thẻ Máy giặt của cổng An ninh & Bảo trì: GET /api/maintenance/washing — CHỈ ĐỌC.
// An ninh phải thấy đúng người ĐANG Ở có đăng ký máy giặt ở CƠ SỞ MÌNH, không thấy người đã trả
// phòng / chưa nhận phòng / cơ sở khác, và không có đường nào ghi được từ đây.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_mgan';
const PW = 'quanly2026a';

const clean = async db => {
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Máy giặt ở cổng an ninh — chỉ đọc, đúng người đang ở, đúng cơ sở',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const ADMIN = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const hash = bcrypt.hashSync(PW, 10);

    const fA = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_A','Cơ sở A') RETURNING id`)).rows[0].id;
    const fB = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_B','Cơ sở B') RETURNING id`)).rows[0].id;
    const mkRoom = (ten, fac, tang) => t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee,floor) VALUES ($1,$2,4,'male','B',1200000,$3) RETURNING id`,
      [ten, fac, tang]).then(r => r.rows[0].id);
    const rA = await mkRoom(P + '_rA', fA, 3);
    const rB = await mkRoom(P + '_rB', fB, 5);

    // giat = uses_washing · ci/co = ngày vào/ra THẬT · pci/pco = dự kiến (BL-117)
    const mkHV = (ten, room, fac, giat, { ci = '2026-05-01', co = null, pci = null, pco = null, xoa = false } = {}) => t.db.query(
      `INSERT INTO students (code,name,gender,room_id,facility_id,check_in_date,check_out_date,planned_check_in,planned_check_out,
         uses_washing,status,rental_type,residency_status,deleted_at)
       VALUES ($1,$1,'male',$2,$3,$4,$5,$6,$7,$8,$9,'ghep','unregistered',$10) RETURNING id`,
      [P + '_' + ten, room, fac, ci, co, pci, pco, giat, co ? 'out' : 'in', xoa ? new Date() : null]).then(r => r.rows[0].id);

    const dangO = await mkHV('dangO', rA, fA, true);                                     // đang ở, có máy giặt
    const sapTra = await mkHV('sapTra', rA, fA, true, { pco: '2099-12-31' });            // đang ở, có lịch trả tương lai
    const khongGiat = await mkHV('khongGiat', rA, fA, false);                            // đang ở, KHÔNG đăng ký
    const daTra = await mkHV('daTra', rA, fA, true, { ci: '2026-05-01', co: '2026-06-30' }); // đã trả phòng
    const chuaVao = await mkHV('chuaVao', rA, fA, true, { ci: null, pci: '2026-09-01' }); // chờ xác nhận vào
    const daXoa = await mkHV('daXoa', rA, fA, true, { xoa: true });                       // hồ sơ đã xoá
    const coSoB = await mkHV('coSoB', rB, fB, true);                                      // cơ sở khác

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

      const r = await t.api('GET', '/api/maintenance/washing', anA);
      t.eq('GET /maintenance/washing → 200', r.status, 200, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
      const ds = Array.isArray(r.json) ? r.json : [];
      const co = id => ds.some(x => x.id === id);

      t.ok('Thấy người đang ở có đăng ký máy giặt', co(dangO), JSON.stringify(ds));
      t.ok('Thấy người đang ở đã có lịch trả trong tương lai (vẫn còn máy trong phòng)', co(sapTra));
      t.ok('KHÔNG thấy người đang ở nhưng chưa đăng ký máy giặt', !co(khongGiat));
      t.ok('KHÔNG thấy người đã trả phòng', !co(daTra));
      t.ok('KHÔNG thấy người chưa xác nhận nhận phòng', !co(chuaVao));
      t.ok('KHÔNG thấy hồ sơ đã xoá', !co(daXoa));
      t.ok('KHÔNG thấy người của cơ sở khác', !co(coSoB));

      const hang = ds.find(x => x.id === dangO) || {};
      t.eq('Có tên phòng để an ninh đi đối chiếu', hang.room_name, P + '_rA', JSON.stringify(hang));
      t.eq('Có tầng', String(hang.floor), '3', JSON.stringify(hang));
      t.eq('Có mã học viên để phân biệt người trùng tên', hang.code, P + '_dangO', JSON.stringify(hang));
      t.ok('KHÔNG kèm dữ liệu nhạy cảm (CCCD, SĐT, ngày sinh, tiền)',
        !['cccd', 'phone', 'dob', 'birth_date', 'parent_phone', 'deposit_amount', 'bank_account'].some(k => k in hang),
        Object.keys(hang).join(','));

      // An ninh cơ sở B chỉ thấy người của mình
      const anB = await t.login(P + '_anninhB', PW);
      const rB2 = await t.api('GET', '/api/maintenance/washing', anB);
      const dsB = Array.isArray(rB2.json) ? rB2.json : [];
      t.ok('An ninh cơ sở B thấy người cơ sở B', dsB.some(x => x.id === coSoB), JSON.stringify(dsB));
      t.ok('An ninh cơ sở B KHÔNG thấy người cơ sở A', !dsB.some(x => x.id === dangO));

      // Điều hành xem được cả hai, và lọc được theo cơ sở
      const rAd = await t.api('GET', '/api/maintenance/washing', ADMIN);
      t.eq('Điều hành → 200', rAd.status, 200, `HTTP ${rAd.status}`);
      const dsAd = Array.isArray(rAd.json) ? rAd.json : [];
      t.ok('Điều hành thấy cả hai cơ sở', dsAd.some(x => x.id === dangO) && dsAd.some(x => x.id === coSoB));
      const rLoc = await t.api('GET', `/api/maintenance/washing?facility=${fB}`, ADMIN);
      const dsLoc = Array.isArray(rLoc.json) ? rLoc.json : [];
      t.ok('Điều hành lọc ?facility → chỉ còn cơ sở đó',
        dsLoc.some(x => x.id === coSoB) && !dsLoc.some(x => x.id === dangO), JSON.stringify(dsLoc));

      // Vai không thuộc nhóm bảo trì / an ninh
      const cam = async (ten, uname) => {
        const tk = await t.login(P + '_' + uname, PW);
        t.eq(ten, (await t.api('GET', '/api/maintenance/washing', tk)).status, 403);
      };
      await cam('Nhân viên quản lý → 403', 'nhanvienA');
      await cam('Thư ký → 403', 'thuky');
      await cam('Giáo viên ProSkills → 403', 'giaovien');
      t.eq('Chưa đăng nhập → 401', (await t.api('GET', '/api/maintenance/washing', null)).status, 401);

      // Không có đường GHI nào ở đây — đăng ký / ngưng vẫn là việc của quản trị
      const ghi = await t.api('POST', '/api/maintenance/washing', anA, { student_id: khongGiat, on: true });
      t.ok('POST /maintenance/washing không tồn tại', ghi.status === 404 || ghi.status === 405, `HTTP ${ghi.status}`);
      t.eq('An ninh vẫn không bật được máy giặt qua đường của quản trị',
        (await t.api('POST', `/api/students/${khongGiat}/washing`, anA, { on: true })).status, 403);

      const sau = (await t.db.query(`SELECT uses_washing FROM students WHERE id=$1`, [khongGiat])).rows[0];
      t.ok('Gọi xong dữ liệu y nguyên (chỉ đọc)', sau.uses_washing === false, JSON.stringify(sau));
    } finally {
      await clean(t.db);
    }
  },
};
