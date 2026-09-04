// BL-74: học viên đóng tiền đầu tháng rồi giữa tháng trả phòng — bàn giao xong bấm "Lập phiếu thu"
// là tắc, mà refund-done lại đòi trạng thái 'billed' nên KHÔNG bao giờ hoàn cọc được. Lối thoát có
// thật (chuyển phiếu về "chưa thu" rồi lập lại), câu báo lỗi phải chỉ ra nó.
const P = '__test_bl74';

async function clean(db) {
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM meter_reads WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'BL-74 · lập phiếu trả phòng khi hoá đơn kỳ đó đã thu — báo lỗi phải chỉ đường thoát',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rm = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'female','B',1200000) RETURNING id`,
      [P + '_r', fac])).rows[0].id;
    const sid = (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,check_out_date,status,rental_type,residency_status,deposit_amount,deposit_status)
       VALUES ($1,$1,'female',$2,'2026-07-01','2026-07-20','out','ghep','unregistered',1000000,'held') RETURNING id`,
      [P + '_s1', rm])).rows[0].id;
    await t.db.query(
      `INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,'2026-07-01','2026-07-20')`, [sid, rm]);
    // Chỉ số công-tơ ngày bàn giao — thiếu là bị chặn ở chốt khác, không tới được nhánh đang kiểm.
    await t.db.query(
      `INSERT INTO meter_reads (room_id,read_date,reading,reason) VALUES ($1,'2026-07-20',1150,'checkout')`, [rm]);
    await t.db.query(
      `INSERT INTO electric_readings (room_id,month,reading_start,reading_end,kwh) VALUES ($1,'2026-06',1000,1100,100)`, [rm]);

    // Hoá đơn kỳ trả phòng ĐÃ THU — đúng tình huống thường gặp: đóng đầu tháng, giữa tháng trả phòng.
    const inv = (await t.db.query(
      `INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, total, status, paid_date)
       VALUES ($1,$2,'2026-07',20,232258,232258,'paid',CURRENT_DATE) RETURNING id`, [sid, rm])).rows[0].id;
    const cr = (await t.db.query(
      `INSERT INTO checkout_requests (student_id, status, desired_date, reason, created_at)
       VALUES ($1,'handed_over','2026-07-20','normal',now()) RETURNING id`, [sid])).rows[0].id;

    try {
      const bill = await t.api('POST', `/api/requests/checkout/${cr}/bill`, T);
      t.eq('TC-74a · hoá đơn kỳ đó đã thu → chặn lập phiếu (400)', bill.status, 400,
        `HTTP ${bill.status} ${JSON.stringify(bill.json)}`);
      const msg = (bill.json && bill.json.error) || '';
      t.ok('TC-74b · câu báo lỗi nói rõ ĐƯỜNG THOÁT: chuyển phiếu về "chưa thu" rồi lập lại',
        /chưa thu/i.test(msg) && /lập phiếu lại|lập lại/i.test(msg), JSON.stringify(bill.json));
      t.ok('TC-74c · … và chỉ đúng SỐ PHIẾU phải mở, khỏi phải đi mò', msg.includes('#' + inv), msg);
      t.ok('TC-74d · … và nói đơn đang kẹt ở bước nào, vì sao chưa hoàn cọc được',
        /bàn giao/i.test(msg) && /hoàn cọc/i.test(msg), msg);

      // Đi đúng đường mà câu báo lỗi chỉ: phải thoát được thật, không phải lời khuyên suông.
      const mo = await t.api('POST', `/api/invoices/${inv}/status`, T, { status: 'pending' });
      t.eq('TC-74e · chuyển phiếu về "chưa thu" → 200', mo.status, 200, `HTTP ${mo.status}`);
      const lai = await t.api('POST', `/api/requests/checkout/${cr}/bill`, T);
      t.eq('TC-74f · lập phiếu lại → 200 (đơn thoát khỏi thế kẹt)', lai.status, 200,
        `HTTP ${lai.status} ${JSON.stringify(lai.json)}`);
      const st = (await t.db.query('SELECT status FROM checkout_requests WHERE id=$1', [cr])).rows[0].status;
      t.eq('TC-74g · đơn sang bước "đã lập phiếu" → hoàn cọc với tới được', st, 'billed', `status=${st}`);
      const rf = await t.api('POST', `/api/requests/checkout/${cr}/refund-done`, T);
      t.eq('TC-74h · đánh dấu hoàn cọc → 200 (trước đây không bao giờ tới được bước này)',
        rf.status, 200, `HTTP ${rf.status} ${JSON.stringify(rf.json)}`);
    } finally {
      await clean(t.db);
    }
  },
};
