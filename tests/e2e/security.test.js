// Thu hồi quyền + chặn thao tác phá sổ. Đây là nhóm lỗi NGUY HIỂM NHẤT của vòng test 15/07/2026:
// người bị giáng chức / đuổi việc / đã đăng xuất vẫn giữ nguyên quyền trong 30 ngày.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_sec';

const clean = db => db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);

module.exports = {
  name: 'Bảo mật — thu hồi quyền & chặn thao tác phá sổ',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);

    try {
      // ===== TC-01: 1 request là xoá sạch sổ công nợ
      const r1 = await t.api('POST', '/api/invoices/mark-paid', T, {});
      t.ok('TC-01 · gửi rỗng {} → phải CHẶN (trước đây: MỌI phiếu MỌI kỳ thành "đã thu")',
        r1.status === 400, `HTTP ${r1.status} — ${(r1.json && r1.json.error || '').slice(0, 90)}`);

      const r1b = await t.api('POST', '/api/invoices/mark-paid', T, { month: '2026-07' });
      t.ok('TC-01 · có kỳ nhưng chưa xác nhận → phải CHẶN và nói rõ sẽ ảnh hưởng bao nhiêu phiếu',
        r1b.status === 400 && /\d+ phiếu/.test(r1b.json && r1b.json.error || ''),
        `HTTP ${r1b.status} — ${(r1b.json && r1b.json.error || '').slice(0, 90)}`);

      await t.db.query(`INSERT INTO users (username,password_hash,role) VALUES ('${P}_staff',$1,'staff')`, [bcrypt.hashSync('test1234', 10)]);
      const staff = await t.login(P + '_staff', 'test1234');
      const r1c = await t.api('POST', '/api/invoices/mark-paid', staff, { month: '2026-07', confirm: true });
      t.ok('TC-01 · NHÂN VIÊN đánh dấu đã thu cả kỳ → phải 403 (chỉ quản trị)',
        r1c.status === 403, `HTTP ${r1c.status} — ${r1c.json && r1c.json.error}`);

      // Tài khoản mới tạo bị bắt ĐỔI MẬT KHẨU lần đầu (xem TC-13) -> mọi API khác trả 403.
      // Các case dưới đây đo việc THU HỒI QUYỀN, nên phải tắt cờ đó đi mới cô lập được đúng thứ cần đo.
      const mkUser = async (suffix, role) => {
        await t.api('POST', '/api/admin/users', T, { username: P + suffix, password: 'test1234', role, full_name: 'Test' + suffix });
        await t.db.query(`UPDATE users SET must_change_password=false WHERE username=$1`, [P + suffix]);
        return t.login(P + suffix, 'test1234');
      };

      // ===== TC-14: bị GIÁNG CHỨC nhưng vé cũ vẫn còn
      const b1 = await mkUser('_b', 'admin');
      const before = await t.api('PUT', '/api/settings', b1, { dorm_name: 'TEST' });
      t.eq('TC-14 · trước khi giáng chức, tài khoản admin sửa được Cài đặt', before.status, 200, `HTTP ${before.status}`);
      const bid = (await t.db.query(`SELECT id FROM users WHERE username=$1`, [P + '_b'])).rows[0].id;
      await t.api('PUT', `/api/admin/users/${bid}`, T, { role: 'staff', full_name: 'Test B' });
      const after = await t.api('PUT', '/api/settings', b1, { dorm_name: 'TEST2' });
      t.ok('TC-14 · SAU khi giáng xuống nhân viên, vé CŨ phải mất hiệu lực NGAY (trước đây: còn quyền 30 ngày)',
        after.status === 401, `HTTP ${after.status} — ${after.json && after.json.error}`);

      // ===== TC-15: tài khoản bị XOÁ
      const c1 = await mkUser('_c', 'admin');
      const cid = (await t.db.query(`SELECT id FROM users WHERE username=$1`, [P + '_c'])).rows[0].id;
      await t.api('DELETE', `/api/admin/users/${cid}`, T);
      const cAfter = await t.api('GET', '/api/students', c1);
      t.ok('TC-15 · tài khoản ĐÃ XOÁ vẫn đọc được danh sách học viên? → phải 401',
        cAfter.status === 401, `HTTP ${cAfter.status} — ${cAfter.json && cAfter.json.error}`);

      // ===== TC-15b: ĐĂNG XUẤT (BL-80) — thoát thường chỉ kết thúc phiên của THIẾT BỊ NÀY: xoá
      // cookie httpOnly, KHÔNG tăng token_epoch. Đánh đổi có chủ ý: đổi lại việc bấm Thoát trên
      // điện thoại không đá luôn máy văn phòng. Muốn giết sạch thì có nút riêng, kiểm ở TC-15c.
      const d1 = await mkUser('_d', 'admin');
      await t.api('POST', '/api/auth/logout', d1);
      const dAfter = await t.api('GET', '/api/students', d1);
      t.ok('TC-15b · thoát thường KHÔNG thu hồi vé cấp tài khoản (thiết bị khác vẫn đăng nhập)',
        dAfter.status === 200, `HTTP ${dAfter.status} — ${dAfter.json && dAfter.json.error}`);
      await t.api('POST', '/api/auth/logout', d1, { all: true });
      const dAll = await t.api('GET', '/api/students', d1);
      t.ok('TC-15c · "Thoát khỏi mọi thiết bị" thu hồi THẬT → 401',
        dAll.status === 401, `HTTP ${dAll.status} — ${dAll.json && dAll.json.error}`);

      // ===== TC-13: bắt đổi mật khẩu nhưng vẫn xem được mọi thứ
      await t.api('POST', '/api/admin/users', T, { username: P + '_e', password: 'test1234', role: 'admin', full_name: 'Test E' });
      await t.db.query(`UPDATE users SET must_change_password=true WHERE username=$1`, [P + '_e']);
      const e1 = await t.login(P + '_e', 'test1234');
      const eList = await t.api('GET', '/api/admin/users', e1);
      t.ok('TC-13 · đang bị bắt đổi mật khẩu mà vẫn đọc được danh sách tài khoản? → phải 403',
        eList.status === 403, `HTTP ${eList.status} — ${eList.json && eList.json.error}`);
      const eMe = await t.api('GET', '/api/auth/me', e1);
      t.eq('TC-13 · nhưng PHẢI cho vào để đổi mật khẩu, không thì kẹt cứng', eMe.status, 200, `HTTP ${eMe.status}`);

      // ===== N-05: chống dò mật khẩu phải đếm lần SAI, không phải lần ĐÚNG.
      // Đếm cả lần đúng = người dùng thật đăng nhập vài thiết bị là bị khoá 15 phút,
      // mà app lại báo "đăng nhập sai quá nhiều lần" — họ không hiểu tại sao.
      let lastOk = 0;
      for (let i = 0; i < 25; i++) {
        const r = await fetch(require('../lib/harness').BASE + '/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: P + '_staff', password: 'test1234' }),
        });
        lastOk = r.status;
        if (r.status === 429) break;
      }
      t.ok('N-05 · đăng nhập ĐÚNG 25 lần liên tiếp → KHÔNG được khoá (chỉ lần SAI mới bị đếm)',
        lastOk === 200, `lần cuối HTTP ${lastOk}`);

      // Nửa còn lại CỐ TÌNH làm khoá IP 15 phút -> chạy xong là cả bộ test không đăng nhập lại được.
      // Vì vậy phải bật riêng:  TEST_BRUTE=1 npm test   (chỉ chạy khi cần kiểm chống dò mật khẩu)
      if (process.env.TEST_BRUTE === '1') {
        let blocked = 0;
        for (let i = 0; i < 25; i++) {
          const r = await fetch(require('../lib/harness').BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: P + '_staff', password: 'sai_be_bet' }),
          });
          if (r.status === 429) { blocked = i + 1; break; }
        }
        t.ok('N-05 · đăng nhập SAI liên tục → PHẢI bị khoá (chống dò mật khẩu vẫn còn tác dụng)',
          blocked > 0 && blocked <= 25, blocked ? `bị chặn từ lần thứ ${blocked}` : 'KHÔNG BAO GIỜ chặn — dò mật khẩu thoải mái');
        console.log('     \x1b[2m(IP này giờ bị khoá đăng nhập ~15 phút — khởi động lại máy chủ để xoá)\x1b[0m');
      }

      // ===== Không được làm hỏng đường bình thường
      for (const [p, want] of [['/api/students', 200], ['/api/rooms', 200], ['/api/reports/revenue', 200]]) {
        const r = await t.api('GET', p, T);
        t.eq(`Đường bình thường · quản trị GET ${p}`, r.status, want, `HTTP ${r.status}`);
      }
      const stuList = await t.api('GET', '/api/students', staff);
      t.eq('Đường bình thường · nhân viên vẫn xem được học viên', stuList.status, 200, `HTTP ${stuList.status}`);
    } finally {
      await clean(t.db);
    }
  },
};
