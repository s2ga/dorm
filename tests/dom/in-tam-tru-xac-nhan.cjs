// Test giao diện (Playwright), KHÔNG ghi dữ liệu: bấm In ở trang ảnh CCCD tạm trú phải HỎI LẠI trước khi chuyển
// hồ sơ sang "Đang xử lý". Hộp in bị huỷ / bấm "Để sau" thì không được gửi request nào. Request PUT bị chặn
// bằng page.route nên không hồ sơ thật nào bị đổi.
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
const ID_GIA = 987654321;
const tieuDe = page => page.evaluate(() => {
  const ov = document.getElementById('overlay');
  if (!ov || !ov.classList.contains('show')) return '';
  const h = document.querySelector('#modal .mh h3'); return h ? h.textContent.trim() : '';
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [];
  page.on('pageerror', e => loiJs.push(String(e)));

  const daGui = [];
  await page.route(`**/api/students/${ID_GIA}`, async route => {
    if (route.request().method() === 'PUT') daGui.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/'); await page.waitForTimeout(2500);
  await page.evaluate(id => {
    window.__soLanIn = 0;
    window.print = () => { window.__soLanIn++; };
    _tamTruDot = [{ id, name: 'Hồ sơ kiểm thử', residency_status: 'unregistered' }];
  }, ID_GIA);

  await page.evaluate(() => tamTruIn());
  await page.waitForTimeout(300);
  ok('Bấm In → mở hộp in của trình duyệt', await page.evaluate(() => window.__soLanIn) === 1);
  ok('In xong → hiện hộp hỏi "Đã in xong?"', /Đã in xong/.test(await tieuDe(page)), await tieuDe(page));
  ok('… chưa xác nhận thì CHƯA gửi request đổi tạm trú', daGui.length === 0, JSON.stringify(daGui));

  await page.click('#modal .mf [data-act="closeModal"]');
  await page.waitForTimeout(300);
  ok('Bấm "Để sau" → đóng hộp hỏi', (await tieuDe(page)) === '', await tieuDe(page));
  ok('… và không gửi request nào', daGui.length === 0, JSON.stringify(daGui));

  await page.evaluate(() => tamTruIn());
  await page.waitForTimeout(300);
  await page.click('#modal [data-act="tamTruXacNhanIn"]');
  for (let t = 0; t < 5000 && !daGui.length; t += 100) await page.waitForTimeout(100);
  ok('Bấm "Chuyển 1 hồ sơ" → gửi đúng một request', daGui.length === 1, JSON.stringify(daGui));
  ok('… đổi tạm trú sang "Đang xử lý"', daGui[0] && daGui[0].residency_status === 'processing', JSON.stringify(daGui[0]));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));

  await browser.close();
  console.log(`\n  In tạm trú — xác nhận: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
