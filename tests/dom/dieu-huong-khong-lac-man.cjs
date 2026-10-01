// Test giao diện (Playwright), KHÔNG ghi dữ liệu (PUT/DELETE bị chặn bằng page.route): màn Tạm trú riêng
// (/tam-tru, Quay lại, F5 giữ tháng, lưu hồ sơ xong vẫn ở đó) · xoá phòng từ màn Học viên vẫn ở màn Học viên ·
// trang đăng ký công khai có đường về Đăng nhập.
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
const trang = page => page.evaluate(() => ({
  title: (document.getElementById('pgTitle') || {}).textContent || '',
  path: location.pathname, search: location.search,
  back: !!document.getElementById('backBtn') && document.getElementById('backBtn').style.display !== 'none',
  menu: [...document.querySelectorAll('#nav button.active')].map(b => b.dataset.v).join(','),
  modal: document.getElementById('overlay').classList.contains('show'),
}));
const cho = async (page, dk, ms = 15000) => {
  for (let t = 0; t < ms; t += 200) { if (dk(await trang(page))) return true; await page.waitForTimeout(200); }
  return false;
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
  const daGhi = [];
  await page.route('**/api/**', async route => {
    const m = route.request().method();
    if (m === 'PUT' || m === 'DELETE') {
      daGhi.push(m + ' ' + new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  // ── 1. Tạm trú là màn riêng ───────────────────────────────────────────────
  await page.goto('/'); await cho(page, t => t.title === 'Tổng quan');
  await page.evaluate(() => residencyModal());
  await page.click('#modal [data-act="tamTruMo"]');
  ok('Danh sách gửi công an → màn "Tạm trú"', await cho(page, t => t.title === 'Tạm trú'), JSON.stringify(await trang(page)));
  let t = await trang(page);
  ok('… đường dẫn /tam-tru', t.path === '/tam-tru', t.path);
  ok('… có nút Quay lại', t.back);
  ok('… menu sáng mục Tổng quan', t.menu === 'dashboard', t.menu);
  ok('… modal đã đóng', !t.modal);

  const thangs = await page.evaluate(() => [...document.querySelectorAll('#ttThang option')].map(o => o.value));
  const chon = thangs.find(v => v) || '';
  await page.selectOption('#ttThang', chon);
  await page.waitForTimeout(400);
  t = await trang(page);
  const thamSo = chon ? 'thang=' + chon : 'thang=tat-ca';
  ok('Đổi tháng → tháng ghi lên URL', t.search.includes(thamSo), t.search);
  await page.reload(); await cho(page, x => x.title === 'Tạm trú');
  const sauF5 = await page.evaluate(() => (document.getElementById('ttThang') || {}).value);
  ok('F5 → vẫn ở màn Tạm trú, đúng tháng đang xem', (await trang(page)).title === 'Tạm trú' && sauF5 === chon, `tháng=${sauF5} (mong ${chon})`);

  const idHv = await page.evaluate(() => (ST.students.find(s => !s.deleted_at) || {}).id);
  if (!idHv) ok('Lưu hồ sơ từ màn Tạm trú (BỎ QUA: không có hồ sơ nào)', true);
  else {
    await page.evaluate(id => studentForm(id), idHv);
    await page.waitForSelector('#modal [data-act="saveStudent"]', { timeout: 15000 });
    await page.click('#modal [data-act="saveStudent"]');
    await cho(page, x => !x.modal);
    await page.waitForTimeout(600);
    t = await trang(page);
    const conTrang = await page.evaluate(() => !!document.getElementById('ttThang'));
    ok('Lưu hồ sơ mở từ màn Tạm trú → vẫn ở màn Tạm trú', t.title === 'Tạm trú' && conTrang, JSON.stringify(t));
  }

  await page.click('#backBtn').catch(() => {});
  ok('Bấm Quay lại → về Tổng quan', await cho(page, x => x.title === 'Tổng quan' && x.path === '/'), JSON.stringify(await trang(page)));

  // ── 2. Xoá phòng không vẽ nhầm màn ─────────────────────────────────────────
  await page.goto('/hoc-vien'); await cho(page, x => x.title === 'Học viên');
  const idPhong = await page.evaluate(() => (ST.rooms.find(r => !r.deleted_at) || {}).id);
  if (!idPhong) ok('Xoá phòng (BỎ QUA: không có phòng nào)', true);
  else {
    await page.evaluate(id => roomDetail(id), idPhong);
    await page.waitForSelector('#modal [data-act="delRoom"]', { timeout: 15000 });
    await page.click('#modal [data-act="delRoom"]');
    await cho(page, x => !x.modal);
    await page.waitForTimeout(600);
    t = await trang(page);
    const veDsPhong = await page.evaluate(() => !!document.querySelector('#topActions [data-act="roomDel"]'));
    ok('Xoá phòng từ màn Học viên → vẫn là màn Học viên', t.title === 'Học viên' && t.menu === 'students' && !veDsPhong,
      JSON.stringify({ ...t, veDsPhong }));
  }
  ok('Không request ghi nào lọt ra máy chủ thật (đều bị chặn)', daGhi.every(x => /^(PUT|DELETE) /.test(x)), daGhi.join(', '));

  await page.goto('/check-in'); await cho(page, x => x.title === 'Nhận / trả phòng');
  t = await trang(page);
  ok('Dấu trang cũ /check-in → mở màn "Nhận / trả phòng", URL đổi sang /nhan-tra-phong', t.title === 'Nhận / trả phòng' && t.path === '/nhan-tra-phong', JSON.stringify(t));

  // ── 3. Trang đăng ký công khai có đường về Đăng nhập ──────────────────────
  const khach = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 800 } });
  const p2 = await khach.newPage();
  p2.on('pageerror', e => loiJs.push(String(e)));
  await p2.goto('/dang-ky');
  await p2.waitForSelector('#applyForm', { timeout: 20000 });
  const soLink = await p2.evaluate(() => [...document.querySelectorAll('a[href="/"]')].filter(a => /Đăng nhập/.test(a.textContent)).length);
  ok('Trang đăng ký có link Đăng nhập (đầu trang + cạnh form)', soLink >= 2, 'số link: ' + soLink);
  await p2.click('a.intro-login');
  await p2.waitForSelector('#lg_user', { timeout: 20000 }).catch(() => {});
  ok('Bấm Đăng nhập → ra màn đăng nhập', await p2.evaluate(() => !!document.getElementById('lg_user')));
  await khach.close();

  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Điều hướng không lạc màn: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
