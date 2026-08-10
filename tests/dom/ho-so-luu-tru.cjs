// Bấm menu "Hồ sơ lưu trữ" phải RA MÀN, không im lặng chết. READ-ONLY.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const USER = process.env.TEST_ADMIN_USER || 'admin';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (ten, dk, them = '') => {
  if (dk) console.log('  [OK] ' + ten);
  else { fail++; console.log('  [FAIL] ' + ten + (them ? ' -- ' + them : '')); }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }

  const page = await ctx.newPage();
  const loiJS = [];
  page.on('pageerror', e => loiJS.push(String(e)));
  await page.goto('/');
  await page.waitForTimeout(2500);

  const nut = page.locator('#nav button[data-v="hoso"]');
  ok('Menu có mục Hồ sơ lưu trữ', await nut.count() > 0);
  if (await nut.count()) {
    // Menu bên có thể nằm ngoài khung nhìn — bắn click thẳng trên DOM, đúng đường người dùng đi.
    await page.evaluate(() => document.querySelector('#nav button[data-v="hoso"]').click());
    await page.waitForTimeout(1800);
  }

  const tieuDe = (await page.locator('#pgTitle').textContent() || '').trim();
  ok('Tiêu đề trang đổi sang Hồ sơ lưu trữ', tieuDe === 'Hồ sơ lưu trữ', 'đang là "' + tieuDe + '"');
  ok('Đường dẫn đổi sang /ho-so', new URL(page.url()).pathname === '/ho-so', page.url());

  const coBang = await page.locator('#content table').count();
  const coRong = await page.locator('#content .empty').count();
  ok('Vùng nội dung có bảng hoặc trạng thái rỗng — KHÔNG trắng trơn', coBang + coRong > 0,
    'html dài ' + ((await page.locator('#content').innerHTML()) || '').length + ' ký tự');
  ok('Có hàng pill lọc thiếu giấy tờ', await page.locator('[data-act="hsGo"]').count() >= 4);
  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Màn Hồ sơ lưu trữ mở được bình thường');
  process.exit(fail ? 1 : 0);
})();
