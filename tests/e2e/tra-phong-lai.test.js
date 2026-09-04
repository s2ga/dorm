// Chốt lịch trả (đơn duyệt, ngày tương lai) rồi ghi ngày rời THỰC TẾ bằng Check-out — không bị 409,
// không bắt đi vòng check-in lại, và room_stays phải dời theo ngày mới (tiền điện chia đúng ngày).
const P = '__test_tplai';

const ngay = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function clean(db) {
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN (SELECT id FROM students WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%' OR code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Trả phòng lại — chốt lịch tương lai rồi ghi ngày rời thực tế',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, floor, gender, capacity, monthly_fee) VALUES ($1, 9, 'male', 4, 1000000) RETURNING id`,
      [P + '_R'])).rows[0].id;

    const dung = async ten => {
      const sid = (await t.db.query(
        `INSERT INTO students (name, code, gender, room_id, check_in_date, status, rental_type)
         VALUES ($1, $2, 'male', $3, $4, 'in', 'ghep') RETURNING id`,
        [P + ' ' + ten, P + '_' + ten, rid, ngay(-30)])).rows[0].id;
      await t.db.query(`INSERT INTO room_stays (student_id, room_id, from_date, to_date) VALUES ($1,$2,$3,NULL)`,
        [sid, rid, ngay(-30)]);
      return sid;
    };
    const hoso = async sid => (await t.db.query(
      `SELECT status, check_out_date::text co, planned_check_out::text lich FROM students WHERE id=$1`, [sid])).rows[0];
    const luotCuoi = async sid => (await t.db.query(
      `SELECT from_date::text f, to_date::text den FROM room_stays WHERE student_id=$1 ORDER BY from_date DESC, id DESC LIMIT 1`, [sid])).rows[0];

    // ── Ca 1: đơn duyệt ngày tương lai → vẫn ĐANG Ở, rồi check-out ngày thực tế sớm hơn ──
    const s1 = await dung('A');
    const crid = (await t.db.query(
      `INSERT INTO checkout_requests (student_id, desired_date, reason) VALUES ($1,$2,'departure') RETURNING id`,
      [s1, ngay(4)])).rows[0].id;
    const duyet = await t.api('POST', `/api/requests/checkout/${crid}/confirm`, T, { date: ngay(4) });
    t.ok('Duyệt đơn → 200', duyet.status === 200, `HTTP ${duyet.status} ${duyet.json && duyet.json.error || ''}`);

    let h = await hoso(s1);
    t.eq('Sau duyệt (ngày +4): status vẫn in — chưa rời', h.status, 'in', JSON.stringify(h));
    t.eq('Lịch trả đã chốt vào hồ sơ (dự kiến)', (h.lich || '').slice(0, 10), ngay(4), JSON.stringify(h));
    t.ok('Ngày trả THẬT còn trống — BL-117: duyệt đơn không phải xác nhận rời', !h.co, JSON.stringify(h));
    let lc = await luotCuoi(s1);
    t.eq('Lượt ở CHƯA đóng (điện vẫn chia tới ngày xác nhận thật)', lc.den, null, JSON.stringify(lc));

    const co1 = await t.api('POST', `/api/students/${s1}/checkout`, T, { date: ngay(1), reason: 'departure' });
    t.ok('Check-out ngày thực tế (+1) → 200, KHÔNG 409 bắt đi vòng', co1.status === 200,
      `HTTP ${co1.status} ${co1.json && co1.json.error || ''}`);
    h = await hoso(s1);
    t.eq('Ngày rời thực tế đè lên lịch', (h.co || '').slice(0, 10), ngay(1), h.co);
    lc = await luotCuoi(s1);
    t.eq('room_stays DỜI theo ngày thực tế (tiền điện chia đúng)', (lc.den || '').slice(0, 10), ngay(1), JSON.stringify(lc));

    // ── Ca 2: hồ sơ CŨ trước bản vá — status='out' nhưng ngày còn tương lai ──
    const s2 = await dung('B');
    await t.db.query(`UPDATE students SET status='out', check_out_date=$1 WHERE id=$2`, [ngay(5), s2]);
    await t.db.query(`UPDATE room_stays SET to_date=$1 WHERE student_id=$2`, [ngay(5), s2]);
    const co2 = await t.api('POST', `/api/students/${s2}/checkout`, T, { date: ngay(0), reason: 'other' });
    t.ok('Hồ sơ cũ kẹt out+ngày tương lai: check-out vẫn được', co2.status === 200,
      `HTTP ${co2.status} ${co2.json && co2.json.error || ''}`);
    lc = await luotCuoi(s2);
    t.eq('Lượt cuối (đã đóng ở ngày cũ) được dời về ngày mới', (lc.den || '').slice(0, 10), ngay(0), JSON.stringify(lc));

    // ── Ca 3: đã rời THẬT thì vẫn chặn như cũ ──
    const co3 = await t.api('POST', `/api/students/${s2}/checkout`, T, { date: ngay(0), reason: 'other' });
    t.eq('Đã rời thật (ngày <= hôm nay) → check-out lần nữa vẫn 409', co3.status, 409,
      `HTTP ${co3.status} ${co3.json && co3.json.error || ''}`);
  },
};
