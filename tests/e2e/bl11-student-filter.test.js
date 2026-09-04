// BL-11 — /api/logs & /api/invoices phải lọc theo student_id Ở SERVER (bằng SQL), không để client
// kéo 500 dòng gần nhất rồi .filter() (HV có lượt cũ hơn 500 bản ghi sẽ mất tích âm thầm).
// Chốt kèm: thêm student_id KHÔNG được phá cách ly cơ sở — quản lý cơ sở B không đọc được dữ liệu
// của học viên cơ sở A dù truyền thẳng ?student_id=<HV cơ sở A>.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_bl11';

const clean = async db => {
  await db.query(`DELETE FROM logs WHERE student_id IN (SELECT id FROM students WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices WHERE student_id IN (SELECT id FROM students WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'BL-11 · lọc /api/logs & /api/invoices theo student_id ở server (+ giữ chốt cơ sở)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const fA = (await t.db.query(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_facA'])).rows[0].id;
    const fB = (await t.db.query(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_facB'])).rows[0].id;
    const sA = (await t.db.query(
      `INSERT INTO students (name, facility_id, check_in_date) VALUES ($1,$2,CURRENT_DATE) RETURNING id`, [P + '_stuA', fA])).rows[0].id;
    const sB = (await t.db.query(
      `INSERT INTO students (name, facility_id, check_in_date) VALUES ($1,$2,CURRENT_DATE) RETURNING id`, [P + '_stuB', fB])).rows[0].id;
    // 3 lượt ra/vào cho A, 2 cho B
    await t.db.query(`INSERT INTO logs (student_id,type,date) VALUES ($1,'in',CURRENT_DATE),($1,'out',CURRENT_DATE),($1,'in',CURRENT_DATE)`, [sA]);
    await t.db.query(`INSERT INTO logs (student_id,type,date) VALUES ($1,'in',CURRENT_DATE),($1,'out',CURRENT_DATE)`, [sB]);
    // 1 hoá đơn mỗi HV
    await t.db.query(`INSERT INTO invoices (student_id,month) VALUES ($1,'2026-07')`, [sA]);
    await t.db.query(`INSERT INTO invoices (student_id,month) VALUES ($1,'2026-07')`, [sB]);
    // Nhân viên bị bó theo cơ sở B
    const pw = 'test1234';
    await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name,facility_id) VALUES ($1,$2,'staff','NV co so B',$3)`,
      [P + '_nvB', bcrypt.hashSync(pw, 10), fB]);

    try {
      const admin = await t.login('admin', process.env.ADMIN_P);
      const nvB = await t.login(P + '_nvB', pw);

      // ===== LOGS =====
      let r = await t.api('GET', `/api/logs?student_id=${sA}`, admin);
      t.eq('TC-11.1 · admin /logs?student_id=A → đúng 3 dòng của A', Array.isArray(r.json) ? r.json.length : -1, 3,
        `HTTP ${r.status} ${JSON.stringify(r.json)}`);
      t.ok('TC-11.1b · … không lẫn dòng của HV khác', Array.isArray(r.json) && r.json.every(l => l.student_id === sA),
        'có dòng student_id lạ');

      r = await t.api('GET', `/api/logs?student_id=${sB}`, admin);
      t.eq('TC-11.2 · admin /logs?student_id=B → đúng 2 dòng', Array.isArray(r.json) ? r.json.length : -1, 2, `HTTP ${r.status}`);

      // BẢO MẬT: NV cơ sở B truyền student_id của HV cơ sở A → chốt cơ sở vẫn chặn (SQL AND facility)
      r = await t.api('GET', `/api/logs?student_id=${sA}`, nvB);
      t.eq('TC-11.3 · BẢO MẬT: NV cơ sở B xem log HV cơ sở A → 0 dòng', Array.isArray(r.json) ? r.json.length : -1, 0,
        `trả ${r.json && r.json.length} dòng — RÒ DỮ LIỆU CHÉO CƠ SỞ!`);

      r = await t.api('GET', `/api/logs?student_id=${sB}`, nvB);
      t.eq('TC-11.4 · NV cơ sở B xem log HV cơ sở mình → 2 dòng', Array.isArray(r.json) ? r.json.length : -1, 2, `HTTP ${r.status}`);

      // Tương thích ngược: không tham số vẫn trả mảng (không vỡ luồng nhật ký chung)
      r = await t.api('GET', `/api/logs`, admin);
      t.ok('TC-11.5 · tương thích: /logs không tham số vẫn trả mảng (≥5 dòng test)',
        Array.isArray(r.json) && r.json.length >= 5, `len=${r.json && r.json.length}`);
      // Tương thích: ?type= vẫn lọc đúng
      r = await t.api('GET', `/api/logs?type=in&student_id=${sA}`, admin);
      t.ok('TC-11.5b · tương thích: ?type=in&student_id=A → chỉ "in" của A (2 dòng)',
        Array.isArray(r.json) && r.json.length === 2 && r.json.every(l => l.student_id === sA && l.type === 'in'),
        `len=${r.json && r.json.length}`);

      // ===== INVOICES =====
      r = await t.api('GET', `/api/invoices?student_id=${sA}`, admin);
      t.eq('TC-11.6 · admin /invoices?student_id=A → đúng 1', Array.isArray(r.json) ? r.json.length : -1, 1, `HTTP ${r.status}`);
      t.ok('TC-11.6b · … đúng hoá đơn của A', Array.isArray(r.json) && r.json.every(i => i.student_id === sA), 'có hoá đơn lạ');

      r = await t.api('GET', `/api/invoices?student_id=${sA}`, nvB);
      t.eq('TC-11.7 · BẢO MẬT: NV cơ sở B xem hoá đơn HV cơ sở A → 0', Array.isArray(r.json) ? r.json.length : -1, 0,
        `trả ${r.json && r.json.length} — RÒ DỮ LIỆU CHÉO CƠ SỞ!`);
    } finally {
      await clean(t.db);
    }
  },
};
