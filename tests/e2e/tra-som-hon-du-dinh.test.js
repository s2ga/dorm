// Trả phòng SỚM HƠN dự định (hoặc đã rời rồi mới báo): mọi luồng check-out phải cho ghi/sửa
// ngày rời THỰC TẾ — Check-out nhận ngày quá khứ, "Sửa ngày trả" của BQL, và an ninh sửa được
// ngay tại màn bàn giao (đồng bộ cả checkout_actual_date để hai màn không lệch nhau).
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_tsom';
const PW = 'anninh26';

const ngay = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_leaders WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM meter_reads WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Trả sớm hơn dự định — sửa được ngày rời thực tế trên mọi luồng check-out',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;
    const dung = async ma => {
      const id = (await t.db.query(
        `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,planned_check_out)
         VALUES ($1,$1,'male',$2,$3,'in','ghep',$4) RETURNING id`, [ma, rid, ngay(-30), ngay(10)])).rows[0].id;
      await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [id, rid, ngay(-30)]);
      return id;
    };
    const hoSo = async id => (await t.db.query(
      `SELECT status, check_out_date::text co, checkout_actual_date::text bg FROM students WHERE id=$1`, [id])).rows[0];
    const luotCuoi = async id => (await t.db.query(
      `SELECT to_date::text den FROM room_stays WHERE student_id=$1 ORDER BY from_date DESC, id DESC LIMIT 1`, [id])).rows[0];

    // ── 1. Check-out của BQL: rời SỚM hơn lịch (+10), ghi ngày quá khứ ──────────────────
    const s1 = await dung(P + '_A');
    const co = await t.api('POST', `/api/students/${s1}/checkout`, T, { date: ngay(-2), reason: 'personal' });
    t.eq('Check-out ngày -2 (sớm hơn lịch +10) → 200', co.status, 200, `HTTP ${co.status} ${co.json && co.json.error || ''}`);
    let h = await hoSo(s1);
    t.ok('Ngày rời thật -2, status out', h.co === ngay(-2) && h.status === 'out', JSON.stringify(h));
    t.eq('Lượt ở đóng đúng ngày -2', (await luotCuoi(s1)).den, ngay(-2));

    // ── 2. Check-out lần 2 → 409, lời báo chỉ đúng đường "Sửa ngày trả" ─────────────────
    const lan2 = await t.api('POST', `/api/students/${s1}/checkout`, T, { date: ngay(-3) });
    t.eq('Check-out lần 2 → 409', lan2.status, 409, `HTTP ${lan2.status}`);
    t.ok('Lời báo chỉ sang "Sửa ngày trả", KHÔNG bắt nhận phòng lại',
      /Sửa ngày trả/.test((lan2.json && lan2.json.error) || '') && !/nhận phòng lại/.test((lan2.json && lan2.json.error) || ''),
      lan2.json && lan2.json.error);

    // ── 3. "Sửa ngày trả" của BQL: lùi tiếp về -3 ───────────────────────────────────────
    const sn = await t.api('PUT', `/api/students/${s1}/checkout-date`, T, { date: ngay(-3), note: 'Báo lại: rời từ -3' });
    t.eq('Sửa ngày trả → 200', sn.status, 200, `HTTP ${sn.status} ${sn.json && sn.json.error || ''}`);
    t.eq('Hồ sơ ghi ngày mới -3', (await hoSo(s1)).co, ngay(-3));
    t.eq('Lượt ở dời theo -3', (await luotCuoi(s1)).den, ngay(-3));

    // ── 4. An ninh: biết rời từ -2 → LẬP BIÊN BẢN ngày -2, quản trị xác nhận (BL-121) ────
    await t.db.query(`INSERT INTO users (username,password_hash,role,approved) VALUES ($1,$2,'maintenance',true)`,
      [P + '_anninh', bcrypt.hashSync(PW, 10)]);
    const AN = await t.login(P + '_anninh', PW);
    const s2 = await dung(P + '_B');
    const gо = await t.api('PUT', `/api/maintenance/handovers/${s2}/checkout-date`, AN, { date: ngay(-2) });
    t.eq('An ninh sửa ngày trả THẲNG vào hồ sơ đã gỡ → 404', gо.status, 404, `HTTP ${gо.status}`);
    const bb = await t.api('POST', '/api/maintenance/reports', AN, { kind: 'checkout', student_id: s2, date: ngay(-2), meter_reading: 50, note: 'Bạn ấy rời từ -2, nay mới báo' });
    t.eq('An ninh lập biên bản trả phòng ngày -2 → 200', bb.status, 200, `HTTP ${bb.status} ${bb.json && bb.json.error || ''}`);
    h = await hoSo(s2);
    t.ok('Biên bản chưa đổi hồ sơ: vẫn đang ở', h.status === 'in' && !h.co, JSON.stringify(h));
    const ok = await t.api('POST', `/api/handover-reports/${bb.json.id}/approve`, T, {});
    t.eq('Quản trị xác nhận biên bản → 200', ok.status, 200, `HTTP ${ok.status} ${ok.json && ok.json.error || ''}`);
    h = await hoSo(s2);
    t.ok('Ngày rời thật VÀ ngày bàn giao cùng là -2 (lõi trả phòng dùng chung đặt cả hai mốc)',
      h.co === ngay(-2) && h.bg === ngay(-2) && h.status === 'out', JSON.stringify(h));
    t.eq('Lượt ở đóng -2', (await luotCuoi(s2)).den, ngay(-2));
    t.ok('Có nhật ký "out"', (await t.db.query(
      `SELECT COUNT(*)::int c FROM logs WHERE student_id=$1 AND type='out'`, [s2])).rows[0].c >= 1);
    t.ok('Check-out tay của BQL (bước 1) cũng đặt mốc xác nhận — an ninh không còn thấy nút thừa',
      (await hoSo(s1)).bg === ngay(-3), JSON.stringify(await hoSo(s1)));

    await clean(t.db);
  },
};
