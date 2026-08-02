// Xe có KHOẢNG HIỆU LỰC (từ ngày → đến ngày), mặc định suy từ ngày nhận/trả phòng của chủ xe.
// Phí gửi xe tính cho THÁNG NÀO khoảng này chạm tới (internal/vehiclecount), nên lệch một ngày
// là lệch tiền trọn tháng.
const P = '__test_xe';

async function clean(db) {
  await db.query(`DELETE FROM vehicles WHERE plate LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Xe — khoảng hiệu lực từ/đến ngày',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const R = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee,room_type)
       VALUES ($1,$2,4,'male','B',1200000,'shared') RETURNING id`, [P + '_R', fac])).rows[0].id;
    const hv = await t.api('POST', '/api/students', T, {
      name: P + ' Nam', code: P + '_MA', gender: 'male', room_id: R,
      check_in_date: '2026-03-08', rental_type: 'ghep', confirm_overload: true,
    });
    t.eq('Dựng học viên thử', hv.status, 201, `HTTP ${hv.status} ${hv.json && hv.json.error || ''}`);
    const sid = hv.json.id;
    const d10 = v => String(v || '').slice(0, 10);

    // ── Mặc định lấy theo lượt ở, KHÔNG phải hôm nay ────────────────────────────────────
    const a = await t.api('POST', '/api/vehicles', T, { student_id: sid, plate: P + '_B1' });
    t.eq('Không gửi ngày → from_date = NGÀY NHẬN PHÒNG (không phải hôm nay)', d10(a.json.from_date), '2026-03-08',
      `nhận được ${d10(a.json.from_date)}`);
    t.eq('Chủ xe chưa trả phòng → to_date để ngỏ', a.json.to_date, null);
    const vid = a.json.id;

    // ── Sửa được cả hai đầu ─────────────────────────────────────────────────────────────
    const b = await t.api('PUT', `/api/vehicles/${vid}`, T, { from_date: '2026-05-01', to_date: '2026-06-30' });
    t.eq('Sửa được ngày bắt đầu', d10(b.json.from_date), '2026-05-01');
    t.eq('Sửa được ngày ngừng', d10(b.json.to_date), '2026-06-30');

    // ── Ba trạng thái: vắng khoá ≠ null ─────────────────────────────────────────────────
    const c = await t.api('PUT', `/api/vehicles/${vid}`, T, { sticker: '101.9' });
    t.eq('Sửa mã dán KHÔNG được làm mất ngày ngừng đã đặt', d10(c.json.to_date), '2026-06-30');
    t.eq('Mã dán vẫn lưu', c.json.sticker, '101.9');
    const d = await t.api('PUT', `/api/vehicles/${vid}`, T, { to_date: null });
    t.eq('Gửi null → xoá ngày ngừng, xe còn hiệu lực', d.json.to_date, null);

    // ── Chặn dữ liệu sai ────────────────────────────────────────────────────────────────
    const nguoc = await t.api('PUT', `/api/vehicles/${vid}`, T, { to_date: '2026-04-01' });
    t.eq('Ngày ngừng TRƯỚC ngày bắt đầu → 400', nguoc.status, 400, `HTTP ${nguoc.status} ${nguoc.json && nguoc.json.error || ''}`);
    const xau = await t.api('POST', '/api/vehicles', T, { student_id: sid, plate: P + '_B2', from_date: '08/03/2026' });
    t.eq('Ngày sai định dạng → 400, không im lặng bỏ qua', xau.status, 400, `HTTP ${xau.status}`);

    // ── Có ngày trả phòng thì to_date theo ngày trả ─────────────────────────────────────
    await t.db.query('UPDATE students SET check_out_date=$1 WHERE id=$2', ['2026-07-25', sid]);
    const e = await t.api('POST', '/api/vehicles', T, { student_id: sid, plate: P + '_B3' });
    t.eq('Có ngày trả phòng → to_date lấy theo ngày trả', d10(e.json.to_date), '2026-07-25',
      `nhận được ${d10(e.json.to_date)}`);

    // ── Gỡ xe không đè lên ngày đã khai ─────────────────────────────────────────────────
    await t.api('DELETE', `/api/vehicles/${e.json.id}`, T);
    const sau = (await t.db.query('SELECT to_date FROM vehicles WHERE id=$1', [e.json.id])).rows[0];
    t.eq('Gỡ xe GIỮ ngày ngừng đã có, không dập thành hôm nay', d10(sau.to_date), '2026-07-25');
    await t.api('DELETE', `/api/vehicles/${vid}`, T);
    const sau2 = (await t.db.query('SELECT to_date FROM vehicles WHERE id=$1', [vid])).rows[0];
    t.ok('Xe đang để ngỏ ngày ngừng → gỡ mới đóng ở hôm nay', !!sau2.to_date, String(sau2.to_date));
  },
};
