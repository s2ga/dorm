// Quét biển số bằng camera: bộ đọc chạy NGAY TRÊN MÁY bảo vệ (WebAssembly).
// Ba thứ phải khớp nhau, thiếu một là màn quét chết câm mà không ai biết:
//   ① CSP phải cho 'wasm-unsafe-eval'  ② tệp bộ đọc phải có mặt  ③ service worker phải cache-first
const fs = require('fs');
const path = require('path');

const goc = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const cop = f => path.join(__dirname, '../..', f);

module.exports = {
  name: 'Quét biển số — bộ đọc chạy trên máy bảo vệ',
  needsServer: false,

  async run(t) {
    // ── ① CSP ────────────────────────────────────────────────────────────────────────────
    const sec = goc('internal/httpx/middleware/security.go');
    t.ok('CSP cho phép biên dịch WebAssembly', /script-src[^;"]*'wasm-unsafe-eval'/.test(sec),
      "thiếu 'wasm-unsafe-eval' thì trình duyệt chặn thẳng bộ đọc biển số");
    t.ok('CSP KHÔNG mở eval() của JavaScript', !/script-src[^;"]*'unsafe-eval'(?!\w)/.test(sec.replace(/'wasm-unsafe-eval'/g, '')),
      "'wasm-unsafe-eval' chỉ mở WebAssembly; 'unsafe-eval' là chuyện khác hẳn, không được lẫn vào");
    t.ok('CSP vẫn chỉ nhận script cùng nguồn', /script-src 'self'/.test(sec));

    // ── ② Tệp bộ đọc ─────────────────────────────────────────────────────────────────────
    const canCo = [
      ['public/vendor/plate/ort.wasm.min.js', 10 * 1024],
      ['public/vendor/plate/ort-wasm-simd-threaded.mjs', 5 * 1024],
      ['public/vendor/plate/ort-wasm-simd-threaded.wasm', 5 * 1024 * 1024],
      ['public/vendor/plate/plate-ocr.onnx', 1024 * 1024],
    ];
    for (const [f, toiThieu] of canCo) {
      const co = fs.existsSync(cop(f));
      t.ok(`Có tệp ${path.basename(f)}`, co, co ? '' : 'thiếu tệp này thì màn quét không chạy');
      if (co) {
        const n = fs.statSync(cop(f)).size;
        t.ok(`  ${path.basename(f)} không rỗng/hỏng`, n >= toiThieu, `${(n / 1048576).toFixed(2)} MB`);
      }
    }

    // ── ③ Service worker ─────────────────────────────────────────────────────────────────
    const sw = goc('public/sw.js');
    t.ok('Service worker xử lý riêng /vendor/', /url\.pathname\.startsWith\('\/vendor\/'\)/.test(sw),
      'không có nhánh riêng thì rơi vào network-first → tải lại 15MB mỗi lần mở màn quét');
    const nhanh = (sw.match(/\/vendor\/'\)\)?\s*\{[\s\S]{0,400}/) || [''])[0];
    t.ok('  /vendor/ đi đường cache-first', /caches\.match\(e\.request\)\.then\(c\s*=>\s*c\s*\|\|/.test(nhanh),
      'phải tra cache TRƯỚC rồi mới ra mạng');
    t.ok('Bộ đọc KHÔNG nằm trong danh sách tải sẵn', !/vendor\/plate/.test((sw.match(/const SHELL = \[[\s\S]*?\];/) || [''])[0]),
      'nhét vào SHELL là MỌI người dùng (kể cả học viên) phải tải 15MB lúc mở app');

    // ── Phía giao diện ───────────────────────────────────────────────────────────────────
    const js = goc('public/js/app-portals-boot.js');
    t.ok('Nạp bản CHỈ-WASM của bộ chạy', /ort\.wasm\.min\.js/.test(js),
      'bundle "all" sẽ đòi thêm tệp jsep 25MB cho WebGPU mà ta không chép');
    t.ok('Ghim tường minh đường dẫn .mjs và .wasm', /wasmPaths\s*=\s*\{[\s\S]{0,200}mjs:[\s\S]{0,200}wasm:/.test(js),
      'để ORT tự đoán là nó đi tìm biến thể không có ở đây');
    t.ok('Có chặn ngữ cảnh không an toàn (HTTP) trước khi gọi camera',
      js.includes('!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia') && /https:\/\//.test(js),
      'vào bằng http:// thì mediaDevices không tồn tại — phải báo rõ, đừng để văng TypeError');
    t.ok('Chốt hai lần đọc giống nhau mới ghi', /bien === lanTruoc/.test(js),
      'một khung hình mờ là đủ để đọc sai — không được ghi ngay lần đầu');
    t.ok('Dừng camera khi đóng màn', /getTracks\(\)\.forEach\(t => t\.stop\(\)\)/.test(js),
      'không tắt là đèn camera sáng mãi, tốn pin của bảo vệ');
    t.ok('Bảng chữ khớp model (36 ký tự + ô trống)', /'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_'/.test(js));
    t.ok('Kích thước ảnh vào đúng 128×64 như model đòi', /PK_MODEL_W = 128, PK_MODEL_H = 64/.test(js));
  },
};
