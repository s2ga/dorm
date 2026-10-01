// Mọi hàm gắn với nút bấm (data-act) mà GHI dữ liệu (gọi API POST/PUT/DELETE) phải nằm trong danh sách bọc
// chongBam2Lan ở app-portals-boot.js — bấm đôi khi mạng chậm là gửi hai lần: hai hồ sơ, hai email, mật khẩu
// hiện ra lần đầu đã bị lần sau thay. Hàm cố ý không bọc thì ghi vào KHONG_BOC kèm lý do.
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', '..', 'public', 'js');

const KHONG_BOC = {
  pkDanhDau: 'an ninh điểm danh từng xe liên tiếp — bọc thì chặn luôn cú bấm vào xe kế; đặt lại cùng trạng thái là vô hại',
  doiTrangThaiThu: 'đánh dấu thu từng dòng liên tiếp ở bảng phiếu báo — cùng lý do; đặt lại cùng trạng thái là vô hại',
  toggleHvNotif: 'mở/đóng chuông cổng học viên — đánh dấu đã xem gửi lại là vô hại; bọc thì nút chuông đổi chữ "Đang xử lý…"',
  testSmtpConnection: 'chỉ thử kết nối máy chủ email, không ghi dữ liệu; hàm tự khoá nút trong lúc chạy',
};

module.exports = {
  name: 'Chống bấm 2 lần — mọi nút ghi dữ liệu đều được bọc',

  run(t) {
    const files = fs.readFileSync(path.join(JS, '..', 'index.html'), 'utf8')
      .match(/js\/[\w-]+\.js/g).filter((v, i, a) => a.indexOf(v) === i).map(p => p.replace('js/', ''));
    const doc = f => fs.readFileSync(path.join(JS, f), 'utf8');

    const apiGhi = new Set([...doc('api.js').matchAll(/^\s*([A-Za-z_$][\w$]*):[^\n]*method:\s*'(?:POST|PUT|DELETE|PATCH)'/gm)].map(m => m[1]));
    t.ok('Đọc được các hàm API ghi dữ liệu từ api.js', apiGhi.size > 30, `${apiGhi.size} hàm`);

    const boot = doc('app-portals-boot.js');
    const khoi = boot.match(/\n\[\n([\s\S]*?)\n\]\.forEach\(ten =>/);
    t.ok('Tìm thấy danh sách bọc chongBam2Lan', !!khoi);
    const daBoc = new Set(khoi ? [...khoi[1].replace(/\/\/.*$/gm, '').matchAll(/'([\w$]+)'/g)].map(m => m[1]) : []);

    // Thân hàm cấp cao nhất: từ dòng khai báo tới dòng khai báo cấp cao nhất kế tiếp.
    const than = new Map();
    for (const f of files) {
      const dong = doc(f).split('\n');
      let ten = null, buf = [];
      const xong = () => { if (ten) than.set(ten, buf.join('\n')); };
      for (const d of dong) {
        const m = d.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
        if (m || /^(?:const|let|var)\s|^\/[*\/]/.test(d)) { xong(); ten = m ? m[1] : null; buf = []; }
        if (ten) buf.push(d);
      }
      xong();
    }

    // Chỉ bỏ chú thích thật (đầu dòng, hoặc ${/* … */''} trong template) — chuỗi accept="image/*" không phải chú thích.
    const nguon = files.map(doc).join('\n')
      .replace(/\$\{\s*\/\*[\s\S]*?\*\/\s*''\s*\}/g, '').replace(/^\s*\/\*[\s\S]*?\*\//gm, '');
    const nutBam = new Set([...nguon.matchAll(/data-act="([\w$]+)"/g)].map(m => m[1]));
    const ghi = [...nutBam].filter(ten => {
      const b = than.get(ten);
      return b && [...b.matchAll(/API\.([\w$]+)\(/g)].some(m => apiGhi.has(m[1]));
    });
    t.ok('Quét được các nút ghi dữ liệu', ghi.length > 40, `${ghi.length} nút`);

    const thieu = ghi.filter(ten => !daBoc.has(ten) && !KHONG_BOC[ten]);
    t.eq('Mọi nút ghi dữ liệu đều được bọc chống bấm 2 lần', thieu.length, 0, 'thiếu: ' + thieu.join(', '));

    const khongCo = [...daBoc].filter(ten => !than.has(ten));
    t.eq('Mọi tên trong danh sách bọc đều là hàm có thật', khongCo.length, 0, khongCo.join(', '));
  },
};
