// Phiên bản asset phải khớp giữa index.html và sw.js — số sửa tay ở 2 file, lệch thì service worker
// tải sẵn nguyên bộ asset cũ mà không dùng tới, và app vẫn "chạy được" nên không ai thấy.
const fs = require('fs');
const path = require('path');

const doc = f => fs.readFileSync(path.join(__dirname, '../../public', f), 'utf8');

module.exports = {
  name: 'Phiên bản asset — index.html vs sw.js',
  needsServer: false,

  async run(t) {
    const html = doc('index.html');
    const sw = doc('sw.js');

    const vHtml = [...new Set((html.match(/\?v=(\d+)/g) || []).map(x => x.slice(3)))];
    t.eq('index.html chỉ dùng ĐÚNG MỘT số phiên bản', vHtml.length, 1, 'đang có: ' + vHtml.join(', '));

    const cache = (sw.match(/const CACHE = 'ktx-shell-v(\d+)'/) || [])[1];
    t.ok('sw.js có tên cache dạng ktx-shell-vNN', !!cache, 'CACHE = v' + cache);
    t.eq('Tên cache sw.js KHỚP phiên bản index.html', cache, vHtml[0],
      `sw.js cache = v${cache} · index.html = ?v=${vHtml[0]}`);

    // Danh sách tải sẵn KHÔNG được ghi cứng số phiên bản — phải suy ra từ tên cache.
    // Ghi cứng là sớm muộn cũng lệch: sửa index.html rồi quên sw.js.
    const shell = (sw.match(/const SHELL = \[[\s\S]*?\];/) || [''])[0];
    const soGhiCung = shell.match(/\?v=\d+/g) || [];
    t.eq('Danh sách tải sẵn KHÔNG ghi cứng số phiên bản (phải dùng ${V})', soGhiCung.length, 0,
      soGhiCung.length ? 'đang ghi cứng: ' + soGhiCung.join(', ') : 'không có số nào ghi cứng ✔');
    t.ok('Danh sách tải sẵn suy ra phiên bản từ tên cache', /\?v=\$\{V\}/.test(shell),
      /\?v=\$\{V\}/.test(shell) ? 'dùng ${V} ✔' : 'KHÔNG dùng ${V}');

    // Mọi asset index.html nạp thì sw.js phải tải sẵn — thiếu là offline gãy
    const assets = [...new Set((html.match(/\/(css|js)\/[\w.-]+\.(css|js)/g) || []))];
    const thieu = assets.filter(a => !sw.includes(a));
    t.eq('Mọi asset index.html nạp đều nằm trong danh sách tải sẵn của sw.js', thieu.length, 0,
      thieu.length ? 'sw.js thiếu: ' + thieu.join(', ') : `đủ ${assets.length} tệp ✔`);
  },
};
