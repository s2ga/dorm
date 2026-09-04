// Hồ sơ ĐÃ RỜI, sửa thông tin (bổ sung hợp đồng) mà KHÔNG đổi phòng thì đừng bắt qua luật xếp
// phòng — người ta đi rồi, không xếp ai vào đâu cả.
const P = '__test_shdr';

async function clean(db) {
  await db.query(`DELETE FROM invoices   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Sửa hồ sơ người đã rời — không hỏi xếp phòng',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const R = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,2,'female','B',1200000,'shared') RETURNING id`, [P + '_R', fac])).rows[0].id;
    const moi = async (n, ra) => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,check_out_date,status,rental_type,residency_status,facility_id)
       VALUES ($1,$1,'female',$2,'2026-05-01',$3,$4,'ghep','unregistered',$5) RETURNING id`,
      [P + n, R, ra, ra ? 'out' : 'in', fac])).rows[0].id;

    // Phòng 2 giường, đã có 2 người ĐANG Ở -> đầy. V đã rời từ tháng 7, vẫn mang room_id phòng này.
    await moi('_A', null); await moi('_B', null);
    const V = await moi('_V', '2026-07-14');

    const doc = async id => (await t.api('GET', `/api/students/${id}`, T)).json;
    const v = await doc(V);

    const luu = await t.api('PUT', `/api/students/${V}`, T, {
      name: v.name, code: v.code, gender: v.gender, room_id: v.room_id,
      check_in_date: String(v.check_in_date || '').slice(0, 10),
      rental_type: v.rental_type, residency_status: v.residency_status,
      contract_no: '77/2026/HDKTX-E2', contract_status: 'scanned', _v: v._v,
    });
    t.eq('Bổ sung hợp đồng cho người ĐÃ RỜI → lưu thẳng, KHÔNG hỏi xếp phòng', luu.status, 200,
      `HTTP ${luu.status} — ${JSON.stringify(luu.json)}`);
    t.ok('Không kèm cảnh báo quá tải nào', !(luu.json.warnings || []).length,
      JSON.stringify(luu.json.warnings || []));
    t.eq('Số HĐ đã lưu', (await doc(V)).contract_no, '77/2026/HDKTX-E2');
    t.eq('Vẫn là hồ sơ đã rời, không bị nhận lại phòng', (await doc(V)).status, 'out');

    // Người ĐANG Ở xếp vào phòng đầy thì VẪN phải hỏi — không được nới nhầm sang ca này.
    const R2 = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,2,'female','B',1200000,'shared') RETURNING id`, [P + '_R2', fac])).rows[0].id;
    const C = (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,facility_id)
       VALUES ($1,$1,'female',$2,'2026-05-01','in','ghep','unregistered',$3) RETURNING id`,
      [P + '_C', R2, fac])).rows[0].id;
    const c = await doc(C);
    const chuyen = await t.api('PUT', `/api/students/${C}`, T, {
      name: c.name, code: c.code, gender: c.gender, room_id: R,
      check_in_date: String(c.check_in_date || '').slice(0, 10),
      rental_type: c.rental_type, residency_status: c.residency_status, _v: c._v,
    });
    t.eq('Người ĐANG Ở chuyển vào phòng đã đầy → VẪN chặn hỏi xác nhận', chuyen.status, 409,
      `HTTP ${chuyen.status} — ${JSON.stringify(chuyen.json)}`);

    await clean(t.db);
  },
};
