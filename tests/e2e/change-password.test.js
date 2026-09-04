// Đổi mật khẩu: không hỏi mật khẩu cũ (đã xác thực bằng cookie), rule chỉ còn tối thiểu 6 ký tự.
// Tái hiện payload trong issue: "123456" -> "qwerty" phải 200. Hai chốt còn lại không được thủng:
// đổi xong thu hồi vé cũ, và không cho đặt lại y hệt mật khẩu hiện tại.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_cpw';

const clean = db => db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);

module.exports = {
  name: 'Đổi mật khẩu — bỏ mật khẩu cũ + rule tối thiểu 6 ký tự',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    try {
      // Tài khoản nhân viên do admin khởi tạo: mật khẩu khởi tạo "123456", BẮT BUỘC đổi lần đầu.
      const uid = (await t.db.query(
        `INSERT INTO users (username, password_hash, role, full_name, must_change_password, approved)
         VALUES ($1, $2, 'staff', 'NV Đổi MK', true, true) RETURNING id`,
        [P + '_nv', bcrypt.hashSync('123456', 10)])).rows[0].id;
      const epochTruoc = (await t.db.query('SELECT token_epoch FROM users WHERE id=$1', [uid])).rows[0].token_epoch;

      const token = await t.login(P + '_nv', '123456');

      // ===== TC-01: mật khẩu mới < 6 ký tự -> 400, KHÔNG cần mật khẩu cũ để bị chặn
      const r1 = await t.api('POST', '/api/auth/change-password', token, { newPassword: 'abc' });
      t.ok('TC-01 · mật khẩu mới "abc" (3 ký tự) -> phải 400 "tối thiểu 6 ký tự"',
        r1.status === 400 && /6 ký tự/.test(r1.json && r1.json.error || ''),
        `HTTP ${r1.status} — ${(r1.json && r1.json.error) || ''}`);

      // ===== TC-02: đặt LẠI y hệt mật khẩu hiện tại -> 400 (giữ ý nghĩa của lần đổi bắt buộc)
      const r2 = await t.api('POST', '/api/auth/change-password', token, { newPassword: '123456' });
      t.ok('TC-02 · đổi sang ĐÚNG mật khẩu khởi tạo "123456" -> phải 400 "phải khác"',
        r2.status === 400 && /phải khác/.test(r2.json && r2.json.error || ''),
        `HTTP ${r2.status} — ${(r2.json && r2.json.error) || ''}`);

      // Tới đây tài khoản vẫn phải còn bị bắt đổi (2 case trên đều thất bại, không được xoá cờ)
      const giua = (await t.db.query('SELECT must_change_password FROM users WHERE id=$1', [uid])).rows[0];
      t.eq('TC-02b · thất bại thì KHÔNG được xoá cờ bắt buộc đổi', giua.must_change_password, true,
        `must_change_password=${giua.must_change_password}`);

      // ===== TC-03: ĐÚNG payload trong issue — đổi "123456" -> "qwerty" KHÔNG gửi oldPassword -> 200
      const r3 = await t.api('POST', '/api/auth/change-password', token, { newPassword: 'qwerty' });
      t.eq('TC-03 · đổi sang "qwerty" (6 ký tự, không gửi mật khẩu cũ) -> phải 200', r3.status, 200,
        `HTTP ${r3.status} — ${(r3.json && r3.json.error) || ''}`);

      const sau = (await t.db.query('SELECT must_change_password, token_epoch FROM users WHERE id=$1', [uid])).rows[0];
      t.eq('TC-03b · đổi xong -> hết bị bắt đổi mật khẩu', sau.must_change_password, false,
        `must_change_password=${sau.must_change_password}`);
      t.ok('TC-03c · đổi xong -> THU HỒI vé cũ (token_epoch tăng), không thì kẻ xem trộm dùng tiếp',
        sau.token_epoch > epochTruoc, `token_epoch ${epochTruoc} -> ${sau.token_epoch}`);

      // ===== TC-04: vé CŨ phải chết ngay sau khi đổi
      const r4 = await t.api('GET', '/api/auth/me', token);
      t.eq('TC-04 · vé cũ (trước khi đổi) gọi /auth/me -> phải 401', r4.status, 401, `HTTP ${r4.status}`);

      // ===== TC-05: đăng nhập bằng mật khẩu MỚI -> vào được, cờ bắt buộc đã hết -> dùng API bình thường
      const token2 = await t.login(P + '_nv', 'qwerty');
      const r5 = await t.api('GET', '/api/students', token2);
      t.eq('TC-05 · đăng nhập lại bằng "qwerty" rồi -> nhân viên xem được danh sách học viên (đã thông luồng)',
        r5.status, 200, `HTTP ${r5.status} — ${(r5.json && r5.json.error) || ''}`);
    } finally {
      await clean(t.db);
    }
  },
};
