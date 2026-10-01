// Test giao diện (Playwright), KHÔNG ghi dữ liệu: bỏ trống ô bắt buộc rồi bấm lưu → viền đỏ + dòng chữ dưới ô + con
// trỏ ở đúng ô; gõ lại là lỗi tự gỡ. Dấu bắt buộc một kiểu (* đỏ). Thử ở form Phòng, Đổi mật khẩu, Đăng ký công khai.
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
const loiO = (page, id) => page.evaluate(i => {
  const o = document.getElementById(i); if (!o) return null;
  const f = o.closest('.field') || o.parentElement, d = f.querySelector('.loi-o');
  return { coLoi: f.classList.contains('co-loi'), chu: d ? d.textContent : '', dangDung: document.activeElement === o };
}, id);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [], daGhi = [];
  page.on('pageerror', e => loiJs.push(String(e)));
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.continue();
    daGhi.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // ── Form Phòng mới ─────────────────────────────────────────────────────────
  await page.goto('/phong'); await page.waitForTimeout(2500);
  await page.evaluate(() => roomForm());
  await page.waitForSelector('#modal [data-act="saveRoom"]', { timeout: 10000 });
  ok('Nhãn ô bắt buộc dùng dấu * đỏ (span.sao)', await page.evaluate(() => !!el('f_name').closest('.field').querySelector('label .sao')));
  await page.fill('#f_name', '');
  await page.click('#modal [data-act="saveRoom"]');
  await page.waitForTimeout(300);
  let r = await loiO(page, 'f_name');
  ok('Phòng: bỏ trống tên → viền đỏ + "Nhập tên phòng" dưới ô + con trỏ ở ô', r && r.coLoi && r.chu === 'Nhập tên phòng' && r.dangDung, JSON.stringify(r));
  await page.type('#f_name', 'P');
  r = await loiO(page, 'f_name');
  ok('… gõ lại → lỗi tự gỡ', r && !r.coLoi && !r.chu, JSON.stringify(r));
  await page.evaluate(() => closeModalNgay()); await page.waitForTimeout(400);

  // ── Đổi mật khẩu ───────────────────────────────────────────────────────────
  await page.evaluate(() => changePwd());
  await page.waitForSelector('#cp_new', { timeout: 5000 });
  await page.fill('#cp_new', 'abcdef'); await page.fill('#cp_new2', 'abcxyz');
  await page.click('#modal [data-act="doChangePwd"]');
  await page.waitForTimeout(300);
  r = await loiO(page, 'cp_new2');
  ok('Đổi mật khẩu: nhập lại không khớp → báo tại ô "Nhập lại mật khẩu"', r && r.coLoi && r.chu === 'Nhập lại mật khẩu không khớp' && r.dangDung, JSON.stringify(r));
  await page.evaluate(() => closeModalNgay()); await page.waitForTimeout(400);

  // ── Đăng ký công khai (chưa đăng nhập) ────────────────────────────────────
  const khach = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 800 } });
  const p2 = await khach.newPage();
  p2.on('pageerror', e => loiJs.push(String(e)));
  await p2.route('**/api/**', route => route.request().method() === 'GET' ? route.continue()
    : (daGhi.push('khách ' + route.request().method()), route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })));
  await p2.goto('/dang-ky');
  await p2.waitForSelector('#applyForm', { timeout: 20000 });
  ok('Form đăng ký tắt bong bóng của trình duyệt (novalidate) — một kênh báo lỗi', await p2.evaluate(() => el('applyForm').noValidate));
  const nhan = await p2.evaluate(() => [...document.querySelectorAll('#applyForm label')].map(l => ({ t: l.textContent.trim(), sao: !!l.querySelector('.sao') })));
  ok('Form đăng ký: mọi dấu * đều là span.sao (không gõ tay), đủ 4 ô bắt buộc',
    nhan.every(x => !x.t.endsWith('*') || x.sao) && nhan.filter(x => x.sao).length >= 4, JSON.stringify(nhan.filter(x => x.t.includes('*'))));
  await p2.click('#applyForm [type=submit]'); await p2.waitForTimeout(300);
  r = await loiO(p2, 'a_name');
  ok('Đăng ký: bỏ trống họ tên → báo tại ô "Nhập họ tên"', r && r.coLoi && r.chu === 'Nhập họ tên' && r.dangDung, JSON.stringify(r));
  await p2.fill('#a_name', 'Nguyễn Văn Thử');
  await p2.click('#applyForm [type=submit]'); await p2.waitForTimeout(300);
  r = await loiO(p2, 'a_phone');
  ok('… có họ tên, thiếu SĐT → báo tại ô SĐT', r && r.coLoi && r.chu === 'Nhập số điện thoại', JSON.stringify(r));
  ok('… lỗi họ tên đã tự gỡ khi gõ', !(await loiO(p2, 'a_name')).coLoi);
  await p2.fill('#a_phone', '0900000000');
  if (await p2.evaluate(() => !!el('a_facility') && !el('a_facility').value)) await p2.selectOption('#a_facility', { index: 1 });
  await p2.selectOption('#a_gender', 'female');
  await p2.click('#applyForm [type=submit]'); await p2.waitForTimeout(400);
  r = await loiO(p2, 'a_birth');
  ok('… thiếu ngày sinh → báo tại ô Ngày sinh, lịch mở sẵn', r && r.coLoi && r.chu === 'Chọn ngày sinh' && await p2.locator('.cal-pop').count() > 0, JSON.stringify(r));
  await khach.close();

  ok('Không request ghi nào (lỗi chặn trước khi gửi)', daGhi.length === 0, daGhi.join(', '));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Lỗi tại ô: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
