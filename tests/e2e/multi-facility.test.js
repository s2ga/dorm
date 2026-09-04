// ĐA CƠ SỞ — cách ly dữ liệu theo cơ sở của người đăng nhập (chốt 18/07).
// role = làm được gì; users.facility_id = thấy dữ liệu nào. Kiểm đủ acceptance a–f. CHỈ LOCAL.
const bcrypt = require('bcryptjs');
const P = '__test_mf';
const PW = 'quanly2026a'; // đạt checkPassword (>=8, có chữ+số, không phổ biến)

async function clean(db) {
  await db.query(`DELETE FROM invoices WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM damage_reports WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM applications WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Đa cơ sở — cách ly dữ liệu theo cơ sở (acceptance a–f)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const ADMIN = await t.login('admin', process.env.ADMIN_P); // điều hành (facility_id NULL)
    await clean(t.db);

    // 2 cơ sở
    const fA = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_A','Cơ sở A') RETURNING id`)).rows[0].id;
    const fB = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_B','Cơ sở B') RETURNING id`)).rows[0].id;
    // Phòng mỗi cơ sở
    const rA = (await t.db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ('${P}_rA',$1,4,'female','B',1200000) RETURNING id`, [fA])).rows[0].id;
    const rB = (await t.db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ('${P}_rB',$1,4,'female','B',1200000) RETURNING id`, [fB])).rows[0].id;
    // HV mỗi cơ sở (facility_id gắn đúng)
    const mkStu = (code, room, fac) => t.db.query(
      `INSERT INTO students (code,name,gender,room_id,facility_id,check_in_date,status,rental_type,residency_status,deposit_amount)
       VALUES ($1,$1,'female',$2,$3,'2026-07-01','in','ghep','unregistered',0) RETURNING id`, [code, room, fac]).then(r => r.rows[0].id);
    const sA = await mkStu(P + '_sA', rA, fA);
    const sB = await mkStu(P + '_sB', rB, fB);
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01'),($3,$4,'2026-07-01')`, [sA, rA, sB, rB]);
    // Hoá đơn mỗi HV
    await t.api('POST', '/api/invoices/generate-one', ADMIN, { student_id: sA, month: '2026-07' });
    await t.api('POST', '/api/invoices/generate-one', ADMIN, { student_id: sB, month: '2026-07' });
    // Báo hư hỏng đã chuyển bảo trì (mỗi cơ sở 1)
    const mkDmg = (sid, rid) => t.db.query(
      `INSERT INTO damage_reports (student_id, room_id, category, title, status, assigned_at) VALUES ($1,$2,'damage',$3,'processing',now()) RETURNING id`,
      [sid, rid, P + '_dmg']).then(r => r.rows[0].id);
    await mkDmg(sA, rA); await mkDmg(sB, rB);
    // Tài khoản: quản lý A, quản lý B (staff), bảo trì A (maintenance), + 1 tài khoản HV cho sA
    const hash = bcrypt.hashSync(PW, 10);
    const mkUser = (uname, role, fac, sid) => t.db.query(
      `INSERT INTO users (username,password_hash,role,facility_id,student_id,must_change_password) VALUES ($1,$2,$3,$4,$5,false)`,
      [uname, hash, role, fac, sid || null]);
    await mkUser(P + '_mgrA', 'staff', fA);
    await mkUser(P + '_mgrB', 'staff', fB);
    await mkUser(P + '_maintA', 'maintenance', fA);
    await mkUser(P + '_hvA', 'student', null, sA);

    const mgrA = await t.login(P + '_mgrA', PW);
    const maintA = await t.login(P + '_maintA', PW);
    const hvA = await t.login(P + '_hvA', PW);

    // ---- (a) Quản lý A KHÔNG thấy HV/phòng/hoá đơn cơ sở B ----
    const stuA = (await t.api('GET', '/api/students', mgrA)).json;
    const ids = (Array.isArray(stuA) ? stuA : stuA.rows || []).map(x => x.id);
    t.ok('(a) Quản lý A thấy HV cơ sở A', ids.includes(sA), `có sA=${ids.includes(sA)}`);
    t.ok('(a) Quản lý A KHÔNG thấy HV cơ sở B', !ids.includes(sB), `có sB=${ids.includes(sB)}`);
    const roomsA = (await t.api('GET', '/api/rooms', mgrA)).json.map(x => x.id);
    t.ok('(a) Quản lý A thấy phòng A, KHÔNG thấy phòng B', roomsA.includes(rA) && !roomsA.includes(rB), `A=${roomsA.includes(rA)} B=${roomsA.includes(rB)}`);
    const invA = (await t.api('GET', '/api/invoices?month=2026-07', mgrA)).json.map(x => x.student_id);
    t.ok('(a) Quản lý A thấy hoá đơn A, KHÔNG thấy hoá đơn B', invA.includes(sA) && !invA.includes(sB), `A=${invA.includes(sA)} B=${invA.includes(sB)}`);

    // ---- (b) Quản lý A SỬA bản ghi cơ sở B -> 403 ----
    const rPutB = await t.api('PUT', `/api/rooms/${rB}`, mgrA, { name: P + '_rB', capacity: 5 });
    t.ok('(b) Quản lý A sửa PHÒNG cơ sở B → 403', rPutB.status === 403, `HTTP ${rPutB.status}`);
    const rCoB = await t.api('POST', `/api/students/${sB}/checkout`, mgrA, { date: '2026-07-20' });
    t.ok('(b) Quản lý A check-out HV cơ sở B → 403', rCoB.status === 403, `HTTP ${rCoB.status}`);
    const rInvB = (await t.db.query(`SELECT id FROM invoices WHERE student_id=$1 AND month='2026-07'`, [sB])).rows[0];
    const rPutInvB = await t.api('POST', `/api/invoices/${rInvB.id}/status`, mgrA, { status: 'paid' });
    t.ok('(b) Quản lý A đổi trạng thái HOÁ ĐƠN cơ sở B → 403', rPutInvB.status === 403, `HTTP ${rPutInvB.status}`);

    // ---- (c) Điều hành thấy TẤT CẢ ----
    const stuAll = (await t.api('GET', '/api/students', ADMIN)).json;
    const allIds = (Array.isArray(stuAll) ? stuAll : stuAll.rows || []).map(x => x.id);
    t.ok('(c) Điều hành thấy cả HV cơ sở A và B', allIds.includes(sA) && allIds.includes(sB), `A=${allIds.includes(sA)} B=${allIds.includes(sB)}`);

    // ---- (d) Duyệt đơn gắn đúng facility_id cho HV ----
    const appB = (await t.db.query(
      `INSERT INTO applications (name, phone, gender, facility_id, status) VALUES ($1,'0900000001','female',$2,'pending') RETURNING id`,
      [P + '_appB', fB])).rows[0].id;
    // Quản lý A KHÔNG duyệt được đơn cơ sở B
    const rApproveByA = await t.api('POST', `/api/applications/${appB}/approve`, mgrA, { room_id: rB });
    t.ok('(d) Quản lý A duyệt đơn cơ sở B → 403', rApproveByA.status === 403, `HTTP ${rApproveByA.status}`);
    // Điều hành duyệt -> HV mới có facility_id = B
    const rApprove = await t.api('POST', `/api/applications/${appB}/approve`, ADMIN, { room_id: rB });
    t.ok('(d) Điều hành duyệt đơn cơ sở B thành công', rApprove.status === 200, `HTTP ${rApprove.status}`);
    const newStu = rApprove.json && rApprove.json.student;
    t.eq('(d) HV mới được gắn facility_id = cơ sở B', newStu && newStu.facility_id, fB);
    if (newStu) await t.db.query(`UPDATE students SET code='${P}_new' WHERE id=$1`, [newStu.id]); // để clean dọn

    // ---- (e) HV chỉ thấy hồ sơ của CHÍNH MÌNH ----
    const prof = (await t.api('GET', '/api/me/profile', hvA)).json;
    t.eq('(e) HV xem đúng hồ sơ của mình (sA)', prof && prof.id, sA);
    const myInv = (await t.api('GET', '/api/me/invoices', hvA)).json;
    t.ok('(e) HV chỉ thấy hoá đơn của mình', Array.isArray(myInv) && myInv.every(i => i.student_id === sA), `n=${myInv.length}`);
    // HV không gọi được API quản trị
    const rStuAsHv = await t.api('GET', '/api/students', hvA);
    t.ok('(e) HV KHÔNG gọi được /api/students (403)', rStuAsHv.status === 403, `HTTP ${rStuAsHv.status}`);

    // ---- (f) Bảo trì A chỉ thấy việc cơ sở A ----
    const tasks = (await t.api('GET', '/api/maintenance/tasks', maintA)).json;
    const taskStu = (tasks || []).map(x => x.student_name);
    t.ok('(f) Bảo trì A thấy việc cơ sở A', (tasks || []).length >= 1, `n=${(tasks || []).length}`);
    // handovers: chỉ HV cơ sở A
    const ho = (await t.api('GET', '/api/maintenance/handovers?month=2026-07', maintA)).json;
    const hoIds = [...(ho.checkins || []), ...(ho.checkouts || [])].map(x => x.id);
    t.ok('(f) Bàn giao bảo trì A KHÔNG gồm HV cơ sở B', !hoIds.includes(sB), `có sB=${hoIds.includes(sB)}`);

    await clean(t.db);
  },
};
