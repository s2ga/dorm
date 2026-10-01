// Ô bắt buộc đánh dấu một kiểu (${SAO} — dấu * đỏ), không gõ tay " *" hay "(bắt buộc)"; lỗi nhập báo ngay tại ô
// bằng loiTaiO (viền đỏ + dòng chữ + đưa con trỏ tới ô), không bằng toast trôi mất.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'js');
// Ngoại lệ theo hàm: danh sách chọn (không có ô để đánh dấu), hộp nhập lý do đã đóng, hàm phiên khác đang sửa dở.
const TOAST_DUOC_GIU = { linkTenant: 1, bienBanTraLai: 1, washReqTuChoiLuu: 1, washReqTuChoiForm: 1 };

const boChuThich = s => s
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ''))
  .split('\n').map(d => (/^\s*\/\//.test(d) ? '' : d.replace(/\s\/\/\s.*$/, ''))).join('\n');

module.exports = {
  name: 'Ô bắt buộc — một kiểu dấu, lỗi báo tại ô',

  run(t) {
    const ui = fs.readFileSync(path.join(DIR, 'ui.js'), 'utf8');
    t.ok('ui.js có hàm loiTaiO', /^function loiTaiO\(/m.test(ui));

    const gap = { sao: [], batBuoc: [], toast: [] };
    for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.js'))) {
      let ham = '(ngoài hàm)';
      boChuThich(fs.readFileSync(path.join(DIR, f), 'utf8')).split('\n').forEach((d, i) => {
        const fn = d.match(/^\s*(?:async\s+)?function\s+([\w$]+)/);
        if (fn) ham = fn[1];
        const cho = `${f}:${i + 1} ${ham}()`;
        if (/\*<\/label>/.test(d) && !TOAST_DUOC_GIU[ham]) gap.sao.push(cho);
        if (/\(bắt buộc\)/.test(d)) gap.batBuoc.push(cho);
        if (/toast\(['`](Nhập|Chọn)[^'`]*['`],\s*'err'\)/.test(d) && !TOAST_DUOC_GIU[ham]) gap.toast.push(cho);
      });
    }
    t.eq('Không gõ tay " *" trong nhãn (dùng ${SAO})', gap.sao.length, 0, gap.sao.join(' | '));
    t.eq('Không ghi "(bắt buộc)"', gap.batBuoc.length, 0, gap.batBuoc.join(' | '));
    t.eq('Lỗi "Nhập…/Chọn…" báo tại ô (loiTaiO), không bằng toast', gap.toast.length, 0, gap.toast.slice(0, 10).join(' | '));
  },
};
