// Lịch sử ở & nhất quán nguồn dữ liệu: room_stays là nguồn sự thật về ở/rời, logs chỉ là nhật ký
// thao tác. API /students/:id/stays phải nói thẳng mốc nào không có nhật ký (ghi từ hồ sơ);
// lập phiếu phải tự dọn phiếu CHƯA THU của người đã rời trước kỳ; data-health phải canh lệch.
const P = '__test_lso';

async function clean(db) {
  await db.query(`DELETE FROM invoices   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Lịch sử ở — room_stays là nguồn sự thật, dọn phiếu người đã rời',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const room = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'male','B',1000000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;
    const mkStu = async (n, r) => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status)
       VALUES ($1,$1,'male',$2,'2026-07-01','in','ghep','unregistered') RETURNING id`, [P + n, r || null])).rows[0].id;

    // ===== A: trả phòng QUA NÚT -> lượt ở đóng, có nhật ký ra
    const A = await mkStu('_A', room);
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [A, room]);
    await t.db.query(`INSERT INTO logs (student_id,type,date,room_id,note,source) VALUES ($1,'in','2026-07-01',$2,'Đăng ký & vào ở','admin')`, [A, room]);
    const co = await t.api('POST', `/api/students/${A}/checkout`, T, { date: '2026-07-10', reason: 'personal' });
    t.ok('Trả phòng qua nút → OK', co.status === 200, `HTTP ${co.status}`);
    const sa = await t.api('GET', `/api/students/${A}/stays`, T);
    t.ok('GET /stays trả về lượt ở', sa.status === 200 && (sa.json.stays || []).length === 1, JSON.stringify(sa.json));
    const a0 = (sa.json.stays || [])[0] || {};
    t.eq('Lượt ở ĐÓNG đúng ngày trả (nguồn sự thật)', a0.to_date, '2026-07-10', JSON.stringify(a0));
    t.ok('Có nhật ký vào lẫn ra (đi qua nút thì log đủ)', a0.log_vao != null && a0.log_ra != null,
      `log_vao=${JSON.stringify(a0.log_vao)} log_ra=${JSON.stringify(a0.log_ra)}`);

    // ===== B: ngày trả GHI THẲNG vào dữ liệu (kiểu nạp ban đầu) -> không có nhật ký ra
    const B = await mkStu('_B');
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,'2026-07-01','2026-07-05')`, [B, room]);
    await t.db.query(`UPDATE students SET status='out', room_id=NULL, check_out_date='2026-07-05' WHERE id=$1`, [B]);
    const sb = await t.api('GET', `/api/students/${B}/stays`, T);
    const b0 = ((sb.json || {}).stays || [])[0] || {};
    t.eq('Lượt ở vẫn cho thấy ngày rời 05/07 (dù không ai bấm Check-out)', b0.to_date, '2026-07-05', JSON.stringify(b0));
    t.ok('log_ra = null → màn hình gắn nhãn "ghi từ hồ sơ", không im lặng', b0.log_ra == null, JSON.stringify(b0.log_ra));

    // ===== Dọn phiếu người đã rời: B rời 05/07 mà lại có phiếu kỳ 08 (rác) + phiếu ĐÃ THU (không đụng)
    await t.db.query(`INSERT INTO invoices (student_id,room_id,month,days_stayed,room_charge,total,status)
      VALUES ($1,$2,'2026-08',31,1200000,1200000,'pending')`, [B, room]);
    const C = await mkStu('_C');
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,'2026-07-01','2026-07-05')`, [C, room]);
    await t.db.query(`UPDATE students SET status='out', room_id=NULL, check_out_date='2026-07-05' WHERE id=$1`, [C]);
    await t.db.query(`INSERT INTO invoices (student_id,room_id,month,days_stayed,room_charge,total,status,paid_date)
      VALUES ($1,$2,'2026-08',31,1200000,1200000,'paid','2026-08-01')`, [C, room]);

    const g = await t.api('POST', '/api/invoices/generate', T, { month: '2026-08' });
    t.ok('Lập phiếu kỳ 08 chạy được', g.status === 200, `HTTP ${g.status}`);
    t.ok('Có báo số phiếu rác đã dọn (cleaned ≥ 1)', (g.json.cleaned || 0) >= 1, `cleaned=${g.json.cleaned}`);
    const invB = (await t.db.query(`SELECT deleted_at FROM invoices WHERE student_id=$1 AND month='2026-08'`, [B])).rows[0];
    t.ok('Phiếu CHƯA THU của người đã rời → bị dọn (xoá mềm)', invB && invB.deleted_at, `deleted_at=${invB && invB.deleted_at}`);
    const invC = (await t.db.query(`SELECT deleted_at FROM invoices WHERE student_id=$1 AND month='2026-08'`, [C])).rows[0];
    t.ok('Phiếu ĐÃ THU → KHÔNG tự xoá (tiền thật, người phải xử lý)', invC && !invC.deleted_at, `deleted_at=${invC && invC.deleted_at}`);

    // ===== Data-health phải có các mục canh lệch mới
    const dh = await t.api('GET', '/api/admin/data-health', T);
    const ma = new Set(((dh.json || {}).checks || []).map(x => x.ma));
    for (const k of ['da_tra_con_luot_mo', 'dang_o_khong_luot_mo', 'ngay_tra_lech_luot_o', 'phieu_sau_khi_roi']) {
      t.ok(`data-health có mục "${k}"`, ma.has(k), [...ma].join(', '));
    }
    // D: đã trả phòng nhưng lượt ở còn MỞ -> mục da_tra_con_luot_mo phải bắt được
    const D = await mkStu('_D');
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,'2026-07-01')`, [D, room]);
    await t.db.query(`UPDATE students SET status='out', room_id=NULL, check_out_date='2026-07-20' WHERE id=$1`, [D]);
    const dh2 = await t.api('GET', '/api/admin/data-health', T);
    const muc = ((dh2.json || {}).checks || []).find(x => x.ma === 'da_tra_con_luot_mo') || {};
    t.ok('Hồ sơ trả rồi + lượt mở → data-health BẮT ĐƯỢC', (muc.so_luong || 0) >= 1, `so_luong=${muc.so_luong}`);

    await clean(t.db);
  },
};
