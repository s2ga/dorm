// BL-79: khoá tài khoản là lớp BẢO VỆ (owner chốt 16/07 là một trong ba lớp bảo mật đăng nhập),
// nhưng trạng thái nằm trong map RAM nên bay hơi mỗi lần Render ngủ dậy / deploy / thêm instance.
// Kẻ dò chỉ cần chờ app restart là bộ đếm về 0.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_bl79';
const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM login_guard WHERE username LIKE '${P}%'`);
};

module.exports = {
  name: 'BL-79 · khoá tài khoản sống sót qua restart (nằm ở CSDL, không phải RAM)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    // Tên duy nhất mỗi lần chạy: net phụ AuthLimiter đếm theo IP|username trong RAM 15 phút, chạy
    // bộ test hai lần liền nhau mà dùng tên cũ thì nó bắn trước, che mất lớp khoá đang cần kiểm.
    const ten = P + '_nv' + Date.now();
    await t.db.query(
      `INSERT INTO users (username,password_hash,role,full_name) VALUES ($1,$2,'staff','NV bị dò')`,
      [ten, bcrypt.hashSync(pw, 10)]);
    try {
      let cuoi = null;
      for (let i = 0; i < 10; i++) {
        cuoi = await t.api('POST', '/api/auth/login', null, { username: ten, password: 'sai-be-bet' });
      }
      t.ok('TC-79a · sai 10 lần → KHOÁ TÀI KHOẢN (đúng lớp khoá, không phải net phụ theo IP)',
        cuoi.status === 429 && /tạm khoá/i.test((cuoi.json && cuoi.json.error) || ''),
        `HTTP ${cuoi.status} — ${cuoi.json && cuoi.json.error}`);

      const row = (await t.db.query(
        'SELECT locked_until_ms FROM login_guard WHERE username=$1', [ten])).rows[0];
      t.ok('TC-79b · trạng thái khoá GHI XUỐNG CSDL (RAM thì restart là mất)',
        !!row && +row.locked_until_ms > Date.now(), JSON.stringify(row));

      const dung = await t.api('POST', '/api/auth/login', null, { username: ten, password: pw });
      t.ok('TC-79c · đang khoá thì mật khẩu ĐÚNG cũng không vào được',
        dung.status === 429 && /tạm khoá/i.test((dung.json && dung.json.error) || ''),
        `HTTP ${dung.status} — ${dung.json && dung.json.error}`);

      // Mô phỏng "tiến trình vừa khởi động lại": xoá hết dấu vết trong tiến trình là không làm được
      // từ ngoài, nên kiểm chiều ngược — đặt mốc khoá THẲNG vào CSDL cho một tài khoản mà tiến trình
      // đang chạy chưa từng thấy. Đọc được nghĩa là nguồn sự thật nằm ở CSDL, không ở RAM.
      const ten2 = P + '_moi' + Date.now();
      await t.db.query(
        `INSERT INTO users (username,password_hash,role,full_name) VALUES ($1,$2,'staff','NV mới')`,
        [ten2, bcrypt.hashSync(pw, 10)]);
      await t.db.query(
        `INSERT INTO login_guard (username, fails_ms, locked_until_ms) VALUES ($1,'{}',$2)`,
        [ten2, Date.now() + 10 * 60 * 1000]);
      const moi = await t.api('POST', '/api/auth/login', null, { username: ten2, password: pw });
      t.eq('TC-79d · mốc khoá do NGƯỜI KHÁC ghi vào CSDL vẫn có hiệu lực (nhiều instance dùng chung)',
        moi.status, 429, `HTTP ${moi.status} — ${moi.json && moi.json.error}`);

      // Hết hạn khoá thì phải vào lại được, không kẹt vĩnh viễn.
      await t.db.query('UPDATE login_guard SET locked_until_ms=$2 WHERE username=$1', [ten2, Date.now() - 1000]);
      const het = await t.api('POST', '/api/auth/login', null, { username: ten2, password: pw });
      t.eq('TC-79e · hết thời gian khoá → đăng nhập lại được', het.status, 200,
        `HTTP ${het.status} — ${het.json && het.json.error}`);
      const con = (await t.db.query('SELECT 1 FROM login_guard WHERE username=$1', [ten2])).rowCount;
      t.eq('TC-79f · đăng nhập thành công thì dọn luôn hàng đếm', con, 0, `còn ${con} hàng`);
    } finally {
      await clean(t.db);
    }
  },
};
