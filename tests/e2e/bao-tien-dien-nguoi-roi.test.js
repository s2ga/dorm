const P = '__test_btd';
const UNIT = 3500;

async function clean(db) {
  await db.query(`DELETE FROM invoices        WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM meter_reads     WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays      WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs            WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Báo tiền điện cho học viên check out giữa tháng',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    await t.db.query(`UPDATE settings SET value=$1 WHERE key='electric_unit'`, [String(UNIT)]);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const R = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,4,'male','B',1200000,'shared') RETURNING id`, [P + '_R', fac])).rows[0].id;
    const mkStu = async n => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,facility_id)
       VALUES ($1,$1,'male',$2,'2026-06-01','in','ghep','unregistered',$3) RETURNING id`, [P + n, R, fac])).rows[0].id;
    const phieu = async (id, m) => (await t.db.query(
      `SELECT electric_kwh, electric_charge FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`,
      [id, m])).rows[0] || {};

    const A = await mkStu('_A'), B = await mkStu('_B'), C = await mkStu('_C');
    for (const s of [A, B, C]) {
      await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-06-01')`, [s, R]);
    }
    await t.db.query(
      `INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,'2026-06',1000,1300,300)`, [R]);

    const co = await t.api('POST', `/api/students/${A}/checkout`, T,
      { date: '2026-07-08', reason: 'personal', meter_reading: 1450 });
    t.eq('Check-out kèm chốt chỉ số → 200', co.status, 200, `HTTP ${co.status} — ${(co.json && co.json.error) || ''}`);

    const lap = await t.api('POST', '/api/invoices/generate-one', T, { student_id: A, month: '2026-07' });
    t.eq('Lập phiếu cuối cho người vừa rời → 200', lap.status, 200,
      `HTTP ${lap.status} — ${(lap.json && lap.json.error) || ''}`);

    // Tay: kỳ 06 thu lùi 300/3 = 100,00 · kỳ 07 tới ngày rời (chặng 01–08/07 = 150 kWh) chia 3 = 50,00
    const pA = await phieu(A, '2026-07');
    t.eq('Phiếu cuối gồm CẢ điện kỳ trước LẪN phần tới ngày rời = 150,00 kWh',
      Number(pA.electric_kwh), 150, `được ${pA.electric_kwh}`);
    t.eq('Thành tiền = 525.000đ', Number(pA.electric_charge), 150 * UNIT, `được ${pA.electric_charge}`);

    await t.api('POST', '/api/invoices/generate-one', T, { student_id: B, month: '2026-07' });
    const pB7 = await phieu(B, '2026-07');
    t.eq('Người ở tiếp: phiếu kỳ 07 chỉ có điện kỳ 06 = 100,00 kWh', Number(pB7.electric_kwh), 100,
      `được ${pB7.electric_kwh}`);

    await t.db.query(
      `INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,'2026-07',1300,1600,300)`, [R]);
    const g8 = await t.api('POST', '/api/invoices/generate', T, { month: '2026-08' });
    t.eq('Lập hàng loạt kỳ 08 → 200', g8.status, 200, `HTTP ${g8.status}`);
    const pA8 = await phieu(A, '2026-08');
    t.ok('Người ĐÃ RỜI không có phiếu kỳ 08 — đã thu ở phiếu cuối rồi', pA8.electric_kwh === undefined,
      `A vẫn có phiếu kỳ 08: ${pA8.electric_kwh} kWh`);

    const pB8 = await phieu(B, '2026-08'), pC8 = await phieu(C, '2026-08');
    const tong07 = 50 + Number(pB8.electric_kwh || 0) + Number(pC8.electric_kwh || 0);
    t.eq('Σ kWh kỳ 07 (A ở phiếu cuối + B,C ở phiếu kỳ 08) = 300,00 khối phòng', tong07, 300,
      `50 + ${pB8.electric_kwh} + ${pC8.electric_kwh} = ${tong07}`);

    await clean(t.db);
  },
};
