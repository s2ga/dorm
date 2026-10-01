// Đơn vị tiền theo chuẩn: số tiền đứng riêng kèm "đ" (money), ô tiền trong bảng không kèm (moneyN) vì đơn vị đã ghi
// ở tiêu đề cột. Hai hàm phải KHÁC nhau — gộp lại làm một (như bản 15/07) là mất đơn vị ở mọi chỗ đứng riêng.
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'Đơn vị tiền — money kèm "đ", moneyN không kèm',

  run(t) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'ui.js'), 'utf8');
    const dong = ['moneyN', 'money'].map(ten => (src.match(new RegExp(`^const ${ten} = .*$`, 'm')) || [])[0]);
    t.ok('Tìm thấy khai báo money và moneyN trong ui.js', dong.every(Boolean), JSON.stringify(dong));
    if (!dong.every(Boolean)) return;
    const { money, moneyN } = new Function(`${dong.join('\n')}\nreturn { money, moneyN };`)();
    t.eq('money(1500000) = "1.500.000 đ" (khoảng trắng không ngắt dòng)', money(1500000), '1.500.000 đ');
    t.eq('moneyN(1500000) = "1.500.000" (không đơn vị)', moneyN(1500000), '1.500.000');
    t.eq('money(null) = "0 đ"', money(null), '0 đ');
    t.eq('money nhận chuỗi số từ máy chủ', money('120000'), '120.000 đ');
    t.ok('money và moneyN là hai hàm khác nhau', money !== moneyN && money(1) !== moneyN(1));
  },
};
