// Owner 05/09: lượt VÀO-RA CÙNG NGÀY — chặng điện dài 0 ngày, đòi mốc chốt công-tơ là vô nghĩa mà
// lại chặn cả phòng khi lập hoá đơn. Bỏ đòi mốc cho lượt cùng-ngày ở cả 3 cổng; lượt rời NHIỀU
// NGÀY của hồ sơ BÌNH THƯỜNG vẫn đòi như cũ (hồ sơ khoá thì đã đứng ngoài — bài thieu-dien-neu-ro-ten).
const P = '__test_vrcn';
const KY = '2026-05';
const KY_DIEN = '2026-04';

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM meter_reads WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Vào-ra cùng ngày (hồ sơ khoá) — không đòi mốc công-tơ, không chặn phòng',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const mkRoom = async ten => (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
      [ten, fac])).rows[0].id;
    const mkStu = async (ma, rid, tu, den, khoa) => {
      const id = (await t.db.query(
        `INSERT INTO students (code,name,gender,room_id,check_in_date,check_out_date,status,rental_type,deleted_at)
         VALUES ($1,$1,'male',$2,$3,$4,$5,'ghep',$6) RETURNING id`,
        [ma, den ? null : rid, tu, den, den ? 'out' : 'in', khoa ? new Date() : null])).rows[0].id;
      await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,$3,$4)`, [id, rid, tu, den]);
      return id;
    };

    // Phòng 1: A ở lại + B vào-ra CÙNG NGÀY 15/04 rồi bị khoá hồ sơ, không có mốc chốt
    const r1 = await mkRoom(P + '_R1');
    const A = await mkStu(P + '_A', r1, '2026-04-01', null, false);
    await mkStu(P + '_B', r1, '2026-04-15', '2026-04-15', true);
    await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,0,60,60)`, [r1, KY_DIEN]);

    // Phòng 2 (đối chứng): D ở lại + C rời NHIỀU NGÀY (10→20/04, hồ sơ thường) không mốc -> vẫn phải đòi
    const r2 = await mkRoom(P + '_R2');
    await mkStu(P + '_D', r2, '2026-04-01', null, false);
    await mkStu(P + '_C', r2, '2026-04-10', '2026-04-20', false);
    await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,0,50,50)`, [r2, KY_DIEN]);

    // ── Màn Chốt giữa kỳ: lượt cùng-ngày KHÔNG bị nhắc; lượt nhiều ngày vẫn nhắc ─────────
    const reads = await t.api('GET', `/api/electric/reads?month=${KY_DIEN}`, T);
    const thieu = (reads.json.missing || []).map(x => x.room_name);
    t.ok('Lượt vào-ra cùng ngày KHÔNG bị nhắc chốt', !thieu.includes(P + '_R1'), thieu.join(', ') || 'trống');
    t.ok('Lượt rời nhiều ngày (hồ sơ thường) VẪN bị nhắc', thieu.includes(P + '_R2'), thieu.join(', ') || 'trống');

    // ── Lập hoá đơn: phòng 1 chạy trơn, phòng 2 vẫn bị treo chờ mốc ──────────────────────
    const g = await t.api('POST', '/api/invoices/generate', T, { month: KY });
    t.eq('Lập phiếu → 200', g.status, 200, `HTTP ${g.status} ${g.json && g.json.error || ''}`);
    const w1 = (g.json.warnings || []).filter(w => w.includes(P + '_R1'));
    t.eq('Phòng có lượt cùng-ngày KHÔNG bị cảnh báo/chặn', w1.length, 0, JSON.stringify(g.json.warnings || []));
    const w2 = (g.json.warnings || []).filter(w => w.includes(P + '_R2'));
    t.ok('Phòng có lượt rời nhiều ngày vẫn bị cảnh báo như cũ', w2.length === 1 && /2026-04-20/.test(w2[0]), JSON.stringify(w2));
    const invA = (await t.db.query(`SELECT id FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [A, KY])).rows;
    t.eq('Người ở lại phòng 1 ra được phiếu', invA.length, 1);

    await clean(t.db);
  },
};
