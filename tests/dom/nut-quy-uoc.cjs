// Test giao diện (Playwright), KHÔNG ghi dữ liệu: chân modal theo một quy ước — nút phụ trái, nút chính phải,
// "Đóng" là nút thường, hai nút đỏ không đứng sát nhau (Chi tiết học viên: Khoá hồ sơ tách khỏi Trả phòng).
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
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [], daGhi = [];
  page.on('pageerror', e => loiJs.push(String(e)));
  page.on('dialog', d => d.dismiss());
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.continue();
    daGhi.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const cho = async (fn, arg, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); }
    return false;
  };
  const chanModal = () => page.evaluate(() => [...document.querySelectorAll('#modal .mf .btn')].map(b => ({
    chu: b.textContent.replace(/\s+/g, ' ').trim(), pri: b.classList.contains('pri'), do: b.classList.contains('danger'),
    mau: ['pri', 'danger', 'green'].some(c => b.classList.contains(c)),
  })));
  const dongModal = () => page.evaluate(() => { if (typeof closeModal === 'function') closeModal(); });
  const kiemChan = (ten, ds) => {
    const iPri = ds.findIndex(b => b.pri);
    ok(`${ten}: nút chính (nếu có) đứng cuối`, iPri === -1 || iPri === ds.length - 1, ds.map(b => b.chu).join(' | '));
    const dong = ds.find(b => b.chu === 'Đóng');
    ok(`${ten}: "Đóng" là nút thường`, !dong || !dong.mau, JSON.stringify(dong));
    ok(`${ten}: không có hai nút đỏ đứng sát nhau`, !ds.some((b, i) => i && b.do && ds[i - 1].do), ds.map(b => (b.do ? '[ĐỎ]' : '') + b.chu).join(' | '));
  };

  await page.goto('/');
  await cho(() => typeof ST !== 'undefined' && ST.students && ST.students.length > 0);

  // Chi tiết học viên đang ở: Khoá hồ sơ (đỏ) đứng đầu, tách khỏi Trả phòng (đỏ); cuối là "Đóng"
  const hv = await page.evaluate(() => (ST.students.find(s => isOccupying(s) && !s.deleted_at) || {}).id);
  if (!hv) ok('Chi tiết học viên (BỎ QUA: không ai đang ở)', true);
  else {
    await page.evaluate(id => studentDetail(id), hv);
    await cho(() => document.querySelectorAll('#modal .mf .btn').length >= 3);
    const ds = await chanModal();
    kiemChan('Chi tiết học viên', ds);
    ok('… "Khoá hồ sơ" đứng đầu (trái), "Đóng" đứng cuối', /Khoá hồ sơ/.test(ds[0].chu) && ds[ds.length - 1].chu === 'Đóng', ds.map(b => b.chu).join(' | '));
    ok('… có cả "Trả phòng" (đỏ) nhưng không cạnh "Khoá hồ sơ"', ds.some(b => b.chu === 'Trả phòng' && b.do) && !(ds[1] && ds[1].do));
    await dongModal();
  }

  // Chi tiết phòng: "Đóng" là nút thường, đứng cuối
  const phong = await page.evaluate(() => (ST.rooms.find(r => !r.deleted_at) || {}).id);
  await page.evaluate(id => roomDetail(id), phong);
  await cho(() => !!document.querySelector('#modal .mf [data-act="delRoom"]'));
  let ds = await chanModal();
  kiemChan('Chi tiết phòng', ds);
  ok('… "Đóng" đứng cuối', ds.length && ds[ds.length - 1].chu === 'Đóng', ds.map(b => b.chu).join(' | '));
  await dongModal();

  // Tổng quan: danh sách thiếu phiếu báo, danh sách tạm trú
  await page.evaluate(() => billOverdueModal());
  await cho(() => !!document.querySelector('#modal .mf .btn') && !document.querySelector('#modal .spinner'));
  ds = await chanModal();
  kiemChan('Học viên thiếu phiếu báo', ds);
  ok('… "Đóng" đứng đầu (trái)', ds.length && ds[0].chu === 'Đóng', ds.map(b => b.chu).join(' | '));
  await dongModal();
  await page.evaluate(() => residencyModal());
  await cho(() => !!document.querySelector('#modal .mf .btn'));
  ds = await chanModal();
  kiemChan('Tạm trú', ds);
  ok('… "Đóng" trái, "Danh sách gửi công an" phải', ds.length === 2 && ds[0].chu === 'Đóng' && ds[1].pri, ds.map(b => b.chu).join(' | '));
  await dongModal();

  ok('Không request ghi nào (đều bị chặn, và không có cái nào)', daGhi.length === 0, daGhi.join(', '));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Quy ước nút: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
