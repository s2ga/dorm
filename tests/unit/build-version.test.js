// /api/version chỉ trả đúng tag + commit khi CHUỖI DÂY còn nối: Dockerfile nhận build-arg và nhúng
// vào binary bằng -ldflags, hai workflow truyền build-arg vào. Đứt một mắt thì API vẫn chạy, vẫn trả
// 200, chỉ là luôn "dev" — không ai thấy cho tới lúc cần biết UAT đang chạy bản nào.
const fs = require('fs');
const path = require('path');

const doc = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const BIEN = ['Version', 'Commit', 'BuiltAt'];
const ARG = ['VERSION', 'COMMIT', 'BUILT_AT'];

module.exports = {
  name: 'Bản dựng nhúng vào binary (Dockerfile + workflows)',
  needsServer: false,

  async run(t) {
    const df = doc('Dockerfile');

    ARG.forEach(a => t.ok(`Dockerfile khai ARG ${a}`, new RegExp(`^ARG\\s+${a}\\b`, 'm').test(df), 'thiếu ARG'));
    BIEN.forEach((b, i) => t.ok(
      `Dockerfile nhúng ${b} bằng -ldflags -X (nhận từ ARG ${ARG[i]})`,
      df.includes(`-X ktx/internal/buildinfo.${b}=\${${ARG[i]}}`),
      'không thấy cờ -X cho biến này'));

    // Tên gói/biến trong Dockerfile phải TRÙNG mã Go, không thì -X ghi vào hư không mà build vẫn qua.
    const bi = doc('internal/buildinfo/buildinfo.go');
    BIEN.forEach(b => t.ok(`internal/buildinfo có biến ${b} để -X ghi vào`,
      new RegExp(`\\b${b}\\s+string`).test(bi), 'biến không tồn tại hoặc đã đổi tên'));

    const wf = {
      'deploy.yml (đẩy commit lên main)': doc('.github/workflows/deploy.yml'),
      'release-image.yml (đẩy tag vNN)': doc('.github/workflows/release-image.yml'),
    };
    Object.entries(wf).forEach(([ten, y]) => {
      t.ok(`${ten}: có khối build-args`, /build-args:/.test(y), 'không truyền build-arg nào');
      ARG.forEach(a => t.ok(`${ten}: truyền ${a}`, new RegExp(`^\\s*${a}=`, 'm').test(y), 'thiếu'));
      t.ok(`${ten}: COMMIT lấy từ github.sha`, /COMMIT=\$\{\{\s*github\.sha\s*\}\}/.test(y), 'không phải github.sha');
    });

    // Tag phát hành phải là tag thật, không phải nhãn theo nhánh.
    t.ok('release-image.yml: VERSION lấy từ TAG vừa đẩy',
      /VERSION=\$\{\{\s*steps\.img\.outputs\.tag\s*\}\}/.test(wf['release-image.yml (đẩy tag vNN)']),
      'VERSION không lấy từ tag');

    // Route phải để ngỏ như /api/health, không thì kiểm từ ngoài không được.
    const router = doc('internal/httpx/router.go');
    const dong = (router.match(/^.*api\.GET\("\/version".*$/m) || [''])[0];
    t.ok('router khai /api/version', !!dong.trim(), 'chưa khai route');
    t.ok('… và KHÔNG gắn RequireAuth (phải gọi được từ ngoài)', !/RequireAuth/.test(dong), dong.trim());
  },
};
