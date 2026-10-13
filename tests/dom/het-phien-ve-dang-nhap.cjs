// Hết phiên đăng nhập thì mọi tab phải về màn đăng nhập, không kẹt ở khối "Không tải được dữ liệu".
// Dấu hiệu đăng nhập (ktx_user) nằm chung localStorage: tab A đăng xuất là tab B mất dấu nhưng vẫn đang mở app.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };
const coManDangNhap = async (page, ms = 6000) => {
  for (let t = 0; t < ms; t += 250) {
    try { if (await page.locator('#loginForm').count()) return true; } catch (e) { /* trang đang tải lại */ }
    await page.waitForTimeout(250);
  }
  return false;
};
const moMan = (page, view) => page.evaluate(v => { adminGo(v); }, view).catch(() => {});
const dangNhap = ctx => ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
  await dangNhap(ctx);
  const loi = [];
  const a = await ctx.newPage(), b = await ctx.newPage();
  [a, b].forEach(p => p.on('pageerror', e => loi.push(String(e))));

  await a.goto('/'); await b.goto('/');
  await a.waitForTimeout(2500); await b.waitForTimeout(2500);
  await moMan(b, 'reg');
  await b.waitForTimeout(1500);
  ok('Hai tab cùng vào được màn quản trị', await a.locator('#nav').count() > 0 && await b.locator('#nav').count() > 0);

  console.log('\n-- Tab A đăng xuất, tab B vẫn đang mở màn Đơn đăng ký');
  await a.evaluate(() => { Auth.logout(); }).catch(() => {});
  ok('Tab A về màn đăng nhập', await coManDangNhap(a));
  await moMan(b, 'reg');
  ok('Tab B tải lại màn → về màn đăng nhập, không kẹt ở "Không tải được dữ liệu"', await coManDangNhap(b),
    ((await b.locator('#content').textContent().catch(() => '')) || '').trim().slice(0, 80));

  console.log('\n-- Một tab, cookie hết hạn khi dấu đăng nhập vẫn còn');
  await dangNhap(ctx);
  await b.goto('/'); await b.waitForTimeout(2500);
  await ctx.clearCookies();
  await moMan(b, 'reg');
  ok('Về màn đăng nhập', await coManDangNhap(b));

  console.log('\n-- Ở màn đăng nhập, sai mật khẩu không được tải lại trang');
  await b.goto('/'); await b.waitForTimeout(1500);
  ok('Đang ở màn đăng nhập', await coManDangNhap(b));
  await b.evaluate(() => { window.__chuaTaiLai = 1; });
  const st = await b.evaluate(async () => { try { await API.login('khong-co-tai-khoan-nay', 'sai-mat-khau'); return 'ok'; } catch (e) { return e.status; } });
  await b.waitForTimeout(1200);
  ok('Sai mật khẩu trả lỗi 401 cho form tự báo', st === 401, String(st));
  ok('Trang không tự tải lại', await b.evaluate(() => window.__chuaTaiLai === 1).catch(() => false));

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Hết phiên là về màn đăng nhập');
  process.exit(fail ? 1 : 0);
})();
