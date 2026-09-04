// Màn đăng nhập: khi SSO bật chỉ hiện nút Microsoft, form tài khoản BQL cấp GIẤU sau dòng "Chưa có tài khoản
// Microsoft?"; SSO tắt thì form hiện như cũ. Giả lập cả hai nhánh bằng cách chặn /api/auth/sso/config.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();

  // ── Nhánh SSO BẬT ────────────────────────────────────────────────────────────────
  let ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
  let page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));
  await page.route('**/api/auth/sso/config**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":true}' }));
  await page.goto('/');
  await page.waitForTimeout(1800);

  ok('SSO bật: nút Microsoft hiện', await page.locator('[data-act="ssoLogin"]').isVisible());
  ok('SSO bật: form tài khoản/mật khẩu GIẤU', !(await page.locator('#loginForm').isVisible()));
  ok('SSO bật: không còn chữ "hoặc" giữa hai phương thức', (await page.locator('.auth-form').textContent() || '').indexOf('hoặc') === -1);
  const alt = page.locator('#lgAlt');
  ok('Có dòng "Chưa có tài khoản Microsoft?" để mở form tài khoản BQL cấp', await alt.isVisible()
    && /Chưa có tài khoản Microsoft/.test(await alt.textContent() || ''));
  await alt.click();
  await page.waitForTimeout(400);
  ok('Bấm dòng đó → form tài khoản BQL cấp hiện', await page.locator('#loginForm').isVisible());
  ok('Con trỏ nhảy vào ô Tài khoản', await page.evaluate(() => document.activeElement && document.activeElement.id === 'lg_user'));
  ok('Dòng mở form tự ẩn sau khi mở', !(await alt.isVisible()));
  ok('Nút Microsoft vẫn còn để ai lỡ mở form vẫn quay lại được', await page.locator('[data-act="ssoLogin"]').isVisible());
  await ctx.close();

  // ── Nhánh SSO TẮT ────────────────────────────────────────────────────────────────
  ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
  page = await ctx.newPage();
  page.on('pageerror', e => loi.push(String(e)));
  await page.route('**/api/auth/sso/config**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' }));
  await page.goto('/');
  await page.waitForTimeout(1800);
  ok('SSO tắt: form tài khoản BQL cấp hiện ngay', await page.locator('#loginForm').isVisible());
  ok('SSO tắt: không hiện nút Microsoft', !(await page.locator('[data-act="ssoLogin"]').isVisible()));
  ok('SSO tắt: con trỏ ở ô Tài khoản', await page.evaluate(() => document.activeElement && document.activeElement.id === 'lg_user'));
  await ctx.close();

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Màn đăng nhập một phương thức chạy đúng');
  process.exit(fail ? 1 : 0);
})();
