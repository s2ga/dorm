// Ô nhập mở đúng bàn phím điện thoại: biển số tự viết HOA, SĐT bàn phím số điện thoại, email bàn phím có @,
// giờ/cổng/số tài khoản bàn phím số. Quét mọi thẻ <input> trong public/js theo id.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'js');
const SO = ['set_smtp_port', 'set_parking_close_alert_time', 'set_security_day_from', 'set_security_day_to', 'r_acc'];

function theInput(src) {
  const ds = [];
  for (let i = src.indexOf('<input'); i !== -1; i = src.indexOf('<input', i + 6)) {
    let sau = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '$' && src[j + 1] === '{') { sau++; j++; } else if (src[j] === '}' && sau) sau--;
      else if (src[j] === '>' && !sau) break;
    }
    const the = src.slice(i, j + 1);
    const id = (the.match(/\bid="([\w-]+)"/) || [])[1];
    if (id) ds.push({ id, the, dong: src.slice(0, i).split('\n').length });
  }
  return ds;
}

module.exports = {
  name: 'Kiểu ô nhập — đúng bàn phím điện thoại',

  run(t) {
    const tat = [];
    for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.js'))) {
      theInput(fs.readFileSync(path.join(DIR, f), 'utf8')).forEach(x => tat.push({ ...x, cho: `${f}:${x.dong} #${x.id}` }));
    }
    const sai = (loc, dk) => tat.filter(loc).filter(x => !dk(x.the)).map(x => x.cho);

    const bien = tat.filter(x => /plate|bien/i.test(x.id));
    t.ok('Tìm thấy các ô biển số', bien.length >= 8, `${bien.length} ô`);
    let s = sai(x => /plate|bien/i.test(x.id), the => /autocapitalize="characters"/.test(the));
    t.eq('Ô biển số tự viết HOA (autocapitalize="characters")', s.length, 0, s.join(' | '));

    s = sai(x => /phone|hotline/i.test(x.id), the => /type="tel"/.test(the));
    t.eq('Ô SĐT/hotline là type="tel"', s.length, 0, s.join(' | '));

    s = sai(x => /email$/i.test(x.id), the => /type="email"|inputmode="email"/.test(the));
    t.eq('Ô email mở bàn phím email', s.length, 0, s.join(' | '));

    const thieu = SO.filter(id => !tat.some(x => x.id === id));
    t.eq('Các ô giờ/cổng/số tài khoản còn tồn tại', thieu.length, 0, thieu.join(', '));
    s = sai(x => SO.includes(x.id), the => /inputmode="numeric"/.test(the));
    t.eq('Ô giờ/cổng/số tài khoản mở bàn phím số', s.length, 0, s.join(' | '));
  },
};
