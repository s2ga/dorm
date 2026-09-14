// Chuông đếm báo cáo bãi xe "chưa xem" — bấm vào phải mở ĐÚNG bộ lọc đó (không rơi vào danh sách
// 30 ngày của lần xem trước) và cuộn tới đúng khối; xem/xử lý xong thì số trên chuông phải giảm.
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
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  if (!lr.ok()) { console.log('  [FAIL] đăng nhập ' + lr.status()); await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJS = [];
  page.on('pageerror', e => loiJS.push(String(e)));

  await page.goto('/tong-quan');
  await page.waitForTimeout(3000);

  // Giả lập: đang có 3 báo cáo chưa xem, và người dùng vừa xem tab "30 ngày gần đây" lần trước
  await page.evaluate(() => {
    ST.pkAlerts = { today: today(), tong: 0, co_mat: 0, vang: 0, chua_danh: 0, plate_requests: 2,
      reports_new: 3, vang_lau: [], alert_days: 7, dailies: [], chua_chot: false, alert_time: '20:00' };
    pkAdminLoc = 'all';
    updateNotif();
  });
  const chuong = await page.evaluate(() => notifItems().find(i => /báo cáo bãi xe/.test(i.tx)));
  ok('Chuông có dòng "3 báo cáo bãi xe … chưa xem"', !!chuong && chuong.n === 3, JSON.stringify(chuong && chuong.n));
  ok('Dòng đó trỏ thẳng tới khối báo cáo', /gotoParkingAdmin/.test((chuong && chuong.act) || '') && /baocao/.test((chuong && chuong.act) || ''),
    (chuong && chuong.act) || '');

  // Bấm vào → phải ép bộ lọc về "chưa xem"
  await page.evaluate(() => gotoParkingAdmin('baocao'));
  await page.waitForTimeout(3000);
  ok('Bấm vào: bộ lọc ép về "chưa xem" (không giữ 30 ngày của lần trước)',
    await page.evaluate(() => pkAdminLoc) === 'new');
  ok('Mở đúng tab Gửi xe của màn Dịch vụ',
    await page.evaluate(() => svcTab) === 'parking' && /dich-vu|services/.test(page.url()), page.url());
  ok('Có khối "Báo cáo bãi xe" để cuộn tới', await page.locator('#pk_panel_baocao').count() === 1);
  ok('Nút "Chưa xem" đang được tô', await page.locator('[data-act="pkAdminLocGo"][data-args=\'["new"]\'].pri').count() === 1);

  // Số trên tiêu đề khối = số chuông đếm (cùng nguồn status='new')
  const soKhoi = await page.evaluate(() => {
    const m = (document.querySelector('#pk_panel_baocao .hd h2') || {}).textContent || '';
    const k = m.match(/\((\d+)\)/); return k ? +k[1] : null;
  });
  const soChuong = await page.evaluate(() => (ST.pkAlerts || {}).reports_new);
  ok('Số ở khối khớp số chuông (cùng đếm "chưa xem")', soKhoi === soChuong, `khối ${soKhoi} · chuông ${soChuong}`);

  // viewServices phải cập nhật lại ST.pkAlerts (không giữ số cũ) -> chuông giảm khi xử lý xong
  ok('Vào màn xong ST.pkAlerts được nạp lại từ máy chủ (số giả đã bị thay)',
    await page.evaluate(() => (ST.pkAlerts || {}).alert_time !== '20:00' || (ST.pkAlerts || {}).reports_new !== 3),
    JSON.stringify(await page.evaluate(() => ST.pkAlerts && { r: ST.pkAlerts.reports_new, t: ST.pkAlerts.alert_time })));
  const dot = await page.evaluate(() => (el('notifDot') || {}).textContent);
  ok('Chuông đã vẽ lại theo số thật', dot !== undefined, String(dot));

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Chuông bãi xe trỏ đúng và tự giảm');
  process.exit(fail ? 1 : 0);
})();
