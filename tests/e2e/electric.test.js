// TC-10 e2e — điện thu LÙI MỘT KỲ (chốt 31/07/2026): phiếu kỳ M mang tiền điện kỳ M-1.
// Chuyển phòng / trả phòng giữa tháng: tiền điện có đi ĐÚNG NGƯỜI không, tổng có rơi đồng nào không,
// và phòng thiếu chỉ số có bị BỎ QUA kèm cảnh báo không. Chạy trên CSDL thật, tự dọn sạch.
const { fmt } = require('../lib/harness');

const M = '2026-07', M2 = '2026-08', UNIT = 3500;
const P = '__test_dien'; // tiền tố để dọn — không đụng dữ liệu thật

async function clean(db) {
  await db.query(`DELETE FROM invoices    WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays  WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs        WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM meter_reads       WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Tiền điện e2e — thu lùi một kỳ + chốt chỉ số lúc rời phòng (TC-10)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);

    const oldUnit = (await t.db.query(`SELECT value FROM settings WHERE key='electric_unit'`)).rows[0];
    await t.db.query(`UPDATE settings SET value=$1 WHERE key='electric_unit'`, [String(UNIT)]);

    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const mkRoom = async n => (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,8,'male','B',1000000) RETURNING id`,
      [P + n, fac])).rows[0].id;
    const mkStu = async (n, room) => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status)
       VALUES ($1,$1,'male',$2,'2026-07-01','in','ghep','unregistered') RETURNING id`, [P + n, room])).rows[0].id;
    const stay = (id, room) => t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,'2026-07-01',NULL)`, [id, room]);
    const meter = (room, end) => t.db.query(`INSERT INTO electric_readings (room_id,month,reading_start,reading_end,kwh) VALUES ($1,$2,0,$3,$3)`, [room, M, end]);
    const elec = async (ids, month) => {
      const o = {};
      (await t.db.query(`SELECT student_id, electric_charge FROM invoices WHERE month=$1 AND student_id = ANY($2) AND deleted_at IS NULL`, [month, ids]))
        .rows.forEach(r => { o[r.student_id] = Number(r.electric_charge); });
      return o;
    };

    try {
      // ===== CHUYỂN PHÒNG giữa tháng — phòng A dùng 300 kWh kỳ 07, X chuyển đi 15/07, chốt 100 kWh.
      // Điện kỳ 07 lên PHIẾU KỲ 08 (điện thu lùi một kỳ, tiền phòng thu trước).
      const RA = await mkRoom('_A'), RB = await mkRoom('_B');
      const A1 = await mkStu('_A1', RA), A2 = await mkStu('_A2', RA), X = await mkStu('_X', RA);
      for (const id of [A1, A2, X]) await stay(id, RA);
      await meter(RA, 300); await meter(RB, 0);

      const tr = await t.api('POST', `/api/students/${X}/transfer`, T, { room_id: RB, date: '2026-07-15', meter_reading: 100 });
      t.ok('Chuyển phòng kèm chốt chỉ số → OK', tr.status === 200, `HTTP ${tr.status}`);

      const stays = (await t.db.query(`SELECT room_id, from_date, to_date FROM room_stays WHERE student_id=$1 ORDER BY from_date`, [X])).rows;
      t.ok('Giữ được dấu vết phòng CŨ (trước đây chuyển phòng là mất sạch)',
        stays.length === 2 && stays[0].room_id === RA && stays[0].to_date === '2026-07-14' && stays[1].room_id === RB,
        JSON.stringify(stays));

      const g7 = await t.api('POST', '/api/invoices/generate', T, { month: M });
      t.ok('Lập phiếu kỳ 07 chạy được (điện kỳ 06 = 0, chưa ai bị tính)', g7.status === 200, `HTTP ${g7.status}`);
      const e7 = await elec([A1, A2, X], M);
      t.ok('Phiếu kỳ 07 KHÔNG mang điện kỳ 07 (điện thu lùi một kỳ)',
        (e7[A1] || 0) === 0 && (e7[A2] || 0) === 0 && (e7[X] || 0) === 0,
        `A1=${fmt(e7[A1] || 0)} A2=${fmt(e7[A2] || 0)} X=${fmt(e7[X] || 0)}`);

      const g8 = await t.api('POST', '/api/invoices/generate', T, { month: M2 });
      t.ok('Lập phiếu kỳ 08 chạy được', g8.status === 200, `HTTP ${g8.status}`);
      // CSDL dev còn phòng THẬT khác có thể thiếu chỉ số — chỉ soi cảnh báo của phòng test.
      t.ok('Phòng test không bị bỏ qua (chỉ số đầy đủ)', !(g8.json.warnings || []).some(w => w.includes(P)),
        JSON.stringify((g8.json.warnings || []).filter(w => w.includes(P))));

      const e = await elec([A1, A2, X], M2);
      // Chặng 1 (01→15/07): 100kWh = 350.000 — A1,A2 15 ngày + X 14 ngày (chuyển đi = hết ngày 14)
      // Chặng 2 (16→31/07): 200kWh = 700.000 — chỉ A1, A2
      t.ok('X VẪN PHẢI TRẢ phần điện đã dùng ở phòng cũ — trên phiếu kỳ 08', e[X] > 0, `X = ${fmt(e[X])}`);
      t.near('X trả đúng phần chặng 1 theo ngày ở (≈111.364)', e[X], 111364, 2);
      t.near('A1 không gánh thay (≈469.318)', e[A1], 469318, 2);
      t.near('A2 không gánh thay (≈469.318)', e[A2], 469318, 2);
      t.eq('TỔNG 3 phiếu kỳ 08 = ĐÚNG tiền điện kỳ 07 phòng A, không rơi đồng nào', e[A1] + e[A2] + e[X], 300 * UNIT,
        `tổng ${fmt(e[A1] + e[A2] + e[X])} · phải ${fmt(300 * UNIT)}`);

      // ===== Chốt chỉ số SAI — phải chặn, và KHÔNG được chuyển phòng nửa vời
      for (const [nhan, val, vi] of [
        ['nhỏ hơn lần chốt trước (100)', 50, 'công-tơ không quay ngược được'],
        ['lớn hơn chỉ số cuối tháng (300)', 999, 'vượt chỉ số cuối tháng'],
        ['số âm', -5, 'chỉ số âm'],
        ['chữ "abc"', 'abc', 'không được âm thầm thành 0'],
      ]) {
        const r = await t.api('POST', `/api/students/${A1}/transfer`, T, { room_id: RB, date: '2026-07-20', meter_reading: val });
        t.ok(`Chốt chỉ số ${nhan} → phải CHẶN (${vi})`, r.status === 400, `HTTP ${r.status} — ${r.json && r.json.error}`);
      }
      const a1now = (await t.db.query('SELECT room_id FROM students WHERE id=$1', [A1])).rows[0];
      t.eq('Chốt chỉ số hỏng → KHÔNG được chuyển phòng nửa vời', a1now.room_id, RA, `A1 vẫn ở phòng ${a1now.room_id === RA ? 'cũ ✔' : 'MỚI ✘'}`);

      const same = await t.api('POST', `/api/students/${A1}/transfer`, T, { room_id: RA, date: '2026-07-20' });
      t.ok('Chuyển vào CHÍNH phòng đang ở → phải CHẶN', same.status === 400, `HTTP ${same.status} — ${same.json && same.json.error}`);

      // ===== TRẢ PHÒNG giữa tháng có chốt chỉ số: phần kỳ 07 của người rời lên PHIẾU CUỐI (kỳ 07,
      // qua tính lại lúc check-out), phần còn lại của người ở lên phiếu kỳ 08.
      await clean(t.db);
      const RC = await mkRoom('_C');
      const C1 = await mkStu('_C1', RC), C2 = await mkStu('_C2', RC);
      for (const id of [C1, C2]) await stay(id, RC);
      await meter(RC, 300);
      await t.api('POST', '/api/invoices/generate', T, { month: M });

      const co = await t.api('POST', `/api/students/${C2}/checkout`, T, { date: '2026-07-15', reason: 'personal', meter_reading: 100 });
      t.ok('Trả phòng kèm chốt chỉ số → OK', co.status === 200, `HTTP ${co.status}`);
      t.ok('Trả phòng → TỰ tính lại phiếu cho bạn cùng phòng ở lại',
        co.json && (co.json.recalced_roommates || []).includes(C1), 'tính lại cho: ' + JSON.stringify(co.json && co.json.recalced_roommates));

      const eC7 = await elec([C1, C2], M);
      // Chặng 1 (01→15/07): 100kWh = 350.000, C1 và C2 mỗi người 15 ngày -> 175.000/người.
      t.eq('Người rời 15/07: phiếu CUỐI (kỳ 07) mang đúng phần điện tới ngày rời = 175.000', eC7[C2], 175000, `được ${fmt(eC7[C2])}`);
      t.eq('Người ở lại: phiếu kỳ 07 KHÔNG mang điện kỳ 07 (sẽ lên phiếu kỳ 08)', eC7[C1] || 0, 0, `được ${fmt(eC7[C1] || 0)}`);

      const gC8 = await t.api('POST', '/api/invoices/generate', T, { month: M2 });
      t.ok('Lập phiếu kỳ 08 không bỏ qua phòng test (chỉ số ngày rời ĐÃ có)', !(gC8.json.warnings || []).some(w => w.includes(P)),
        JSON.stringify((gC8.json.warnings || []).filter(w => w.includes(P))));
      const eC8 = await elec([C1, C2], M2);
      t.eq('Người ở lại nhận phần kỳ 07 trên phiếu kỳ 08 = 175.000 + 700.000', eC8[C1], 875000, `được ${fmt(eC8[C1])}`);
      t.ok('Người ĐÃ RỜI không có phiếu kỳ 08', eC8[C2] === undefined, `C2 = ${eC8[C2]}`);
      t.eq('TỔNG (phiếu cuối C2 + phiếu 08 C1) khớp tuyệt đối tiền điện kỳ 07', eC7[C2] + eC8[C1], 300 * UNIT,
        `tổng ${fmt(eC7[C2] + eC8[C1])}`);

      // ===== QUÊN nhập chỉ số lúc trả phòng -> kỳ sau phòng bị BỎ QUA kèm cảnh báo,
      // nhập bù qua /api/electric/reads rồi chạy lại là đủ.
      await clean(t.db);
      const RD = await mkRoom('_D');
      const D1 = await mkStu('_D1', RD), D2 = await mkStu('_D2', RD);
      for (const id of [D1, D2]) await stay(id, RD);
      await meter(RD, 300);
      const co2 = await t.api('POST', `/api/students/${D2}/checkout`, T, { date: '2026-07-15', reason: 'personal' });
      t.ok('Không nhập chỉ số → vẫn trả phòng được (không bắt buộc lúc check-out)', co2.status === 200, `HTTP ${co2.status}`);

      const gD = await t.api('POST', '/api/invoices/generate', T, { month: M2 });
      t.ok('Kỳ 08: phòng thiếu chỉ số ngày rời → BỎ QUA + cảnh báo (không chia bừa)',
        gD.status === 200 && (gD.json.skipped_missing || 0) >= 1
          && (gD.json.warnings || []).some(w => w.includes(P + '_D') && w.includes('2026-07-15')),
        `skipped_missing=${gD.json.skipped_missing} warnings=${JSON.stringify(gD.json.warnings || [])}`);
      const eD0 = await elec([D1, D2], M2);
      t.ok('Chưa nhập bù thì D1 CHƯA có phiếu kỳ 08 (không âm thầm tính sai)', eD0[D1] === undefined, `D1 = ${eD0[D1]}`);

      // Nhập bù chỉ số ngày rời (số ghi trên giấy lúc bàn giao) qua API mới
      const mr = await t.api('POST', '/api/electric/reads', T, { room_id: RD, date: '2026-07-15', reading: 100, student_id: D2 });
      t.ok('Nhập bù chỉ số ngày rời qua /api/electric/reads → OK', mr.status === 200, `HTTP ${mr.status} — ${mr.json && mr.json.error}`);

      const gD2 = await t.api('POST', '/api/invoices/generate', T, { month: M2 });
      t.ok('Nhập bù xong → phòng test hết cảnh báo', !(gD2.json.warnings || []).some(w => w.includes(P)),
        JSON.stringify((gD2.json.warnings || []).filter(w => w.includes(P))));
      const eD = await elec([D1, D2], M2);
      t.eq('Người ở lại = 175.000 + 700.000 (đúng chặng, không chia bừa)', eD[D1], 875000, `được ${fmt(eD[D1])}`);

      // Phiếu CUỐI của người rời (kỳ 07) lấy phần tới ngày rời qua lập phiếu lẻ
      const g1 = await t.api('POST', '/api/invoices/generate-one', T, { student_id: D2, month: M });
      t.ok('Lập phiếu cuối cho người rời chạy được', g1.status === 200, `HTTP ${g1.status} — ${g1.json && g1.json.error}`);
      const eD7 = await elec([D2], M);
      t.eq('Người rời trả đúng phần mình = 175.000', eD7[D2], 175000, `được ${fmt(eD7[D2])}`);
      t.eq('TỔNG hai người khớp tuyệt đối tiền điện kỳ 07', eD[D1] + eD7[D2], 300 * UNIT, `tổng ${fmt(eD[D1] + eD7[D2])}`);
    } finally {
      await clean(t.db);
      if (oldUnit) await t.db.query(`UPDATE settings SET value=$1 WHERE key='electric_unit'`, [oldUnit.value]);
    }
  },
};
