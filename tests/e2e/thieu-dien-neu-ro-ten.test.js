// Cảnh báo thiếu chỉ số điện phải NÓI RÕ AI (owner 04/09: "không code nửa vời bắt người ta tự mò"):
// câu cảnh báo lập hoá đơn nêu tên người rời; màn Chốt giữa kỳ không được GIẤU người đã khoá hồ sơ
// (mốc chốt là của công-tơ — giấu đi thì màn nhập bảo "đủ" mà lập hoá đơn vẫn treo cả phòng).
const P = '__test_tdrt';
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
  name: 'Thiếu chỉ số điện — cảnh báo nêu tên, không giấu người đã khoá hồ sơ',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;
    const A = (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type)
       VALUES ($1,$2,'male',$3,'2026-04-01','in','ghep') RETURNING id`, [P + '_A', P + ' Còn Ở', rid])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-04-01')`, [A, rid]);
    const B = (await t.db.query(
      `INSERT INTO students (code,name,gender,check_in_date,check_out_date,status,rental_type,deleted_at,lock_reason)
       VALUES ($1,$2,'male','2026-04-01','2026-04-15','out','ghep',now(),'test khoá') RETURNING id`,
      [P + '_B', P + ' Đã Khoá'])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,'2026-04-01','2026-04-15')`, [B, rid]);
    await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,0,60,60)`, [rid, KY_DIEN]);

    // ── Màn Chốt giữa kỳ: người đã khoá hồ sơ VẪN hiện, gắn cờ ho_so_khoa ────────────────
    const reads = await t.api('GET', `/api/electric/reads?month=${KY_DIEN}`, T);
    t.eq('Đọc danh sách chốt giữa kỳ', reads.status, 200, `HTTP ${reads.status}`);
    const dongB = (reads.json.missing || []).find(x => x.student_id === B);
    t.ok('Người rời ĐÃ KHOÁ hồ sơ vẫn nằm trong danh sách còn thiếu (không giấu)', !!dongB, JSON.stringify(reads.json.missing || []));
    t.ok('Dòng đó nêu tên + cờ hồ sơ khoá', dongB && dongB.student_name === P + ' Đã Khoá' && dongB.ho_so_khoa === true, JSON.stringify(dongB));

    // ── Lập phiếu: câu cảnh báo nêu RÕ TÊN người rời, không nói chung chung ──────────────
    const g1 = await t.api('POST', '/api/invoices/generate', T, { month: KY, preview: true });
    t.eq('Xem trước lập phiếu chạy được', g1.status, 200, `HTTP ${g1.status} ${g1.json && g1.json.error || ''}`);
    const wR = (g1.json.warnings || []).filter(w => w.includes(P + '_R'));
    t.ok('Cảnh báo của phòng nêu TÊN người rời + ghi chú hồ sơ đã khoá',
      wR.length === 1 && wR[0].includes(P + ' Đã Khoá') && /hồ sơ đã khoá/.test(wR[0]) && /2026-04-15/.test(wR[0]),
      JSON.stringify(wR));

    // ── Nhập mốc chốt cho người đã khoá → hết thiếu, phòng ra phiếu ──────────────────────
    const sv = await t.api('POST', '/api/electric/reads', T, { room_id: rid, date: '2026-04-15', reading: 30, student_id: B });
    t.eq('Lưu mốc chốt ngày rời → 200', sv.status, 200, `HTTP ${sv.status} ${sv.json && sv.json.error || ''}`);
    const reads2 = await t.api('GET', `/api/electric/reads?month=${KY_DIEN}`, T);
    t.ok('Lưu xong dòng thiếu biến mất (không còn "hiện trống")',
      !((reads2.json.missing || []).some(x => x.student_id === B)), JSON.stringify(reads2.json.missing || []));
    const g2 = await t.api('POST', '/api/invoices/generate', T, { month: KY });
    t.eq('Lập phiếu thật → 200', g2.status, 200, `HTTP ${g2.status}`);
    t.eq('Phòng hết bị treo', (g2.json.warnings || []).filter(w => w.includes(P + '_R')).length, 0,
      JSON.stringify(g2.json.warnings || []));
    const invA = (await t.db.query(`SELECT id FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [A, KY])).rows;
    t.eq('Người ở lại ra được phiếu', invA.length, 1);

    await clean(t.db);
  },
};
