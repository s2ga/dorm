// Câu lỗi máy chủ trả về giao diện: không lộ định dạng máy (YYYY-MM…), id=, lỗi thô e.Error(), mã nội bộ; không
// VIẾT HOA để nhấn. Chỉ soi các dòng trả lỗi (badRequest/notFound/forbidden/conflict/"error":) trong mã Go.
const fs = require('fs');
const path = require('path');

const GOC = path.join(__dirname, '..', '..', 'internal');
const IN_HOA = ['KHÔNG', 'CHƯA', 'ĐÃ', 'ĐANG', 'KHOÁ', 'KHÁC', 'GIỮ', 'LẠ', 'NHỎ', 'LỚN', 'HƠN', 'ĐỔI', 'CHỈ', 'MỌI', 'SAI', 'THẬT', 'DUYỆT', 'PHIẾU'];
const CAM = [
  { ten: 'Không lộ định dạng máy / id thô', re: /YYYY|\(id=|"id không hợp lệ"|phòng #"/ },
  { ten: 'Không trả lỗi thô e.Error() cho người dùng (ghi log bằng loiCoGhiLog/serverErr)', re: /\.Error\(\)/ },
  { ten: 'Không dùng "thao tác khác", "chữ ký file", "Khóa ảnh/tài liệu"', re: /thao tác khác|chữ ký file|Khóa (ảnh|tài liệu)/ },
  { ten: 'Không VIẾT HOA để nhấn trong câu lỗi', re: new RegExp(`(?<![\\p{L}\\p{N}_])(${IN_HOA.join('|')})(?![\\p{L}\\p{N}_])`, 'u') },
];
const DONG_LOI = /(badRequest|notFound|forbidden|conflict)\(c,|"error":|applicationsErr\{/;

const tepGo = thu => fs.readdirSync(thu, { withFileTypes: true }).flatMap(e => {
  const p = path.join(thu, e.name);
  if (e.isDirectory()) return tepGo(p);
  return e.name.endsWith('.go') && !e.name.endsWith('_test.go') ? [p] : [];
});

module.exports = {
  name: 'Câu lỗi máy chủ — tiếng Việt, không lộ chi tiết kỹ thuật',

  run(t) {
    const dong = tepGo(GOC).flatMap(p => fs.readFileSync(p, 'utf8').split('\n')
      .map((d, i) => ({ tep: path.relative(GOC, p).replace(/\\/g, '/'), so: i + 1, d }))
      .filter(x => DONG_LOI.test(x.d) && !/^\s*\/\//.test(x.d)));
    t.ok('Tìm thấy các dòng trả lỗi trong mã Go', dong.length > 200, `${dong.length} dòng`);
    for (const luat of CAM) {
      const gap = dong.filter(x => luat.re.test(x.d.replace(/\s\/\/\s.*$/, '')))
        .map(x => `${x.tep}:${x.so} …${x.d.trim().slice(0, 70)}`);
      t.eq(luat.ten, gap.length, 0, gap.slice(0, 8).join(' | '));
    }
  },
};
