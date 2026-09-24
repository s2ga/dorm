// BL-137 (owner chốt 24/09): tên người chỉ một kiểu chữ — hoa chữ cái đầu mỗi từ, phần còn lại thường,
// bỏ khoảng trắng thừa. Máy chủ chuẩn lại khi lưu ở MỌI đường vào, kể cả đơn đăng ký công khai.
const P = '__test_tenchuan';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM applications WHERE lower(name) LIKE lower('${P}%')`);
  await db.query(`DELETE FROM students WHERE lower(name) LIKE lower('${P}%')`);
};

module.exports = {
  name: 'Tên người chuẩn hoá một kiểu (BL-137)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const tenTrongCSDL = async id => (await t.db.query('SELECT name FROM students WHERE id=$1', [id])).rows[0].name;
    try {
      // ── Tạo hồ sơ: gõ IN HOA → lưu hoa đầu từ ────────────────────────────────────────
      const tao = await t.api('POST', '/api/students', T, {
        name: P + ' NGUYỄN HOÀI THỦY TIÊN', gender: 'female', birth_date: '2004-05-06',
        check_in_date: '2026-07-01', rental_type: 'ghep',
      });
      t.eq('Tạo hồ sơ → 201', tao.status, 201, `HTTP ${tao.status} ${tao.json && tao.json.error || ''}`);
      t.eq('Tên IN HOA được chuẩn lại khi lưu', await tenTrongCSDL(tao.json.id), P + ' Nguyễn Hoài Thủy Tiên');
      t.eq('Hồ sơ trả về cũng là tên đã chuẩn', tao.json.name, P + ' Nguyễn Hoài Thủy Tiên');

      // ── Sửa hồ sơ: gõ thường + thừa khoảng trắng → cũng chuẩn ────────────────────────
      const sua = await t.api('PUT', `/api/students/${tao.json.id}`, T, { name: P + '   nguyễn   hữu   đạt ' });
      t.eq('Sửa hồ sơ → 200', sua.status, 200, `HTTP ${sua.status} ${sua.json && sua.json.error || ''}`);
      t.eq('Tên viết thường + thừa khoảng trắng được chuẩn lại', await tenTrongCSDL(tao.json.id), P + ' Nguyễn Hữu Đạt');

      // ── Tài khoản học viên bám theo tên hồ sơ ───────────────────────────────────────
      const acc = await t.api('POST', `/api/students/${tao.json.id}/account`, T, { username: P + '_u1' });
      if (acc.status === 200) {
        await t.api('PUT', `/api/students/${tao.json.id}`, T, { name: P + ' VÕ ĐÔNG TRIỀU' });
        const fn = (await t.db.query('SELECT full_name FROM users WHERE lower(username)=lower($1)', [P + '_u1'])).rows[0].full_name;
        t.eq('Tên trên tài khoản đăng nhập cũng theo chuẩn', fn, P + ' Võ Đông Triều');
      }

      // ── Đơn đăng ký công khai ───────────────────────────────────────────────────────
      const fac = (await t.db.query('SELECT id FROM facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1')).rows[0];
      const don = await t.api('POST', '/api/public/apply', null, {
        name: P + ' LÊ HUỲNH YẾN NHI', phone: '0900777888', gender: 'female', facility_id: fac && fac.id,
        birth_date: '2005-03-04', desired_check_in: '2026-12-01', rental_type: 'ghep', cccd_front: PNG, cccd_back: PNG,
      });
      if (don.status === 501) { t.ok('S3 chưa cấu hình — bỏ qua phần đơn công khai', true, '501'); return; }
      t.eq('Gửi đơn đăng ký → 201', don.status, 201, `HTTP ${don.status} ${don.json && don.json.error || ''}`);
      const tenDon = (await t.db.query(`SELECT name FROM applications WHERE phone='0900777888' ORDER BY id DESC LIMIT 1`)).rows[0].name;
      t.eq('Tên trên đơn đăng ký được chuẩn lại', tenDon, P + ' Lê Huỳnh Yến Nhi');

      // ── Đơn cũ còn tên IN HOA: duyệt xong hồ sơ phải là tên chuẩn ───────────────────
      const donCu = (await t.db.query(
        `INSERT INTO applications (name, phone, gender, birth_date, status, facility_id) VALUES ($1,'0900777999','male','2004-01-02','pending',$2) RETURNING id`,
        [P + ' TRẦN VĂN BỐN', fac && fac.id])).rows[0].id;
      const duyet = await t.api('POST', `/api/applications/${donCu}/approve`, T, {});
      t.eq('Duyệt đơn cũ → 200', duyet.status, 200, `HTTP ${duyet.status} ${duyet.json && duyet.json.error || ''}`);
      t.eq('Hồ sơ tạo từ đơn cũ mang tên đã chuẩn', duyet.json.student.name, P + ' Trần Văn Bốn');
    } finally {
      await clean(t.db);
    }
  },
};
