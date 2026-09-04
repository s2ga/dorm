// Điểm danh bãi xe: an ninh đi một vòng mỗi ngày, đánh dấu xe nào có gửi / không gửi, ghi xe lạ.
// Chốt lớn nhất của bộ này: tính năng CHỈ ĐỌC bảng vehicles. Chạm vào đó là đổi tiền gửi xe của
// học viên (internal/vehiclecount đếm hàng ở đó), nên có test canh riêng.
const P = '__test_pk';

// Dọn theo CƠ SỞ riêng của bộ test, không chỉ theo tiền tố tên: bước "chốt lượt kiểm" ghi một dòng
// cho MỌI xe trong tầm nhìn, nên chạy trên cơ sở chung là đóng dấu lên cả xe thật.
async function clean(db) {
  await db.query(`DELETE FROM parking_checks
                   WHERE plate LIKE '${P}%' OR checked_by LIKE '${P}%'
                      OR facility_id IN (SELECT id FROM facilities WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM vehicles WHERE plate LIKE '${P}%'
                   OR student_id IN (SELECT id FROM students WHERE facility_id IN (SELECT id FROM facilities WHERE name LIKE '${P}%'))`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'
                   OR facility_id IN (SELECT id FROM facilities WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'
                   OR facility_id IN (SELECT id FROM facilities WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
}

// Ngày trong QUÁ KHỨ tính từ hôm nay — không viết cứng '2026-07-25' như bộ xe-hieu-luc:
// ngày cứng thì test cứ chạy được tới lúc nó lùi vào quá khứ rồi vỡ mà không ai đụng code.
const lui = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

module.exports = {
  name: 'Điểm danh bãi xe — an ninh kiểm hằng ngày',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const homNay = lui(0);

    // Cơ sở RIÊNG: "chốt lượt kiểm" quét mọi xe trong tầm nhìn, chạy chung cơ sở thật là ghi đè lên
    // dữ liệu của bộ test khác (và của xe thật trên staging).
    const fac = (await t.db.query(
      `INSERT INTO facilities (name, address) VALUES ($1,'') RETURNING id`, [P + '_CS'])).rows[0].id;
    const R = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee,room_type)
       VALUES ($1,$2,4,'male','B',1200000,'shared') RETURNING id`, [P + '_R', fac])).rows[0].id;
    const hv = await t.api('POST', '/api/students', T, {
      name: P + ' Nam', code: P + '_MA', gender: 'male', room_id: R,
      check_in_date: lui(90), rental_type: 'ghep', confirm_overload: true,
    });
    t.eq('Dựng học viên thử', hv.status, 201, `HTTP ${hv.status} ${hv.json && hv.json.error || ''}`);
    const sid = hv.json.id;
    const xe = await t.api('POST', '/api/vehicles', T, { student_id: sid, plate: P + '-B4 508.58' });
    t.eq('Dựng xe thử', xe.status, 201, `HTTP ${xe.status} ${xe.json && xe.json.error || ''}`);
    const vid = xe.json.id;

    // ── Danh sách xe phải kiểm ──────────────────────────────────────────────────────────
    const ds = await t.api('GET', '/api/maintenance/parking', T);
    t.eq('Lấy được danh sách điểm danh', ds.status, 200, `HTTP ${ds.status}`);
    t.eq('Ngày mặc định là hôm nay', ds.json.date, homNay);
    const cua = ds.json.vehicles.find(v => v.vehicle_id === vid);
    t.ok('Xe vừa dựng nằm trong danh sách phải kiểm', !!cua);
    t.eq('Chưa đánh dấu thì status rỗng', cua && cua.status, null);
    t.eq('Không lộ đường dẫn ảnh ra ngoài', cua && cua.photo_key, undefined,
      'API chỉ được trả has_photo, không trả photo_key');

    // ── Đánh dấu + đánh lại là GHI ĐÈ, không đẻ dòng thứ hai ────────────────────────────
    const m1 = await t.api('POST', '/api/maintenance/parking/mark', T, { vehicle_id: vid, status: 'present' });
    t.eq('Đánh dấu có gửi → 200', m1.status, 200, `HTTP ${m1.status} ${m1.json && m1.json.error || ''}`);
    const m2 = await t.api('POST', '/api/maintenance/parking/mark', T, { vehicle_id: vid, status: 'absent' });
    t.eq('Đánh lại thành không gửi → 200', m2.status, 200);
    t.eq('Đánh lại GHI ĐÈ, cùng một bản ghi', m2.json.id, m1.json.id);
    const dem = await t.db.query('SELECT count(*)::int c FROM parking_checks WHERE vehicle_id=$1 AND check_date=$2', [vid, homNay]);
    t.eq('Một xe một ngày chỉ MỘT dòng', dem.rows[0].c, 1);

    // ── Chặn dữ liệu sai ────────────────────────────────────────────────────────────────
    const xau = await t.api('POST', '/api/maintenance/parking/mark', T, { vehicle_id: vid, status: 'xyz' });
    t.eq('Trạng thái lạ → 400, không âm thầm ép về giá trị khác', xau.status, 400, `HTTP ${xau.status}`);
    const tuongLai = await t.api('POST', '/api/maintenance/parking/mark', T,
      { vehicle_id: vid, status: 'present', date: '2099-01-01' });
    t.eq('Điểm danh ngày TƯƠNG LAI → 400', tuongLai.status, 400, `HTTP ${tuongLai.status}`);
    const maLa = await t.api('POST', '/api/maintenance/parking/mark', T, { vehicle_id: 99999999, status: 'present' });
    t.eq('Xe không tồn tại → 404', maLa.status, 404, `HTTP ${maLa.status}`);

    // ── Xe lạ ───────────────────────────────────────────────────────────────────────────
    const la = await t.api('POST', '/api/maintenance/parking/stranger', T,
      { plate: P + '-LA 999.99', note: 'Xe máy đỏ đậu chắn lối ra' });
    t.eq('Ghi nhận xe lạ → 200', la.status, 200, `HTTP ${la.status} ${la.json && la.json.error || ''}`);
    const gtVN = await t.db.query('SELECT note, char_length(note) k, octet_length(note) b FROM parking_checks WHERE id=$1', [la.json.id]);
    t.ok('Ghi chú tiếng Việt CÓ DẤU lưu đúng UTF-8 (byte > ký tự)',
      gtVN.rows[0].b > gtVN.rows[0].k, `${gtVN.rows[0].k} ký tự · ${gtVN.rows[0].b} byte`);
    const trong = await t.api('POST', '/api/maintenance/parking/stranger', T, { plate: '   ' });
    t.eq('Xe lạ không có biển → 400', trong.status, 400, `HTTP ${trong.status}`);

    // Biển ĐÃ đăng ký nhưng gõ khác định dạng: phải nhận ra và chỉ đường, không tạo bản ghi rác.
    const nham = await t.api('POST', '/api/maintenance/parking/stranger', T, { plate: `  ${P.toLowerCase()}b450858 ` });
    t.eq('Gõ xe ĐÃ đăng ký vào ô xe lạ → 409, không tạo bản ghi rác', nham.status, 409, `HTTP ${nham.status}`);
    t.eq('409 chỉ đúng xe để điểm danh cho phải chỗ', nham.json && nham.json.registered && nham.json.registered.vehicle_id, vid);

    // ── Chốt lượt: xe chưa đánh dấu thành VẮNG ──────────────────────────────────────────
    const xe2 = await t.api('POST', '/api/vehicles', T, { student_id: sid, plate: P + '-B5 111.11' });
    t.eq('Dựng xe thứ hai', xe2.status, 201, `HTTP ${xe2.status}`);
    const chot = await t.api('POST', `/api/maintenance/parking/finish?facility=${fac}`, T, {});
    t.eq('Chốt lượt kiểm → 200', chot.status, 200, `HTTP ${chot.status}`);
    t.eq('Chốt lượt ghi VẮNG đúng 1 xe chưa đánh, KHÔNG quét sang cơ sở khác', chot.json.da_ghi_vang, 1,
      `ghi ${chot.json.da_ghi_vang} xe — cơ sở này chỉ có 1 xe chưa đánh dấu`);
    const chot2 = await t.api('POST', `/api/maintenance/parking/finish?facility=${fac}`, T, {});
    t.eq('Chốt lần hai KHÔNG ghi đè xe đã đánh tay', chot2.json.da_ghi_vang, 0);
    const sauChot = await t.db.query('SELECT status FROM parking_checks WHERE vehicle_id=$1 AND check_date=$2', [vid, homNay]);
    t.eq('Xe đã đánh tay giữ nguyên trạng thái của mình', sauChot.rows[0].status, 'absent');

    // ── KHÔNG ĐỤNG TIỀN: bảng vehicles y nguyên sau mọi thao tác điểm danh ──────────────
    const xeSau = await t.db.query('SELECT from_date, to_date, deleted_at FROM vehicles WHERE id=$1', [vid]);
    t.eq('Điểm danh KHÔNG đặt ngày ngừng cho xe', xeSau.rows[0].to_date, null);
    t.eq('Điểm danh KHÔNG xoá mềm xe', xeSau.rows[0].deleted_at, null);
    const ky = homNay.slice(0, 7);
    const soXe = await t.db.query(
      `SELECT count(*)::int c FROM vehicles v WHERE v.student_id=$1 AND v.deleted_at IS NULL
         AND COALESCE(v.from_date, v.created_at::date) <= ($2||'-01')::date + interval '1 month - 1 day'
         AND (v.to_date IS NULL OR v.to_date >= ($2||'-01')::date)`, [sid, ky]);
    t.eq('Phép đếm xe TÍNH TIỀN không đổi sau khi điểm danh (2 xe vẫn là 2)', soXe.rows[0].c, 2);

    // ── Báo cáo lịch sử ─────────────────────────────────────────────────────────────────
    await t.db.query(
      `INSERT INTO parking_checks (check_date, vehicle_id, plate, plate_norm, status, checked_by)
       SELECT d::date, $1, $2, 'X', 'absent', $3 FROM generate_series($4::date, $5::date, '1 day') d
       ON CONFLICT DO NOTHING`, [vid, P + '-B4 508.58', P + '_seed', lui(5), lui(1)]);
    const bc = await t.api('GET', `/api/maintenance/parking/report?from=${lui(6)}&to=${homNay}`, T);
    t.eq('Báo cáo → 200', bc.status, 200, `HTTP ${bc.status}`);
    t.eq('Báo cáo đủ 7 cột ngày', bc.json.days.length, 7);
    const dong = bc.json.rows.find(r => r.vehicle_id === vid);
    t.ok('Báo cáo có dòng của xe', !!dong);
    t.eq('Đếm đúng số ngày không gửi', dong && dong.vang, 6);
    t.eq('Chuỗi vắng liên tiếp tính lùi từ cuối khoảng', dong && dong.vang_lien_tiep, 6);
    t.ok('Báo cáo liệt kê xe lạ trong khoảng', bc.json.strangers.some(s => String(s.plate).includes('LA 999.99')));
    t.ok('Ngưỡng cảnh báo đọc từ Cài đặt, không viết cứng', bc.json.alert_days > 0, `alert_days=${bc.json.alert_days}`);
    const qua = await t.api('GET', '/api/maintenance/parking/report?from=2020-01-01&to=2030-01-01', T);
    t.eq('Khoảng quá dài → 400, không kéo về cả nghìn ngày', qua.status, 400, `HTTP ${qua.status}`);

    // ── Xoá xe là XOÁ CỨNG: lịch sử điểm danh phải SỐNG SÓT, không kéo sập DELETE ───────
    const xoa = await t.api('DELETE', `/api/vehicles/${xe2.json.id}`, T);
    t.eq('Xoá xe vẫn được dù đã có bản ghi điểm danh', xoa.status, 200, `HTTP ${xoa.status}`);
    const conLai = await t.db.query(
      `SELECT vehicle_id, plate FROM parking_checks WHERE plate=$1`, [P + '-B5 111.11']);
    t.eq('Lịch sử điểm danh của xe đã xoá KHÔNG bốc hơi', conLai.rows.length, 1);
    t.eq('Bản ghi cũ nhả tham chiếu về NULL (không treo khoá ngoại)', conLai.rows[0].vehicle_id, null);
    const bc2 = await t.api('GET', `/api/maintenance/parking/report?from=${lui(6)}&to=${homNay}`, T);
    t.ok('Báo cáo vẫn hiện xe đã gỡ, có nhãn riêng',
      bc2.json.rows.some(r => r.da_go === true && String(r.plate).includes('111.11')));

    // ── Bỏ đánh dấu ─────────────────────────────────────────────────────────────────────
    const bo = await t.api('DELETE', `/api/maintenance/parking/${m1.json.id}`, T);
    t.eq('Bỏ một lần đánh dấu → 200', bo.status, 200, `HTTP ${bo.status}`);
    const bo2 = await t.api('DELETE', `/api/maintenance/parking/${m1.json.id}`, T);
    t.eq('Bỏ lần hai trên bản ghi đã mất → 404, không báo thành công giả', bo2.status, 404, `HTTP ${bo2.status}`);

    // ── Phân quyền: an ninh vào được điểm danh nhưng KHÔNG thấy hồ sơ/tiền ─────────────
    const taoTk = await t.api('POST', '/api/admin/users', T,
      { username: P + '_anninh', password: 'anninh123456', role: 'maintenance', full_name: 'Bao ve thu' });
    t.eq('Dựng tài khoản an ninh', taoTk.status, 201, `HTTP ${taoTk.status} ${taoTk.json && taoTk.json.error || ''}`);
    await t.db.query('UPDATE users SET must_change_password=false WHERE username=$1', [P + '_anninh']);
    const A = await t.login(P + '_anninh', 'anninh123456');
    const q = async (m, p) => (await t.api(m, p, A)).status;
    t.eq('An ninh XEM được danh sách điểm danh', await q('GET', '/api/maintenance/parking'), 200);
    t.eq('An ninh XEM được báo cáo', await q('GET', '/api/maintenance/parking/report'), 200);
    t.eq('An ninh KHÔNG xem được danh sách xe của quản lý', await q('GET', '/api/vehicles'), 403);
    t.eq('An ninh KHÔNG xem được hồ sơ học viên', await q('GET', '/api/students'), 403);
    t.eq('An ninh KHÔNG xem được hoá đơn', await q('GET', '/api/invoices'), 403);

    const an = await t.api('GET', '/api/maintenance/parking', null);
    t.eq('Chưa đăng nhập → 401', an.status, 401, `HTTP ${an.status}`);
  },
};
