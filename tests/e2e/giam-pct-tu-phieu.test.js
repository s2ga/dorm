// BL-101: % giảm giá lưu ở HỒ SƠ nhưng chỗ SỬA nằm ở phiếu (form ✎ màn Tiền phòng). Đường dữ liệu:
// PUT /students/:id chỉ gửi các cột % (merge, không đụng cột khác) rồi POST /invoices/:id/recalc —
// phiếu phải áp % mới; đưa % về 0 là hết giảm. Owner 04/09: "tự điều chỉnh giảm, không chết luôn".
const P = '__test_gpct';

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Giảm giá % — sửa từ phiếu, lưu vào hồ sơ, tính lại phiếu (BL-101)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;
    const sid = (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type)
       VALUES ($1,$2,'male',$3,'2026-05-01','in','ghep') RETURNING id`, [P + '_A', P + ' Giảm', rid])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-05-01')`, [sid, rid]);
    const inv = (await t.db.query(
      `INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, total, status)
       VALUES ($1,$2,'2026-05',31,1200000,1200000,'pending') RETURNING id`, [sid, rid])).rows[0].id;

    // ── Đặt 10% giảm tiền phòng: PUT chỉ gửi cột %, các cột khác giữ nguyên ──────────────
    const p1 = await t.api('PUT', `/api/students/${sid}`, T, { room_fee_discount_pct: 10 });
    t.eq('PUT hồ sơ chỉ với cột % → 200 (merge, không đòi field khác)', p1.status, 200, `HTTP ${p1.status} ${p1.json && p1.json.error || ''}`);
    const hs = (await t.db.query(`SELECT room_fee_discount_pct, check_in_date::text ci, room_id FROM students WHERE id=$1`, [sid])).rows[0];
    t.ok('% lưu vào hồ sơ, ngày vào + phòng không suy suyển', +hs.room_fee_discount_pct === 10 && hs.ci === '2026-05-01' && hs.room_id === rid, JSON.stringify(hs));

    const rc1 = await t.api('POST', `/api/invoices/${inv}/recalc`, T);
    t.eq('Tính lại phiếu → 200', rc1.status, 200, `HTTP ${rc1.status} ${rc1.json && rc1.json.error || ''}`);
    const i1 = (await t.db.query(`SELECT room_charge, room_discount, total FROM invoices WHERE id=$1`, [inv])).rows[0];
    t.eq('Phiếu áp đúng 10% giảm tiền phòng (120.000)', +i1.room_discount, 120000, JSON.stringify(i1));

    // ── Đưa về 0 = thôi giảm; tổng hai bản chênh nhau đúng khoản giảm ────────────────────
    const p0 = await t.api('PUT', `/api/students/${sid}`, T, { room_fee_discount_pct: 0 });
    t.eq('Đưa % về 0 → 200', p0.status, 200);
    await t.api('POST', `/api/invoices/${inv}/recalc`, T);
    const i0 = (await t.db.query(`SELECT room_discount, total FROM invoices WHERE id=$1`, [inv])).rows[0];
    t.eq('Phiếu hết khoản giảm', +i0.room_discount, 0, JSON.stringify(i0));
    t.eq('Tổng không-giảm cao hơn tổng có-giảm đúng 120.000', +i0.total - +i1.total, 120000,
      `${i0.total} - ${i1.total}`);

    await clean(t.db);
  },
};
