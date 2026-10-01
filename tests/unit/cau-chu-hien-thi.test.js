// Câu chữ hiển thị: nhấn mạnh bằng <strong>, không VIẾT HOA từ thường; không giọng nói chuyện ("trước đã", "nhé"…).
// Chỉ soi chuỗi trong mã giao diện, bỏ chú thích. Ngoại lệ ghi rõ lý do trong CHO_PHEP.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'js');
const IN_HOA = ['KHÔNG', 'CHƯA', 'CHỈ', 'MỌI', 'VẪN', 'GIỮ', 'KHOÁ', 'KHÓA', 'TẮT', 'ĐỌC', 'CẢ', 'HẾT', 'LUÔN', 'ĐÚNG', 'ĐÃ', 'TRƯỚC', 'RIÊNG'];
const CAM = [
  { ten: 'Không VIẾT HOA từ thường để nhấn mạnh (dùng <strong>)', re: new RegExp(`(?<![\\p{L}\\p{N}_])(${IN_HOA.join('|')})(?![\\p{L}\\p{N}_])`, 'u') },
  { ten: 'Không giọng nói chuyện ("trước đã", "nhé", "cứ chọn tạm", "ngoài đời", "chỏi nhau")', re: /trước đã|\snhé[\s.,!'"`<]|cứ chọn tạm|ngoài đời|chỏi nhau/ },
];
// Hỏi hoàn cọc giữ nguyên chờ owner chốt cách gọi "Không hoàn (giữ cọc)".
const CHO_PHEP = [/Xác nhận HOÀN cọc|Xác nhận KHÔNG hoàn cọc/];

const boChuThich = s => s
  .replace(/\$\{\s*\/\*[\s\S]*?\*\/\s*''\s*\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ''))
  .split('\n').map(d => (/^\s*\/\//.test(d) ? '' : d.replace(/\s\/\/\s.*$/, ''))).join('\n');

module.exports = {
  name: 'Câu chữ hiển thị — không viết hoa để nhấn, không giọng nói chuyện',

  run(t) {
    const tep = fs.readdirSync(DIR).filter(f => f.endsWith('.js'))
      .map(f => ({ f, dong: boChuThich(fs.readFileSync(path.join(DIR, f), 'utf8')).split('\n') }));
    t.ok('Đọc được mã giao diện', tep.length > 10, `${tep.length} tệp`);
    for (const luat of CAM) {
      const gap = [];
      for (const { f, dong } of tep) {
        dong.forEach((d, i) => {
          const m = d.match(luat.re);
          if (m && !CHO_PHEP.some(re => re.test(d))) gap.push(`${f}:${i + 1} «${m[0]}» …${d.trim().slice(0, 60)}`);
        });
      }
      t.eq(luat.ten, gap.length, 0, gap.slice(0, 8).join(' | '));
    }
  },
};
