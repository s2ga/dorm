// BL-120: trang Xe của an ninh — tổng danh sách xe (đang ở / đã trả + phòng cũ → mới), sửa biển qua DUYỆT,
// báo cáo về quản trị viên, chốt ngày = bản tổng kết + mail, chuông (đề nghị chờ duyệt, báo cáo chưa xem,
// xe vắng lâu, quá giờ chưa chốt). Vẫn canh: điểm danh KHÔNG đụng bảng vehicles ngoài biển số ĐÃ DUYỆT.
const P = '__test_b120';

// Biển số duyệt xong được viết HOA -> dọn bằng ILIKE, không thì bản ghi sót lại sau test.
async function clean(db) {
  const fac = `(SELECT id FROM facilities WHERE name LIKE '${P}%')`;
  await db.query(`DELETE FROM parking_reports WHERE plate ILIKE '${P}%' OR reported_by LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM parking_daily_reports WHERE closed_by LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM vehicle_plate_requests WHERE plate_moi ILIKE '${P}%' OR requested_by LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM parking_checks WHERE plate ILIKE '${P}%' OR checked_by LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM vehicles WHERE plate ILIKE '${P}%'
                   OR student_id IN (SELECT id FROM students WHERE facility_id IN ${fac})`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
}

const lui = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const cho = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  name: 'BL-120 — Xe an ninh: đề nghị sửa biển, báo cáo, chốt ngày, chuông quản trị',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const homNay = lui(0);
    const loi = r => `HTTP ${r.status} ${(r.json && r.json.error) || ''}`;

    // Cài đặt là TOÀN CỤC — test đổi giờ nhắc + email nhận thì phải trả lại y cũ.
    const setCu = (await t.api('GET', '/api/settings', T)).json || {};
    const gioCu = setCu.parking_close_alert_time || '23:00', mailCu = setCu.parking_report_email || '';
    try {
      const fac = (await t.db.query(`INSERT INTO facilities (name, address) VALUES ($1,'') RETURNING id`, [P + '_CS'])).rows[0].id;
      const phong = async ten => (await t.db.query(
        `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee,room_type)
         VALUES ($1,$2,4,'male','B',1200000,'shared') RETURNING id`, [ten, fac])).rows[0].id;
      const R1 = await phong(P + '_R1'), R2 = await phong(P + '_R2');
      const hv1 = await t.api('POST', '/api/students', T, {
        name: P + ' Mot', code: P + '_M1', gender: 'male', room_id: R1, check_in_date: lui(90), rental_type: 'ghep', confirm_overload: true,
      });
      t.eq('Dựng HV1 đang ở', hv1.status, 201, loi(hv1));
      const hv2 = await t.api('POST', '/api/students', T, {
        name: P + ' Hai', code: P + '_M2', gender: 'male', room_id: R1, check_in_date: lui(60), rental_type: 'ghep', confirm_overload: true,
      });
      t.eq('Dựng HV2', hv2.status, 201, loi(hv2));
      const s1 = hv1.json.id, s2 = hv2.json.id;
      // Biển ngắn: đề nghị sửa biển giới hạn 20 ký tự, tiền tố test đã chiếm 11.
      const x1 = await t.api('POST', '/api/vehicles', T, { student_id: s1, plate: P + '-A1' });
      const x2 = await t.api('POST', '/api/vehicles', T, { student_id: s2, plate: P + '-A2' });
      t.ok('Dựng 2 xe', x1.status === 201 && x2.status === 201, loi(x1) + ' · ' + loi(x2));
      // HV2 đã trả phòng 3 ngày trước, xe vẫn mở (ghi thẳng CSDL — bước xác nhận trả là của bộ test khác).
      await t.db.query(`UPDATE students SET check_out_date=$1, status='out', checkout_confirmed_at=now() WHERE id=$2`, [lui(3), s2]);
      const v1 = x1.json.id, v2 = x2.json.id;

      const AN = P + '_anninh';
      const tk = await t.api('POST', '/api/admin/users', T,
        { username: AN, password: 'anninh123456', role: 'maintenance', full_name: 'Bao ve BL120', facility_id: fac });
      t.eq('Dựng tài khoản an ninh gắn cơ sở', tk.status, 201, loi(tk));
      await t.db.query('UPDATE users SET must_change_password=false WHERE username=$1', [AN]);
      const A = await t.login(AN, 'anninh123456');

      // ── Danh sách: MỌI xe đã đăng ký, cột phai_kiem / da_tra, ngày để vẽ trạng thái ở ─────────────
      let ds = await t.api('GET', '/api/maintenance/parking', A);
      t.eq('An ninh lấy được danh sách', ds.status, 200, loi(ds));
      const tim = id => ds.json.vehicles.find(v => v.vehicle_id === id);
      let r1 = tim(v1), r2 = tim(v2);
      t.ok('Xe của HV đang ở: phải kiểm', !!r1 && r1.phai_kiem === true);
      t.ok('Xe của HV ĐÃ TRẢ vẫn có trong danh sách (tab Đã trả) nhưng KHÔNG phải kiểm', !!r2 && r2.phai_kiem === false && r2.da_tra === true);
      t.eq('Tổng xe phải kiểm chỉ đếm xe đang ở', ds.json.summary.tong, 1);
      t.eq('Dòng xe mang ngày vào (vẽ nhãn trạng thái ở)', r1 && r1.check_in_date, lui(90));
      t.eq('Dòng xe của người đã trả mang ngày ra', r2 && r2.check_out_date, lui(3));
      t.ok('Có danh sách báo cáo + bản chốt (đang rỗng)', Array.isArray(ds.json.reports) && Array.isArray(ds.json.dailies) && !ds.json.dailies.length);

      // ── Chuyển phòng -> dòng xe hiện phòng cũ → mới, ở CẢ màn an ninh lẫn màn quản trị ─────────────
      const ch = await t.api('POST', `/api/students/${s1}/transfer`, T, { room_id: R2, date: homNay });
      t.eq('Chuyển phòng HV1 R1 → R2', ch.status, 200, loi(ch));
      ds = await t.api('GET', '/api/maintenance/parking', A);
      r1 = tim(v1);
      t.eq('An ninh thấy phòng mới', r1 && r1.room_name, P + '_R2');
      t.eq('An ninh thấy phòng cũ', r1 && r1.prev_room_name, P + '_R1');
      t.eq('Ngày chuyển = ngày bắt đầu lượt ở mới', r1 && r1.moved_on, homNay);
      const dsQT = await t.api('GET', `/api/vehicles?facility=${fac}`, T);
      const q1 = (dsQT.json || []).find(v => v.id === v1);
      t.eq('Màn quản trị (Dịch vụ → Gửi xe) cùng nguồn phòng cũ', q1 && q1.prev_room_name, P + '_R1');

      // ── Sửa biển = ĐỀ NGHỊ; hồ sơ xe chỉ đổi khi quản trị duyệt ─────────────────────────────────
      const dn0 = await t.api('PUT', `/api/maintenance/vehicles/${v1}/plate`, A, { plate: '   ' });
      t.eq('Biển trống → 400', dn0.status, 400, loi(dn0));
      const dnCung = await t.api('PUT', `/api/maintenance/vehicles/${v1}/plate`, A, { plate: (P + 'a1').toLowerCase() });
      t.ok('Cùng biển khác cách viết → doi=false, không tạo đề nghị', dnCung.status === 200 && dnCung.json.doi === false, loi(dnCung));
      const dupX2 = await t.api('PUT', `/api/maintenance/vehicles/${v1}/plate`, A, { plate: P + '-A2' });
      t.eq('Biển đã của xe khác → 400', dupX2.status, 400, loi(dupX2));
      const dn1 = await t.api('PUT', `/api/maintenance/vehicles/${v1}/plate`, A, { plate: P.toLowerCase() + '-m3', note: 'Đọc trên xe thật' });
      t.eq('Gửi đề nghị → 200', dn1.status, 200, loi(dn1));
      t.eq('Trạng thái chờ duyệt', dn1.json.status, 'pending');
      const bienMoi = (P + '-M3').toUpperCase();
      t.eq('Biển đề nghị được viết hoa', dn1.json.plate, bienMoi);
      t.eq('Hồ sơ xe CHƯA đổi khi mới đề nghị', (await t.db.query('SELECT plate FROM vehicles WHERE id=$1', [v1])).rows[0].plate, P + '-A1');
      const dn2 = await t.api('PUT', `/api/maintenance/vehicles/${v1}/plate`, A, { plate: P + '-K4' });
      t.eq('Đề nghị thứ hai khi cái trước còn chờ → 409', dn2.status, 409, loi(dn2));
      ds = await t.api('GET', '/api/maintenance/parking', A);
      r1 = tim(v1);
      t.eq('Dòng xe hiện đề nghị đang chờ', r1 && r1.req_status, 'pending');
      t.eq('Kèm biển đề nghị', r1 && r1.req_plate, bienMoi);

      t.eq('An ninh KHÔNG xem được danh sách đề nghị', (await t.api('GET', '/api/vehicles/plate-requests', A)).status, 403);
      t.eq('An ninh KHÔNG tự duyệt được', (await t.api('POST', `/api/vehicles/plate-requests/${dn1.json.id}/approve`, A, {})).status, 403);
      const dsDN = await t.api('GET', `/api/vehicles/plate-requests?facility=${fac}`, T);
      t.eq('Quản trị xem đề nghị → 200', dsDN.status, 200, loi(dsDN));
      const qDN = (dsDN.json.rows || []).find(q => q.id === dn1.json.id);
      t.ok('Đề nghị nằm trong danh sách chờ duyệt kèm chủ xe + ghi chú', !!qDN && qDN.student_name === P + ' Mot' && qDN.note === 'Đọc trên xe thật');
      const cb0 = await t.api('GET', `/api/vehicles/parking-alerts?facility=${fac}`, T);
      t.eq('Chuông quản trị đếm 1 đề nghị chờ duyệt', cb0.json && cb0.json.plate_requests, 1, loi(cb0));

      const tcTrong = await t.api('POST', `/api/vehicles/plate-requests/${dn1.json.id}/reject`, T, { note: '' });
      t.eq('Từ chối không lý do → 400', tcTrong.status, 400, loi(tcTrong));
      const ok1 = await t.api('POST', `/api/vehicles/plate-requests/${dn1.json.id}/approve`, T, {});
      t.eq('Duyệt → 200', ok1.status, 200, loi(ok1));
      const bienSau = (await t.db.query('SELECT plate, to_date, deleted_at FROM vehicles WHERE id=$1', [v1])).rows[0];
      t.eq('Hồ sơ xe đổi biển SAU khi duyệt', bienSau.plate, bienMoi);
      t.ok('Duyệt biển KHÔNG đụng hiệu lực xe (đường tiền)', bienSau.to_date === null && bienSau.deleted_at === null);
      const nk = await t.db.query(`SELECT count(*)::int c FROM audit_log WHERE method='SỬA-BIỂN' AND detail LIKE $1 AND detail LIKE $2`,
        ['%' + P + '-A1%', '%' + AN + '%']);
      t.ok('Nhật ký ghi cũ → mới kèm người đề nghị', nk.rows[0].c >= 1, `${nk.rows[0].c} dòng`);
      t.eq('Duyệt lần hai → 409', (await t.api('POST', `/api/vehicles/plate-requests/${dn1.json.id}/approve`, T, {})).status, 409);

      const dn3 = await t.api('PUT', `/api/maintenance/vehicles/${v1}/plate`, A, { plate: P + '-T5' });
      t.eq('Đề nghị mới sau khi cái trước đã xử lý → 200', dn3.status, 200, loi(dn3));
      const tc = await t.api('POST', `/api/vehicles/plate-requests/${dn3.json.id}/reject`, T, { note: 'Đã đối chiếu cà vẹt' });
      t.eq('Từ chối có lý do → 200', tc.status, 200, loi(tc));
      ds = await t.api('GET', '/api/maintenance/parking', A);
      r1 = tim(v1);
      t.eq('Dòng xe hiện bị từ chối', r1 && r1.req_status, 'rejected');
      t.eq('Kèm lý do để an ninh biết', r1 && r1.req_note, 'Đã đối chiếu cà vẹt');
      t.eq('Biển giữ nguyên bản đã duyệt', (await t.db.query('SELECT plate FROM vehicles WHERE id=$1', [v1])).rows[0].plate, bienMoi);

      // ── Báo cáo của an ninh: 3 loại, quản trị xem / xử lý, an ninh chỉ xoá được khi chưa ai xem ──
      const rp = (b, ai) => t.api('POST', '/api/maintenance/parking-reports', ai || A, b);
      t.eq('Loại lạ → 400', (await rp({ kind: 'xyz', vehicle_id: v1 })).status, 400);
      t.eq('Loại "khác" không nội dung → 400', (await rp({ kind: 'other', vehicle_id: v1, note: '' })).status, 400);
      t.eq('Thiếu xe → 400', (await rp({ kind: 'absent_long' })).status, 400);
      const bc1 = await rp({ kind: 'other', vehicle_id: v1, note: 'Xe đậu chắn lối thoát hiểm' });
      t.eq('Báo cáo loại khác → 200', bc1.status, 200, loi(bc1));
      const bc2 = await rp({ kind: 'absent_long', vehicle_id: v1 });
      t.eq('Báo cáo vắng nhiều ngày → 200', bc2.status, 200, loi(bc2));
      const la = await t.api('POST', '/api/maintenance/parking/stranger', A, { plate: P + '-LA9', note: 'Xe lạ đậu sát cổng' });
      t.eq('Đường xe lạ cũ vẫn chạy → 200', la.status, 200, loi(la));
      const laDB = (await t.db.query('SELECT kind, status, facility_id FROM parking_reports WHERE id=$1', [la.json.id])).rows[0];
      t.ok('Xe lạ nay là báo cáo loại stranger, gắn cơ sở của an ninh', !!laDB && laDB.kind === 'stranger' && laDB.facility_id === fac);
      t.eq('Xe lạ KHÔNG còn ghi vào parking_checks', (await t.db.query(`SELECT count(*)::int c FROM parking_checks WHERE status='stranger' AND plate ILIKE $1`, [P + '%'])).rows[0].c, 0);
      const laTrung = await rp({ kind: 'stranger', plate: (P + 'm3').toLowerCase() });
      t.eq('Xe lạ trùng biển đã đăng ký → 409, chỉ đúng xe', laTrung.status === 409 && laTrung.json.registered && laTrung.json.registered.vehicle_id, v1, loi(laTrung));

      ds = await t.api('GET', '/api/maintenance/parking', A);
      t.eq('Danh sách ngày hôm nay có 3 báo cáo', ds.json.reports.length, 3);
      const cb1 = await t.api('GET', `/api/vehicles/parking-alerts?facility=${fac}`, T);
      t.eq('Chuông đếm 3 báo cáo chưa xem', cb1.json.reports_new, 3);
      const dsBC = await t.api('GET', `/api/vehicles/parking-reports?status=new&facility=${fac}`, T);
      t.ok('Quản trị thấy báo cáo kèm chủ xe', (dsBC.json.rows || []).some(x => x.id === bc1.json.id && x.student_name === P + ' Mot'), loi(dsBC));
      t.eq('Trạng thái lạ → 400', (await t.api('POST', `/api/vehicles/parking-reports/${bc1.json.id}/status`, T, { status: 'xyz' })).status, 400);
      t.eq('Đánh dấu đã xem → 200', (await t.api('POST', `/api/vehicles/parking-reports/${bc1.json.id}/status`, T, { status: 'seen' })).status, 200);
      t.eq('An ninh xoá báo cáo QTV ĐÃ xem → 409', (await t.api('DELETE', `/api/maintenance/parking-reports/${bc1.json.id}`, A)).status, 409);
      t.eq('An ninh xoá báo cáo chưa xem → 200', (await t.api('DELETE', `/api/maintenance/parking-reports/${bc2.json.id}`, A)).status, 200);
      t.eq('Xoá lần hai → 404', (await t.api('DELETE', `/api/maintenance/parking-reports/${bc2.json.id}`, A)).status, 404);
      const cb2 = await t.api('GET', `/api/vehicles/parking-alerts?facility=${fac}`, T);
      t.eq('Chuông còn 1 báo cáo chưa xem (xe lạ)', cb2.json.reports_new, 1);

      // ── Cài đặt: giờ nhắc chưa chốt + email nhận báo cáo ─────────────────────────────────────────
      t.eq('Giờ nhắc rác → 400', (await t.api('PUT', '/api/settings', T, { parking_close_alert_time: '25:99' })).status, 400);
      t.eq('Email rác → 400', (await t.api('PUT', '/api/settings', T, { parking_report_email: 'abc, x@y.vn' })).status, 400);
      t.eq('Email hợp lệ nhiều địa chỉ → 200', (await t.api('PUT', '/api/settings', T, { parking_report_email: 'a@x.vn, b@y.vn' })).status, 200);
      t.eq('Đặt giờ nhắc 00:00 → 200', (await t.api('PUT', '/api/settings', T, { parking_close_alert_time: '00:00' })).status, 200);
      const cb3 = await t.api('GET', `/api/vehicles/parking-alerts?facility=${fac}`, T);
      t.eq('Chưa chốt mà đã qua giờ nhắc → chuông báo chưa chốt', cb3.json.chua_chot, true);
      t.eq('Chuông trả đúng giờ nhắc đã cài', cb3.json.alert_time, '00:00');
      t.eq('An ninh KHÔNG gọi được chuông quản trị', (await t.api('GET', '/api/vehicles/parking-alerts', A)).status, 403);

      // ── Chốt ngày: ghi vắng + bản tổng kết + mail ở nền ───────────────────────────────────────────
      const chot = await t.api('POST', '/api/maintenance/parking/finish', A, {});
      t.eq('An ninh chốt → 200', chot.status, 200, loi(chot));
      t.eq('Chốt ghi VẮNG cho xe đang ở chưa đánh (1), KHÔNG cho xe của người đã trả', chot.json.da_ghi_vang, 1);
      const dl = chot.json.daily || {};
      t.ok('Trả bản tổng kết ngày (1 xe · 0 có · 1 vắng)', dl.tong === 1 && dl.vang === 1 && dl.co_mat === 0, JSON.stringify(dl));
      t.eq('Bản tổng kết đếm báo cáo còn lại trong ngày', dl.so_bao_cao, 2);
      t.eq('Lần đầu chốt → gửi mail', dl.mail, 'sending');
      t.eq('Xe của người đã trả phòng KHÔNG bị ghi vắng',
        (await t.db.query('SELECT count(*)::int c FROM parking_checks WHERE vehicle_id=$1 AND check_date=$2', [v2, homNay])).rows[0].c, 0);
      // Mail chạy ở nền; máy local thường không có SMTP -> phải ghi LÝ DO vào bản chốt, không im lặng.
      let mailRow = null;
      for (let i = 0; i < 40; i++) {
        mailRow = (await t.db.query('SELECT mail_to, mail_sent_at, mail_error, closed_by, facility_id FROM parking_daily_reports WHERE id=$1', [dl.id])).rows[0];
        if (mailRow && (mailRow.mail_sent_at || mailRow.mail_error)) break;
        await cho(250);
      }
      t.ok('Bản chốt ghi kết quả mail (gửi được hoặc lý do rõ)', !!(mailRow && (mailRow.mail_sent_at || mailRow.mail_error)), (mailRow && (mailRow.mail_error || 'đã gửi')) || 'chưa có gì');
      t.eq('Người nhận lấy từ Cài đặt', mailRow && mailRow.mail_to, 'a@x.vn, b@y.vn');
      t.eq('Bản chốt gắn cơ sở của an ninh', mailRow && mailRow.facility_id, fac);
      t.eq('Ghi người chốt', mailRow && mailRow.closed_by, AN);

      const chot2 = await t.api('POST', '/api/maintenance/parking/finish', A, {});
      t.eq('Chốt lại cùng số liệu → KHÔNG dội mail lần nữa', chot2.json.daily && chot2.json.daily.mail, 'kept');
      const co = await t.api('POST', '/api/maintenance/parking/mark', A, { vehicle_id: v1, status: 'present' });
      t.eq('Đánh có mặt', co.status, 200, loi(co));
      const chot3 = await t.api('POST', '/api/maintenance/parking/finish', A, {});
      t.eq('Số liệu đổi (có 1) → gửi lại mail', chot3.json.daily && chot3.json.daily.mail, 'sending');
      t.eq('Bản chốt ghi đè: vẫn MỘT dòng cho ngày + cơ sở',
        (await t.db.query('SELECT count(*)::int c FROM parking_daily_reports WHERE report_date=$1 AND facility_id=$2', [homNay, fac])).rows[0].c, 1);
      ds = await t.api('GET', '/api/maintenance/parking', A);
      t.ok('An ninh thấy bản chốt hôm nay với số mới', ds.json.dailies.length === 1 && ds.json.dailies[0].co_mat === 1);
      const cb4 = await t.api('GET', `/api/vehicles/parking-alerts?facility=${fac}`, T);
      t.eq('Đã chốt → chuông thôi báo chưa chốt', cb4.json.chua_chot, false);
      t.eq('Chuông kèm bản chốt hôm nay', (cb4.json.dailies || []).length, 1);

      // ── Xe vắng liên tiếp vượt ngưỡng -> cờ trên dòng + chuông ───────────────────────────────────
      const nguong = ds.json.alert_days;
      t.ok('Ngưỡng vắng đọc từ Cài đặt', nguong > 0, `alert_days=${nguong}`);
      await t.db.query(
        `INSERT INTO parking_checks (check_date, facility_id, vehicle_id, plate, plate_norm, status, checked_by)
         SELECT d::date, $2, $1, 'X', 'X', 'absent', $3 FROM generate_series($4::date, $5::date, '1 day') d
         ON CONFLICT DO NOTHING`, [v1, fac, AN, lui(nguong + 2), lui(1)]);
      await t.api('POST', '/api/maintenance/parking/mark', A, { vehicle_id: v1, status: 'absent' });
      ds = await t.api('GET', '/api/maintenance/parking', A);
      r1 = tim(v1);
      t.ok('Dòng xe mang số ngày vắng liên tiếp ≥ ngưỡng', !!r1 && r1.vang_lien_tiep >= nguong, `vắng ${r1 && r1.vang_lien_tiep} · ngưỡng ${nguong}`);
      const cb5 = await t.api('GET', `/api/vehicles/parking-alerts?facility=${fac}`, T);
      t.ok('Chuông liệt kê xe vắng lâu', (cb5.json.vang_lau || []).some(x => x.vehicle_id === v1), JSON.stringify(cb5.json.vang_lau));

      // ── Đường tiền: vehicles chỉ đổi biển ĐÃ DUYỆT, không đổi gì khác ────────────────────────────
      const cuoi = (await t.db.query('SELECT from_date, to_date, deleted_at FROM vehicles WHERE id=$1', [v1])).rows[0];
      t.ok('Điểm danh / báo cáo / chốt KHÔNG đụng hiệu lực xe', cuoi.to_date === null && cuoi.deleted_at === null);
      t.eq('Chưa đăng nhập → 401', (await t.api('POST', '/api/maintenance/parking-reports', null, { kind: 'other' })).status, 401);
    } finally {
      await t.api('PUT', '/api/settings', T, { parking_close_alert_time: gioCu, parking_report_email: mailCu });
    }
  },
};
