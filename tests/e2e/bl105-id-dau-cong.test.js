// BL-105: id có dấu cộng ("%2B9") lách rào cơ sở — rào kiểm bằng "chỉ chữ số" rồi NHẢ cho qua, còn
// handler đọc id bằng Atoi nên vẫn ra số thật. Đường GHI mới nguy: sửa hồ sơ, xoá giấy tờ của cơ sở khác.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_bl105';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'BL-105 — id có dấu cộng không lách được rào cơ sở',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const hash = bcrypt.hashSync(pw, 10);
    const q = (sql, p) => t.db.query(sql, p);
    const fA = (await q(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_A'])).rows[0].id;
    const fB = (await q(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_B'])).rows[0].id;
    const sA = (await q(`INSERT INTO students (name, gender, facility_id, note) VALUES ($1,'male',$2,'goc') RETURNING id`, [P + '_hvA', fA])).rows[0].id;
    const sB = (await q(`INSERT INTO students (name, gender, facility_id, note) VALUES ($1,'male',$2,'goc') RETURNING id`, [P + '_hvB', fB])).rows[0].id;
    const rB = (await q(`INSERT INTO rooms (name, capacity, facility_id) VALUES ($1,4,$2) RETURNING id`, [P + '_pB', fB])).rows[0].id;
    await q(`INSERT INTO users (username, password_hash, role, full_name, facility_id) VALUES ($1,$2,'staff',$1,$3)`, [P + '_nvA', hash, fA]);

    const admin = await t.login('admin', process.env.ADMIN_P);
    try {
      const scan = await t.api('POST', `/api/students/${sB}/contract-scan`, admin, { data: PNG });
      const coS3 = scan.status === 200;
      await t.api('PUT', `/api/students/${sB}`, admin, { cccd_front: PNG });
      const nvA = await t.login(P + '_nvA', pw);
      const ghi = async (m, duong, body) => (await t.api(m, duong, nvA, body)).status;
      const cot = async (id, f) => (await q(`SELECT ${f} FROM students WHERE id=$1`, [id])).rows[0][f];
      const chan = (ten, st) => t.ok(`${ten} → bị chặn (403/404)`, st === 403 || st === 404, `HTTP ${st}`);

      // Đường thẳng (id đúng chuẩn) phải bị chặn — nếu không thì cả bài này vô nghĩa.
      chan('Nhân viên cơ sở A sửa hồ sơ HV cơ sở B', await ghi('PUT', `/api/students/${sB}`, { note: 'bi sua' }));

      for (const bien of [`%2B${sB}`, `+${sB}`, ` ${sB}`.replace(' ', '%20'), `0${sB}`.replace(/^0/, '%30')]) {
        chan(`Sửa hồ sơ HV cơ sở B qua id "${bien}"`, await ghi('PUT', `/api/students/${bien}`, { note: 'bi sua ' + bien }));
        chan(`Xoá ảnh CCCD HV cơ sở B qua id "${bien}"`, await ghi('PUT', `/api/students/${bien}`, { cccd_front: '' }));
        chan(`Nộp scan HĐ cho HV cơ sở B qua id "${bien}"`, await ghi('POST', `/api/students/${bien}/contract-scan`, { data: PNG }));
        chan(`Xoá scan HĐ HV cơ sở B qua id "${bien}"`, await ghi('DELETE', `/api/students/${bien}/contract-scan`));
        chan(`Đổi ngày trả phòng HV cơ sở B qua id "${bien}"`, await ghi('PUT', `/api/students/${bien}/checkout-date`, { date: '2026-12-31' }));
        chan(`Chuyển phòng HV cơ sở B qua id "${bien}"`, await ghi('POST', `/api/students/${bien}/transfer`, { room_id: rB, date: '2026-09-18' }));
        chan(`Xoá hồ sơ HV cơ sở B qua id "${bien}"`, await ghi('DELETE', `/api/students/${bien}`));
        chan(`Sửa phòng cơ sở B qua id "${bien.replace(String(sB), String(rB))}"`,
          await ghi('PUT', `/api/rooms/${bien.replace(String(sB), String(rB))}`, { name: P + '_pB_sua' }));
      }

      t.eq('Ghi chú hồ sơ HV cơ sở B không bị sửa', await cot(sB, 'note'), 'goc');
      t.ok('Ảnh CCCD HV cơ sở B vẫn còn', !!(await cot(sB, 'cccd_front')), String(await cot(sB, 'cccd_front')));
      t.eq('Hồ sơ HV cơ sở B chưa bị khoá hay xoá', await cot(sB, 'deleted_at'), null);
      t.eq('HV cơ sở B chưa bị chuyển phòng', await cot(sB, 'room_id'), null);
      t.eq('Ngày trả phòng HV cơ sở B không bị đặt', await cot(sB, 'check_out_date'), null);
      t.eq('Tên phòng cơ sở B không đổi', (await q('SELECT name FROM rooms WHERE id=$1', [rB])).rows[0].name, P + '_pB');
      if (coS3) {
        const xemScan = await t.api('GET', `/api/students/${sB}/contract-scan`, admin);
        t.eq('Bản scan HĐ của HV cơ sở B vẫn còn', xemScan.status, 200, `HTTP ${xemScan.status}`);
      }

      // Không siết nhầm: id đúng chuẩn trong cơ sở mình vẫn làm việc được.
      const sua = await t.api('PUT', `/api/students/${sA}`, nvA, { note: 'nhan vien A sua' });
      t.eq('Nhân viên cơ sở A vẫn sửa được hồ sơ cơ sở mình → 200', sua.status, 200, `HTTP ${sua.status} ${sua.json && sua.json.error || ''}`);
      t.eq('Ghi chú được lưu', await cot(sA, 'note'), 'nhan vien A sua');
      const xem = await t.api('GET', `/api/students/${sA}`, nvA);
      t.eq('Và vẫn mở được hồ sơ đó → 200', xem.status, 200, `HTTP ${xem.status}`);
    } finally {
      await t.api('PUT', `/api/students/${sB}`, admin, { cccd_front: '' });
      await t.api('DELETE', `/api/students/${sB}/contract-scan`, admin);
      await clean(t.db);
    }
  },
};
