// Trần tệp 25MB: PDF/PNG/JPG trong mức thì lưu được; quá cỡ hoặc sai loại thì báo NẰM LẠI cạnh ô.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
const SID = process.env.SID;
if (!PASS || !SID) { console.error('Thiếu TEST_ADMIN_PASS / SID.'); process.exit(2); }

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// PNG hợp lệ nhưng nhồi thêm cho nặng ~20MB (chunk tEXt sau IEND vẫn giữ chữ ký PNG ở đầu)
const PNG20 = Buffer.concat([PNG1, Buffer.alloc(20 * 1024 * 1024, 0x41)]);
const PNG30 = Buffer.concat([PNG1, Buffer.alloc(30 * 1024 * 1024, 0x41)]);

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
  page.on('response', r => { if (/contract-scan/.test(r.url())) goi.push(r.status()); });

  const mo = async () => {
    await page.goto('/hoc-vien'); await page.waitForTimeout(2500);
    await page.evaluate(id => studentDetail(+id), SID);
    await page.waitForTimeout(2000);
  };

  await mo();
  goi.length = 0;
  await page.locator('#hd_scan').setInputFiles({ name: 'to.png', mimeType: 'image/png', buffer: PNG30 });
  await page.waitForTimeout(900);
  ok('Tệp 30MB → báo lỗi NẰM LẠI cạnh ô, không gửi lên',
    await page.locator('.tep-loi').count() > 0 && goi.length === 0,
    'lỗi hiện=' + await page.locator('.tep-loi').count() + ' · request=' + goi.length);
  const chu = await page.locator('.tep-loi').first().textContent();
  ok('Câu báo nói rõ cỡ tệp và mức cho phép', /30\.0MB/.test(chu) && /25MB/.test(chu), chu);

  await mo();
  await page.locator('#hd_scan').setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.waitForTimeout(900);
  ok('Sai định dạng → báo rõ chỉ nhận PDF/PNG/JPG',
    /PDF/.test(await page.locator('.tep-loi').first().textContent() || ''), await page.locator('.tep-loi').first().textContent());

  await mo();
  goi.length = 0;
  await page.locator('#hd_scan').setInputFiles({ name: 'ok.png', mimeType: 'image/png', buffer: PNG20 });
  await page.waitForTimeout(9000);
  ok('Tệp 20MB (trong mức) → GỬI LÊN và máy chủ nhận', goi.length > 0 && goi[0] === 200,
    'phản hồi = ' + JSON.stringify(goi));

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Trần tệp 25MB chạy đúng');
  process.exit(fail ? 1 : 0);
})();
