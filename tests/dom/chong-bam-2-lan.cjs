// Test giao diện (Playwright), KHÔNG ghi dữ liệu: gọi hai lần liền một hàm ghi (máy chủ trả chậm) thì chỉ được đi
// MỘT request. Kiểm ở hai hàm hậu quả kép: gửi email nhà trường, cấp lại mật khẩu học viên.
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
  page.on('dialog', d => d.accept());
  const daGui = [];
  await page.route('**/api/**', async route => {
    const m = route.request().method();
    if (m === 'GET') return route.continue();
    daGui.push(m + ' ' + new URL(route.request().url()).pathname);
    await new Promise(r => setTimeout(r, 800));   // máy chủ chậm: cú bấm thứ hai tới khi cú đầu chưa xong
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"mail":{"sent":true}}' });
  });
  await page.goto('/vi-pham'); await page.waitForTimeout(2500);
  const id = await page.evaluate(() => (ST.students.find(s => !s.deleted_at) || {}).id);

  const haiLan = async (ten, goi) => {
    daGui.length = 0;
    await page.evaluate(goi, id);
    const soHop = await page.waitForSelector('.xn-hop', { timeout: 1500 }).then(() => page.$$eval('.xn-hop', h => h.length)).catch(() => 0);
    if (soHop) await page.click('.xn-hop [data-xn="1"]');
    await page.waitForTimeout(2000);
    ok(`${ten}: gọi hai lần liền → chỉ một request`, daGui.length === 1, daGui.join(', ') || 'không có request nào');
    return soHop;
  };
  const soHop = await haiLan('Gửi email nhà trường', i => { Promise.all([notifySchool(i), notifySchool(i)]); });
  ok('Gửi email nhà trường: gọi hai lần liền → chỉ hiện một hộp hỏi', soHop <= 1, 'số hộp: ' + soHop);
  await haiLan('Cấp lại mật khẩu học viên', i => {
    window._stuAccCache = [{ id: 987654322, student_id: i, username: 'kiem-thu' }];
    return Promise.all([doStuAccPw(987654322), doStuAccPw(987654322)]).catch(() => {});
  });
  await page.evaluate(() => closeModalNgay());
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));

  await browser.close();
  console.log(`\n  Chống bấm 2 lần: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
