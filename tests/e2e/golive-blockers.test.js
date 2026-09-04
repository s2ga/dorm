// Canh các lỗ CHẶN PHÁT HÀNH đã vá (review go-live 18/07): trả phòng thống nhất 3 đường (BLK-1),
// chặn ngày trả < ngày bắt đầu lượt ở (BLK-3), đổi giới tính phòng khi còn người khác giới (BLK-2),
// tổng tiền âm khi giảm > phí (BLK-7). CHỈ LOCAL.
const P = '__test_blk';

async function clean(db) {
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices    WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays  WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_leaders WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs        WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}
const mkRoom = (db, name, fac, gender = 'female') =>
  db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,$3,'B',1200000) RETURNING id`, [name, fac, gender]).then(r => r.rows[0].id);
const mkStu = (db, code, room, gender = 'female', ci = '2026-07-01') =>
  db.query(`INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,deposit_amount) VALUES ($1,$1,$2,$3,$4,'in','ghep','unregistered',0) RETURNING id`, [code, gender, room, ci]).then(r => r.rows[0].id);

module.exports = {
  name: 'Chặn phát hành go-live — trả phòng thống nhất, giới tính phòng, tiền âm',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    // ---- BLK-2: đổi giới tính phòng khi còn người khác giới đang ở ----
    const rmMale = await mkRoom(t.db, P + '_male', fac, 'male');
    await mkStu(t.db, P + '_m1', rmMale, 'male');
    const rG = await t.api('PUT', `/api/rooms/${rmMale}`, T, { name: P + '_male', gender: 'female' });
    t.ok('BLK-2: đổi phòng nam (đang có nam ở) sang nữ → 400', rG.status === 400, `HTTP ${rG.status}`);
    const gNow = (await t.db.query(`SELECT gender FROM rooms WHERE id=$1`, [rmMale])).rows[0].gender;
    t.eq('BLK-2: giới tính phòng KHÔNG bị đổi', gNow, 'male');

    // ---- BLK-7: tổng tiền âm khi khoản giảm > tổng phí (phiếu phòng trưởng) ----
    const rmL = await mkRoom(t.db, P + '_L', fac);
    const sL = await mkStu(t.db, P + '_L1', rmL);
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [sL, rmL]);
    await t.db.query(`INSERT INTO room_leaders (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [sL, rmL]);
    await t.api('POST', '/api/invoices/generate-one', T, { student_id: sL, month: '2026-07' });
    const invL = (await t.db.query(`SELECT id, leader_discount, total FROM invoices WHERE student_id=$1 AND month='2026-07'`, [sL])).rows[0];
    const rNeg = await t.api('PUT', `/api/invoices/${invL.id}`, T, { room_charge: 1000, electric_charge: 0, water_charge: 0, service_charge: 0, washing_charge: 0, parking_charge: 0, other_charge: 0, days_stayed: 30, electric_kwh: 0 });
    t.ok('BLK-7: sửa phiếu để total âm (giảm > phí) → 400', rNeg.status === 400 && +invL.leader_discount > 0, `HTTP ${rNeg.status} · leader_discount=${invL.leader_discount}`);
    const totAfter = (await t.db.query(`SELECT total FROM invoices WHERE id=$1`, [invL.id])).rows[0].total;
    t.ok('BLK-7: total KHÔNG bị ghi âm', +totAfter >= 0, `total=${totAfter}`);

    // ---- BLK-1: duyệt đơn trả phòng phải ĐÓNG room_stays + phòng trưởng + DỌN phiếu kỳ sau ----
    // Phiếu kỳ sau dựng thẳng bằng SQL: generate-one giờ CHẶN khi kỳ điện trước chưa chốt (đúng
    // thiết kế điện-lùi-một-kỳ) — ở đây chỉ cần TỒN TẠI một phiếu 2026-08 để kiểm việc dọn.
    await t.db.query(
      `INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, total, status)
       VALUES ($1,$2,'2026-08',31,1200000,1200000,'pending')`, [sL, rmL]);
    const cr = (await t.db.query(`INSERT INTO checkout_requests (student_id, status, desired_date, reason, created_at) VALUES ($1,'pending','2026-07-20','normal',now()) RETURNING id`, [sL])).rows[0].id;
    const rc = await t.api('POST', `/api/requests/checkout/${cr}/confirm`, T, { date: '2026-07-20' });
    t.ok('BLK-1: duyệt đơn trả phòng thành công', rc.status === 200, `HTTP ${rc.status}`);
    // BL-117: duyệt = chốt lịch; lượt ở / phòng trưởng / phiếu chỉ đóng-dọn khi XÁC NHẬN trả phòng thật.
    const stayTruoc = (await t.db.query(`SELECT to_date FROM room_stays WHERE student_id=$1 ORDER BY from_date DESC LIMIT 1`, [sL])).rows[0];
    t.ok('BL-117: sau duyệt lịch, lượt ở VẪN MỞ', stayTruoc && stayTruoc.to_date === null, `to_date=${stayTruoc && stayTruoc.to_date}`);
    const rco = await t.api('POST', `/api/students/${sL}/checkout`, T, { date: '2026-07-20' });
    t.ok('BLK-1: xác nhận trả phòng thật thành công', rco.status === 200, `HTTP ${rco.status} ${rco.json && rco.json.error || ''}`);
    const stayL = (await t.db.query(`SELECT to_date FROM room_stays WHERE student_id=$1 ORDER BY from_date DESC LIMIT 1`, [sL])).rows[0];
    t.ok('BLK-1: room_stays được ĐÓNG (to_date không null)', stayL && stayL.to_date, `to_date=${stayL && stayL.to_date}`);
    const leadL = (await t.db.query(`SELECT to_date FROM room_leaders WHERE student_id=$1 ORDER BY from_date DESC LIMIT 1`, [sL])).rows[0];
    t.ok('BLK-1: nhiệm kỳ phòng trưởng được ĐÓNG (không miễn phí vĩnh viễn)', leadL && leadL.to_date, `to_date=${leadL && leadL.to_date}`);
    const futL = (await t.db.query(`SELECT deleted_at FROM invoices WHERE student_id=$1 AND month='2026-08'`, [sL])).rows[0];
    t.ok('BLK-1: phiếu kỳ SAU (2026-08) bị dọn (không đòi người đã đi)', futL && futL.deleted_at, `deleted_at=${futL && futL.deleted_at}`);

    // ---- BLK-3: trả phòng lùi ngày TRƯỚC ngày bắt đầu lượt ở đang mở (đã chuyển phòng) → chặn, không xoá lượt ----
    const rmT = await mkRoom(t.db, P + '_T', fac);
    const sT = await mkStu(t.db, P + '_T1', rmT); // check_in 2026-07-01
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-15')`, [sT, rmT]); // lượt mở từ 15 (mô phỏng đã chuyển phòng)
    const rBack = await t.api('POST', `/api/students/${sT}/checkout`, T, { date: '2026-07-10' }); // >= check_in(07-01) NHƯNG < from_date(07-15)
    t.ok('BLK-3: trả phòng ngày < ngày bắt đầu lượt ở hiện tại → 400', rBack.status === 400, `HTTP ${rBack.status}`);
    const stayCount = (await t.db.query(`SELECT COUNT(*)::int c FROM room_stays WHERE student_id=$1 AND to_date IS NULL`, [sT])).rows[0].c;
    t.ok('BLK-3: lượt ở KHÔNG bị xoá', stayCount === 1, `còn ${stayCount} lượt mở`);

    // ---- BLK-3b: đường bảo trì cũng chặn ngày lùi ----
    const rBackM = await t.api('POST', `/api/maintenance/handovers/${sT}/checkout`, T, { actual_date: '2026-07-10' });
    t.ok('BLK-3b: đường bảo trì cũng chặn ngày < lượt ở hiện tại → 400', rBackM.status === 400, `HTTP ${rBackM.status}`);

    // ---- M-2: check-out LẦN 2 (HV đã 'out') → 409 ----
    const rmC = await mkRoom(t.db, P + '_C', fac);
    const sC = await mkStu(t.db, P + '_C1', rmC);
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [sC, rmC]);
    const co1 = await t.api('POST', `/api/students/${sC}/checkout`, T, { date: '2026-07-20' });
    t.ok('M-2: check-out lần 1 OK', co1.status === 200, `HTTP ${co1.status}`);
    const co2 = await t.api('POST', `/api/students/${sC}/checkout`, T, { date: '2026-07-25' });
    t.ok('M-2: check-out lần 2 (đã out) → 409', co2.status === 409, `HTTP ${co2.status}`);
    const coDate = (await t.db.query(`SELECT check_out_date FROM students WHERE id=$1`, [sC])).rows[0].check_out_date;
    t.eq('M-2: check_out_date KHÔNG bị ghi đè sang ngày mới', String(coDate).slice(0, 10), '2026-07-20');

    // ---- M-1: máy trạng thái cọc ----
    const rmD = await mkRoom(t.db, P + '_D', fac);
    const sD = (await t.db.query(`INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,deposit_amount,deposit_status) VALUES ($1,$1,'female',$2,'2026-07-01','in','ghep','unregistered',1200000,'held') RETURNING id`, [P + '_D1', rmD])).rows[0].id;
    // tất toán khi CHƯA trả phòng → 400
    const s0 = await t.api('POST', `/api/students/${sD}/deposit-settle`, T, { action: 'refund', override_reason: 'test hoan coc du dieu kien khong' });
    t.ok('M-1: tất toán cọc khi HV chưa trả phòng → 400', s0.status === 400, `HTTP ${s0.status}`);
    // cho trả phòng
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [sD, rmD]);
    await t.api('POST', `/api/students/${sD}/checkout`, T, { date: '2026-07-20', reason: 'departure' });
    // tất toán lần 1 (forfeit — không cần điều kiện) → ok
    const s1 = await t.api('POST', `/api/students/${sD}/deposit-settle`, T, { action: 'forfeit' });
    t.ok('M-1: tất toán cọc lần 1 (đã trả phòng) OK', s1.status === 200, `HTTP ${s1.status}`);
    // tất toán LẠI → 409
    const s2 = await t.api('POST', `/api/students/${sD}/deposit-settle`, T, { action: 'refund', override_reason: 'doi y muon hoan lai coc' });
    t.ok('M-1: tất toán cọc LẦN 2 → 409 (không đảo trạng thái)', s2.status === 409, `HTTP ${s2.status}`);
    const dep = (await t.db.query(`SELECT deposit_status FROM students WHERE id=$1`, [sD])).rows[0].deposit_status;
    t.eq('M-1: trạng thái cọc giữ nguyên "forfeited"', dep, 'forfeited');

    await clean(t.db);
  },
};
