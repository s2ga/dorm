// Điện phòng THUÊ NGUYÊN: trọn công-tơ lên phiếu người ký HĐ, không chia đầu người (owner 03/09:
// "các bạn thuê theo phòng thì đã chốt số điện với trưởng phòng rồi"). Vì vậy người rời giữa kỳ
// KHÔNG cần mốc chốt công-tơ — lập phiếu không được treo cả phòng vì thiếu mốc đó. Phòng ghép giữ luật cũ.
const P = '__test_dnp';
const KY = '2026-05';      // kỳ lập phiếu
const KY_DIEN = '2026-04'; // kỳ điện (lùi một kỳ)

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM meter_reads WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Điện phòng thuê nguyên — trọn công-tơ cho người ký HĐ, không đòi mốc giữa kỳ',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    const mkRoom = async (ten, loai) => (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,4,'female','B',1200000,$3) RETURNING id`, [ten, fac, loai])).rows[0].id;
    const mkStu = async (ma, room, rental, ci, co, hd) => {
      const id = (await t.db.query(
        `INSERT INTO students (code,name,gender,room_id,check_in_date,check_out_date,status,rental_type,residency_status,contract_no)
         VALUES ($1,$1,'female',$2,$3,$4,$5,$6,'unregistered',$7) RETURNING id`,
        [ma, co ? null : room, ci, co, co ? 'out' : 'in', rental, hd || ''])).rows[0].id;
      await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,$3,$4)`, [id, room, ci, co]);
      return id;
    };

    // Phòng THUÊ NGUYÊN: chủ HĐ + 1 người ở cùng còn ở + 1 người RỜI GIỮA KỲ ĐIỆN, không có mốc chốt
    const rNP = await mkRoom(P + '_NP', 'whole');
    const chu = await mkStu(P + '_chu', rNP, 'phong', '2026-04-01', null, 'HD-' + P);
    const cung = await mkStu(P + '_cung', rNP, 'ghep', '2026-04-01', null);
    await mkStu(P + '_roi', rNP, 'ghep', '2026-04-01', '2026-04-15');
    await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,0,100,100)`, [rNP, KY_DIEN]);

    // Phòng GHÉP đối chứng: cũng có người rời giữa kỳ không mốc chốt -> PHẢI còn bị treo như cũ
    const rG = await mkRoom(P + '_G', 'shared');
    const g1 = await mkStu(P + '_g1', rG, 'ghep', '2026-04-01', null);
    await mkStu(P + '_g2', rG, 'ghep', '2026-04-01', '2026-04-20');
    await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,0,50,50)`, [rG, KY_DIEN]);

    // ── Màn "Chốt giữa kỳ" không được nhắc phòng thuê nguyên, vẫn nhắc phòng ghép ─────────
    const reads = await t.api('GET', `/api/electric/reads?month=${KY_DIEN}`, T);
    t.eq('Đọc danh sách chốt giữa kỳ', reads.status, 200, `HTTP ${reads.status}`);
    const thieuRooms = (reads.json.missing || []).map(x => x.room_name);
    t.ok('Phòng thuê nguyên KHÔNG bị nhắc chốt giữa kỳ', !thieuRooms.includes(P + '_NP'), thieuRooms.join(', ') || 'trống');
    t.ok('Phòng ghép VẪN bị nhắc như cũ', thieuRooms.includes(P + '_G'), thieuRooms.join(', ') || 'trống');

    // ── Lập phiếu kỳ 05 ──────────────────────────────────────────────────────────────────
    const g = await t.api('POST', '/api/invoices/generate', T, { month: KY });
    t.eq('Lập phiếu chạy được', g.status, 200, `HTTP ${g.status} ${g.json && g.json.error || ''}`);
    const wNP = (g.json.warnings || []).filter(w => w.includes(P + '_NP'));
    t.eq('Phòng thuê nguyên KHÔNG bị treo vì thiếu mốc ngày rời', wNP.length, 0, JSON.stringify(g.json.warnings));
    const wG = (g.json.warnings || []).filter(w => w.includes(P + '_G'));
    t.ok('Phòng ghép thiếu mốc VẪN bị cảnh báo + bỏ qua (luật cũ giữ nguyên)',
      wG.length === 1 && /2026-04-20/.test(wG[0]), JSON.stringify(wG));

    const unit = +((await t.api('GET', '/api/settings', T)).json.electric_unit || 0);
    const invChu = (await t.db.query(`SELECT electric_kwh, electric_charge, deleted_at FROM invoices WHERE student_id=$1 AND month=$2`, [chu, KY])).rows[0];
    t.ok('Chủ HĐ có phiếu kỳ 05', !!invChu && !invChu.deleted_at, JSON.stringify(invChu));
    t.eq('Phiếu chủ HĐ ăn TRỌN 100 kWh của phòng', invChu && +invChu.electric_kwh, 100, JSON.stringify(invChu));
    t.eq('Tiền điện = 100 kWh × đơn giá', invChu && +invChu.electric_charge, Math.round(100 * unit), `unit=${unit} · ${JSON.stringify(invChu)}`);

    const invCung = (await t.db.query(`SELECT id FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [cung, KY])).rows;
    t.eq('Người ở cùng không có phiếu riêng (tiền đã gộp vào chủ HĐ)', invCung.length, 0);
    const invG1 = (await t.db.query(`SELECT id FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [g1, KY])).rows;
    t.eq('Người phòng ghép thiếu mốc → vẫn CHƯA có phiếu (chờ nhập mốc)', invG1.length, 0);

    await clean(t.db);
  },
};
