// Màn Học viên có cột "Ngày vào" (kèm dòng "trả dd/mm" khi có), nhấp tiêu đề sắp xếp được theo ngày.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));

  await page.goto('/hoc-vien');
  await page.waitForTimeout(2800);

  const th = page.locator('th[data-sort="checkin"]');
  ok('Có cột "Ngày vào" trong tiêu đề', await th.count() === 1);
  ok('Cột nằm ngay sau Trạng thái', /Trạng thái.*Ngày vào.*Mã pháp nhân/s.test(await page.locator('thead').first().textContent() || ''));

  const oNgay = page.locator('td[data-label="Ngày vào"]');
  ok('Mỗi hàng có ô Ngày vào', await oNgay.count() > 0);
  ok('Ô đầu có ngày dạng dd/mm/yyyy hoặc —', /(\d{2}\/\d{2}\/\d{4}|—)/.test(await oNgay.first().textContent() || ''),
    await oNgay.first().textContent());

  const coTra = await page.evaluate(() => ST.students.some(s => !s.deleted_at && s.check_out_date));
  if (coTra) {
    ok('Người có ngày trả → hiện dòng "trả dd/mm/yyyy"',
      await page.locator('td[data-label="Ngày vào"] .sub2', { hasText: 'trả' }).count() > 0);
  } else console.log('  [BỎ QUA] CSDL không có ai có ngày trả');

  // Nhấp tiêu đề: sắp theo ngày vào tăng dần, nhấp lần hai đảo chiều
  await th.click();
  await page.waitForTimeout(1200);
  const lay = async () => page.evaluate(() =>
    [...document.querySelectorAll('td[data-label="Ngày vào"]')].map(td => {
      const m = td.textContent.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      return m ? m[3] + m[2] + m[1] : '';
    }).filter(Boolean));
  const tang = await lay();
  ok('Nhấp 1: ngày tăng dần', tang.every((v, i) => !i || tang[i - 1] <= v), tang.slice(0, 5).join(','));
  await page.locator('th[data-sort="checkin"]').click();
  await page.waitForTimeout(1200);
  const giam = await lay();
  ok('Nhấp 2: đảo chiều giảm dần', giam.every((v, i) => !i || giam[i - 1] >= v), giam.slice(0, 5).join(','));

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Cột Ngày vào chạy đúng');
  process.exit(fail ? 1 : 0);
})();
