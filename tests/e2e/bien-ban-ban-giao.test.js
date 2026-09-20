// BL-121: an ninh LẬP biên bản bàn giao (điện, hư hao, vệ sinh, chìa khoá, biển số, ghi chú),
// quản trị XÁC NHẬN mới đổi hồ sơ. Bộ này cố tình phá: dữ liệu sai, lập trùng, vượt cơ sở, duyệt hai lần.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_bb';
const PW = 'anninh26';

const ngay = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM handover_reports WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM meter_reads WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_leaders WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM assets WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Biên bản bàn giao — an ninh lập, quản trị xác nhận (BL-121)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const facA = (await t.db.query('SELECT id FROM facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1')).rows[0].id;
    const facB = (await t.db.query(`INSERT INTO facilities (name, address) VALUES ($1,'') RETURNING id`, [P + '_CSB'])).rows[0].id;
    const mkRoom = async (ten, fac) => (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`, [ten, fac])).rows[0].id;
    const rA = await mkRoom(P + '_RA', facA);
    const rB = await mkRoom(P + '_RB', facB);
    // Học viên đang ở (đã xác nhận vào từ -30) và học viên mới đặt chỗ (chưa xác nhận vào).
    const dangO = async (ma, room, fac) => {
      const id = (await t.db.query(
        `INSERT INTO students (code,name,gender,birth_date,room_id,facility_id,check_in_date,checkin_confirmed_at,status,rental_type,planned_check_out)
         VALUES ($1,$1,'male','2004-05-06',$2,$3,$4,now(),'in','ghep',$5) RETURNING id`, [ma, room, fac, ngay(-30), ngay(5)])).rows[0].id;
      await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [id, room, ngay(-30)]);
      return id;
    };
    const sapVao = async (ma, room, fac) => (await t.db.query(
      // cccd_front/back phải có: xác nhận nhận phòng đòi đủ 2 mặt (luật 12/09/2026).
      `INSERT INTO students (code,name,gender,birth_date,room_id,facility_id,planned_check_in,status,rental_type,cccd_front,cccd_back)
       VALUES ($1,$1,'male','2004-05-06',$2,$3,$4,'in','ghep','test/f.jpg','test/b.jpg') RETURNING id`, [ma, room, fac, ngay(0)])).rows[0].id;
    const mkUser = async (u, role, fac) => {
      await t.db.query(`INSERT INTO users (username,password_hash,role,approved,facility_id) VALUES ($1,$2,$3,true,$4)`,
        [u, bcrypt.hashSync(PW, 10), role, fac]);
      return t.login(u, PW);
    };
    const AN = await mkUser(P + '_anA', 'maintenance', facA);
    const ANB = await mkUser(P + '_anB', 'maintenance', facB);
    const NVB = await mkUser(P + '_nvB', 'staff', facB);
    const ghe = (await t.db.query(`INSERT INTO assets (name,unit,fee) VALUES ($1,'cái',150000) RETURNING id`, [P + '_ghe'])).rows[0].id;
    const chia = (await t.db.query(`INSERT INTO assets (name,unit,fee) VALUES ($1,'chiếc',50000) RETURNING id`, [P + '_chia'])).rows[0].id;
    const hoSo = async id => (await t.db.query(
      `SELECT status, check_out_date::text co, checkout_confirmed_at IS NOT NULL AS da_xn, check_in_date::text ci FROM students WHERE id=$1`, [id])).rows[0];
    const bienBan = async id => (await t.db.query(`SELECT status, reviewed_by, review_note, damage_amount::int dm FROM handover_reports WHERE id=$1`, [id])).rows[0];

    // ── 1. Chưa đăng nhập / sai vai ────────────────────────────────────────────────────
    t.eq('Chưa đăng nhập lập biên bản → 401', (await t.api('POST', '/api/maintenance/reports', null, {})).status, 401);
    t.eq('An ninh gọi danh sách biên bản của quản trị → 403', (await t.api('GET', '/api/handover-reports', AN)).status, 403);
    const dm = await t.api('GET', '/api/maintenance/assets', AN);
    t.ok('An ninh đọc được danh mục tài sản (có đơn giá) để tick hư hao', dm.status === 200 && (dm.json || []).some(a => a.id === ghe && +a.fee === 150000), `HTTP ${dm.status}`);

    // ── 2. Dữ liệu sai bị chặn ngay lúc lập ───────────────────────────────────────────
    const sA = await dangO(P + '_A', rA, facA);
    const bad = (name, body, want) => t.api('POST', '/api/maintenance/reports', AN, body).then(r => t.eq(name, r.status, want, `HTTP ${r.status} ${r.json && r.json.error || ''}`));
    await bad('Loại biên bản lạ → 400', { kind: 'x', student_id: sA, meter_reading: 1 }, 400);
    await bad('Ngày tương lai → 400', { kind: 'checkout', student_id: sA, date: ngay(1), meter_reading: 1 }, 400);
    await bad('Có phòng mà không ghi số điện → 400', { kind: 'checkout', student_id: sA, date: ngay(0) }, 400);
    await bad('Số điện là chữ → 400', { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: 'abc' }, 400);
    await bad('Số điện âm → 400', { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: -3 }, 400);
    await bad('Vệ sinh giá trị lạ → 400', { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: 10, cleanliness: 'ok' }, 400);
    await bad('Số lượng hư hao âm → 400', { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: 10, damages: [{ asset_id: ghe, quantity: -1 }] }, 400);
    await bad('Tài sản không tồn tại → 400', { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: 10, damages: [{ asset_id: 999999, quantity: 1 }] }, 400);
    await bad('Ngày trả trước ngày vào → 400', { kind: 'checkout', student_id: sA, date: ngay(-40), meter_reading: 10 }, 400);
    await bad('Biên bản NHẬN cho người đã xác nhận vào → 409', { kind: 'checkin', student_id: sA, date: ngay(0), meter_reading: 10 }, 409);
    await t.db.query(`INSERT INTO meter_reads (room_id, read_date, reading, reason) VALUES ($1,$2,200,'manual')`, [rA, ngay(-5)]);
    await bad('Số điện nhỏ hơn lần chốt trước (công-tơ quay ngược) → 400', { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: 150 }, 400);

    // ── 3. Lập đúng: hư hao tính từ danh mục, hồ sơ chưa đổi ─────────────────────────
    const bb = await t.api('POST', '/api/maintenance/reports', AN, {
      kind: 'checkout', student_id: sA, date: ngay(-1), meter_reading: 230, cleanliness: 'ban_nhe', keys_count: 2,
      plates: '59-X1 123.45', note: 'Gãy 1 ghế, mất 1 chìa', damages: [{ asset_id: ghe, quantity: 1 }, { asset_id: chia, quantity: 2 }, { asset_id: ghe, quantity: 0 }],
    });
    t.eq('Lập biên bản trả phòng hợp lệ → 200', bb.status, 200, `HTTP ${bb.status} ${bb.json && bb.json.error || ''}`);
    t.eq('Tiền hư hao = 1×150.000 + 2×50.000, máy tính từ đơn giá', +bb.json.damage_amount, 250000);
    t.eq('Dòng số lượng 0 bị bỏ', (bb.json.damages || []).length, 2);
    let h = await hoSo(sA);
    t.ok('Hồ sơ CHƯA đổi: vẫn đang ở, chưa ngày rời', h.status === 'in' && !h.co && !h.da_xn, JSON.stringify(h));
    t.eq('Chưa có lần chốt điện nào từ biên bản (chỉ ghi khi quản trị xác nhận)', (await t.db.query(
      `SELECT COUNT(*)::int c FROM meter_reads WHERE room_id=$1 AND read_date=$2`, [rA, ngay(-1)])).rows[0].c, 0);
    t.eq('Lập thêm biên bản trả khi đang chờ → 409', (await t.api('POST', '/api/maintenance/reports', AN,
      { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: 240 })).status, 409);

    // ── 4. Danh sách an ninh: dòng mang biên bản + chỉ số chốt gần nhất; huy hiệu không đếm người đã có biên bản
    const ho = await t.api('GET', `/api/maintenance/handovers?month=${ngay(5).slice(0, 7)}`, AN);
    const dongA = ((ho.json || {}).checkouts || []).find(x => x.id === sA);
    t.ok('Danh sách trả phòng có dòng của A kèm biên bản đang chờ', dongA && dongA.report && dongA.report.status === 'pending', JSON.stringify(dongA && dongA.report));
    t.ok('Dòng kèm lần chốt điện gần nhất để đối chiếu', dongA && dongA.last_meter && +dongA.last_meter.reading === 200, JSON.stringify(dongA && dongA.last_meter));
    const sum = await t.api('GET', '/api/maintenance/handovers/summary', AN);
    t.ok('Huy hiệu "cần lập biên bản" KHÔNG đếm người đã có biên bản chờ', sum.status === 200 && !((sum.json || {}).pendingCheckout > 0 && ngay(5).slice(0, 7) === ngay(0).slice(0, 7) && (ho.json.checkouts || []).filter(x => x.status !== 'out' && !x.checkout_confirmed_at && !(x.report && x.report.status === 'pending')).length === 0), JSON.stringify(sum.json));

    // ── 5. Cách ly cơ sở ─────────────────────────────────────────────────────────────
    t.eq('An ninh cơ sở B lập biên bản cho học viên cơ sở A → 403', (await t.api('POST', '/api/maintenance/reports', ANB,
      { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: 240 })).status, 403);
    const dsB = await t.api('GET', '/api/handover-reports?status=pending', NVB);
    t.ok('Nhân viên cơ sở B KHÔNG thấy biên bản cơ sở A', dsB.status === 200 && !(dsB.json || []).some(r => r.id === bb.json.id), `HTTP ${dsB.status} n=${(dsB.json || []).length}`);
    t.eq('Nhân viên cơ sở B duyệt biên bản cơ sở A → 403', (await t.api('POST', `/api/handover-reports/${bb.json.id}/approve`, NVB, {})).status, 403);
    t.eq('Nhân viên cơ sở B trả lại biên bản cơ sở A → 403', (await t.api('POST', `/api/handover-reports/${bb.json.id}/return`, NVB, { note: 'x' })).status, 403);

    // ── 6. Trả lại phải có lý do; quản trị thấy đủ ô an ninh đã nhập ──────────────────
    t.eq('Trả lại không lý do → 400', (await t.api('POST', `/api/handover-reports/${bb.json.id}/return`, T, { note: '  ' })).status, 400);
    const ds = await t.api('GET', '/api/handover-reports?status=pending', T);
    const r1 = (ds.json || []).find(r => r.id === bb.json.id);
    t.ok('Quản trị thấy biên bản với đủ số điện / vệ sinh / chìa / biển / ghi chú / người lập',
      r1 && +r1.meter_reading === 230 && r1.cleanliness === 'ban_nhe' && r1.keys_count === 2 && r1.plates === '59-X1 123.45'
      && r1.note === 'Gãy 1 ghế, mất 1 chìa' && r1.created_by === P + '_anA' && Array.isArray(r1.damages) && r1.damages.length === 2, JSON.stringify(r1));

    // ── 7. Quản trị xác nhận với số điện GHI ĐÈ → đi đúng lõi trả phòng ─────────────
    t.eq('Xác nhận với số điện quay ngược → 400 (lõi trả phòng vẫn kiểm)', (await t.api('POST', `/api/handover-reports/${bb.json.id}/approve`, T, { meter_reading: 100 })).status, 400);
    t.eq('Biên bản vẫn chờ sau lần duyệt hỏng', (await bienBan(bb.json.id)).status, 'pending');
    const ok = await t.api('POST', `/api/handover-reports/${bb.json.id}/approve`, T, { meter_reading: 235, reason: 'personal' });
    t.eq('Xác nhận hợp lệ → 200', ok.status, 200, `HTTP ${ok.status} ${ok.json && ok.json.error || ''}`);
    t.eq('Phản hồi kèm report_id', ok.json && ok.json.report_id, bb.json.id);
    h = await hoSo(sA);
    t.ok('Hồ sơ: out, ngày rời = ngày trên biên bản (-1), có mốc xác nhận', h.status === 'out' && h.co === ngay(-1) && h.da_xn, JSON.stringify(h));
    t.eq('Số điện ghi vào meter_reads là số quản trị ghi đè (235), reason=checkout', (await t.db.query(
      `SELECT reading::float r FROM meter_reads WHERE room_id=$1 AND read_date=$2 AND reason='checkout'`, [rA, ngay(-1)])).rows[0].r, 235);
    t.eq('Lượt ở đóng -1', (await t.db.query(`SELECT to_date::text d FROM room_stays WHERE student_id=$1 ORDER BY id DESC LIMIT 1`, [sA])).rows[0].d, ngay(-1));
    const bbSau = await bienBan(bb.json.id);
    t.ok('Biên bản chuyển approved, ghi người duyệt', bbSau.status === 'approved' && bbSau.reviewed_by === 'admin', JSON.stringify(bbSau));
    t.eq('Duyệt lần hai → 409', (await t.api('POST', `/api/handover-reports/${bb.json.id}/approve`, T, {})).status, 409);
    t.eq('Trả lại biên bản đã duyệt → 409', (await t.api('POST', `/api/handover-reports/${bb.json.id}/return`, T, { note: 'x' })).status, 409);
    t.eq('Lập biên bản trả cho người đã rời → 409', (await t.api('POST', '/api/maintenance/reports', AN,
      { kind: 'checkout', student_id: sA, date: ngay(0), meter_reading: 240 })).status, 409);

    // ── 8. Nhận phòng: người chưa xác nhận vào, xác nhận ghi số điện reason=checkin ──
    const sN = await sapVao(P + '_N', rA, facA);
    t.eq('Biên bản TRẢ cho người chưa xác nhận vào → 409', (await t.api('POST', '/api/maintenance/reports', AN,
      { kind: 'checkout', student_id: sN, date: ngay(0), meter_reading: 240 })).status, 409);
    const bn = await t.api('POST', '/api/maintenance/reports', AN, { kind: 'checkin', student_id: sN, date: ngay(0), meter_reading: 240, keys_count: 1, cleanliness: 'sach' });
    t.eq('Biên bản nhận phòng → 200', bn.status, 200, `HTTP ${bn.status} ${bn.json && bn.json.error || ''}`);
    t.ok('Hồ sơ chưa có ngày vào thật', !(await hoSo(sN)).ci);
    const tl = await t.api('POST', `/api/handover-reports/${bn.json.id}/return`, T, { note: 'Thiếu số điện đầu' });
    t.eq('Trả lại → 200', tl.status, 200);
    t.eq('Duyệt biên bản đã trả lại → 409', (await t.api('POST', `/api/handover-reports/${bn.json.id}/approve`, T, {})).status, 409);
    const hoN = await t.api('GET', `/api/maintenance/handovers?month=${ngay(0).slice(0, 7)}`, AN);
    const dongN = ((hoN.json || {}).checkins || []).find(x => x.id === sN);
    t.ok('An ninh thấy biên bản bị trả lại kèm lý do', dongN && dongN.report && dongN.report.status === 'returned' && dongN.report.review_note === 'Thiếu số điện đầu', JSON.stringify(dongN && dongN.report));
    const bn2 = await t.api('POST', '/api/maintenance/reports', AN, { kind: 'checkin', student_id: sN, date: ngay(0), meter_reading: 240 });
    t.eq('Lập lại sau khi bị trả → 200', bn2.status, 200, `HTTP ${bn2.status} ${bn2.json && bn2.json.error || ''}`);
    const okN = await t.api('POST', `/api/handover-reports/${bn2.json.id}/approve`, T, {});
    t.eq('Quản trị xác nhận nhận phòng → 200', okN.status, 200, `HTTP ${okN.status} ${okN.json && okN.json.error || ''}`);
    t.eq('Ngày vào thật = hôm nay', (await hoSo(sN)).ci, ngay(0));
    t.eq('Số điện lúc vào ghi meter_reads reason=checkin', (await t.db.query(
      `SELECT COUNT(*)::int c FROM meter_reads WHERE room_id=$1 AND read_date=$2 AND reason='checkin' AND student_id=$3`, [rA, ngay(0), sN])).rows[0].c, 1);

    // ── 9. Check-out tay của quản trị cũng đặt mốc xác nhận (lỗi cũ: an ninh thấy nút thừa rồi 409)
    const sC = await dangO(P + '_C', rB, facB);
    const co = await t.api('POST', `/api/students/${sC}/checkout`, T, { date: ngay(0), meter_reading: 5 });
    t.eq('Check-out tay → 200', co.status, 200, `HTTP ${co.status} ${co.json && co.json.error || ''}`);
    t.ok('checkout_confirmed_at được đặt bởi lõi dùng chung', (await hoSo(sC)).da_xn);
    const hoB = await t.api('GET', `/api/maintenance/handovers?month=${ngay(0).slice(0, 7)}`, ANB);
    const dongC = ((hoB.json || {}).checkouts || []).find(x => x.id === sC);
    t.ok('Danh sách an ninh cơ sở B: C đã có mốc xác nhận (không còn nút thừa)', dongC && dongC.checkout_confirmed_at && dongC.status === 'out', JSON.stringify(dongC));

    await clean(t.db);
  },
};
