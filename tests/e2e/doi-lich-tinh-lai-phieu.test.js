// Lịch vào/ra là ngày TÍNH TIỀN (04-05/09) → ĐỔI LỊCH là phiếu phải tính lại NGAY, không đợi ai
// bấm "Tính lại": sửa ô ngày trả ở form hồ sơ (PUT) và chốt lịch qua duyệt đơn đều recalc; phiếu
// ĐÃ THU thì để yên.
const P = '__test_dltl';

const congNgay = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Đổi lịch trả → phiếu tự tính lại (form hồ sơ + duyệt đơn); phiếu đã thu để yên',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const ky = congNgay(0).slice(0, 7);
    if (congNgay(11).slice(0, 7) !== ky) { console.log('  [BỎ QUA] sát cuối tháng — bài này cần các mốc +6/+8/+10 cùng tháng'); return; }
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;
    const [ny, nm] = ky.split('-').map(Number);
    const kyDien = nm === 1 ? `${ny - 1}-12` : `${ny}-${String(nm - 1).padStart(2, '0')}`;
    await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,0,50,50)`, [rid, kyDien]);
    const sid = (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type)
       VALUES ($1,$2,'male',$3,$4,'in','ghep') RETURNING id`, [P + '_A', P + ' Đổi Lịch', rid, congNgay(-40)])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [sid, rid, congNgay(-40)]);

    const g = await t.api('POST', '/api/invoices/generate', T, { month: ky });
    t.eq('Lập phiếu kỳ này → 200', g.status, 200, `HTTP ${g.status}`);
    const ngayO = async () => { const r = (await t.db.query(`SELECT days_stayed FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [sid, ky])).rows[0]; return r ? +r.days_stayed : null; };
    t.ok('Chưa có lịch trả → phiếu trọn tháng', (await ngayO()) >= 28, `days=${await ngayO()}`);

    // ── Sửa ô "ngày trả" ở FORM HỒ SƠ → phiếu tự tính lại, không cần bấm gì thêm ─────────
    const cur = (await t.api('GET', `/api/students/${sid}`, T)).json;
    const p1 = await t.api('PUT', `/api/students/${sid}`, T, { ...cur, _v: cur._v, check_out_date: congNgay(6) });
    t.eq('Đặt lịch trả +6 qua form → 200', p1.status, 200, `HTTP ${p1.status} ${p1.json && p1.json.error || ''}`);
    t.eq('Phiếu TỰ cắt về ngày lịch mới (+6)', await ngayO(), +congNgay(6).slice(8));

    // ── Chốt lịch khác qua DUYỆT ĐƠN trả phòng → phiếu cũng tự tính lại ──────────────────
    const cr = (await t.db.query(
      `INSERT INTO checkout_requests (student_id, status, desired_date, reason, created_at) VALUES ($1,'pending',$2,'normal',now()) RETURNING id`,
      [sid, congNgay(10)])).rows[0].id;
    const d = await t.api('POST', `/api/requests/checkout/${cr}/confirm`, T, { date: congNgay(10) });
    t.eq('Duyệt đơn chốt lịch +10 → 200', d.status, 200, `HTTP ${d.status} ${d.json && d.json.error || ''}`);
    t.eq('Phiếu TỰ dời theo lịch mới (+10)', await ngayO(), +congNgay(10).slice(8));

    // ── Phiếu ĐÃ THU: đổi lịch KHÔNG được đụng vào ───────────────────────────────────────
    await t.db.query(`UPDATE invoices SET status='paid', paid_date=CURRENT_DATE WHERE student_id=$1 AND month=$2`, [sid, ky]);
    const cur2 = (await t.api('GET', `/api/students/${sid}`, T)).json;
    const p2 = await t.api('PUT', `/api/students/${sid}`, T, { ...cur2, _v: cur2._v, check_out_date: congNgay(8) });
    t.eq('Đổi lịch khi phiếu đã thu → hồ sơ vẫn lưu được', p2.status, 200, `HTTP ${p2.status} ${p2.json && p2.json.error || ''}`);
    t.eq('Phiếu ĐÃ THU giữ nguyên số ngày (không tính đè tiền đã thu)', await ngayO(), +congNgay(10).slice(8));

    await clean(t.db);
  },
};
