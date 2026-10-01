// Danh sách rỗng chỉ hai mẫu câu (tu-ngu.js): chưa có dữ liệu → "Chưa có …."; có dữ liệu mà lọc/tìm không ra →
// "Không có … khớp bộ lọc." kèm nút "Xóa bộ lọc". Hàng .no-result chỉ dựng qua hangKhongKhop (ui.js) để luôn có nút.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'js');
const CAM = [
  { ten: 'Không dùng "Không tìm thấy … phù hợp" / "Không có … phù hợp"', re: /Không (tìm thấy|có) [^'"`<]{1,40} phù hợp/ },
  { ten: 'Không dùng câu trống thiếu chủ ngữ ("Chưa có.", "Không có ai.")', re: /[>'"`]\s*(Chưa có|Không có ai)\.\s*[<'"`]/ },
  { ten: 'Không dùng "không sót ai"', re: /không sót ai/i },
  { ten: 'Viết "Không có … khớp", không viết thiếu "có" ("Không hồ sơ nào khớp")', re: /Không (?!có )[^'"`<]{1,30} nào khớp/ },
  { ten: 'Nút xoá bộ lọc ghi "Xóa bộ lọc" (NHAN_XOA_LOC), không ghi "Bỏ lọc"', re: />[^<]*Bỏ lọc\s*</ },
  { ten: 'Hàng .no-result chỉ dựng qua hangKhongKhop (để luôn có nút xoá lọc)', re: /class="no-result"/, chi: f => f !== 'ui.js' },
];

const boChuThich = s => s
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ''))
  .split('\n').map(d => (/^\s*\/\//.test(d) ? '' : d.replace(/\s\/\/\s.*$/, ''))).join('\n');

module.exports = {
  name: 'Danh sách rỗng — hai mẫu câu, có nút xoá bộ lọc',

  run(t) {
    const tuNgu = fs.readFileSync(path.join(DIR, 'tu-ngu.js'), 'utf8');
    const dong = ['trongChuaCo', 'trongKhongKhop', 'NHAN_XOA_LOC'].map(ten => (tuNgu.match(new RegExp(`^const ${ten} = .*$`, 'm')) || [])[0]);
    t.ok('tu-ngu.js khai báo trongChuaCo, trongKhongKhop, NHAN_XOA_LOC', dong.every(Boolean), JSON.stringify(dong));
    if (dong.every(Boolean)) {
      const { trongChuaCo, trongKhongKhop, NHAN_XOA_LOC } = new Function(`${dong.join('\n')}\nreturn { trongChuaCo, trongKhongKhop, NHAN_XOA_LOC };`)();
      t.eq('trongChuaCo("phòng nào")', trongChuaCo('phòng nào'), 'Chưa có phòng nào.');
      t.eq('trongKhongKhop("học viên")', trongKhongKhop('học viên'), 'Không có học viên khớp bộ lọc.');
      t.eq('Nhãn nút', NHAN_XOA_LOC, 'Xóa bộ lọc');
    }

    const tep = fs.readdirSync(DIR).filter(f => f.endsWith('.js'))
      .map(f => ({ f, dong: boChuThich(fs.readFileSync(path.join(DIR, f), 'utf8')).split('\n') }));
    for (const luat of CAM) {
      const gap = [];
      for (const { f, dong: ds } of tep) {
        if (luat.chi && !luat.chi(f)) continue;
        ds.forEach((d, i) => { const m = d.match(luat.re); if (m) gap.push(`${f}:${i + 1} «${m[0].slice(0, 60)}»`); });
      }
      t.eq(luat.ten, gap.length, 0, gap.slice(0, 8).join(' | '));
    }
  },
};
