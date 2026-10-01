// Câu chữ hiển thị: nhấn mạnh bằng <strong>, không VIẾT HOA từ thường; không giọng nói chuyện ("trước đã", "nhé"…);
// dấu "…" một ký tự; thao tác ghi "Bấm"; không viết tắt/tiếng Anh đã thay. Chỉ soi chuỗi trong mã giao diện, bỏ chú
// thích. Ngoại lệ ghi rõ lý do trong CHO_PHEP.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'js');
const IN_HOA = ['KHÔNG', 'CHƯA', 'CHỈ', 'MỌI', 'VẪN', 'GIỮ', 'KHOÁ', 'KHÓA', 'TẮT', 'ĐỌC', 'CẢ', 'HẾT', 'LUÔN', 'ĐÚNG', 'ĐÃ', 'TRƯỚC', 'RIÊNG'];
const CAM = [
  { ten: 'Không VIẾT HOA từ thường để nhấn mạnh (dùng <strong>)', re: new RegExp(`(?<![\\p{L}\\p{N}_])(${IN_HOA.join('|')})(?![\\p{L}\\p{N}_])`, 'u') },
  { ten: 'Không giọng nói chuyện ("trước đã", "nhé", "hãy", "cứ chọn tạm", "ngoài đời", "chỏi nhau")', re: /trước đã|\snhé[\s.,!'"`<]|(?<![\p{L}])hãy\s|cứ chọn tạm|ngoài đời|chỏi nhau/u },
  { ten: 'Dấu ba chấm là một ký tự "…", không gõ "..."', re: /[\p{L}\p{N})] ?\.\.\.['"`<]/u },
  { ten: 'Thao tác ghi "Bấm", không "Nhấp"/"Chạm để"', re: /(?<![\p{L}])(Nhấp|nhấp|Chạm|chạm) (để|vào|đúp)/u },
  { ten: 'Không viết tắt / tiếng Anh: "scan", "MSHV", "Dự kiến XC", "Ctrl+C", "tab mới"', re: /(?<![\w/-])scan(?=\s+\p{L})|\bMSHV\b|Dự kiến XC|Ctrl\+C|tab mới/iu },
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
