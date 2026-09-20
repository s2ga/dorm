// An ninh báo "xe lạ", quản trị xác nhận đó là xe của một HV đang ở: biển số phải VÀO danh sách gửi xe
// (trước đây chỉ đổi trạng thái báo cáo, biển số không nằm ở đâu cả). Cùng một lượt: ghi xe + đóng báo cáo.
const P = '__test_xela';

async function clean(db) {
  const fac = `(SELECT id FROM facilities WHERE name LIKE '${P}%')`;
  await db.query(`DELETE FROM parking_reports WHERE plate ILIKE '${P}%' OR reported_by LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM parking_daily_reports WHERE closed_by LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM parking_checks WHERE plate ILIKE '${P}%' OR checked_by LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM vehicles WHERE plate ILIKE '${P}%'
                   OR student_id IN (SELECT id FROM students WHERE facility_id IN ${fac})`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%' OR facility_id IN ${fac}`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
}

const doiNgay = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

module.exports = {
  name: 'Xe lạ → ghi thẳng vào danh sách gửi xe',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const loi = r => `HTTP ${r.status} ${(r.json && r.json.error) || ''}`;
    const ganXe = (id, body, ai) => t.api('POST', `/api/vehicles/parking-reports/${id}/vehicle`, ai === undefined ? T : ai, body);
    const bcDB = async id => (await t.db.query('SELECT status, vehicle_id, handled_by, handled_note FROM parking_reports WHERE id=$1', [id])).rows[0];

    const fac = (await t.db.query(`INSERT INTO facilities (name, address) VALUES ($1,'') RETURNING id`, [P + '_CS'])).rows[0].id;
    const R1 = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee,room_type)
       VALUES ($1,$2,4,'male','B',1200000,'shared') RETURNING id`, [P + '_R1', fac])).rows[0].id;
    const hv1 = await t.api('POST', '/api/students', T, {
      name: P + ' Mot', code: P + '_M1', gender: 'male', birth_date: '2004-05-06', room_id: R1, check_in_date: doiNgay(-40),
      check_out_date: doiNgay(60), rental_type: 'ghep', confirm_overload: true,   // BL-117: ngày tương lai = LỊCH trả phòng
    });
    t.eq('Dựng HV đang ở', hv1.status, 201, loi(hv1));
    const hv2 = await t.api('POST', '/api/students', T, {
      name: P + ' Hai', code: P + '_M2', gender: 'male', birth_date: '2004-05-06', room_id: R1, check_in_date: doiNgay(-30), rental_type: 'ghep', confirm_overload: true,
    });
    t.eq('Dựng HV thứ hai', hv2.status, 201, loi(hv2));
    const s1 = hv1.json.id, s2 = hv2.json.id;
    await t.db.query(`UPDATE students SET check_out_date=$1, status='out', checkout_confirmed_at=now() WHERE id=$2`, [doiNgay(-5), s2]);

    const AN = P + '_anninh';
    const tk = await t.api('POST', '/api/admin/users', T,
      { username: AN, password: 'anninh123456', role: 'maintenance', full_name: 'Bao ve xe la', facility_id: fac });
    t.eq('Dựng tài khoản an ninh', tk.status, 201, loi(tk));
    await t.db.query('UPDATE users SET must_change_password=false WHERE username=$1', [AN]);
    const A = await t.login(AN, 'anninh123456');

    const baoXeLa = async bien => {
      const r = await t.api('POST', '/api/maintenance/parking/stranger', A, { plate: bien, note: 'Xe lạ đậu sát cổng' });
      t.eq(`An ninh ghi nhận xe lạ ${bien}`, r.status, 200, loi(r));
      return r.json.id;
    };

    // ── Đường chính: xác nhận là xe của HV đang ở -> biển số VÀO bảng vehicles ────────────────────
    const b1 = await baoXeLa(P + '-L1');
    const cbTruoc = await t.api('GET', `/api/vehicles/parking-alerts?facility=${fac}`, T);
    t.eq('Chuông đếm 1 báo cáo chưa xem', cbTruoc.json.reports_new, 1, loi(cbTruoc));

    const gan = await ganXe(b1, { student_id: s1, vehicle_type: 'Xe số', sticker: '201.1' });
    t.eq('Gán xe lạ cho HV đang ở → 200', gan.status, 200, loi(gan));
    const xe = (await t.db.query('SELECT id, student_id, plate, vehicle_type, sticker, from_date, to_date FROM vehicles WHERE plate ILIKE $1', [P + '-L1'])).rows[0];
    t.ok('Biển số ĐÃ nằm trong danh sách gửi xe', !!xe, 'không thấy dòng vehicles nào');
    t.eq('Đúng chủ xe', xe && xe.student_id, s1);
    t.eq('Giữ nguyên biển an ninh đọc được', xe && xe.plate, P + '-L1');
    t.eq('Giữ loại xe đã nhập', xe && xe.vehicle_type, 'Xe số');
    t.eq('Giữ mã dán đã nhập', xe && xe.sticker, '201.1');
    t.eq('Hiệu lực từ = ngày nhận phòng của chủ xe', xe && String(xe.from_date).slice(0, 10), doiNgay(-40));
    t.eq('Hiệu lực đến = lịch trả phòng (BL-117)', xe && String(xe.to_date).slice(0, 10), doiNgay(60));

    const sau1 = await bcDB(b1);
    t.eq('Báo cáo chuyển sang đã xử lý', sau1.status, 'done');
    t.eq('Báo cáo trỏ đúng xe vừa ghi', sau1.vehicle_id, xe && xe.id);
    t.eq('Ghi người xử lý', sau1.handled_by, 'admin');
    t.ok('Ghi chú nói rõ đã ghi vào danh sách', /danh sách gửi xe/.test(sau1.handled_note || ''), sau1.handled_note);

    const dsBC = await t.api('GET', `/api/vehicles/parking-reports?status=all&facility=${fac}`, T);
    const dong = (dsBC.json.rows || []).find(x => x.id === b1);
    t.eq('Danh sách báo cáo nay hiện tên chủ xe', dong && dong.student_name, P + ' Mot', loi(dsBC));
    const cbSau = await t.api('GET', `/api/vehicles/parking-alerts?facility=${fac}`, T);
    t.eq('Chuông hết báo cáo chưa xem', cbSau.json.reports_new, 0);
    t.eq('Xe mới được đếm vào bãi phải kiểm', cbSau.json.tong, 1);

    t.eq('Gán lần hai vào cùng báo cáo → 409', (await ganXe(b1, { student_id: s1 })).status, 409);

    // ── Chặn: chỉ báo cáo XE LẠ, phải có chủ, chủ phải đang ở, biển không được trùng ───────────────
    const bKhac = await t.api('POST', '/api/maintenance/parking-reports', A, { kind: 'other', vehicle_id: xe.id, note: 'Đậu chắn lối' });
    t.eq('Dựng báo cáo loại khác', bKhac.status, 200, loi(bKhac));
    const ganKhac = await ganXe(bKhac.json.id, { student_id: s1 });
    t.eq('Báo cáo KHÔNG phải xe lạ → 400', ganKhac.status, 400, loi(ganKhac));

    const b2 = await baoXeLa(P + '-L2');
    t.eq('Thiếu chủ xe → 400', (await ganXe(b2, {})).status, 400);
    const ganRa = await ganXe(b2, { student_id: s2 });
    t.eq('Gán cho người ĐÃ TRẢ PHÒNG → 400', ganRa.status, 400, loi(ganRa));
    const ganTrung = await ganXe(b2, { student_id: s1, plate: P + '-L1' });
    t.eq('Biển đã đăng ký cho người khác → 400', ganTrung.status, 400, loi(ganTrung));

    // Hỏng giữa chừng phải QUAY LUI SẠCH: không tạo xe rác, báo cáo vẫn "chưa xem" để làm lại.
    const sau2 = await bcDB(b2);
    t.eq('Báo cáo lỗi vẫn ở trạng thái chưa xem', sau2.status, 'new');
    t.eq('Báo cáo lỗi chưa gắn xe nào', sau2.vehicle_id, null);
    t.eq('Không sinh dòng xe rác',
      (await t.db.query('SELECT count(*)::int c FROM vehicles WHERE plate ILIKE $1', [P + '-L2'])).rows[0].c, 0);

    // Làm lại đúng thì vẫn chạy — biển lấy từ chính báo cáo khi không gửi ô biển số.
    const lam2 = await ganXe(b2, { student_id: s1 });
    t.eq('Gán lại đúng cách → 200', lam2.status, 200, loi(lam2));
    t.eq('Biển lấy từ báo cáo khi để trống ô biển',
      (await t.db.query('SELECT count(*)::int c FROM vehicles WHERE plate ILIKE $1', [P + '-L2'])).rows[0].c, 1);

    // ── Quyền: an ninh không tự ghi vào danh sách xe; báo cáo lạ → 404 ────────────────────────────
    const b3 = await baoXeLa(P + '-L3');
    t.eq('An ninh KHÔNG tự gán được xe (403)', (await ganXe(b3, { student_id: s1 }, A)).status, 403);
    t.eq('Chưa đăng nhập → 401', (await ganXe(b3, { student_id: s1 }, null)).status, 401);
    t.eq('Báo cáo không tồn tại → 404', (await ganXe(999999999, { student_id: s1 })).status, 404);
    t.eq('Báo cáo bị từ chối vẫn còn nguyên', (await bcDB(b3)).status, 'new');
  },
};
