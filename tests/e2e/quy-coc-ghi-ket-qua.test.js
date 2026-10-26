// Quỹ cọc chỉ LƯU THÔNG TIN (tiền thật do Bravo chuyển): ghi nhận cọc được để trống ngày đóng (cọc đóng ngoài app
// từ trước), người đã trả phòng ghi kết quả Hoàn cọc / Không hoàn cọc (bắt buộc lý do), đã ghi thì không ghi lại.
// CHỈ LOCAL.
const P = '__test_qcoc';

async function clean(db) {
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices    WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays  WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs        WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}
const mkStu = (db, code, room, ci, co) =>
  db.query(`INSERT INTO students (code,name,gender,room_id,check_in_date,check_out_date,status,rental_type,residency_status,deposit_amount,deposit_status)
            VALUES ($1,$1,'female',$2,$3,$4,$5,'ghep','unregistered',0,'none') RETURNING id`, [code, room, ci, co, co ? 'out' : 'in']).then(r => r.rows[0].id);
const coc = (db, id) => db.query(`SELECT deposit_status, deposit_amount::float AS amt, to_char(deposit_date,'YYYY-MM-DD') AS ngay,
  to_char(deposit_refund_date,'YYYY-MM-DD') AS ngay_xl, deposit_deduction_note AS ly FROM students WHERE id=$1`, [id]).then(r => r.rows[0]);

module.exports = {
  name: 'Quỹ cọc — ghi nhận cọc không rõ ngày, ghi kết quả hoàn / không hoàn kèm lý do',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rm = (await t.db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'female','B',1200000) RETURNING id`, [P + '_R', fac])).rows[0].id;

    // ---- Ghi nhận cọc ----
    const a = await mkStu(t.db, P + '_a', rm, '2026-03-01', null);
    const r1 = await t.api('POST', `/api/students/${a}/deposit`, T, { amount: 1200000, date: null });
    const c1 = await coc(t.db, a);
    t.ok('Ghi nhận cọc với "date": null → 200', r1.status === 200, `HTTP ${r1.status}`);
    t.eq('… đang giữ cọc 1.200.000, ngày đóng để trống', [c1.deposit_status, c1.amt, c1.ngay], ['held', 1200000, null]);

    const b = await mkStu(t.db, P + '_b', rm, '2026-03-01', null);
    await t.api('POST', `/api/students/${b}/deposit`, T, { amount: 1200000 });
    const c2 = await coc(t.db, b);
    t.ok('Không gửi ngày → vẫn lấy ngày hôm nay như trước', c2.deposit_status === 'held' && /^\d{4}-\d{2}-\d{2}$/.test(c2.ngay || ''), JSON.stringify(c2));

    const r3 = await t.api('POST', `/api/students/${b}/deposit`, T, { amount: 1200000, date: '2026-13-40' });
    t.ok('Ngày sai định dạng → 400', r3.status === 400, `HTTP ${r3.status}`);

    // ---- Ghi kết quả cho người đã trả phòng ----
    const h = await mkStu(t.db, P + '_h', rm, '2026-03-01', '2026-09-30');
    await t.db.query(`UPDATE students SET deposit_status='held', deposit_amount=1200000 WHERE id=$1`, [h]);
    const rh = await t.api('POST', `/api/students/${h}/deposit-settle`, T, { action: 'refund', date: '2026-10-05', deduction_note: '' });
    const ch = await coc(t.db, h);
    t.ok('Hoàn cọc → 200 (trước đây luôn 500)', rh.status === 200, `HTTP ${rh.status} ${JSON.stringify(rh.json || '')}`);
    t.eq('… ghi "đã hoàn", ngày xử lý 05/10', [ch.deposit_status, ch.ngay_xl], ['refunded', '2026-10-05']);

    const k = await mkStu(t.db, P + '_k', rm, '2026-03-01', '2026-09-30');
    await t.db.query(`UPDATE students SET deposit_status='held', deposit_amount=1200000 WHERE id=$1`, [k]);
    const rk0 = await t.api('POST', `/api/students/${k}/deposit-settle`, T, { action: 'forfeit' });
    t.ok('Không hoàn cọc mà thiếu lý do → 400', rk0.status === 400, `HTTP ${rk0.status}`);
    const rk0b = await t.api('POST', `/api/students/${k}/deposit-settle`, T, { action: 'forfeit', deduction_note: '   ' });
    t.ok('… lý do toàn dấu cách cũng → 400', rk0b.status === 400, `HTTP ${rk0b.status}`);
    t.eq('… cọc vẫn đang giữ', (await coc(t.db, k)).deposit_status, 'held');
    const rk = await t.api('POST', `/api/students/${k}/deposit-settle`, T, { action: 'forfeit', deduction_note: 'Báo trước dưới 30 ngày' });
    const ck = await coc(t.db, k);
    t.ok('Không hoàn cọc kèm lý do → 200', rk.status === 200, `HTTP ${rk.status}`);
    t.eq('… ghi "không hoàn" và lưu lý do', [ck.deposit_status, ck.ly], ['forfeited', 'Báo trước dưới 30 ngày']);

    const rLai = await t.api('POST', `/api/students/${h}/deposit-settle`, T, { action: 'forfeit', deduction_note: 'đổi ý' });
    t.ok('Đã ghi kết quả thì không ghi lại → 409', rLai.status === 409, `HTTP ${rLai.status}`);

    const dangO = await mkStu(t.db, P + '_o', rm, '2026-03-01', null);
    await t.db.query(`UPDATE students SET deposit_status='held', deposit_amount=1200000 WHERE id=$1`, [dangO]);
    const rO = await t.api('POST', `/api/students/${dangO}/deposit-settle`, T, { action: 'refund' });
    t.ok('Người còn đang ở → chưa ghi kết quả được (400)', rO.status === 400, `HTTP ${rO.status}`);

    const ds = await t.api('GET', '/api/students', T);
    const dong = (Array.isArray(ds.json) ? ds.json : ((ds.json || {}).rows || [])).find(s => s.id === k);
    t.eq('Danh sách học viên trả kèm lý do (Quỹ cọc hiện được)', dong && dong.deposit_deduction_note, 'Báo trước dưới 30 ngày');

    await clean(t.db);
  },
};
