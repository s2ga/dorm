// Vai "teacher" (Giáo viên ProSkills): CHỈ xem lịch trực nhật từng phòng + vi phạm nội quy.
// Mọi đường GHI và mọi màn khác (hồ sơ HV, phòng, phiếu thu, cài đặt, tài khoản) phải 403.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_gvps';

const clean = async db => {
  await db.query(`DELETE FROM violations WHERE student_id IN (SELECT id FROM students WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%' OR code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Giáo viên ProSkills — chỉ xem trực nhật & vi phạm',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const hash = bcrypt.hashSync(pw, 10);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    const room = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, floor)
       VALUES ($1,$2,4,'male','B',1200000,3) RETURNING id`, [P + '_R', fac])).rows[0].id;
    const mkHV = async ten => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,facility_id)
       VALUES ($1,$1,'male',$2,'2026-05-01','in','ghep','unregistered',$3) RETURNING id`,
      [P + '_' + ten, room, fac])).rows[0].id;
    const hvA = await mkHV('A');
    const hvB = await mkHV('B');
    await t.db.query(
      `INSERT INTO violations (student_id, type_name, severity, level, date, note)
       VALUES ($1,'Về trễ giờ','minor',1,'2026-09-10','Về lúc 23h30')`, [hvA]);

    await t.db.query(
      `INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,'teacher','Cô giáo ProSkills')`,
      [P + '_gv', hash]);

    try {
      const gv = await t.login(P + '_gv', pw);
      t.ok('Giáo viên đăng nhập được', !!gv);

      // ===== CỬA MỞ =====
      const tn = await t.api('GET', '/api/rooms/chores', gv);
      t.eq('GET /rooms/chores → 200', tn.status, 200, `HTTP ${tn.status} ${tn.json && tn.json.error || ''}`);
      const ds = Array.isArray(tn.json) ? tn.json : [];
      const p = ds.find(x => x.room_name === P + '_R');
      t.ok('Thấy phòng vừa tạo trong lịch trực nhật', !!p, JSON.stringify(ds.slice(0, 3)));
      t.eq('Đếm đúng số người đang ở trong phòng', p && p.so_nguoi, 2, JSON.stringify(p));
      t.ok('Có lịch trực xoay vòng (app tự tính, không ai nhập)', !!p && Array.isArray(p.lich) && p.lich.length > 0,
        JSON.stringify(p && p.lich));
      t.ok('Mỗi tuần trực nêu rõ ai trực và từ ngày nào tới ngày nào',
        !!p && !!p.lich[0] && !!p.lich[0].name && !!p.lich[0].from && !!p.lich[0].to, JSON.stringify(p && p.lich[0]));
      t.ok('Người trực phải là người ĐANG Ở phòng đó', !!p && [hvA, hvB].includes(p.lich[0].student_id),
        JSON.stringify(p && p.lich[0]));

      const vp = await t.api('GET', '/api/violations', gv);
      t.eq('GET /violations → 200', vp.status, 200, `HTTP ${vp.status}`);
      const vps = Array.isArray(vp.json) ? vp.json : (vp.json && vp.json.rows) || [];
      const v1 = vps.find(v => v.student_name === P + '_A');
      t.ok('Thấy vi phạm kèm tên học viên, phòng và lỗi', !!v1 && v1.type_name === 'Về trễ giờ' && v1.room_name === P + '_R',
        JSON.stringify(v1));

      t.eq('GET /violations/types → 200', (await t.api('GET', '/api/violations/types', gv)).status, 200);
      t.eq('GET /violations/student/:id → 200', (await t.api('GET', `/api/violations/student/${hvA}`, gv)).status, 200);

      // ===== CỬA ĐÓNG: mọi đường GHI vi phạm =====
      const cam = async (ten, method, path, body) => {
        const r = await t.api(method, path, gv, body);
        t.eq(ten, r.status, 403, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
      };
      await cam('Ghi vi phạm mới → 403', 'POST', '/api/violations', { student_id: hvA, type_name: 'X', date: '2026-09-20' });
      await cam('Sửa vi phạm → 403', 'PUT', '/api/violations/1', { note: 'x' });
      await cam('Xoá vi phạm → 403', 'DELETE', '/api/violations/1');
      await cam('Gửi mail nhà trường → 403', 'POST', `/api/violations/student/${hvA}/notify`);
      await cam('Thống kê vi phạm (không thuộc phần được xem) → 403', 'GET', '/api/violations/stats');

      // ===== CỬA ĐÓNG: mọi màn khác =====
      await cam('Danh sách học viên đầy đủ → 403', 'GET', '/api/students');
      await cam('Hồ sơ lưu trữ (việc của thư ký) → 403', 'GET', '/api/students/archive');
      await cam('Danh sách phòng → 403', 'GET', '/api/rooms');
      await cam('Lịch chỗ trống → 403', 'GET', '/api/rooms/lich');
      await cam('Phiếu thu → 403', 'GET', '/api/invoices?month=2026-09');
      await cam('Cài đặt → 403', 'GET', '/api/settings');
      await cam('Tài khoản nhân viên → 403', 'GET', '/api/admin/users');
      await cam('Tiền điện → 403', 'GET', '/api/electric');
      await cam('Đơn đăng ký → 403', 'GET', '/api/applications');
      await cam('Tạo phòng → 403', 'POST', '/api/rooms', { name: P + '_X', capacity: 4 });
      await cam('Sửa hồ sơ học viên → 403', 'PUT', `/api/students/${hvA}`, { name: 'đổi tên' });
      await cam('Check-out học viên → 403', 'POST', `/api/students/${hvA}/checkout`, { date: '2026-09-20' });

      // Chặn rồi thì dữ liệu phải y nguyên
      const con = (await t.db.query('SELECT name, status FROM students WHERE id=$1', [hvA])).rows[0];
      t.ok('Bị chặn thì hồ sơ học viên KHÔNG đổi', con.name === P + '_A' && con.status === 'in', JSON.stringify(con));
      t.eq('Bị chặn thì không đẻ thêm vi phạm nào',
        (await t.db.query('SELECT COUNT(*)::int c FROM violations WHERE student_id=$1', [hvA])).rows[0].c, 1);
    } finally {
      await clean(t.db);
    }
  },
};
