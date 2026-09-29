// GET /api/version — biết ngay bản dựng nào đang chạy (tag + commit ghi lúc build bằng -ldflags).
// Phải gọi được KHÔNG cần đăng nhập, cùng lý do với /api/health: kiểm từ ngoài (staging, UAT) khi
// chưa có tài khoản hoặc app đang hỏng. Kèm asset_version = số ?v= của giao diện đang được phục vụ.
const fs = require('fs');
const { BASE } = require('../lib/harness');

module.exports = {
  name: 'API phiên bản bản dựng (/api/version)',
  needsServer: true,

  async run(t) {
    const r = await t.api('GET', '/api/version', null);
    t.eq('TC-1 · gọi KHÔNG đăng nhập → 200', r.status, 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);

    const v = r.json || {};
    t.ok('TC-2 · có đủ 4 khoá: version, commit, built_at, nguon',
      ['version', 'commit', 'built_at', 'nguon'].every(k => k in v), JSON.stringify(v));
    t.ok('TC-3 · version là chuỗi không rỗng', typeof v.version === 'string' && v.version.length > 0, JSON.stringify(v.version));
    // Bản dựng không truyền tham số thì commit là chữ "khong-ro" — giữ nguyên, không cắt cho khó hiểu.
    t.ok('TC-4 · commit_short là 7 ký tự đầu của commit',
      typeof v.commit === 'string' &&
      v.commit_short === (v.commit.length > 7 && v.commit !== 'khong-ro' ? v.commit.slice(0, 7) : v.commit),
      `commit=${v.commit} short=${v.commit_short}`);
    t.ok('TC-5 · nguon nói rõ lấy từ đâu (ldflags | env | khong-ro)',
      ['ldflags', 'env', 'khong-ro'].includes(v.nguon), JSON.stringify(v.nguon));

    // asset_version phải khớp ?v= trong index.html ĐANG ĐƯỢC PHỤC VỤ — đây mới là thứ trả lời được
    // câu "staging đang chạy bản nào", vì giao diện cũ kẹt lại thì số này không nhúc nhích.
    const html = await fetch(BASE + '/index.html').then(x => x.text()).catch(() => '');
    const tuTrang = String(html).match(/\?v=(\d+)/);
    if (tuTrang) {
      t.eq('TC-6 · asset_version khớp ?v= trong index.html máy chủ đang phục vụ', v.asset_version, tuTrang[1],
        `api=${v.asset_version} · index.html=${tuTrang[1]}`);
    }
    const tuDia = String(fs.readFileSync('public/index.html', 'utf8')).match(/\?v=(\d+)/);
    if (tuDia) {
      t.eq('TC-7 · … và khớp luôn mã nguồn trong repo', v.asset_version, tuDia[1],
        `api=${v.asset_version} · repo=${tuDia[1]}`);
    }

    // Không được lộ gì ngoài thông tin bản dựng: endpoint này để ngỏ nên phải đếm đúng số khoá.
    const choPhep = ['version', 'commit', 'commit_short', 'built_at', 'nguon', 'asset_version', 'app_env'];
    const thua = Object.keys(v).filter(k => !choPhep.includes(k));
    t.ok('TC-8 · không trả thêm khoá nào ngoài danh sách cho phép', thua.length === 0, `thừa: ${thua.join(', ')}`);
  },
};
