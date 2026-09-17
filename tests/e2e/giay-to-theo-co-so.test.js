// QA-008: ảnh CCCD và bản scan HĐ phải bó theo cơ sở như hồ sơ chi tiết. Nhân viên/thư ký cơ sở A
// đổi số id không được tải giấy tờ của học viên cơ sở B; học viên chỉ xem giấy tờ của chính mình.
// Nộp tệp THẬT cho cả hai hồ sơ trước khi thử: không có tệp thì bản lỗi cũng trả 404 và test xanh oan.
const bcrypt = require('../../node_modules/bcryptjs');
const { BASE } = require('../lib/harness');
const P = '__test_giayto_cs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const CHU_KY_PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47]);

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Giấy tờ học viên bó theo cơ sở',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const hash = bcrypt.hashSync(pw, 10);
    const q = (sql, p) => t.db.query(sql, p);
    const fA = (await q(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_A'])).rows[0].id;
    const fB = (await q(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_B'])).rows[0].id;
    const sA = (await q(`INSERT INTO students (name, gender, facility_id) VALUES ($1,'male',$2) RETURNING id`, [P + '_hvA', fA])).rows[0].id;
    const sB = (await q(`INSERT INTO students (name, gender, facility_id) VALUES ($1,'male',$2) RETURNING id`, [P + '_hvB', fB])).rows[0].id;
    const user = (u, role, fac, sid) => q(
      `INSERT INTO users (username, password_hash, role, full_name, facility_id, student_id) VALUES ($1,$2,$3,$1,$4,$5)`,
      [P + u, hash, role, fac, sid]);
    await user('_nvA', 'staff', fA, null);
    await user('_tkA', 'secretary', fA, null);
    await user('_btA', 'maintenance', fA, null);
    await user('_hvA', 'student', null, sA);

    const admin = await t.login('admin', process.env.ADMIN_P);
    try {
      let coTep = true;
      for (const id of [sA, sB]) {
        const anh = await t.api('PUT', `/api/students/${id}`, admin, { cccd_front: PNG, cccd_back: PNG });
        const scan = await t.api('POST', `/api/students/${id}/contract-scan`, admin, { data: PNG });
        if (scan.status === 501) coTep = false;
        else {
          t.eq(`Admin nộp ảnh CCCD cho HV #${id} → 200`, anh.status, 200, `HTTP ${anh.status}`);
          t.eq(`Admin nộp scan HĐ cho HV #${id} → 200`, scan.status, 200, `HTTP ${scan.status}`);
        }
      }
      if (!coTep) t.ok('S3 chưa cấu hình — ca được phép chỉ kiểm "không bị 403"', true, '501');

      const nvA = await t.login(P + '_nvA', pw);
      const tkA = await t.login(P + '_tkA', pw);
      const btA = await t.login(P + '_btA', pw);
      const hvA = await t.login(P + '_hvA', pw);
      const duong = id => [`/api/students/${id}/cccd/front`, `/api/students/${id}/cccd/back`, `/api/students/${id}/contract-scan`];
      const tai = async (d, tok) => {
        const r = await fetch(BASE + d, { headers: { Authorization: 'Bearer ' + tok } });
        return { status: r.status, than: Buffer.from(await r.arrayBuffer()) };
      };
      const biChan = (ten, r) => {
        t.ok(`${ten} → 403/404`, r.status === 403 || r.status === 404, `HTTP ${r.status}`);
        t.ok(`${ten} → không lọt byte nào của tệp`, !r.than.includes(CHU_KY_PNG), `${r.than.length} byte`);
      };
      const duocXem = (ten, r) => coTep
        ? t.eq(`${ten} → 200`, r.status, 200, `HTTP ${r.status}`)
        : t.ok(`${ten} → không bị chặn quyền`, r.status !== 403, `HTTP ${r.status}`);

      for (const [ten, tok] of [['Nhân viên', nvA], ['Thư ký', tkA]]) {
        for (const d of duong(sB)) {
          const r = await tai(d, tok);
          t.eq(`${ten} cơ sở A mở ${d.replace(String(sB), '<HV cơ sở B>')} → 403`, r.status, 403, `HTTP ${r.status}`);
          t.ok(`${ten} cơ sở A mở ${d.replace(String(sB), '<HV cơ sở B>')} → không lọt byte nào của tệp`, !r.than.includes(CHU_KY_PNG), `${r.than.length} byte`);
        }
        for (const d of duong(sA)) duocXem(`${ten} cơ sở A mở ${d.replace(String(sA), '<HV cơ sở A>')}`, await tai(d, tok));
      }

      for (const bien of [`%2B${sB}`, `+${sB}`, `${sB}abc`, `0${sB}x`, `%20${sB}`]) {
        biChan(`Nhân viên cơ sở A dùng id biến dạng "${bien}" mở CCCD HV cơ sở B`, await tai(`/api/students/${bien}/cccd/front`, nvA));
        biChan(`Nhân viên cơ sở A dùng id biến dạng "${bien}" mở scan HĐ HV cơ sở B`, await tai(`/api/students/${bien}/contract-scan`, nvA));
      }

      for (const d of duong(sB)) {
        const r = await tai(d, hvA);
        t.eq(`Học viên mở giấy tờ của người khác ${d.replace(String(sB), '<id>')} → 403`, r.status, 403, `HTTP ${r.status}`);
      }
      for (const d of duong(sA)) duocXem(`Học viên mở giấy tờ của chính mình ${d.replace(String(sA), '<id>')}`, await tai(d, hvA));
      const bt = await tai(duong(sA)[0], btA);
      t.eq('Vai bảo trì không xem được CCCD kể cả cùng cơ sở → 403', bt.status, 403, `HTTP ${bt.status}`);
      for (const d of duong(sB)) duocXem(`Admin (điều hành) mở ${d.replace(String(sB), '<HV cơ sở B>')}`, await tai(d, admin));
    } finally {
      for (const id of [sA, sB]) {
        await t.api('PUT', `/api/students/${id}`, admin, { cccd_front: '', cccd_back: '' });
        await t.api('DELETE', `/api/students/${id}/contract-scan`, admin);
      }
      await clean(t.db);
    }
  },
};
