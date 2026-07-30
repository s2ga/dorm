// 8 file app-*.js là classic script, DÙNG CHUNG một scope toàn cục. Hai file khai báo cùng tên hàm
// thì file nạp SAU đè mất file nạp trước — không lỗi, không cảnh báo, nút chỉ đơn giản là không phản ứng.
// Đã dính một lần: approveForm ("Thêm vào phòng" ở đơn đăng ký) bị bản duyệt tài khoản của
// app-invoices-settings.js đè, nút chết suốt từ v170 tới v175 mà không ai thấy vì nó `return` im lặng.
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', '..', 'public', 'js');

// Lấy đúng khai báo ở CẤP CAO NHẤT (không thụt đầu dòng) — đó mới là thứ nằm trên scope toàn cục.
const khaiBaoToanCuc = src => {
  const ten = new Set();
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) ten.add(m[1] || m[2]);
  return ten;
};

module.exports = {
  name: 'Classic script — không file nào được đè tên toàn cục của file khác',

  run(t) {
    const files = fs.readFileSync(path.join(JS, '..', 'index.html'), 'utf8')
      .match(/js\/[\w-]+\.js/g)
      .filter((v, i, a) => a.indexOf(v) === i)
      .map(p => p.replace('js/', ''));

    t.ok('Đọc được thứ tự nạp script từ index.html', files.length >= 8, files.join(', '));

    const chuNhan = new Map();   // tên -> file khai báo đầu tiên
    const dungDo = [];
    for (const f of files) {
      const p = path.join(JS, f);
      if (!fs.existsSync(p)) continue;
      for (const ten of khaiBaoToanCuc(fs.readFileSync(p, 'utf8'))) {
        if (chuNhan.has(ten)) dungDo.push(`${ten}: ${chuNhan.get(ten)} bị ${f} đè`);
        else chuNhan.set(ten, f);
      }
    }

    t.eq('Không có tên toàn cục nào bị đè', dungDo.length, 0, dungDo.join(' · '));

    // Mọi data-act/-change/-input phải trỏ tới một hàm có thật — gõ sai tên cũng là nút chết y hệt.
    // Bỏ chú thích trước khi quét: app-actions.js có ví dụ data-act="tenHam" trong phần mô tả quy ước.
    const boChuThich = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const nguon = files.filter(f => fs.existsSync(path.join(JS, f)))
      .map(f => boChuThich(fs.readFileSync(path.join(JS, f), 'utf8'))).join('\n');
    const act = [...nguon.matchAll(/data-(?:act|change|input)="([\w$]+)"/g)].map(m => m[1]);
    const thieu = [...new Set(act)].filter(a => !chuNhan.has(a));
    t.eq('Mọi data-act/-change/-input đều có hàm tương ứng', thieu.length, 0, thieu.join(', '));
  },
};
