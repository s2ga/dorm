// BL-81: hồ sơ duyệt từ đơn đăng ký công khai chưa có mã HV (người ngoài chưa vào học). Hai đường
// tạo tài khoản dùng hai quy tắc suy ra tên đăng nhập khác nhau — đường duyệt đơn lùi về SĐT, đường
// "mở hồ sơ → Tạo tài khoản" (đường nhân viên hay dùng nhất) thì không, nên báo "Cần tên đăng nhập".
const P = '__test_bl81';
const clean = async db => {
  await db.query(`DELETE FROM users WHERE student_id IN (SELECT id FROM students WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'BL-81 · tạo tài khoản cho hồ sơ chưa có mã học viên',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const T = await t.login('admin', process.env.ADMIN_P);
    try {
      // Hồ sơ KHÔNG mã HV nhưng CÓ số điện thoại — đúng hình dạng 14/208 hồ sơ đang dính.
      const sid = (await t.db.query(
        `INSERT INTO students (name, code, phone, check_in_date) VALUES ($1,'','0900000081',CURRENT_DATE) RETURNING id`,
        [P + '_khongma'])).rows[0].id;

      const r = await t.api('POST', `/api/students/${sid}/account`, T, { password: 'test1234' });
      t.eq('TC-81a · không mã HV nhưng có SĐT → tạo được (lùi về SĐT như đường duyệt đơn)',
        r.status, 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
      const u = (await t.db.query('SELECT username FROM users WHERE student_id=$1', [sid])).rows[0];
      t.eq('TC-81b · tên đăng nhập lấy đúng số điện thoại', u && u.username, '0900000081',
        JSON.stringify(u));
      const vao = await t.api('POST', '/api/auth/login', null, { username: '0900000081', password: 'test1234' });
      t.eq('TC-81c · đăng nhập được bằng tên đó', vao.status, 200, `HTTP ${vao.status}`);

      // Không mã, không SĐT: vẫn phải chặn — nhưng câu báo nói rõ vì sao và phải làm gì.
      const sid2 = (await t.db.query(
        `INSERT INTO students (name, code, phone, check_in_date) VALUES ($1,'','',CURRENT_DATE) RETURNING id`,
        [P + '_trong'])).rows[0].id;
      const r2 = await t.api('POST', `/api/students/${sid2}/account`, T, { password: 'test1234' });
      t.eq('TC-81d · không mã, không SĐT → vẫn chặn (400)', r2.status, 400, `HTTP ${r2.status}`);
      const msg = (r2.json && r2.json.error) || '';
      t.ok('TC-81e · … câu báo nói rõ THIẾU GÌ và phải làm gì, không cụt lủn "Cần tên đăng nhập"',
        /mã học viên/i.test(msg) && /điện thoại/i.test(msg) && /nhập tên đăng nhập/i.test(msg), msg);

      // Tên tự đặt vẫn ưu tiên hơn mọi giá trị suy ra.
      const r3 = await t.api('POST', `/api/students/${sid2}/account`, T,
        { password: 'test1234', username: P + '_tay' });
      t.eq('TC-81f · tự nhập tên đăng nhập → tạo được', r3.status, 200,
        `HTTP ${r3.status} ${JSON.stringify(r3.json)}`);
    } finally {
      await clean(t.db);
    }
  },
};
