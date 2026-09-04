// ĐỢT 1 — vá chặn phát hành đa cơ sở: race trả phòng (409, không check-out đôi), admin LUÔN điều hành,
// xoá cơ sở bị chặn khi còn tài khoản/phòng, ?facility cho điều hành, cách ly nhật ký. CHỈ LOCAL.
const bcrypt = require('bcryptjs');
const P = '__test_mf2';
const PW = 'quanly2026a';

async function clean(db) {
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
  await db.query(`UPDATE users SET facility_id=NULL WHERE username='admin'`); // trả admin về điều hành
}

module.exports = {
  name: 'Đợt 1 — race trả phòng + admin điều hành + xoá cơ sở + ?facility + nhật ký',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const ADMIN = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fA = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_A','A') RETURNING id`)).rows[0].id;
    const fB = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_B','B') RETURNING id`)).rows[0].id;
    const rA = (await t.db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ('${P}_rA',$1,4,'female','B',1200000) RETURNING id`, [fA])).rows[0].id;
    const mkStu = (code, room, fac) => t.db.query(
      `INSERT INTO students (code,name,gender,room_id,facility_id,check_in_date,status,rental_type,residency_status,deposit_amount)
       VALUES ($1,$1,'female',$2,$3,'2026-07-01','in','ghep','unregistered',0) RETURNING id`, [code, room, fac]).then(r => r.rows[0].id);
    const sA = await mkStu(P + '_sA', rA, fA);
    const sB = await mkStu(P + '_sB', null, fB);
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [sA, rA]);
    // vài dòng nhật ký để test cách ly
    await t.db.query(`INSERT INTO logs (student_id,type,date,room_id,note,source) VALUES ($1,'in','2026-07-01',$2,'x','admin'),($3,'in','2026-07-01',NULL,'y','admin')`, [sA, rA, sB]);
    const hash = bcrypt.hashSync(PW, 10);
    await t.db.query(`INSERT INTO users (username,password_hash,role,facility_id,must_change_password) VALUES ($1,$2,'staff',$3,false)`, [P + '_mgrA', hash, fA]);
    const mgrA = await t.login(P + '_mgrA', PW);

    // ---- RACE: duyệt đơn trả phòng 2 lần ĐỒNG THỜI -> đúng 1 lần 200, 1 lần 409 ----
    const cr = (await t.db.query(`INSERT INTO checkout_requests (student_id,status,desired_date,reason,created_at) VALUES ($1,'pending','2026-07-20','normal',now()) RETURNING id`, [sA])).rows[0].id;
    const [r1, r2] = await Promise.all([
      t.api('POST', `/api/requests/checkout/${cr}/confirm`, ADMIN, { date: '2026-07-20' }),
      t.api('POST', `/api/requests/checkout/${cr}/confirm`, ADMIN, { date: '2026-07-20' }),
    ]);
    const codes = [r1.status, r2.status].sort();
    t.ok('RACE: duyệt 2 lần đồng thời → đúng 1×200 + 1×409', codes[0] === 200 && codes[1] === 409, `mã: ${codes.join(',')}`);
    // BL-117: duyệt đơn chỉ chốt LỊCH, không ghi nhật ký "out" (nhật ký ra chỉ có khi xác nhận trả thật)
    const nOut = (await t.db.query(`SELECT COUNT(*)::int c FROM logs WHERE student_id=$1 AND type='out'`, [sA])).rows[0].c;
    t.eq('RACE: không dòng nhật ký "out" nào (duyệt lịch không phải trả phòng)', nOut, 0);
    const pl = (await t.db.query(`SELECT planned_check_out::text p FROM students WHERE id=$1`, [sA])).rows[0].p;
    t.eq('RACE: lịch dự kiến ghi đúng một lần', String(pl || '').slice(0, 10), '2026-07-20');

    // ---- reject sau khi đã confirm → 409 ----
    const rRej = await t.api('POST', `/api/requests/checkout/${cr}/reject`, ADMIN);
    t.ok('Từ chối đơn đã duyệt → 409', rRej.status === 409, `HTTP ${rRej.status}`);

    // ---- ADMIN LUÔN điều hành: dù DB lưu facility_id cho admin ----
    await t.db.query(`UPDATE users SET facility_id=$1 WHERE username='admin'`, [fA]);
    const ADMIN2 = await t.login('admin', process.env.ADMIN_P);
    const stuAdmin = (await t.api('GET', '/api/students', ADMIN2)).json;
    const idsAdmin = (Array.isArray(stuAdmin) ? stuAdmin : stuAdmin.rows || []).map(x => x.id);
    t.ok('ADMIN có facility_id vẫn là ĐIỀU HÀNH (thấy cả A và B)', idsAdmin.includes(sA) && idsAdmin.includes(sB), `A=${idsAdmin.includes(sA)} B=${idsAdmin.includes(sB)}`);
    await t.db.query(`UPDATE users SET facility_id=NULL WHERE username='admin'`);

    // ---- ?facility cho điều hành: lọc được từng cơ sở ----
    const admins = await t.login('admin', process.env.ADMIN_P);
    const onlyA = (await t.api('GET', `/api/students?facility=${fA}`, admins)).json;
    const idsA = (Array.isArray(onlyA) ? onlyA : onlyA.rows || []).map(x => x.id);
    t.ok('Điều hành ?facility=A → chỉ HV cơ sở A', idsA.includes(sA) && !idsA.includes(sB), `A=${idsA.includes(sA)} B=${idsA.includes(sB)}`);

    // ---- Nhật ký cách ly: quản lý A không thấy nhật ký cơ sở B ----
    const logsA = (await t.api('GET', '/api/logs', mgrA)).json;
    const logRows = Array.isArray(logsA) ? logsA : logsA.rows || [];
    t.ok('Quản lý A KHÔNG thấy nhật ký HV cơ sở B', logRows.every(l => l.student_id !== sB), `n=${logRows.length}`);

    // ---- Xoá cơ sở bị chặn khi còn TÀI KHOẢN / PHÒNG ----
    const rDelUser = await t.api('DELETE', `/api/facilities/${fA}`, admins);
    t.ok('Xoá cơ sở còn tài khoản quản lý → 400', rDelUser.status === 400, `HTTP ${rDelUser.status}`);
    // gỡ tài khoản A, vẫn còn phòng -> vẫn chặn
    await t.db.query(`DELETE FROM users WHERE username='${P}_mgrA'`);
    const rDelRoom = await t.api('DELETE', `/api/facilities/${fA}`, admins);
    t.ok('Xoá cơ sở còn phòng → 400', rDelRoom.status === 400, `HTTP ${rDelRoom.status}`);

    await clean(t.db);
  },
};
