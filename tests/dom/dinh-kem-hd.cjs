// Thẻ chi tiết học viên CHỈ ĐỂ XEM: không có ô chọn tệp nào. Muốn nộp/thay giấy tờ phải vào form Sửa.
// (Trước đây ô chọn tệp nằm ngay thẻ chi tiết, chọn nhầm là ghi đè luôn — đã có ca dính biên lai
// chuyển khoản vào ô hợp đồng.)
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
  page.on('request', r => { if (/contract-scan|\/cccd\//.test(r.url()) && r.method() !== 'GET') goi.push(r.method() + ' ' + r.url()); });

  await page.goto('/hoc-vien');
  await page.waitForTimeout(2600);
  await page.evaluate(id => studentDetail(+id), SID);
  await page.waitForTimeout(2200);

  const oTep = page.locator('#modal input[type=file]');
  ok('Thẻ chi tiết KHÔNG còn ô chọn tệp nào', await oTep.count() === 0,
    'còn ' + await oTep.count() + ' ô');
  ok('Thẻ chi tiết chỉ ra nút "Sửa hồ sơ" để nộp giấy tờ',
    await page.locator('#modal [data-act="studentForm"]').count() > 0);
  ok('Không có request ghi giấy tờ nào tự phát', goi.length === 0, goi.join(' | '));

  await page.evaluate(id => studentForm(+id), SID);
  await page.waitForTimeout(2200);
  const inp = page.locator('#hd_scan_form');
  ok('Form Sửa MỚI có ô chọn tệp scan HĐ', await inp.count() > 0);
  if (await inp.count()) {
    ok('Ô chọn tệp chỉ nhận PDF/PNG/JPG',
      /application\/pdf/.test(await inp.getAttribute('accept') || '')
      && !/image\/\*/.test(await inp.getAttribute('accept') || ''),
      await inp.getAttribute('accept'));
    await inp.setInputFiles({ name: 'hd.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForTimeout(2500);
    ok('Chọn tệp trong form là GỬI LÊN ngay', goi.length > 0, 'không thấy request nào tới contract-scan');
  }
  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Đính kèm HĐ: thẻ chi tiết chỉ xem, form Sửa mới nộp được');
  process.exit(fail ? 1 : 0);
})();
