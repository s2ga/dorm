// Toàn vẹn ĐƯỜNG TIỀN của trang Tiền phòng — canh vĩnh viễn các lỗ đã vá (bộ TIENPHONG).
// Đây là sổ sách tiền: khoá "đã thu", một phiếu một con số, chặn số vô lý.
const P = '__test_money';

async function clean(db) {
  await db.query(`DELETE FROM invoices    WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays  WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_leaders WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Toàn vẹn đường tiền — Tiền phòng (khoá đã thu, một con số)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const room = (await t.db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'female','B',1200000) RETURNING id`, [P + '_R', fac])).rows[0].id;
    const s = (await t.db.query(`INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,deposit_amount) VALUES ($1,$1,'female',$2,'2026-07-01','in','ghep','unregistered',0) RETURNING id`, [P + '_hv', room])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [s, room]);
    // Phòng trưởng -> có leader_discount
    await t.db.query(`INSERT INTO room_leaders (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [s, room]);

    await t.api('POST', '/api/invoices/generate-one', T, { student_id: s, month: '2026-07' });
    const inv = (await t.db.query(`SELECT id,total,leader_discount FROM invoices WHERE student_id=$1 AND month='2026-07'`, [s])).rows[0];
    const id = inv.id;
    t.ok('Phiếu phòng trưởng có khoản giảm để kiểm', +inv.leader_discount > 0, `leader_discount=${inv.leader_discount}`);

    // TP-08/11 · PUT trừ khoản giảm -> total không nhảy lên bằng khoản giảm
    const cur = (await t.db.query(`SELECT * FROM invoices WHERE id=$1`, [id])).rows[0];
    // PUT là GHI ĐÈ TOÀN PHẦN, không hợp nhất: thiếu trường nào thì trường đó về 0. Gửi ĐỦ đúng
    // như form Sửa hoá đơn gửi (saveInvoice), không thì mất tiền cọc rồi tưởng total sai.
    await t.api('PUT', `/api/invoices/${id}`, T, { room_charge: cur.room_charge, electric_charge: cur.electric_charge, water_charge: cur.water_charge, service_charge: cur.service_charge, washing_charge: cur.washing_charge, parking_charge: cur.parking_charge, other_charge: cur.other_charge, deposit_charge: cur.deposit_charge, days_stayed: cur.days_stayed, electric_kwh: cur.electric_kwh });
    const afterPut = (await t.db.query(`SELECT total FROM invoices WHERE id=$1`, [id])).rows[0].total;
    t.eq('TP-08: PUT giữ đúng total (đã trừ giảm, không tăng bằng khoản giảm)', +afterPut, +inv.total);

    // TP-11 · recalc = PUT (cùng một con số)
    await t.api('POST', `/api/invoices/${id}/recalc`, T);
    const afterRc = (await t.db.query(`SELECT total FROM invoices WHERE id=$1`, [id])).rows[0].total;
    t.eq('TP-11: recalc ra cùng total với PUT', +afterRc, +afterPut);

    // Đánh dấu ĐÃ THU
    await t.api('POST', `/api/invoices/${id}/status`, T, { status: 'paid' });

    // TP-07 · recalc phiếu đã thu -> 400, total không đổi
    const r7 = await t.api('POST', `/api/invoices/${id}/recalc`, T);
    const t7 = (await t.db.query(`SELECT total FROM invoices WHERE id=$1`, [id])).rows[0].total;
    t.ok('TP-07: recalc phiếu ĐÃ THU bị chặn (400) + total giữ nguyên', r7.status === 400 && +t7 === +afterRc, `HTTP ${r7.status} · total ${t7}`);

    // TP-09 · xoá phiếu đã thu -> 400
    const r9 = await t.api('DELETE', `/api/invoices/${id}`, T);
    const del = (await t.db.query(`SELECT deleted_at FROM invoices WHERE id=$1`, [id])).rows[0];
    t.ok('TP-09: xoá phiếu ĐÃ THU bị chặn (400) + không xoá', r9.status === 400 && !del.deleted_at, `HTTP ${r9.status} · deleted_at=${del.deleted_at}`);

    // TP-24 · status lạ -> 400 (không âm thầm về pending)
    const r24 = await t.api('POST', `/api/invoices/${id}/status`, T, { status: 'PAID' });
    const st24 = (await t.db.query(`SELECT status FROM invoices WHERE id=$1`, [id])).rows[0].status;
    t.ok('TP-24: status="PAID" (hoa) → 400, phiếu vẫn "paid"', r24.status === 400 && st24 === 'paid', `HTTP ${r24.status} · status=${st24}`);

    // TP-10 · gỡ paid → có dòng nhật ký kèm total
    await t.api('POST', `/api/invoices/${id}/status`, T, { status: 'pending' });
    await new Promise(r => setTimeout(r, 300));
    const au = (await t.db.query(`SELECT detail FROM audit_log WHERE method='STATUS' AND path LIKE '%/invoices/${id}%' ORDER BY id DESC LIMIT 1`)).rows[0];
    t.ok('TP-10: gỡ "đã thu" được ghi nhật ký kèm total', au && /total/.test(au.detail), au ? au.detail : '(không có dòng)');

    // TP-14 · days_stayed vượt số ngày tháng -> 400
    const r14 = await t.api('POST', '/api/invoices', T, { student_id: s, month: '2026-08', room_charge: 1000000, days_stayed: 99999 });
    t.ok('TP-14: days_stayed=99999 (tháng 31 ngày) → 400', r14.status === 400, `HTTP ${r14.status}`);
    await t.db.query(`DELETE FROM invoices WHERE student_id=$1 AND month='2026-08'`, [s]);

    // TP-19 · GET /electric thiếu month -> 400
    const r19 = await t.api('GET', '/api/electric', T);
    t.ok('TP-19: GET /electric thiếu month → 400 (không 500)', r19.status === 400, `HTTP ${r19.status}`);
  },
};
