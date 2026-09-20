// BL-117: ngày đăng ký là DỰ KIẾN; chỉ bước XÁC NHẬN (Check-in/out của BQL hoặc an ninh bàn giao)
// mới ghi ngày thật, mở/đóng lượt ở, và xác nhận trả thì tự khoá tài khoản. Người không đến thì
// khoá hồ sơ, không bao giờ thành "đang ở".
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_xnvr';
const PW = 'hv123456';

const ngay = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%')`;
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_leaders WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM vehicles WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM applications WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Xác nhận vào/ra — ngày đăng ký là dự kiến, xác nhận mới đổi trạng thái + khoá tài khoản (BL-117)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'female','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;

    // Đơn có sẵn ảnh CCCD 2 mặt (bắt buộc từ 12/09/2026) — duyệt đơn chép sang hồ sơ, nhận phòng mới qua.
    const donMoi = async (ma, sdt) => (await t.db.query(
      `INSERT INTO applications (name, phone, gender, birth_date, code, status, facility_id, desired_check_in, cccd_front, cccd_back)
       VALUES ($1,$2,'female','2004-05-06',$3,'pending',$4,$5,'test/f.jpg','test/b.jpg') RETURNING id`,
      [P + ' ' + ma, sdt, P + '_' + ma, fac, ngay(3)])).rows[0].id;
    const duyet = async (appId, user, ciDate) => {
      const r = await t.api('POST', `/api/applications/${appId}/approve`, T, {
        room_id: rid, check_in_date: ciDate, create_login: true, login_username: user, login_password: PW,
      });
      t.eq(`Duyệt đơn ${user} → 200`, r.status, 200, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
      return r.json && r.json.student && r.json.student.id;
    };
    const hoSo = async sid => (await t.db.query(
      `SELECT status, check_in_date::text ci, planned_check_in::text lich_vao, check_out_date::text co,
              planned_check_out::text lich_ra, deleted_at FROM students WHERE id=$1`, [sid])).rows[0];
    const luot = async sid => (await t.db.query(
      `SELECT from_date::text tu, to_date::text den FROM room_stays WHERE student_id=$1 ORDER BY id`, [sid])).rows;
    const nhatKy = async (sid, loai) => (await t.db.query(
      `SELECT COUNT(*)::int c FROM logs WHERE student_id=$1 AND type=$2`, [sid, loai])).rows[0].c;
    const phong = async d => {
      const r = await t.api('GET', '/api/rooms' + (d ? '?date=' + d : ''), T);
      const p = (r.json || []).find(x => x.id === rid) || {};
      return { occ: p.occupancy, up: p.upcoming, leave: p.leaving };
    };
    const dangNhap = (user) => t.api('POST', '/api/auth/login', null, { username: user, password: PW });
    const khoa = async user => (await t.db.query(`SELECT deleted_at FROM users WHERE username=$1`, [user])).rows[0];

    // ── A. Duyệt đơn = đặt chỗ, KHÔNG phải vào ở ─────────────────────────────────────────
    const uA = P + '_a';
    const sA = await duyet(await donMoi('A', '0901000001'), uA, ngay(3));
    let h = await hoSo(sA);
    t.ok('A: duyệt xong ngày vào THẬT còn trống', !h.ci, JSON.stringify(h));
    t.eq('A: ngày đăng ký nằm ở lịch dự kiến', (h.lich_vao || '').slice(0, 10), ngay(3), JSON.stringify(h));
    t.eq('A: chưa có lượt ở nào (chưa tính tiền)', (await luot(sA)).length, 0);
    t.eq('A: chưa có nhật ký "vào"', await nhatKy(sA, 'in'), 0);
    let p = await phong();
    t.ok('A: hôm nay phòng KHÔNG đếm bạn ấy đang ở, chỉ "sắp vào"', p.occ === 0 && p.up === 1, JSON.stringify(p));
    p = await phong(ngay(3));
    t.ok('A: mốc ngày dự kiến thì đã giữ chỗ (occupancy 1)', p.occ === 1, JSON.stringify(p));
    const lgA = await dangNhap(uA);
    t.eq('A: tài khoản tạo lúc duyệt đăng nhập được (chưa khoá)', lgA.status, 200, `HTTP ${lgA.status}`);

    // ── B. Không được xác nhận nhận phòng ở ngày tương lai ───────────────────────────────
    const rB = await t.api('POST', `/api/students/${sA}/checkin`, T, { date: ngay(1), room_id: rid });
    t.eq('B: check-in ngày mai → 400 (ngày thật không ở tương lai)', rB.status, 400, `HTTP ${rB.status} ${rB.json && rB.json.error || ''}`);
    t.eq('B: hồ sơ vẫn chưa có ngày vào thật', (await hoSo(sA)).ci, null);

    // ── B2. Thiếu ảnh CCCD thì KHÔNG nhận phòng được (luật 12/09/2026) ───────────────────
    // Phòng riêng để phép đếm chỗ ở của phòng chính bên dưới không bị ca này làm lệch.
    const ridK = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'female','B',1200000) RETURNING id`,
      [P + '_RK', fac])).rows[0].id;
    const sK = (await t.db.query(
      `INSERT INTO students (code,name,gender,birth_date,planned_check_in,status,rental_type) VALUES ($1,$1,'female','2004-05-06',$2,'out','ghep') RETURNING id`,
      [P + '_K', ngay(3)])).rows[0].id;
    const ciK = () => t.api('POST', `/api/students/${sK}/checkin`, T, { date: ngay(0), room_id: ridK });
    const rK1 = await ciK();
    t.eq('B2: hồ sơ trắng ảnh CCCD → check-in 400', rK1.status, 400, `HTTP ${rK1.status} ${rK1.json && rK1.json.error || ''}`);
    t.ok('B2: báo lỗi nói rõ thiếu mặt nào', /CCCD mặt trước và mặt sau/.test((rK1.json && rK1.json.error) || ''),
      String(rK1.json && rK1.json.error));
    t.eq('B2: hồ sơ KHÔNG bị đổi (chưa có ngày vào thật)', (await hoSo(sK)).ci, null);
    await t.db.query(`UPDATE students SET cccd_front='test/f.jpg' WHERE id=$1`, [sK]);
    const rK2 = await ciK();
    t.eq('B2: mới có 1 mặt vẫn chặn → 400', rK2.status, 400, `HTTP ${rK2.status} ${rK2.json && rK2.json.error || ''}`);
    await t.db.query(`UPDATE students SET cccd_back='test/b.jpg' WHERE id=$1`, [sK]);
    const rK3 = await ciK();
    t.eq('B2: bổ sung đủ 2 mặt → 200', rK3.status, 200, `HTTP ${rK3.status} ${rK3.json && rK3.json.error || ''}`);

    // ── C. Xác nhận nhận phòng (BQL) ─────────────────────────────────────────────────────
    const rC = await t.api('POST', `/api/students/${sA}/checkin`, T, { date: ngay(0), room_id: rid, note: 'Đến sớm 3 ngày' });
    t.eq('C: check-in hôm nay → 200', rC.status, 200, `HTTP ${rC.status} ${rC.json && rC.json.error || ''}`);
    h = await hoSo(sA);
    t.eq('C: ngày vào THẬT = hôm nay (không phải ngày đăng ký)', (h.ci || '').slice(0, 10), ngay(0), JSON.stringify(h));
    t.eq('C: lịch dự kiến vào được xoá', h.lich_vao, null);
    t.eq('C: trạng thái đang ở', h.status, 'in');
    let l = await luot(sA);
    t.ok('C: mở đúng 1 lượt ở từ hôm nay, còn mở', l.length === 1 && l[0].tu === ngay(0) && l[0].den === null, JSON.stringify(l));
    t.eq('C: nhật ký "vào" đúng 1 dòng', await nhatKy(sA, 'in'), 1);
    p = await phong();
    t.ok('C: phòng đếm đang ở 1, sắp vào 0', p.occ === 1 && p.up === 0, JSON.stringify(p));

    // ── D. Duyệt đơn trả phòng = chốt LỊCH, chưa rời ─────────────────────────────────────
    const cr = (await t.db.query(
      `INSERT INTO checkout_requests (student_id, status, desired_date, reason, created_at) VALUES ($1,'pending',$2,'normal',now()) RETURNING id`,
      [sA, ngay(5)])).rows[0].id;
    const rD = await t.api('POST', `/api/requests/checkout/${cr}/confirm`, T, { date: ngay(5) });
    t.eq('D: duyệt đơn trả → 200', rD.status, 200, `HTTP ${rD.status} ${rD.json && rD.json.error || ''}`);
    h = await hoSo(sA);
    t.eq('D: lịch trả ghi vào hồ sơ', (h.lich_ra || '').slice(0, 10), ngay(5), JSON.stringify(h));
    t.ok('D: ngày trả THẬT còn trống, vẫn đang ở', !h.co && h.status === 'in', JSON.stringify(h));
    l = await luot(sA);
    t.eq('D: lượt ở chưa đóng', l[0].den, null, JSON.stringify(l));
    t.eq('D: chưa có nhật ký "ra"', await nhatKy(sA, 'out'), 0);
    p = await phong();
    t.ok('D: phòng vẫn đếm đang ở 1, sắp ra 1', p.occ === 1 && p.leave === 1, JSON.stringify(p));
    t.eq('D: tài khoản chưa bị khoá theo lịch', (await khoa(uA)).deleted_at, null);

    // ── E. Xác nhận trả phòng THẬT → đổi trạng thái + đóng lượt + khoá tài khoản ─────────
    const veTruoc = await t.login(uA, PW);
    const rE = await t.api('POST', `/api/students/${sA}/checkout`, T, { date: ngay(0), reason: 'other', note: 'Rời sớm hơn lịch' });
    t.eq('E: check-out hôm nay → 200', rE.status, 200, `HTTP ${rE.status} ${rE.json && rE.json.error || ''}`);
    h = await hoSo(sA);
    t.ok('E: ngày trả THẬT = hôm nay, status out', (h.co || '').slice(0, 10) === ngay(0) && h.status === 'out', JSON.stringify(h));
    l = await luot(sA);
    t.eq('E: lượt ở đóng đúng ngày thật (không phải ngày lịch +5)', (l[0].den || '').slice(0, 10), ngay(0), JSON.stringify(l));
    t.eq('E: nhật ký "ra" đúng 1 dòng', await nhatKy(sA, 'out'), 1);
    t.ok('E: tài khoản đăng nhập TỰ KHOÁ khi xác nhận trả', (await khoa(uA)).deleted_at !== null, JSON.stringify(await khoa(uA)));
    const lgSau = await dangNhap(uA);
    t.eq('E: học viên đã trả phòng đăng nhập → 403 (bị khoá)', lgSau.status, 403, `HTTP ${lgSau.status} ${lgSau.json && lgSau.json.error || ''}`);
    const cu = await t.api('GET', '/api/me/profile', veTruoc);
    t.eq('E: vé đăng nhập cũ bị thu hồi ngay → 401', cu.status, 401, `HTTP ${cu.status}`);
    p = await phong();
    t.ok('E: phòng về 0 đang ở', p.occ === 0, JSON.stringify(p));

    // ── F. Người KHÔNG ĐẾN: khoá hồ sơ, không bao giờ thành "đang ở" ─────────────────────
    const uF = P + '_f';
    const sF = await duyet(await donMoi('F', '0901000002'), uF, ngay(-2));
    h = await hoSo(sF);
    t.ok('F: đăng ký ngày đã qua nhưng chưa xác nhận → vẫn KHÔNG có ngày vào thật', !h.ci && (h.lich_vao || '').slice(0, 10) === ngay(-2), JSON.stringify(h));
    t.eq('F: không có lượt ở dù ngày đăng ký đã qua', (await luot(sF)).length, 0);
    const rF = await t.api('DELETE', `/api/students/${sF}`, T, { reason: 'Không đến nhận phòng' });
    t.eq('F: khoá hồ sơ người không đến → 200', rF.status, 200, `HTTP ${rF.status} ${rF.json && rF.json.error || ''}`);
    t.ok('F: hồ sơ đã khoá', (await hoSo(sF)).deleted_at !== null);
    t.eq('F: vẫn không có lượt ở (không tính tiền)', (await luot(sF)).length, 0);
    p = await phong();
    t.ok('F: phòng không còn đếm bạn ấy ở đâu cả', p.occ === 0 && p.up === 0, JSON.stringify(p));
    t.eq('F: tài khoản của hồ sơ khoá đăng nhập → 403', (await dangNhap(uF)).status, 403);

    // ── G. An ninh LẬP BIÊN BẢN, quản trị XÁC NHẬN mới đổi hồ sơ (BL-121) ────────────────
    await t.db.query(`INSERT INTO users (username,password_hash,role,approved,facility_id) VALUES ($1,$2,'maintenance',true,$3)`,
      [P + '_anninh', bcrypt.hashSync(PW, 10), fac]);
    const AN = await t.login(P + '_anninh', PW);
    const uG = P + '_g';
    const sG = await duyet(await donMoi('G', '0901000003'), uG, ngay(0));
    t.eq('G: sau duyệt vẫn chưa có lượt ở', (await luot(sG)).length, 0);
    const duongCu = await t.api('POST', `/api/maintenance/handovers/${sG}/checkin`, AN, { note: 'x' });
    t.eq('G: đường an ninh xác nhận THẲNG đã gỡ → 404', duongCu.status, 404, `HTTP ${duongCu.status}`);
    const bb1 = await t.api('POST', '/api/maintenance/reports', AN,
      { kind: 'checkin', student_id: sG, date: ngay(0), meter_reading: 100, keys_count: 2, cleanliness: 'sach', note: 'Đã giao chìa' });
    t.eq('G: an ninh lập biên bản nhận phòng → 200', bb1.status, 200, `HTTP ${bb1.status} ${bb1.json && bb1.json.error || ''}`);
    h = await hoSo(sG);
    t.ok('G: lập biên bản KHÔNG đổi hồ sơ (chưa ngày vào thật, chưa lượt ở)', !h.ci && (await luot(sG)).length === 0, JSON.stringify(h));
    const bb1b = await t.api('POST', '/api/maintenance/reports', AN, { kind: 'checkin', student_id: sG, date: ngay(0), meter_reading: 100 });
    t.eq('G: lập biên bản thứ hai khi đang chờ → 409', bb1b.status, 409, `HTTP ${bb1b.status}`);
    const cam = await t.api('POST', `/api/handover-reports/${bb1.json.id}/approve`, AN, {});
    t.eq('G: an ninh tự duyệt biên bản → 403', cam.status, 403, `HTTP ${cam.status}`);
    const ds = await t.api('GET', '/api/handover-reports?status=pending', T);
    t.ok('G: quản trị thấy biên bản đang chờ', ds.status === 200 && (ds.json || []).some(r => r.id === bb1.json.id), `HTTP ${ds.status}`);
    const ok1 = await t.api('POST', `/api/handover-reports/${bb1.json.id}/approve`, T, {});
    t.eq('G: quản trị xác nhận biên bản nhận phòng → 200', ok1.status, 200, `HTTP ${ok1.status} ${ok1.json && ok1.json.error || ''}`);
    h = await hoSo(sG);
    t.ok('G: xác nhận = ngày vào THẬT hôm nay, lịch dự kiến xoá', (h.ci || '').slice(0, 10) === ngay(0) && !h.lich_vao, JSON.stringify(h));
    l = await luot(sG);
    t.ok('G: mở 1 lượt ở', l.length === 1 && l[0].den === null, JSON.stringify(l));
    t.eq('G: nhật ký "vào" 1 dòng', await nhatKy(sG, 'in'), 1);
    t.eq('G: số điện an ninh ghi thành lần chốt reason=checkin', (await t.db.query(
      `SELECT COUNT(*)::int c FROM meter_reads WHERE room_id=$1 AND reason='checkin' AND student_id=$2`, [rid, sG])).rows[0].c, 1);
    t.eq('G: xác nhận biên bản lần 2 → 409', (await t.api('POST', `/api/handover-reports/${bb1.json.id}/approve`, T, {})).status, 409);
    const bb2 = await t.api('POST', '/api/maintenance/reports', AN, { kind: 'checkout', student_id: sG, date: ngay(0), meter_reading: 120, note: 'Trả chìa' });
    t.eq('G: an ninh lập biên bản trả phòng → 200', bb2.status, 200, `HTTP ${bb2.status} ${bb2.json && bb2.json.error || ''}`);
    h = await hoSo(sG);
    t.ok('G: hồ sơ VẪN đang ở sau khi lập biên bản trả', h.status === 'in' && !h.co, JSON.stringify(h));
    const tl = await t.api('POST', `/api/handover-reports/${bb2.json.id}/return`, T, { note: 'Ghi thiếu chìa khoá' });
    t.eq('G: quản trị trả lại biên bản → 200', tl.status, 200, `HTTP ${tl.status} ${tl.json && tl.json.error || ''}`);
    const bb3 = await t.api('POST', '/api/maintenance/reports', AN, { kind: 'checkout', student_id: sG, date: ngay(0), meter_reading: 125, keys_count: 2, note: 'Lập lại' });
    t.eq('G: an ninh lập lại sau khi bị trả → 200', bb3.status, 200, `HTTP ${bb3.status} ${bb3.json && bb3.json.error || ''}`);
    const ok2 = await t.api('POST', `/api/handover-reports/${bb3.json.id}/approve`, T, {});
    t.eq('G: quản trị xác nhận biên bản trả phòng → 200', ok2.status, 200, `HTTP ${ok2.status} ${ok2.json && ok2.json.error || ''}`);
    h = await hoSo(sG);
    t.ok('G: ngày trả thật hôm nay, status out', (h.co || '').slice(0, 10) === ngay(0) && h.status === 'out', JSON.stringify(h));
    t.eq('G: lượt ở đóng hôm nay', ((await luot(sG))[0].den || '').slice(0, 10), ngay(0));
    t.ok('G: tài khoản tự khoá sau xác nhận trả', (await khoa(uG)).deleted_at !== null);
    t.eq('G: đăng nhập → 403', (await dangNhap(uG)).status, 403);
    t.eq('G: biên bản đã bị trả lại không duyệt được nữa → 409', (await t.api('POST', `/api/handover-reports/${bb2.json.id}/approve`, T, {})).status, 409);

    await clean(t.db);
  },
};
