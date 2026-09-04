// Kéo giãn cột phải THẤY và KÉO ĐƯỢC ở mọi màn có bảng, và nhớ độ rộng sau khi tải lại.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const USER = process.env.TEST_ADMIN_USER || 'admin';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

const MAN = [['/hoc-vien', 'Học viên'], ['/phong', 'Phòng'], ['/tien-phong', 'Tiền phòng'],
  ['/ho-so', 'Hồ sơ lưu trữ'], ['/dich-vu', 'Dịch vụ']];

let fail = 0;
const ok = (ten, dk, them = '') => {
  if (dk) console.log('  [OK] ' + ten);
  else { fail++; console.log('  [FAIL] ' + ten + (them ? ' -- ' + them : '')); }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  if (!lr.ok()) { console.log('  [FAIL] đăng nhập ' + lr.status()); await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJS = [];
  page.on('pageerror', e => loiJS.push(String(e)));

  for (const [duong, ten] of MAN) {
    await page.goto(duong);
    await page.waitForTimeout(2600);
    const soBang = await page.locator('.table-wrap table').count();
    if (!soBang) { console.log(`  [BỎ QUA] ${ten} — màn này không có bảng`); continue; }
    const tay = await page.locator('.table-wrap table .rz-handle').count();
    ok(`${ten}: bảng có thanh kéo cột`, tay > 0, `${soBang} bảng, ${tay} thanh kéo`);
    const hien = await page.locator('.table-wrap table .rz-handle').first()
      .evaluate(e => getComputedStyle(e, '::after').backgroundColor);
    ok(`${ten}: thanh kéo THẤY ĐƯỢC khi chưa rê chuột`,
      hien && hien !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(hien), 'màu = ' + hien);
  }

  // Kéo thật một cột ở màn Học viên rồi kiểm độ rộng đổi và được nhớ lại
  await page.goto('/hoc-vien');
  await page.waitForTimeout(2600);
  const th = page.locator('.table-wrap table thead th').first();
  const truoc = (await th.boundingBox()).width;
  const hbox = await page.locator('.table-wrap table .rz-handle').first().boundingBox();
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hbox.x + hbox.width / 2 + 90, hbox.y + hbox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const sau = (await th.boundingBox()).width;
  ok('Kéo thật thì cột rộng ra', sau > truoc + 40, `${Math.round(truoc)}px -> ${Math.round(sau)}px`);

  await page.reload();
  await page.waitForTimeout(2800);
  const sauTai = (await page.locator('.table-wrap table thead th').first().boundingBox()).width;
  ok('Tải lại trang vẫn nhớ độ rộng đã kéo', Math.abs(sauTai - sau) < 12,
    `${Math.round(sau)}px -> ${Math.round(sauTai)}px`);

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));
  await ctx.close();
  await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Kéo giãn cột chạy đúng trên mọi màn có bảng');
  process.exit(fail ? 1 : 0);
})();
