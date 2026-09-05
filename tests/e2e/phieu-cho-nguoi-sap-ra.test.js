// Owner 05/09: đã ĐĂNG KÝ TRẢ giữa kỳ (planned_check_out) thì phiếu kỳ đó phải cắt ở ngày dự kiến
// trả, không tính đủ 30 ngày. Đối xứng với chiều vào (04/09): thu trước theo lịch, xác nhận trả
// thật thì phiếu tự tính lại theo ngày thật (check-out sẵn có recalc + dọn phiếu kỳ sau).
const P = '__test_psr';

const congNgay = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Phiếu cho người ĐÃ ĐĂNG KÝ TRẢ giữa kỳ — cắt ở ngày dự kiến, xác nhận thật thì tính lại',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;

    const lichRa = congNgay(5);           // đã đăng ký trả 5 ngày nữa
    const ky = lichRa.slice(0, 7);
    const vao = congNgay(-40);            // ở từ hơn một tháng trước
    const sid = (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,planned_check_out,status,rental_type)
       VALUES ($1,$2,'male',$3,$4,$5,'in','ghep') RETURNING id`, [P + '_A', P + ' Sắp Ra', rid, vao, lichRa])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [sid, rid, vao]);
    // Chốt chỉ số điện kỳ M-1 cho phòng — thiếu là cả phòng bị bỏ qua khi lập phiếu (đúng luật, ngoài đề bài này)
    const [ny, nm] = ky.split('-').map(Number);
    const kyDien = nm === 1 ? `${ny - 1}-12` : `${ny}-${String(nm - 1).padStart(2, '0')}`;
    await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,0,50,50)`, [rid, kyDien]);

    const g = await t.api('POST', '/api/invoices/generate', T, { month: ky });
    t.eq('Lập phiếu kỳ có người đã đăng ký trả → 200', g.status, 200, `HTTP ${g.status} ${g.json && g.json.error || ''}`);
    const i1 = (await t.db.query(
      `SELECT days_stayed, room_charge FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [sid, ky])).rows[0];
    const ngayLich = +lichRa.slice(8);
    t.ok('Phiếu CẮT ở ngày dự kiến trả, không tính đủ tháng', !!i1 && +i1.days_stayed === ngayLich,
      `days=${i1 && i1.days_stayed} · kỳ vọng ${ngayLich} (lịch trả ${lichRa})`);

    // ── Xác nhận trả THẬT sớm hơn lịch (hôm nay) → phiếu tính lại theo ngày thật ─────────
    if (congNgay(0).slice(0, 7) === ky) {
      const co = await t.api('POST', `/api/students/${sid}/checkout`, T, { date: congNgay(0), reason: 'personal' });
      t.eq('Xác nhận trả hôm nay → 200', co.status, 200, `HTTP ${co.status} ${co.json && co.json.error || ''}`);
      const i2 = (await t.db.query(
        `SELECT days_stayed FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [sid, ky])).rows[0];
      t.eq('Phiếu tính lại theo ngày rời THẬT (sớm hơn lịch)', +i2.days_stayed, +congNgay(0).slice(8), JSON.stringify(i2));
    } else console.log('  [BỎ QUA] lịch trả rơi sang tháng sau — ca xác nhận chạy ở lần test giữa tháng');

    await clean(t.db);
  },
};
