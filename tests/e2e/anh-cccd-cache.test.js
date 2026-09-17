// QA-014 + QA-050: sau khi thay ảnh CCCD/scan HĐ, mọi màn phải thấy ảnh MỚI ngay (không cache 5 phút),
// và sau mỗi lần phát hành trình duyệt phải nạp vỏ app mới, còn tệp gắn ?v= thì được giữ lâu.
const { BASE } = require('../lib/harness');
const P = '__test_anhcache';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const khac = s => 'data:image/png;base64,' +
  Buffer.concat([Buffer.from(PNG.split(',')[1], 'base64'), Buffer.from(s)]).toString('base64');

const clean = db => db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);

module.exports = {
  name: 'Ảnh CCCD và vỏ app không dùng bản cũ',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    // ── Vỏ app và tệp tĩnh (không cần đăng nhập) ────────────────────────────────────────
    const hdr = async (duong, h = {}) => {
      const r = await fetch(BASE + duong, { headers: h });
      await r.arrayBuffer();
      return { status: r.status, cc: r.headers.get('cache-control') || '', ct: r.headers.get('content-type') || '', etag: r.headers.get('etag') };
    };
    const goc = await hdr('/');
    t.ok('Vỏ app "/" → no-cache', /no-cache/.test(goc.cc), `Cache-Control: ${goc.cc}`);
    const spa = await hdr('/dang-ky');
    t.ok('Đường SPA "/dang-ky" → no-cache', /no-cache/.test(spa.cc), `Cache-Control: ${spa.cc}`);
    const sw = await hdr('/sw.js');
    t.ok('/sw.js → no-cache', /no-cache/.test(sw.cc) && !/immutable/.test(sw.cc), `Cache-Control: ${sw.cc}`);
    const idx = await fetch(BASE + '/index.html', { redirect: 'manual' });
    const idxThan = await idx.text();
    t.eq('/index.html trả thẳng vỏ app (200), không chuyển hướng — service worker cache bản này để mở khi mất mạng',
      idx.status, 200, `HTTP ${idx.status} · Location: ${idx.headers.get('location')}`);
    t.ok('/index.html → no-cache', /no-cache/.test(idx.headers.get('cache-control') || ''), idx.headers.get('cache-control'));
    const v = (idxThan.match(/\?v=(\d+)/) || [])[1];
    t.ok('Vỏ app có số phiên bản ?v=', !!v, String(v));
    // Số ?v= không chắc đổi theo từng lần sửa JS/CSS -> JS/CSS KHÔNG được giữ lâu, phải hỏi lại máy chủ.
    const js = await hdr(`/js/api.js?v=${v}`);
    t.ok('Tệp JS gắn ?v= → no-cache, không immutable', /no-cache/.test(js.cc) && !/immutable/.test(js.cc), `Cache-Control: ${js.cc}`);
    const css = await hdr(`/css/styles.css?v=${v}`);
    t.ok('Tệp CSS gắn ?v= → no-cache, không immutable', /no-cache/.test(css.cc) && !/immutable/.test(css.cc), `Cache-Control: ${css.cc}`);
    const lm = (await fetch(BASE + `/js/api.js?v=${v}`)).headers.get('last-modified');
    const js304 = await hdr(`/js/api.js?v=${v}`, lm ? { 'If-Modified-Since': lm } : {});
    t.eq('JS chưa đổi → hỏi lại chỉ nhận 304 (không tải lại)', js304.status, 304, `HTTP ${js304.status} · Last-Modified: ${lm}`);
    const vendor = await hdr(`/vendor/plate/ort.wasm.min.js?v=${v}`);
    t.ok('Bộ đọc biển số gắn ?v= → giữ lâu (immutable)', vendor.status === 200 && /immutable/.test(vendor.cc), `HTTP ${vendor.status} · Cache-Control: ${vendor.cc}`);
    const thieu = await hdr(`/vendor/plate/khong-ton-tai.js?v=${v}`);
    t.ok('Tệp không tồn tại gắn ?v= → KHÔNG được giữ lâu (không khoá nhầm vỏ HTML vào cache)',
      !/immutable/.test(thieu.cc), `HTTP ${thieu.status} · ${thieu.ct} · Cache-Control: ${thieu.cc}`);

    // ── Ảnh CCCD ──────────────────────────────────────────────────────────────────────
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const sid = (await t.db.query(`INSERT INTO students (name, gender) VALUES ($1,'male') RETURNING id`, [P + ' An'])).rows[0].id;
    try {
      const len = await t.api('PUT', `/api/students/${sid}`, T, { cccd_front: khac('lan-1') });
      t.eq('Tải ảnh CCCD → 200', len.status, 200, `HTTP ${len.status}`);
      const key = (await t.db.query('SELECT cccd_front FROM students WHERE id=$1', [sid])).rows[0].cccd_front;
      if (!key) { t.ok('S3 chưa cấu hình — bỏ qua phần ảnh', true, 'không có kho ảnh'); return; }

      const auth = { Authorization: 'Bearer ' + T };
      const a1 = await hdr(`/api/students/${sid}/cccd/front`, auth);
      t.eq('Mở ảnh → 200', a1.status, 200, `HTTP ${a1.status}`);
      t.ok('Ảnh CCCD → private, no-cache (không được giữ 5 phút)', /no-cache/.test(a1.cc) && /private/.test(a1.cc) && !/max-age=300/.test(a1.cc), `Cache-Control: ${a1.cc}`);
      t.ok('Ảnh CCCD có ETag', !!a1.etag, String(a1.etag));
      const a304 = await hdr(`/api/students/${sid}/cccd/front`, { ...auth, 'If-None-Match': a1.etag });
      t.eq('Hỏi lại với ETag cũ khi ảnh chưa đổi → 304', a304.status, 304, `HTTP ${a304.status}`);

      const hs1 = await t.api('GET', `/api/students/${sid}`, T);
      t.ok('Hồ sơ trả URL ảnh kèm phiên bản ?v=', /\/cccd\/front\?v=\S+$/.test(hs1.json.cccd_front || ''), hs1.json.cccd_front);

      const thay = await t.api('PUT', `/api/students/${sid}`, T, { cccd_front: khac('lan-2-khac-han') });
      t.eq('Thay ảnh khác → 200', thay.status, 200, `HTTP ${thay.status}`);
      const a2 = await hdr(`/api/students/${sid}/cccd/front`, { ...auth, 'If-None-Match': a1.etag });
      t.eq('Hỏi lại với ETag cũ sau khi thay ảnh → 200 (nhận ảnh mới)', a2.status, 200, `HTTP ${a2.status}`);
      t.ok('ETag đổi theo ảnh mới', !!a2.etag && a2.etag !== a1.etag, `${a1.etag} → ${a2.etag}`);
      const hs2 = await t.api('GET', `/api/students/${sid}`, T);
      t.ok('URL ảnh trong hồ sơ đổi sau khi thay ảnh', hs2.json.cccd_front && hs2.json.cccd_front !== hs1.json.cccd_front,
        `${hs1.json.cccd_front} → ${hs2.json.cccd_front}`);
      const wEtag = await hdr(`/api/students/${sid}/cccd/front`, { ...auth, 'If-None-Match': `"khac", W/${a2.etag}` });
      t.eq('If-None-Match nhiều giá trị, dạng W/ vẫn khớp → 304', wEtag.status, 304, `HTTP ${wEtag.status}`);

      // ── Scan hợp đồng: cùng luật ───────────────────────────────────────────────────
      const nop = await t.api('POST', `/api/students/${sid}/contract-scan`, T, { data: khac('scan-1') });
      t.eq('Nộp scan HĐ → 200', nop.status, 200, `HTTP ${nop.status}`);
      const s1 = await hdr(`/api/students/${sid}/contract-scan`, auth);
      t.ok('Scan HĐ → private, no-cache + ETag', /no-cache/.test(s1.cc) && !!s1.etag, `Cache-Control: ${s1.cc} · ETag: ${s1.etag}`);
      const s304 = await hdr(`/api/students/${sid}/contract-scan`, { ...auth, 'If-None-Match': s1.etag });
      t.eq('Scan HĐ chưa đổi → 304', s304.status, 304, `HTTP ${s304.status}`);
      await t.api('POST', `/api/students/${sid}/contract-scan`, T, { data: khac('scan-2-khac') });
      const s2 = await hdr(`/api/students/${sid}/contract-scan`, { ...auth, 'If-None-Match': s1.etag });
      t.eq('Scan HĐ đã thay → 200', s2.status, 200, `HTTP ${s2.status}`);
    } finally {
      await t.api('PUT', `/api/students/${sid}`, T, { cccd_front: '' });
      await t.api('DELETE', `/api/students/${sid}/contract-scan`, T);
      await clean(t.db);
    }
  },
};
