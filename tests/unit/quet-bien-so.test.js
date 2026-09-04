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
    t.ok('Có đường quét lại tại chỗ (không phải tắt/bật camera)', /function pkCamQuetLai\(\)/.test(js),
      'đọc sai mà không có nút quét lại thì bảo vệ phải thoát ra mở lại — đúng lỗi đã gặp ngoài thực tế');
    t.ok('Không chắc thì đưa danh sách cho người bấm chọn', /data-act="pkCamChon"/.test(js),
      'tự ghi khi chưa chắc là điểm danh nhầm sang xe người khác');
    // Chủ dự án chốt: máy CHỈ được tự ghi khi đọc trùng khít. Lệch dù một ký tự phải người xác nhận.
    t.ok('CHỈ tự ghi khi khoảng cách bằng 0', /if \(nhat && nhat\.kc === 0\) \{/.test(js),
      'nới ra "kc <= 1" là máy tự ghi có gửi cho xe mà nó đọc không trùng khít — ghi sai vào tài sản người khác');
    t.ok('Không còn nhánh tự ghi khi lệch ký tự', !/nhat\.kc <= 1/.test(js),
      'luật cũ cho lệch 1 ký tự đã bị gỡ theo yêu cầu chủ dự án');
    t.ok('Làm ngơ chuỗi vừa xử lý một lúc', /PK_LANG_MS/.test(js),
      'xe vẫn nằm trước camera nên khung sau đọc y hệt — không chặn thì thông báo bị ghi đè, và nút Quét lại nhìn như hỏng');

    // ── Cách dò biển máy đọc được ────────────────────────────────────────────────────────
    // Lỗi thật đã gặp: hàm dò cũ (pkDiem) đòi chuỗi phải là DÃY CON đúng thứ tự của biển — hợp với
    // người GÕ TAY, nhưng máy đọc sai vài ký tự GIỮA chuỗi thì xe đúng bị chấm 0 và biến mất.
    const lay = ten => {
      const m = js.match(new RegExp(`function ${ten}\\([\\s\\S]*?\\n\\}`));
      return m ? m[0] : null;
    };
    const bangLan = (/const PK_HAY_LAN = \[[^\]]*\];/.exec(js) || [''])[0];
    const nguon = [bangLan, lay('pkPhat'), lay('pkKhoangCach')].filter(Boolean).join('\n');
    t.ok('Đọc được hàm dò trong mã nguồn', nguon.includes('pkKhoangCach'), 'không tách được thì phần dưới vô nghĩa');

    let kc = null;
    try { kc = new Function(nguon + '; return pkKhoangCach;')(); } catch (e) { /* để null -> báo hỏng bên dưới */ }
    t.ok('Chạy được hàm dò', typeof kc === 'function');
    if (typeof kc === 'function') {
      const bai = ['77C173448', '63B450858', '59P122007', '51K973144', '71B477140', '60C284244', '77C173449'];
      const gan = doc => bai.map(p => ({ p, d: kc(doc, p) })).sort((a, b) => a.d - b.d);

      // Đúng ca hỏng ngoài bãi: biển 77-C1 734.48, máy đọc ra 77411448.
      const ca1 = gan('77411448');
      t.eq('Ca hỏng thật (đọc 77411448) dò ra ĐÚNG xe 77C173448', ca1[0].p, '77C173448',
        `xếp hạng: ${ca1.slice(0, 3).map(x => x.p + '(' + x.d.toFixed(1) + ')').join(', ')}`);

      t.eq('Đọc đúng hoàn toàn → khoảng cách 0', kc('77C173448', '77C173448'), 0);
      t.ok('Lẫn 8↔B bị phạt nhẹ để xe đúng vẫn đứng đầu gợi ý', kc('77C17344B', '77C173448') < 1,
        `được ${kc('77C17344B', '77C173448')} — chỉ để XẾP HẠNG, vẫn phải người xác nhận mới ghi`);
      t.ok('Lẫn 0↔O bị phạt nhẹ', kc('71B47714O', '71B477140') < 1);
      t.ok('Khoảng cách khác 0 khi có bất kỳ ký tự nào lệch', kc('77C17344B', '77C173448') > 0,
        'phải khác 0 thì luật "chỉ trùng khít mới tự ghi" mới chặn được');
      t.ok('Biển khác hẳn thì phải xa', kc('77C173448', '63B450858') >= 5,
        `được ${kc('77C173448', '63B450858')} — gần quá là dễ điểm danh nhầm xe`);
      t.ok('Hai biển chỉ khác số cuối vẫn phân biệt được', kc('77C173448', '77C173449') >= 1,
        'khác 1 ký tự phải ra khoảng cách ≥1, nếu không thì tự ghi nhầm sang xe bên cạnh');
    }
  },
};
