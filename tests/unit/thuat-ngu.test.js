// Thuật ngữ owner chốt 01/10/2026 — chữ HIỆN LÊN cho người dùng (giao diện + câu báo của máy chủ + email) không được
// dùng lại từ đã bỏ. Chỉ soi chuỗi hiển thị: chú thích trong mã, tên biến, tên API không tính.
const fs = require('fs');
const path = require('path');

const GOC = path.join(__dirname, '..', '..');
const CAM = [
  { ten: 'Chứng từ tiền hàng tháng gọi là "phiếu báo" — không dùng "hoá đơn"/"phiếu thu"', re: /h[oó][aá] đơn|phiếu thu/i },
  // ghiChuRaVao và PATH_VIEWS['/check-in'] cố ý chứa chữ cũ: đổi ghi chú bản ghi cũ khi hiển thị, nhận dấu trang cũ.
  { ten: 'Vào/rời phòng gọi là "Nhận phòng"/"Trả phòng" — không dùng "Check-in"/"Check-out"', re: /check-(in|out)\b/i, boQua: /ghiChuRaVao|PATH_VIEWS\[/ },
];

// JS: bỏ chú thích dòng, khối đầu dòng, ${/* … */''} trong template, và "// …" cuối dòng.
const boChuThichJs = s => s
  .replace(/\$\{\s*\/\*[\s\S]*?\*\/\s*''\s*\}/g, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .split('\n').map(d => (/^\s*\/\//.test(d) ? '' : d.replace(/\s\/\/\s.*$/, ''))).join('\n');

// Go: chỉ lấy chuỗi "…" và `…` sau khi bỏ chú thích.
const chuoiGo = s => {
  const sach = s.split('\n').map(d => (/^\s*\/\//.test(d) ? '' : d.replace(/\s\/\/\s.*$/, ''))).join('\n');
  return [...sach.matchAll(/"(?:[^"\\\n]|\\.)*"|`[^`]*`/g)].map(m => m[0]).join('\n');
};

const tepGo = thu => fs.readdirSync(thu, { withFileTypes: true }).flatMap(e => {
  const p = path.join(thu, e.name);
  if (e.isDirectory()) return tepGo(p);
  return e.name.endsWith('.go') && !e.name.endsWith('_test.go') ? [p] : [];
});

module.exports = {
  name: 'Thuật ngữ đã chốt — chữ hiển thị không dùng lại từ đã bỏ',

  run(t) {
    const jsDir = path.join(GOC, 'public', 'js');
    const nguon = [
      ...fs.readdirSync(jsDir).filter(f => f.endsWith('.js'))
        .map(f => ({ tep: 'public/js/' + f, chu: boChuThichJs(fs.readFileSync(path.join(jsDir, f), 'utf8')) })),
      ...tepGo(path.join(GOC, 'internal'))
        .map(p => ({ tep: path.relative(GOC, p).replace(/\\/g, '/'), chu: chuoiGo(fs.readFileSync(p, 'utf8')) })),
    ];
    t.ok('Đọc được mã giao diện và máy chủ', nguon.length > 40, `${nguon.length} tệp`);

    for (const luat of CAM) {
      const gap = [];
      for (const { tep, chu } of nguon) {
        chu.split('\n').forEach(d => {
          const m = d.match(luat.re);
          if (m && !(luat.boQua && luat.boQua.test(d))) gap.push(`${tep} «${m[0]}» …${d.trim().slice(0, 70)}`);
        });
      }
      t.eq(luat.ten, gap.length, 0, gap.slice(0, 8).join(' | '));
    }
  },
};
