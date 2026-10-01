// Test giao diện (Playwright), CHỈ ĐỌC: tiêu đề tab trình duyệt theo màn đang mở; thông báo nhanh (toast) có nút tắt,
// có role cho trình đọc màn hình, và thông báo lỗi ở lại đủ lâu để đọc (trước đây mọi toast tắt sau 2,8 giây).
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const USER = process.env.TEST_ADMIN_USER || 'admin';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS (đặt qua biến môi trường).'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? ' -- ' + extra : '')); }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [];
  page.on('pageerror', e => loiJs.push(String(e)));

  await page.goto('/phong'); await page.waitForTimeout(2500);
  ok('Tiêu đề tab theo màn Phòng', (await page.title()) === 'Phòng · Nội trú Esuhai', await page.title());
  await page.goto('/tien-phong'); await page.waitForTimeout(2500);
  ok('Tiêu đề tab theo màn Tiền phòng', (await page.title()) === 'Tiền phòng · Nội trú Esuhai', await page.title());

  await page.evaluate(() => toast('Lỗi thử nghiệm: không lưu được', 'err'));
  const t = await page.evaluate(() => { const x = document.getElementById('toast'); return { role: x.getAttribute('role'), nut: !!x.querySelector('.toast-x'), live: x.getAttribute('aria-live') }; });
  ok('Toast lỗi có role="alert" và vùng aria-live', t.role === 'alert' && t.live === 'polite', JSON.stringify(t));
  ok('Toast có nút × để tắt', t.nut);
  await page.waitForTimeout(3500);
  ok('Toast lỗi vẫn hiện sau 3,5 giây (đủ thời gian đọc)', await page.evaluate(() => document.getElementById('toast').classList.contains('show')));
  await page.click('#toast .toast-x');
  ok('Bấm × → toast tắt ngay', !(await page.evaluate(() => document.getElementById('toast').classList.contains('show'))));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));

  await browser.close();
  console.log(`\n  Mẫu câu chung: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
