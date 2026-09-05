// Owner 05/09: bấm "Đã thu cả kỳ" xong ai xác nhận trả phòng thì phiếu vẫn nguyên giá — vì phiếu
// ĐÃ THU là chốt cứng (đúng luật). Owner chọn: giữ chốt + app phải NÓI TO (canh_bao khi check-out)
// + data-health có mục "phiếu đã thu lệch ngày ở thật"; mở khoá → Tính lại thì phiếu về đúng.
const P = '__test_ptl';

const congNgay = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_leaders WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Phiếu ĐÃ THU + trả phòng giữa kỳ — chốt cứng nhưng phải cảnh báo, mở khoá tính lại là đúng',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;
    const sid = (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type)
       VALUES ($1,$2,'male',$3,$4,'in','ghep') RETURNING id`, [P + '_A', P + ' Đã Thu', rid, congNgay(-40)])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [sid, rid, congNgay(-40)]);
    const ky = congNgay(0).slice(0, 7);
    const inv = (await t.db.query(
      `INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, total, status, paid_date)
       VALUES ($1,$2,$3,30,1200000,1200000,'paid',CURRENT_DATE) RETURNING id`, [sid, rid, ky])).rows[0].id;

    // ── Xác nhận trả giữa kỳ: phiếu đã thu ĐỨNG YÊN nhưng phản hồi phải CẢNH BÁO rõ ──────
    const ngayRoi = congNgay(-1).slice(0, 7) === ky ? congNgay(-1) : congNgay(0);   // mùng 1 thì rời hôm nay
    const co = await t.api('POST', `/api/students/${sid}/checkout`, T, { date: ngayRoi, reason: 'personal' });
    t.eq('Check-out → 200', co.status, 200, `HTTP ${co.status} ${co.json && co.json.error || ''}`);
    const i1 = (await t.db.query(`SELECT days_stayed, total, status FROM invoices WHERE id=$1`, [inv])).rows[0];
    t.ok('Phiếu đã thu giữ nguyên (không ghi đè tiền đã cầm)', +i1.days_stayed === 30 && i1.status === 'paid', JSON.stringify(i1));
    t.ok('Phản hồi check-out có CẢNH BÁO nêu rõ chênh lệch',
      /ĐÃ THU/.test(co.json.canh_bao || '') && /30 ngày/.test(co.json.canh_bao || ''),
      JSON.stringify(co.json.canh_bao));

    // ── Data-health chỉ mặt phiếu đã-thu-lệch-ngày-ở ─────────────────────────────────────
    const dh = await t.api('GET', '/api/admin/data-health', T);
    const muc = ((dh.json || {}).checks || []).find(x => x.ma === 'da_thu_lech_ngay_o');
    t.ok('Data-health có mục "da_thu_lech_ngay_o" và bắt được phiếu này', !!muc && (muc.so_luong || 0) >= 1,
      muc ? `so_luong=${muc.so_luong}` : 'không có mục');

    // ── Đường xử đúng: mở khoá về Chưa thu → Tính lại → phiếu về đúng ngày ───────────────
    t.eq('Mở khoá phiếu → 200', (await t.api('POST', `/api/invoices/${inv}/status`, T, { status: 'pending' })).status, 200);
    t.eq('Tính lại → 200', (await t.api('POST', `/api/invoices/${inv}/recalc`, T)).status, 200);
    const i2 = (await t.db.query(`SELECT days_stayed FROM invoices WHERE id=$1`, [inv])).rows[0];
    t.eq('Phiếu về đúng ngày ở thật', +i2.days_stayed, +ngayRoi.slice(8), JSON.stringify(i2));

    await clean(t.db);
  },
};
