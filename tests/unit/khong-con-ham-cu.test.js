// Bốn hàm đếm giường cũ đã bị thay bằng chiSoPhong/tongChiSo (một nguồn số duy nhất).
// Ai mang chúng trở lại là mang lại 4 định nghĩa lệch nhau — bài này chặn từ cửa.
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'Không còn hàm đếm giường cũ (availBedsOf/rentCapOf/roomForRent/giuongTrongCua)',
  needsServer: false,

  async run(t) {
    const dir = path.join(__dirname, '..', '..', 'public', 'js');
    const cam = ['availBedsOf', 'rentCapOf', 'roomForRent', 'giuongTrongCua'];
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const ten of cam) {
        const n = (src.match(new RegExp('\\b' + ten + '\\b', 'g')) || []).length;
        t.ok(`${f}: không có ${ten}`, n === 0, n ? `xuất hiện ${n} lần` : 'sạch');
      }
    }
    const auth = fs.readFileSync(path.join(dir, 'app-public-auth.js'), 'utf8');
    for (const ten of ['chiSoPhong', 'tongChiSo', 'phongTinhGiuong', 'phongConCho', 'phongQuaTai']) {
      t.ok(`bộ hàm mới có ${ten}`, new RegExp('(function |const )' + ten + '\\b').test(auth), '');
    }
  },
};
