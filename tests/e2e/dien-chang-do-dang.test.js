// Chặng đã có mốc đóng thì tính được ngay, không đợi hết kỳ; mỗi chặng chia theo đúng số người
// của chặng đó (owner chốt 10/08/2026).
const P = '__test_cdd';
const KY_DIEN = '2026-06';
const KY_PHIEU = '2026-07';   // phiếu kỳ 07 mang khối điện kỳ 06
const DON_GIA = 3000;

async function clean(db) {
  await db.query(`DELETE FROM invoices     WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM meter_reads  WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs         WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Điện chặng dở dang — tính được phần người rời/chuyển giữa kỳ',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    await t.db.query(`UPDATE settings SET value=$1 WHERE key='electric_unit'`, [String(DON_GIA)]);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const mkRoom = async n => (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,6,'male','B',1200000,'shared') RETURNING id`, [P + n, fac])).rows[0].id;
    const mkStu = async (n, ra) => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,check_out_date,status,rental_type,residency_status,facility_id)
       VALUES ($1,$1,'male',$2,'2026-05-01',$3,$4,'ghep','unregistered',$5) RETURNING id`,
      [P + n, null, ra, ra ? 'out' : 'in', fac])).rows[0].id;
    const stay = (id, room, tu, den) => t.db.query(
      `INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,$3,$4)`, [id, room, tu, den]);
    const chotKy = (room, ky, dau, cuoi) => t.db.query(
      `INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh)
       VALUES ($1,$2,$3,$4,$5)`, [room, ky, dau, cuoi, cuoi - dau]);
    const chotGiua = (room, ngay, so) => t.db.query(
      `INSERT INTO meter_reads (room_id, read_date, reading, reason) VALUES ($1,$2,$3,'checkout')`, [room, ngay, so]);
    const lap = (id, month) => t.api('POST', '/api/invoices/generate-one', T, { student_id: id, month });
    const soDien = async id => (await t.db.query(
      `SELECT electric_kwh, electric_charge FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`,
      [id, KY_PHIEU])).rows[0] || {};

    // ══ Bố cục: A chuyển phòng X -> Y ngày 11/06. X có 4 người chặng đầu, Y có 3 người ══
    const X = await mkRoom('_X'), Y = await mkRoom('_Y');
    const A = await mkStu('_A', null);                       // chuyển X->Y, vẫn đang ở
    const X2 = await mkStu('_X2', null), X3 = await mkStu('_X3', null), X4 = await mkStu('_X4', null);
    const Y2 = await mkStu('_Y2', null), Y3 = await mkStu('_Y3', null);
    await stay(A, X, '2026-05-01', '2026-06-10');            // chặng X: 01–10/06
    await stay(A, Y, '2026-06-11', null);                    // chặng Y: 11/06 trở đi
    for (const s of [X2, X3, X4]) await stay(s, X, '2026-05-01', null);
    for (const s of [Y2, Y3]) await stay(s, Y, '2026-05-01', null);

    // X: đầu kỳ 06 = 100 (lấy từ chốt kỳ 05), chốt lúc A chuyển đi 11/06 = 400  -> chặng 300 kWh
    // X CHƯA chốt cuối kỳ 06.  Y: chốt đủ kỳ 06 = 90 kWh.
    await chotKy(X, '2026-05', 0, 100);
    await chotGiua(X, '2026-06-11', 400);
    await chotKy(Y, '2026-06', 0, 90);

    const r = await lap(A, KY_PHIEU);
    t.eq('Chuyển phòng giữa kỳ, phòng cũ chưa chốt → VẪN lập được phiếu', r.status, 200,
      `HTTP ${r.status} — ${(r.json && r.json.error) || ''}`);

    // Tính tay theo NGÀY Ở của từng chặng:
    //   chặng X [01–11/06] 300 kWh · A ở 10 ngày, X2/X3/X4 mỗi người 11 -> A = 300×10/43 = 69,77
    //   chặng Y [01–30/06] 90 kWh · A ở 20 ngày, Y2/Y3 mỗi người 30 -> A = 90×20/80 = 22,50
    const A_X = 300 * 10 / 43, A_Y = 90 * 20 / 80;
    const mongDoi = Math.round((A_X + A_Y) * 100) / 100;
    const d = await soDien(A);
    t.eq(`Phần điện của A = ${mongDoi} kWh — chia theo NGÀY Ở từng chặng, không chia đều`,
      Number(d.electric_kwh), mongDoi, `nhận được ${d.electric_kwh}`);
    t.ok('Tiền điện suy từ đúng số kWh đó', Math.abs(Number(d.electric_charge) - mongDoi * DON_GIA) <= 1,
      `${d.electric_charge} vs ${mongDoi}×${DON_GIA}`);

    // ══ Chốt nốt cuối kỳ phòng X -> phần ĐÃ TÍNH của A không được đổi ══
    await chotKy(X, '2026-06', 100, 900);   // cả kỳ 800 kWh; chặng sau 11/06 là 500 kWh, A không có mặt
    const r2 = await lap(A, KY_PHIEU);
    t.eq('Lập lại sau khi chốt cuối kỳ → 200', r2.status, 200, `HTTP ${r2.status}`);
    const d2 = await soDien(A);
    t.eq('Chặng đã đóng KHÔNG đổi số khi kỳ đóng sổ', Number(d2.electric_kwh), Number(d.electric_kwh),
      `trước ${d.electric_kwh} · sau ${d2.electric_kwh}`);

    // ══ TỔNG phòng X phải khớp tuyệt đối ══
    for (const s of [X2, X3, X4]) {
      const rr = await lap(s, KY_PHIEU);
      t.eq(`Lập phiếu cho người ở phòng X → 200`, rr.status, 200, `HTTP ${rr.status} — ${(rr.json && rr.json.error) || ''}`);
    }
    const tongX = (await t.db.query(
      `SELECT COALESCE(SUM(electric_kwh),0)::numeric s FROM invoices
        WHERE month=$1 AND deleted_at IS NULL AND student_id = ANY($2)`,
      [KY_PHIEU, [A, X2, X3, X4]])).rows[0].s;
    // A chỉ đóng góp 75 kWh vào phòng X (22,5 còn lại là của phòng Y)
    t.eq('Tổng kWh chia ra từ phòng X khớp TUYỆT ĐỐI khối 800 kWh', Number(tongX) - 22.5, 800,
      `tổng gồm cả phần Y của A = ${tongX}`);

    // ══ Phòng KHÔNG có mốc đầu nào thì vẫn phải CHẶN, không được ra phiếu 0đ ══
    const Z = await mkRoom('_Z');
    const B = await mkStu('_B', '2026-06-15');
    await stay(B, Z, '2026-05-01', '2026-06-15');
    await chotGiua(Z, '2026-06-15', 250);
    const rz = await lap(B, KY_PHIEU);
    t.eq('Phòng chưa có mốc đầu kỳ → CHẶN, không ra phiếu 0đ', rz.status, 400, `HTTP ${rz.status}`);
    t.ok('Nói rõ thiếu mốc đầu', String((rz.json && rz.json.error) || '').includes('mốc đầu'),
      String((rz.json && rz.json.error) || ''));

    // ══ Mốc chốt rơi ĐÚNG ngày cuối kỳ vẫn phải được nhận ══
    const M = await mkRoom('_M');
    const M1 = await mkStu('_M1', '2026-06-29'), M2 = await mkStu('_M2', null);
    await stay(M1, M, '2026-05-01', '2026-06-29'); await stay(M2, M, '2026-05-01', null);
    await chotKy(M, '2026-05', 0, 1000);
    await chotGiua(M, '2026-06-15', 1100);
    await chotGiua(M, '2026-06-30', 1200);   // đúng ngày cuối tháng
    const rm = await lap(M1, KY_PHIEU);
    t.eq('Mốc ngày cuối kỳ → lập được phiếu', rm.status, 200, `HTTP ${rm.status} — ${(rm.json && rm.json.error) || ''}`);
    const dm = await soDien(M1);
    // chặng 01–15 (100 kWh, 2 người đủ 15 ngày) = 50 · chặng 16–30 (100 kWh, M1 14/29 ngày) = 48,28
    t.ok('Chặng CUỐI không bị vứt — phần của M1 phải > 50 kWh', Number(dm.electric_kwh) > 50,
      `nhận được ${dm.electric_kwh} (vứt chặng cuối thì đúng 50)`);
    // M2 ở tới hết kỳ nên chưa lập được khi kỳ chưa chốt — chốt xong mới đối tổng.
    const rm2 = await lap(M2, KY_PHIEU);
    t.eq('Người ở tới hết kỳ vẫn bị chặn khi kỳ chưa chốt', rm2.status, 400, `HTTP ${rm2.status}`);
    await chotKy(M, KY_DIEN, 1000, 1200);
    await lap(M2, KY_PHIEU);
    await lap(M1, KY_PHIEU);
    const tongM = (await t.db.query(
      `SELECT COALESCE(SUM(electric_kwh),0)::numeric s FROM invoices
        WHERE month=$1 AND deleted_at IS NULL AND student_id = ANY($2)`, [KY_PHIEU, [M1, M2]])).rows[0].s;
    t.eq('Chốt kỳ xong → tổng khớp tuyệt đối khối 200 kWh', Number(tongM), 200, `tổng ${tongM}`);

    // ══ Chỉ số LÙI: không được ra phiếu 0đ ══
    const L = await mkRoom('_L');
    const L1 = await mkStu('_L1', '2026-06-09');
    await stay(L1, L, '2026-05-01', '2026-06-09');
    await chotKy(L, '2026-05', 0, 1000);
    await chotGiua(L, '2026-06-09', 950);   // lùi so với mốc đầu 1000
    const rl = await lap(L1, KY_PHIEU);
    t.ok('Chỉ số lùi → KHÔNG phát hành phiếu 0đ', rl.status !== 200 || Number((await soDien(L1)).electric_kwh) > 0,
      `HTTP ${rl.status} · kwh ${(await soDien(L1)).electric_kwh}`);

    // ══ Chốt kỳ hàng loạt phải KÉO phiếu lập sớm tính lại ══
    const rb = await t.api('POST', '/api/electric/bulk', T,
      { month: KY_DIEN, readings: [{ room_id: X, reading_start: 100, reading_end: 900 }] });
    t.eq('Chốt kỳ hàng loạt → 200', rb.status, 200, `HTTP ${rb.status} — ${(rb.json && rb.json.error) || ''}`);
    t.ok('Có tính lại phiếu sau khi chốt kỳ', Number((rb.json || {}).recalculated) > 0,
      `recalculated = ${(rb.json || {}).recalculated}`);

    await clean(t.db);
  },
};
