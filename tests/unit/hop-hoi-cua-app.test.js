// Hỏi và báo bằng hộp của app (xacNhan · thongBao · nhapLyDo trong ui.js), không bằng confirm()/alert()/prompt() của
// trình duyệt. Ngoại lệ là hỏi "dữ liệu chưa lưu" lúc rời màn/đóng modal: câu trả lời phải có ngay, đồng bộ.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'js');
const CHO_PHEP = {
  adminGo: 'hỏi dữ liệu chưa lưu khi rời màn',
  modalBack: 'hỏi dữ liệu chưa lưu khi quay lại lớp trước',
  closeModal: 'hỏi dữ liệu chưa lưu khi đóng modal',
  washReqDuyet: 'chưa đổi: dòng này đang có sửa dở của phiên khác',
};
const HOP_GOC = /(^|[^\w.$])(window\.)?(confirm|alert|prompt)\s*\(/;

// Bỏ chú thích nhưng giữ nguyên số dòng.
const boChuThich = s => s
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ''))
  .split('\n').map(d => (/^\s*\/\//.test(d) ? '' : d.replace(/\s\/\/\s.*$/, ''))).join('\n');

module.exports = {
  name: 'Hộp hỏi của app — không dùng confirm/alert/prompt của trình duyệt',

  run(t) {
    const ui = fs.readFileSync(path.join(DIR, 'ui.js'), 'utf8');
    t.ok('ui.js khai báo xacNhan, thongBao, nhapLyDo',
      ['xacNhan', 'thongBao', 'nhapLyDo'].every(f => new RegExp(`^const ${f} = `, 'm').test(ui)));

    const gap = [], conGiu = new Set();
    for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.js'))) {
      let ham = '(ngoài hàm)';
      boChuThich(fs.readFileSync(path.join(DIR, f), 'utf8')).split('\n').forEach((d, i) => {
        const fn = d.match(/^\s*(?:async\s+)?function\s+([\w$]+)/);
        if (fn) ham = fn[1];
        const m = d.match(HOP_GOC);
        if (!m) return;
        if (CHO_PHEP[ham]) conGiu.add(ham);
        else gap.push(`${f}:${i + 1} ${ham}() dùng ${m[3]}()`);
      });
    }
    t.eq('Không còn confirm/alert/prompt gốc ngoài danh sách ngoại lệ', gap.length, 0, gap.slice(0, 10).join(' | '));
    const thua = Object.keys(CHO_PHEP).filter(h => !conGiu.has(h));
    t.eq('Danh sách ngoại lệ không thừa (hàm đã đổi sang hộp của app thì gỡ khỏi danh sách)', thua.length, 0, thua.join(', '));
  },
};
