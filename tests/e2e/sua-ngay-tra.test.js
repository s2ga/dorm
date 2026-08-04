// SỬA NGÀY TRẢ của hồ sơ ĐÃ rời (chủ dự án chốt 04/08/2026 — "phải sửa được, vì có nhiều học viên
// đăng ký sai ngày"). Check-out chặn gọi lần hai nên trước đây nhập sai là kẹt.
// Đổi ngày phải kéo theo: lượt ở trong room_stays, phiếu tháng cũ, phiếu tháng mới.
const P = '__test_sntra';

async function clean(db) {
  await db.query(`DELETE FROM invoices     WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_leaders WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs         WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Sửa ngày trả phòng của hồ sơ đã rời',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const R = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,4,'male','B',1200000,'shared') RETURNING id`, [P + '_R', fac])).rows[0].id;
    const mkStu = async n => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status)
       VALUES ($1,$1,'male',$2,'2026-05-01','in','ghep','unregistered') RETURNING id`, [P + n, R])).rows[0].id;
    const stay = async id => (await t.db.query(
      `SELECT from_date::text f, to_date::text tt FROM room_stays WHERE student_id=$1 ORDER BY from_date DESC, id DESC LIMIT 1`, [id])).rows[0];
    const hv = async id => (await t.db.query('SELECT status, check_out_date::text co FROM students WHERE id=$1', [id])).rows[0];

    // ── Chưa trả phòng thì KHÔNG cho sửa — phải đi nút Check-out ───────────────────────
    const A = await mkStu('_A');
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,'2026-05-01',NULL)`, [A, R]);
    const som = await t.api('PUT', `/api/students/${A}/checkout-date`, T, { date: '2026-06-20' });
    t.eq('Hồ sơ đang ở → từ chối, chỉ sang nút Check-out', som.status, 409, `HTTP ${som.status}`);

    // ── Trả phòng rồi thì sửa được ────────────────────────────────────────────────────
    const ra = await t.api('POST', `/api/students/${A}/checkout`, T, { date: '2026-06-20', reason: 'personal' });
    t.eq('Check-out lần đầu → 200', ra.status, 200, `HTTP ${ra.status} ${ra.json && ra.json.error || ''}`);
    t.eq('Lượt ở đóng đúng ngày check-out', (await stay(A)).tt, '2026-06-20');

    // Check-out lần hai vẫn bị chặn — đường cũ không mở ra, chỉ có đường mới
    const lai = await t.api('POST', `/api/students/${A}/checkout`, T, { date: '2026-06-25' });
    t.eq('Check-out lần hai vẫn bị chặn', lai.status, 409, `HTTP ${lai.status}`);

    const sua = await t.api('PUT', `/api/students/${A}/checkout-date`, T, { date: '2026-06-25', note: 'Báo nhầm ngày' });
    t.eq('Sửa ngày trả → 200', sua.status, 200, `HTTP ${sua.status} ${sua.json && sua.json.error || ''}`);
    t.eq('Phản hồi nói rõ ngày cũ', sua.json && sua.json.cu, '2026-06-20');
    t.eq('Phản hồi nói rõ ngày mới', sua.json && sua.json.moi, '2026-06-25');
    t.eq('Hồ sơ mang ngày trả MỚI', (await hv(A)).co, '2026-06-25');
    t.eq('Hồ sơ vẫn ở trạng thái đã trả', (await hv(A)).status, 'out');
    t.eq('LƯỢT Ở cũng dời theo — không để lịch sử ở nói một đằng hồ sơ một nẻo', (await stay(A)).tt, '2026-06-25');

    // ── Dời SANG THÁNG SAU: phiếu kỳ 07 bị check-out dọn đi phải được TRẢ LẠI ─────────
    const B = await mkStu('_B');
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,'2026-05-01',NULL)`, [B, R]);
    await t.db.query(
      `INSERT INTO invoices (student_id, month, room_charge, total, status) VALUES ($1,'2026-07',1200000,1200000,'pending')`, [B]);
    await t.api('POST', `/api/students/${B}/checkout`, T, { date: '2026-06-20', reason: 'personal' });
    const daDon = (await t.db.query(
      `SELECT count(*)::int c FROM invoices WHERE student_id=$1 AND month='2026-07' AND deleted_at IS NULL`, [B])).rows[0].c;
    t.eq('Check-out 20/06 dọn phiếu kỳ 07 đi (đúng, lúc đó không ở)', daDon, 0);

    const doiThang = await t.api('PUT', `/api/students/${B}/checkout-date`, T, { date: '2026-07-10' });
    t.eq('Dời sang tháng sau → 200', doiThang.status, 200, `HTTP ${doiThang.status} ${doiThang.json && doiThang.json.error || ''}`);
    t.eq('Lượt ở dời sang tháng mới', (await stay(B)).tt, '2026-07-10');
    const ky07 = (await t.db.query(
      `SELECT count(*)::int c FROM invoices WHERE student_id=$1 AND month='2026-07' AND deleted_at IS NULL`, [B])).rows[0].c;
    t.eq('Ở tới 10/07 → phiếu kỳ 07 được TRẢ LẠI, không để mất tiền', ky07, 1);
    t.ok('Phản hồi nói rõ kỳ nào được trả lại', (doiThang.json.restored_invoices || []).includes('2026-07'),
      JSON.stringify(doiThang.json.restored_invoices));

    // ── Lùi ngày về TRƯỚC ngày nhận phòng thì phải chặn ────────────────────────────────
    const lui = await t.api('PUT', `/api/students/${B}/checkout-date`, T, { date: '2026-04-01' });
    t.eq('Ngày trả trước ngày nhận phòng → chặn', lui.status, 400, `HTTP ${lui.status}`);
    t.eq('Chặn rồi thì dữ liệu KHÔNG đổi', (await hv(B)).co, '2026-07-10');

    // ── Ngày không hợp lệ ─────────────────────────────────────────────────────────────
    const xau = await t.api('PUT', `/api/students/${B}/checkout-date`, T, { date: '31/07/2026' });
    t.eq('Ngày sai khuôn → 400', xau.status, 400, `HTTP ${xau.status}`);

    // ── Trường lạ trong body bị từ chối, không âm thầm bỏ qua ─────────────────────────
    const la = await t.api('PUT', `/api/students/${B}/checkout-date`, T, { date: '2026-07-11', room_id: 999 });
    t.eq('Gửi kèm trường lạ → 400, không âm thầm nuốt', la.status, 400, `HTTP ${la.status}`);
  },
};
