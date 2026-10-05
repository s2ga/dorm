// Đăng ký / hủy máy giặt, gửi xe từ cổng học viên: gửi đề nghị, Ban Quản lý duyệt mới áp, áp từ KỲ SAU
// theo ngày gửi (đăng ký tính từ ngày 1 tháng sau, hủy tính hết tháng gửi). Đường an ninh áp ngay.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_dvhv';
const PW = 'quanly2026a';

const pad = n => String(n).padStart(2, '0');
const ngay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const congNgay = n => { const d = new Date(); d.setDate(d.getDate() + n); return ngay(d); };

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM service_requests WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM washing_requests WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM vehicles WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Cổng học viên: đăng ký/hủy máy giặt & gửi xe — BQL duyệt, áp từ kỳ sau',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const hash = bcrypt.hashSync(PW, 10);
    const homNay = congNgay(0);
    const ky = homNay.slice(0, 7);
    const [ny, nm] = ky.split('-').map(Number);
    const kySau = nm === 12 ? `${ny + 1}-01` : `${ny}-${pad(nm + 1)}`;
    const cuoiKy = `${ky}-${pad(new Date(ny, nm, 0).getDate())}`;
    const dauKySau = `${kySau}-01`;

    const fac = (await t.db.query('SELECT id FROM facilities ORDER BY id LIMIT 1')).rows[0].id;
    const facKhac = (await t.db.query(`INSERT INTO facilities (name,address) VALUES ('${P}_CS2','Cơ sở khác') RETURNING id`)).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,8,'male','B',1200000,'shared') RETURNING id`, [P + '_R', fac])).rows[0].id;
    const mkHV = async (ma, giat, giatTu) => {
      const id = (await t.db.query(
        `INSERT INTO students (code,name,gender,room_id,facility_id,check_in_date,status,rental_type,deposit_status,uses_washing,washing_from)
         VALUES ($1,$1,'male',$2,$3,$4,'in','ghep','held',$5,$6) RETURNING id`,
        [P + ma, rid, fac, congNgay(-60), giat, giatTu])).rows[0].id;
      await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [id, rid, congNgay(-60)]);
      await t.db.query(`INSERT INTO users (username,password_hash,role,student_id,facility_id,must_change_password)
        VALUES ($1,$2,'student',$3,$4,false)`, [P + ma, hash, id, fac]);
      return id;
    };
    const A = await mkHV('_A', false, null);   // chưa dùng gì
    const B = await mkHV('_B', true, null);    // đang dùng máy giặt từ trước (dữ liệu cũ, không có ngày)
    const C = await mkHV('_C', false, null);   // đi đường an ninh — đối chứng luật cũ
    const xeB = (await t.db.query(`INSERT INTO vehicles (student_id, plate, vehicle_type, from_date) VALUES ($1,$2,'Xe máy',$3) RETURNING id`,
      [B, P.toUpperCase() + '-B1', congNgay(-60)])).rows[0].id;
    await t.db.query(`INSERT INTO users (username,password_hash,role,facility_id,must_change_password) VALUES
      ($1,$3,'maintenance',$4,false), ($2,$3,'staff',$5,false)`, [P + '_anninh', P + '_nvkhac', hash, fac, facKhac]);

    const st = (await t.api('GET', '/api/settings', T)).json || {};
    const phiGiat = +st.washing_fee || 0, phiXe = +st.parking_fee || 0;
    t.ok('Cài đặt có phí máy giặt và gửi xe để so', phiGiat > 0 && phiXe > 0, `washing_fee=${phiGiat} parking_fee=${phiXe}`);

    // Phiếu CHƯA THU kỳ này và kỳ sau cho cả ba — duyệt xong máy chủ phải tự tính lại các phiếu này.
    for (const sid of [A, B, C]) {
      for (const m of [ky, kySau]) {
        await t.db.query(`INSERT INTO invoices (student_id, room_id, month, status) VALUES ($1,$2,$3,'pending')`, [sid, rid, m]);
      }
    }
    // Phiếu tạo ra đều 0đ: tiền phòng > 0 là bằng chứng phiếu ĐÃ được tính lại, không thì ca "phí = 0" xanh oan.
    const phieu = async (sid, m) => (await t.db.query(
      `SELECT id, washing_charge::int AS giat, parking_charge::int AS xe, room_charge::int AS phong
         FROM invoices WHERE student_id=$1 AND month=$2`, [sid, m])).rows[0];
    const tinhLai = async (sid, m) => {
      const r = await t.api('POST', `/api/invoices/${(await phieu(sid, m)).id}/recalc`, T);
      const row = await phieu(sid, m);
      if (r.status !== 200 || !(row.phong > 0)) t.ok(`Tính lại phiếu ${m} của HV #${sid} phải chạy được`, false, `HTTP ${r.status} ${JSON.stringify(row)}`);
      return row;
    };
    const daTinhLai = row => !!row && row.phong > 0;
    const hs = async sid => (await t.db.query(
      `SELECT uses_washing, washing_from::text AS tu, washing_to::text AS toi FROM students WHERE id=$1`, [sid])).rows[0];

    const hvA = await t.login(P + '_A', PW);
    const hvB = await t.login(P + '_B', PW);
    t.ok('Học viên đăng nhập được', !!hvA && !!hvB);

    /* ===== 1. Đăng ký máy giặt: gửi đề nghị, KHÔNG ghi thẳng ===== */
    const g1 = await t.api('POST', '/api/me/service-requests', hvA, { service: 'washing', action: 'register', note: 'Em cần giặt đồ' });
    t.eq('Gửi đề nghị đăng ký máy giặt → 200', g1.status, 200, `HTTP ${g1.status} ${g1.json && g1.json.error || ''}`);
    t.eq('Ngày áp dụng = ngày 1 tháng sau ngày gửi', g1.json && String(g1.json.effective_date).slice(0, 10), dauKySau);
    t.eq('Gửi xong hồ sơ CHƯA đổi (không ghi âm thầm)', (await hs(A)).uses_washing, false);
    t.eq('Gửi lần hai khi còn chờ → 409', (await t.api('POST', '/api/me/service-requests', hvA, { service: 'washing', action: 'register' })).status, 409);
    const cu = await t.api('POST', '/api/me/washing', hvA, { on: true });
    t.eq('Đường tự bật máy giặt cũ bị chặn → 400', cu.status, 400, `HTTP ${cu.status}`);
    t.eq('…và hồ sơ vẫn không đổi', (await hs(A)).uses_washing, false);

    const ds = await t.api('GET', '/api/service-requests', T);
    const dn = ((ds.json && ds.json.rows) || []).find(x => x.id === g1.json.id) || {};
    t.eq('BQL thấy đề nghị kèm tên học viên', dn.student_name, P + '_A', JSON.stringify(dn));

    /* ===== 2. Quyền duyệt ===== */
    const an = await t.login(P + '_anninh', PW);
    t.eq('An ninh không duyệt được → 403', (await t.api('POST', `/api/service-requests/${g1.json.id}/approve`, an, {})).status, 403);
    t.eq('Học viên không tự duyệt được → 403', (await t.api('POST', `/api/service-requests/${g1.json.id}/approve`, hvA, {})).status, 403);
    const nvKhac = await t.login(P + '_nvkhac', PW);
    const k = await t.api('POST', `/api/service-requests/${g1.json.id}/approve`, nvKhac, {});
    t.ok('Nhân viên cơ sở khác không duyệt được', k.status === 403 || k.status === 404, `HTTP ${k.status}`);
    t.ok('Nhân viên cơ sở khác không thấy đề nghị',
      !(((await t.api('GET', '/api/service-requests', nvKhac)).json || {}).rows || []).some(x => x.id === g1.json.id));

    /* ===== 3. Duyệt đăng ký máy giặt → tính từ kỳ sau ===== */
    const d1 = await t.api('POST', `/api/service-requests/${g1.json.id}/approve`, T, {});
    t.eq('Duyệt → 200', d1.status, 200, `HTTP ${d1.status} ${d1.json && d1.json.error || ''}`);
    let h = await hs(A);
    t.ok('Duyệt xong mới vào danh sách máy giặt, tính từ ngày 1 tháng sau', h.uses_washing === true && h.tu === dauKySau && h.toi === null, JSON.stringify(h));
    t.eq('Phiếu KỲ NÀY không có phí máy giặt', (await tinhLai(A, ky)).giat, 0);
    const aSau = await phieu(A, kySau);
    t.ok('Phiếu KỲ SAU có phí máy giặt (tự tính lại lúc duyệt)', daTinhLai(aSau) && aSau.giat === phiGiat, JSON.stringify(aSau));
    t.eq('Duyệt lại lần hai → 409', (await t.api('POST', `/api/service-requests/${g1.json.id}/approve`, T, {})).status, 409);

    /* ===== 4. Hủy máy giặt → vẫn tính hết tháng gửi ===== */
    t.eq('Mốc: B đang dùng máy giặt, phiếu kỳ này có phí', (await tinhLai(B, ky)).giat, phiGiat);
    const g2 = await t.api('POST', '/api/me/service-requests', hvB, { service: 'washing', action: 'cancel' });
    t.eq('Gửi đề nghị hủy máy giặt → 200', g2.status, 200, `HTTP ${g2.status} ${g2.json && g2.json.error || ''}`);
    t.eq('Ngày áp dụng hủy = ngày cuối tháng gửi', g2.json && String(g2.json.effective_date).slice(0, 10), cuoiKy);
    t.eq('Duyệt hủy → 200', (await t.api('POST', `/api/service-requests/${g2.json.id}/approve`, T, {})).status, 200);
    h = await hs(B);
    t.ok('Hủy: thôi trong danh sách, giữ hạn tính phí tới cuối tháng', h.uses_washing === false && h.toi === cuoiKy, JSON.stringify(h));
    t.eq('Phiếu KỲ NÀY vẫn tính máy giặt (dùng hết tháng)', (await tinhLai(B, ky)).giat, phiGiat);
    const bSau = await phieu(B, kySau);
    t.ok('Phiếu KỲ SAU thôi tính máy giặt (tự tính lại lúc duyệt)', daTinhLai(bSau) && bSau.giat === 0, JSON.stringify(bSau));
    // Lưu hồ sơ ở form quản trị (không gửi uses_washing) KHÔNG được xoá mất hạn hủy.
    await t.api('PUT', `/api/students/${B}`, T, { class_name: 'Lớp mới' });
    t.eq('Lưu hồ sơ không xoá mất hạn hủy cuối tháng', (await hs(B)).toi, cuoiKy);
    t.eq('…phiếu kỳ này vẫn còn phí máy giặt', (await tinhLai(B, ky)).giat, phiGiat);

    /* ===== 5. Đăng ký gửi xe: bắt buộc biển số, tính từ kỳ sau, an ninh điểm danh ngay ===== */
    t.eq('Đăng ký gửi xe không nhập biển → 400',
      (await t.api('POST', '/api/me/service-requests', hvA, { service: 'parking', action: 'register', plate: '  ' })).status, 400);
    t.eq('Biển trùng xe người khác đang gửi → 400',
      (await t.api('POST', '/api/me/service-requests', hvA, { service: 'parking', action: 'register', plate: P.toUpperCase() + '-B1' })).status, 400);
    const bien = P.toUpperCase() + '-A1';
    const g3 = await t.api('POST', '/api/me/service-requests', hvA, { service: 'parking', action: 'register', plate: bien, vehicle_type: 'Xe máy' });
    t.eq('Gửi đề nghị gửi xe → 200', g3.status, 200, `HTTP ${g3.status} ${g3.json && g3.json.error || ''}`);
    t.eq('Gửi xong CHƯA có xe trong hồ sơ', (await t.db.query('SELECT COUNT(*)::int c FROM vehicles WHERE student_id=$1', [A])).rows[0].c, 0);
    t.eq('Duyệt gửi xe → 200', (await t.api('POST', `/api/service-requests/${g3.json.id}/approve`, T, {})).status, 200);
    const xe = (await t.db.query(`SELECT plate, from_date::text AS tu, bill_from::text AS tinh FROM vehicles WHERE student_id=$1`, [A])).rows[0];
    t.ok('Xe vào danh sách từ hôm nay (an ninh điểm danh được), tính phí từ ngày 1 tháng sau',
      !!xe && xe.tu === homNay && xe.tinh === dauKySau, JSON.stringify(xe));
    t.eq('Phiếu KỲ NÀY không có phí gửi xe', (await tinhLai(A, ky)).xe, 0);
    const aSau2 = await phieu(A, kySau);
    t.ok('Phiếu KỲ SAU có phí gửi xe (tự tính lại lúc duyệt)', daTinhLai(aSau2) && aSau2.xe === phiXe, JSON.stringify(aSau2));

    /* ===== 6. Hủy gửi xe → vẫn tính hết tháng gửi ===== */
    t.eq('Mốc: B đang gửi xe, phiếu kỳ này có phí', (await tinhLai(B, ky)).xe, phiXe);
    t.eq('Hủy xe không phải của mình → 404',
      (await t.api('POST', '/api/me/service-requests', hvA, { service: 'parking', action: 'cancel', vehicle_id: xeB })).status, 404);
    const g4 = await t.api('POST', '/api/me/service-requests', hvB, { service: 'parking', action: 'cancel', vehicle_id: xeB });
    t.eq('Gửi đề nghị hủy gửi xe → 200', g4.status, 200, `HTTP ${g4.status} ${g4.json && g4.json.error || ''}`);
    t.eq('Duyệt hủy gửi xe → 200', (await t.api('POST', `/api/service-requests/${g4.json.id}/approve`, T, {})).status, 200);
    t.eq('Xe thôi gửi từ hôm nay (an ninh khỏi điểm danh)',
      (await t.db.query('SELECT to_date::text d FROM vehicles WHERE id=$1', [xeB])).rows[0].d, homNay);
    t.eq('Phiếu KỲ NÀY vẫn tính gửi xe (dùng hết tháng)', (await tinhLai(B, ky)).xe, phiXe);
    const bSau2 = await phieu(B, kySau);
    t.ok('Phiếu KỲ SAU thôi tính gửi xe (tự tính lại lúc duyệt)', daTinhLai(bSau2) && bSau2.xe === 0, JSON.stringify(bSau2));

    /* ===== 7. Từ chối: bắt buộc lý do, học viên đọc được ===== */
    const g5 = await t.api('POST', '/api/me/service-requests', hvB, { service: 'washing', action: 'register' });
    t.eq('B gửi lại đề nghị máy giặt → 200', g5.status, 200, `HTTP ${g5.status} ${g5.json && g5.json.error || ''}`);
    t.eq('Từ chối không ghi lý do → 400', (await t.api('POST', `/api/service-requests/${g5.json.id}/reject`, T, { note: '' })).status, 400);
    t.eq('Từ chối có lý do → 200',
      (await t.api('POST', `/api/service-requests/${g5.json.id}/reject`, T, { note: 'Máy đang hỏng, tháng sau đăng ký lại' })).status, 200);
    t.eq('Từ chối thì hồ sơ không đổi', (await hs(B)).uses_washing, false);
    const sv = (await t.api('GET', '/api/me/services', hvB)).json || {};
    const r5 = (sv.requests || []).find(x => x.id === g5.json.id) || {};
    t.ok('Học viên thấy bị từ chối kèm lý do', r5.status === 'rejected' && r5.decision_note === 'Máy đang hỏng, tháng sau đăng ký lại', JSON.stringify(r5));
    const tb = ((await t.api('GET', '/api/me/notifications', hvB)).json || {});
    const loai = (tb.items || tb.rows || (Array.isArray(tb) ? tb : [])).map(x => x.kind);
    t.ok('Chuông học viên có thông báo được duyệt và bị từ chối', loai.includes('svc_approved') && loai.includes('svc_rejected'), JSON.stringify(loai));

    /* ===== 8. Đường an ninh giữ nguyên: duyệt là tính luôn kỳ này ===== */
    const ws = await t.api('POST', '/api/maintenance/washing/requests', an, { student_id: C });
    t.eq('An ninh gửi đề nghị máy giặt → 200', ws.status, 200, `HTTP ${ws.status} ${ws.json && ws.json.error || ''}`);
    t.eq('Quản trị duyệt đề nghị an ninh → 200', (await t.api('POST', `/api/washing-requests/${ws.json.id}/approve`, T, {})).status, 200);
    t.eq('Đường an ninh: phiếu KỲ NÀY có phí máy giặt ngay', (await tinhLai(C, ky)).giat, phiGiat);

    await clean(t.db);
  },
};
