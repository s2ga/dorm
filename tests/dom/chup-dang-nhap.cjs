// Chụp màn đăng nhập (SSO bật) khổ máy tính để xem bố cục — không khẳng định gì, chỉ xuất ảnh.
const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const OUT = process.env.SHOT_OUT || '/work/tests/dom/_shot-dang-nhap.png';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route('**/api/auth/sso/config**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":true}' }));
  await page.goto('/');
  await page.waitForTimeout(2200);
  await page.screenshot({ path: OUT, fullPage: false });
  console.log('đã chụp ' + OUT);
  await browser.close();
})();
