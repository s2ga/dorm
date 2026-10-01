// Quy ước nút: trong chân modal (.mf) nút chính đứng cuối (phụ trái, chính phải), "Đóng" luôn là nút thường,
// không để hai nút đỏ đứng sát nhau; nút đỏ (danger) chỉ cho việc xoá / khoá / trả phòng / giữ cọc / miễn nhiệm /
// từ chối. Sửa và xoá trong bảng là nút icon ghost, không dùng chữ "Sửa" / "Xóa" trơn.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'js');
const DO_DUOC = /^(del\w*|doKhoaHoSo|checkOutForm|doCheckOut|quickPick|settleDeposit\w*|unsetLeader|\w*TuChoi\w*)$|checkOutForm/;

function cacNut(s) {
  const ds = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(s))) {
    const cls = (m[1].match(/class="([^"]*)"/) || [])[1] || '';
    ds.push({
      cls, act: (m[1].match(/data-act="([^"]*)"/) || [])[1] || '',
      chu: m[2].replace(/\$\{IC\.\w+\}/g, '').replace(/\$\{[^}]*\}/g, '…').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      pri: /\bpri\b/.test(cls), mau: /\b(pri|danger|green)\b/.test(cls), danger: /\bdanger\b/.test(cls),
    });
  }
  return ds;
}

module.exports = {
  name: 'Quy ước nút — vị trí, màu đỏ, sửa/xoá',

  run(t) {
    const gap = { thuTu: [], dong: [], doSat: [], doSai: [], chuTron: [] };
    let soMf = 0;
    for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8');
      const dong = i => src.slice(0, i).split('\n').length;
      const reMf = /<div class="mf"[^>]*>/g;
      let m;
      while ((m = reMf.exec(src))) {
        let sau = 1, j = m.index + m[0].length;
        for (; j < src.length && sau; j++) {
          if (src.startsWith('<div', j)) sau++;
          else if (src.startsWith('</div>', j)) sau--;
        }
        soMf++;
        const nut = cacNut(src.slice(m.index, j)), cho = `${f}:${dong(m.index)}`;
        const iPri = nut.findIndex(n => n.pri);
        if (iPri !== -1 && nut.slice(iPri + 1).some(n => !n.pri)) gap.thuTu.push(`${cho} (${nut.map(n => n.chu).join(' | ')})`);
        nut.filter(n => n.chu === 'Đóng' && n.mau).forEach(() => gap.dong.push(cho));
        for (let k = 1; k < nut.length; k++) if (nut[k].danger && nut[k - 1].danger) gap.doSat.push(`${cho} (${nut[k - 1].chu} | ${nut[k].chu})`);
      }
      for (const n of cacNut(src)) {
        if (n.danger && n.act && !DO_DUOC.test(n.act)) gap.doSai.push(`${f} "${n.chu}" (${n.act})`);
        if (/^(Sửa|Xóa|Xoá|Gỡ)$/.test(n.chu) && /\bsm\b/.test(n.cls) && /^(del\w*|\w*Form|xoaChotGiuaKy)$/.test(n.act)) gap.chuTron.push(`${f} "${n.chu}" (${n.act})`);
      }
    }
    t.ok('Tìm thấy các chân modal', soMf > 50, `${soMf} chân modal`);
    t.eq('Nút chính đứng cuối chân modal', gap.thuTu.length, 0, gap.thuTu.join(' · '));
    t.eq('"Đóng" là nút thường (không pri/danger/green)', gap.dong.length, 0, gap.dong.join(' · '));
    t.eq('Không có hai nút đỏ đứng sát nhau', gap.doSat.length, 0, gap.doSat.join(' · '));
    t.eq('Nút đỏ chỉ cho xoá / khoá / trả phòng / giữ cọc / miễn nhiệm / từ chối', gap.doSai.length, 0, gap.doSai.join(' · '));
    t.eq('Sửa / xoá trong bảng là nút icon, không phải chữ trơn', gap.chuTron.length, 0, gap.chuTron.join(' · '));
  },
};
