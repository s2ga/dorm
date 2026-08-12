// Màn Hồ sơ lưu trữ: ô nào CÓ giấy tờ phải là đường mở tệp bấm được, và bấm ra đúng tệp
// (máy chủ trả 200 kèm Content-Type ảnh/PDF, Content-Disposition inline để xem thẳng trong tab).
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));

  await page.goto('/ho-so');
  await page.waitForTimeout(3000);

  const bang = page.locator('.card-tbl table');
  ok('Màn Hồ sơ lưu trữ có bảng', await bang.count() > 0);

  const link = page.locator('.card-tbl a.tep-mo');
  const soLink = await link.count();
  ok('Có ít nhất một ô giấy tờ là đường mở tệp', soLink > 0, 'đếm được ' + soLink);
  if (!soLink) {
    ok('Bỏ qua phần còn lại', false, 'không có hồ sơ nào đã nộp giấy tờ trong CSDL này');
    await ctx.close(); await browser.close(); process.exit(1);
  }

  ok('Đường mở tệp trỏ đúng endpoint có kiểm quyền',
    (await link.first().getAttribute('href') || '').match(/^\/api\/students\/\d+\/(contract-scan|cccd\/(front|back))$/) !== null,
    await link.first().getAttribute('href'));
  ok('Mở ở tab mới, có rel=noopener',
    await link.first().getAttribute('target') === '_blank'
    && /noopener/.test(await link.first().getAttribute('rel') || ''));
  ok('Chip nói rõ là bấm được (chữ "Xem")', /Xem/.test(await link.first().textContent() || ''),
    await link.first().textContent());

  // Bấm THẬT: mọi đường trong bảng phải trả tệp, không phải 404/HTML lỗi.
  const hrefs = await link.evaluateAll(a => a.map(x => x.getAttribute('href')));
  const xau = [];
  for (const h of hrefs) {
    const r = await ctx.request.get(h);
    const ct = r.headers()['content-type'] || '';
    if (r.status() !== 200 || !/^(image\/|application\/pdf)/.test(ct)) xau.push(h + ' → ' + r.status() + ' ' + ct);
  }
  ok(`Cả ${hrefs.length} đường đều trả đúng tệp (200 + ảnh/PDF)`, xau.length === 0, xau.slice(0, 3).join(' | '));

  const r0 = await ctx.request.get(hrefs[0]);
  ok('Tệp mở thẳng trong tab (inline), không ép tải về',
    /inline/.test(r0.headers()['content-disposition'] || ''), r0.headers()['content-disposition']);

  // Ô TRỐNG thì không được là đường bấm — bấm vào chỗ chưa nộp gì mà ra 404 là tệ hơn không cho bấm.
  const trong = page.locator('.card-tbl td .badge.gray');
  ok('Ô chưa có giấy tờ không phải đường bấm',
    await trong.count() === 0 || await page.locator('.card-tbl td a.badge.gray').count() === 0);

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Hồ sơ lưu trữ: bấm mở tệp chạy đúng');
  process.exit(fail ? 1 : 0);
})();
