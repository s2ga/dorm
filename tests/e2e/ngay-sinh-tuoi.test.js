// BL-128: chỉ nhận học viên 17–39 tuổi. Bắt buộc ở HAI cửa — đăng ký công khai và NHẬN PHÒNG;
// đơn cũ thiếu ngày sinh vẫn duyệt được; hồ sơ cũ sai tuổi chỉ bị liệt kê, không chặn cứng;
// phòng an ninh và phòng nhân viên được miễn.
const P = '__test_tuoi';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const clean = async db => {
  await db.query(`DELETE FROM applications WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
};

// Ngày sinh ứng với đúng N tuổi hôm nay (và lệch đi một ngày để thử biên).
const ngaySinhTuoi = (n, lech = 0) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  d.setDate(d.getDate() + lech);
  return d.toISOString().slice(0, 10);
};

module.exports = {
  name: 'Ngày sinh bắt buộc và khoảng tuổi nhận học viên (BL-128)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const q = (sql, p) => t.db.query(sql, p);
    const fac = (await q('SELECT id FROM facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1')).rows[0];
    const demKiemDuLieu = async () => {
      const dh = await t.api('GET', '/api/admin/data-health', T);
      return ((dh.json && dh.json.checks) || []).find(c => c.ma === 'ngay_sinh_ngoai_tuoi') || {};
    };
    const mucTruoc = await demKiemDuLieu();
    try {
      const phong = async (ten, loai) => (await q(
        `INSERT INTO rooms (name, gender, capacity, room_type, facility_id) VALUES ($1,'male',4,$2,$3) RETURNING id`,
        [P + ten, loai, fac && fac.id])).rows[0].id;
      const pO = await phong('_o', 'shared');
      const pAnNinh = await phong('_anninh', 'security');

      // ── Cửa 1: trang đăng ký công khai ────────────────────────────────────────────────
      const don = (them = {}) => ({
        name: P + ' An', phone: '0900333444', gender: 'male', facility_id: fac && fac.id,
        desired_check_in: '2026-12-01', rental_type: 'ghep', cccd_front: PNG, cccd_back: PNG, ...them,
      });
      const thieu = await t.api('POST', '/api/public/apply', null, don());
      t.eq('Đăng ký công khai thiếu ngày sinh → 400', thieu.status, 400, `HTTP ${thieu.status} ${thieu.json && thieu.json.error || ''}`);
      const nhi = await t.api('POST', '/api/public/apply', null, don({ birth_date: ngaySinhTuoi(16) }));
      t.eq('16 tuổi → 400', nhi.status, 400, `HTTP ${nhi.status}`);
      t.ok('Lời báo nói rõ khoảng tuổi nhận', /17|39/.test(nhi.json && nhi.json.error || ''), nhi.json && nhi.json.error);
      const gia = await t.api('POST', '/api/public/apply', null, don({ birth_date: ngaySinhTuoi(40) }));
      t.eq('Tròn 40 tuổi → 400', gia.status, 400, `HTTP ${gia.status}`);
      const dung = await t.api('POST', '/api/public/apply', null, don({ birth_date: ngaySinhTuoi(17) }));
      if (dung.status === 501) { t.ok('S3 chưa cấu hình — bỏ qua phần còn lại của cửa công khai', true, '501'); }
      else t.eq('Đúng 17 tuổi → 201', dung.status, 201, `HTTP ${dung.status} ${dung.json && dung.json.error || ''}`);
      const info = (await t.api('GET', '/api/public/info')).json;
      t.eq('Trang công khai biết ngưỡng tuổi tối thiểu', info.age_min, 17, String(info.age_min));
      t.eq('Trang công khai biết ngưỡng tuổi tối đa', info.age_max, 39, String(info.age_max));

      // ── Cửa 2: nhận phòng ─────────────────────────────────────────────────────────────
      const hv = async (ten, ngaySinh, room) => (await q(
        `INSERT INTO students (name, gender, birth_date, room_id, planned_check_in, cccd_front, cccd_back, facility_id)
         VALUES ($1,'male',$2,$3,CURRENT_DATE,'students/x/f.png','students/x/b.png',$4) RETURNING id`,
        [P + ten, ngaySinh, room, fac && fac.id])).rows[0].id;
      const thieuNS = await hv('_thieu', null, pO);
      const r1 = await t.api('POST', `/api/students/${thieuNS}/checkin`, T, {});
      t.eq('Nhận phòng khi hồ sơ CHƯA có ngày sinh → 400', r1.status, 400, `HTTP ${r1.status} ${r1.json && r1.json.error || ''}`);
      t.ok('Lời báo chỉ đường bổ sung ngày sinh', /ngày sinh/i.test(r1.json && r1.json.error || ''), r1.json && r1.json.error);

      const saiTuoi = await hv('_nhi', ngaySinhTuoi(15), pO);
      const r2 = await t.api('POST', `/api/students/${saiTuoi}/checkin`, T, {});
      t.eq('Nhận phòng khi tuổi ngoài khoảng → 400', r2.status, 400, `HTTP ${r2.status}`);

      const dungTuoi = await hv('_dung', ngaySinhTuoi(25), pO);
      const r3 = await t.api('POST', `/api/students/${dungTuoi}/checkin`, T, {});
      t.eq('Nhận phòng khi đủ tuổi → 200', r3.status, 200, `HTTP ${r3.status} ${r3.json && r3.json.error || ''}`);

      const anNinh = await hv('_bao_ve', null, pAnNinh);
      const r4 = await t.api('POST', `/api/students/${anNinh}/checkin`, T, {});
      t.eq('Phòng an ninh được miễn luật tuổi → 200', r4.status, 200, `HTTP ${r4.status} ${r4.json && r4.json.error || ''}`);

      // 4 hồ sơ vừa dựng: thiếu ngày sinh + sai tuổi bị đếm; đủ tuổi và phòng an ninh thì không.
      const mucSau = await demKiemDuLieu();
      t.ok('Kiểm dữ liệu có mục "thiếu ngày sinh hoặc ngoài khoảng tuổi"', !!mucSau.ma, JSON.stringify(Object.keys(mucSau)));
      t.eq('Đếm thêm đúng 2 hồ sơ (thiếu ngày sinh + sai tuổi), bỏ qua phòng an ninh và hồ sơ đủ tuổi',
        (mucSau.so_luong || 0) - (mucTruoc.so_luong || 0), 2,
        `${mucTruoc.so_luong} → ${mucSau.so_luong}`);

      // ── Hồ sơ cũ sai tuổi: sửa thứ khác vẫn được, nhưng không xoá trắng, không đổi sang tuổi sai ──
      const suaKhac = await t.api('PUT', `/api/students/${saiTuoi}`, T, { class_name: 'Lop K30' });
      t.eq('Hồ sơ cũ sai tuổi vẫn sửa được thông tin khác → 200', suaKhac.status, 200, `HTTP ${suaKhac.status} ${suaKhac.json && suaKhac.json.error || ''}`);
      const xoaTrang = await t.api('PUT', `/api/students/${saiTuoi}`, T, { birth_date: null });
      t.eq('Không được xoá trắng ngày sinh → 400', xoaTrang.status, 400, `HTTP ${xoaTrang.status}`);
      const doiSai = await t.api('PUT', `/api/students/${dungTuoi}`, T, { birth_date: ngaySinhTuoi(41) });
      t.eq('Đổi ngày sinh sang tuổi ngoài khoảng → 400', doiSai.status, 400, `HTTP ${doiSai.status}`);
      const doiDung = await t.api('PUT', `/api/students/${saiTuoi}`, T, { birth_date: ngaySinhTuoi(20) });
      t.eq('Sửa ngày sinh về đúng khoảng → 200', doiDung.status, 200, `HTTP ${doiDung.status} ${doiDung.json && doiDung.json.error || ''}`);

      // Sửa ngày sinh về đúng khoảng thì hồ sơ đó rời khỏi danh sách Kiểm dữ liệu.
      const mucCuoi = await demKiemDuLieu();
      t.eq('Sửa xong một hồ sơ thì danh sách giảm 1', (mucSau.so_luong || 0) - (mucCuoi.so_luong || 0), 1,
        `${mucSau.so_luong} → ${mucCuoi.so_luong}`);

      // ── Đơn cũ thiếu ngày sinh vẫn duyệt được (owner chốt 19/09) ──────────────────────
      const donCu = (await q(
        `INSERT INTO applications (name, phone, gender, status, facility_id) VALUES ($1,'0900555666','male','pending',$2) RETURNING id`,
        [P + ' Cu', fac && fac.id])).rows[0].id;
      const duyet = await t.api('POST', `/api/applications/${donCu}/approve`, T, {});
      t.eq('Đơn cũ không có ngày sinh vẫn duyệt được → 200', duyet.status, 200, `HTTP ${duyet.status} ${duyet.json && duyet.json.error || ''}`);
      const mucSauDuyet = await demKiemDuLieu();
      t.eq('Hồ sơ vừa duyệt (thiếu ngày sinh) vào danh sách Kiểm dữ liệu để nhân viên bổ sung',
        (mucSauDuyet.so_luong || 0) - (mucCuoi.so_luong || 0), 1, `${mucCuoi.so_luong} → ${mucSauDuyet.so_luong}`);
    } finally {
      await clean(t.db);
    }
  },
};
