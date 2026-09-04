// BL-117: ngày đăng ký là DỰ KIẾN; chỉ bước XÁC NHẬN (Check-in/out của BQL hoặc an ninh bàn giao)
// mới ghi ngày thật, mở/đóng lượt ở, và xác nhận trả thì tự khoá tài khoản. Người không đến thì
// khoá hồ sơ, không bao giờ thành "đang ở".
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

    const donMoi = async (ma, sdt) => (await t.db.query(
      `INSERT INTO applications (name, phone, gender, code, status, facility_id, desired_check_in)
       VALUES ($1,$2,'female',$3,'pending',$4,$5) RETURNING id`,
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

    // ── G. An ninh bàn giao = xác nhận thật (cả vào lẫn ra) ──────────────────────────────
    const uG = P + '_g';
    const sG = await duyet(await donMoi('G', '0901000003'), uG, ngay(0));
    t.eq('G: sau duyệt vẫn chưa có lượt ở', (await luot(sG)).length, 0);
    const rG1 = await t.api('POST', `/api/maintenance/handovers/${sG}/checkin`, T, { note: 'Đã nhận chìa khoá' });
    t.eq('G: an ninh xác nhận bàn giao nhận phòng → 200', rG1.status, 200, `HTTP ${rG1.status} ${rG1.json && rG1.json.error || ''}`);
    h = await hoSo(sG);
    t.ok('G: bàn giao = ngày vào THẬT hôm nay, lịch dự kiến xoá', (h.ci || '').slice(0, 10) === ngay(0) && !h.lich_vao, JSON.stringify(h));
    l = await luot(sG);
    t.ok('G: mở 1 lượt ở', l.length === 1 && l[0].den === null, JSON.stringify(l));
    t.eq('G: nhật ký "vào" 1 dòng', await nhatKy(sG, 'in'), 1);
    const rG1b = await t.api('POST', `/api/maintenance/handovers/${sG}/checkin`, T, {});
    t.eq('G: xác nhận bàn giao lần 2 → 409', rG1b.status, 409, `HTTP ${rG1b.status}`);
    const rG2 = await t.api('POST', `/api/maintenance/handovers/${sG}/checkout`, T, { actual_date: ngay(0), note: 'Trả chìa' });
    t.eq('G: an ninh xác nhận bàn giao trả phòng → 200', rG2.status, 200, `HTTP ${rG2.status} ${rG2.json && rG2.json.error || ''}`);
    h = await hoSo(sG);
    t.ok('G: ngày trả thật hôm nay, status out', (h.co || '').slice(0, 10) === ngay(0) && h.status === 'out', JSON.stringify(h));
    t.eq('G: lượt ở đóng hôm nay', ((await luot(sG))[0].den || '').slice(0, 10), ngay(0));
    t.ok('G: tài khoản tự khoá sau bàn giao trả', (await khoa(uG)).deleted_at !== null);
    t.eq('G: đăng nhập → 403', (await dangNhap(uG)).status, 403);

    await clean(t.db);
  },
};
