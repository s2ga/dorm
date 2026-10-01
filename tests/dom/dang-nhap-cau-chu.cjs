// Test giao diện (Playwright), CHỈ ĐỌC, không đăng nhập: màn đăng nhập có dòng hướng dẫn quên mật khẩu, và lỗi
// Microsoft (mã AADSTS…, tiếng Anh) truyền về qua ?sso_error hiện thành câu tiếng Việt kèm mã gốc.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? ' -- ' + extra : '')); }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const loiJs = [];
  page.on('pageerror', e => loiJs.push(String(e)));

  const raw = 'AADSTS50020: User account from identity provider does not exist in tenant.';
  await page.goto('/?sso_error=' + encodeURIComponent(raw));
  await page.waitForSelector('#loginForm', { state: 'attached', timeout: 20000 });
  const tb = await page.evaluate(() => (document.getElementById('lgNotice') || {}).textContent || '');
  ok('Lỗi AADSTS hiện thành câu tiếng Việt', /không thuộc tổ chức/.test(tb) && !/User account/.test(tb), tb);
  ok('… kèm mã gốc để tra cứu', tb.includes('AADSTS50020'), tb);
  const quen = await page.evaluate(() => (document.getElementById('loginForm') || {}).textContent || '');
  ok('Form đăng nhập có dòng "Quên mật khẩu? Liên hệ Ban Quản lý"', /Quên mật khẩu\? Liên hệ Ban Quản lý/.test(quen), quen.slice(0, 120));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));

  await browser.close();
  console.log(`\n  Đăng nhập — câu chữ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
