// Chọn tệp ở thẻ chi tiết học viên thì phải LƯU ngay, không cần bấm Sửa.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
const SID = process.env.SID;
if (!PASS || !SID) { console.error('Thiếu TEST_ADMIN_PASS / SID.'); process.exit(2); }

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));
  const goi = [];
  page.on('request', r => { if (/contract-scan/.test(r.url())) goi.push(r.method() + ' ' + r.url()); });

  await page.goto('/hoc-vien');
  await page.waitForTimeout(2600);
  await page.evaluate(id => studentDetail(+id), SID);
  await page.waitForTimeout(2200);

  const inp = page.locator('#hd_scan');
  ok('Thẻ chi tiết có ô chọn tệp scan HĐ', await inp.count() > 0);
  if (await inp.count()) {
    await inp.setInputFiles({ name: 'hd.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForTimeout(2500);
    ok('Chọn tệp là GỬI LÊN ngay, không cần bấm Sửa', goi.length > 0, 'không thấy request nào tới contract-scan');
  }
  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Đính kèm HĐ ở thẻ chi tiết chạy đúng');
  process.exit(fail ? 1 : 0);
})();
