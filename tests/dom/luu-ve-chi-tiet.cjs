// Lưu một form con mở từ MÀN CHI TIẾT thì phải quay về đúng màn chi tiết đó (dữ liệu mới),
// không đóng sạch modal rồi nhảy về danh sách (owner 04/09). Lưu từ danh sách thì đóng như cũ.
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
  page.on('dialog', d => d.accept());

  await page.goto('/hoc-vien');
  await page.waitForTimeout(3000);

  const s = await page.evaluate(() => {
    const x = ST.students.find(v => !v.deleted_at && v.name) || null;
    return x ? { id: x.id, name: x.name } : null;
  });
  if (!s) { console.log('  [BỎ QUA] CSDL không có học viên nào'); await browser.close(); process.exit(0); }

  // ── Sửa hồ sơ MỞ TỪ chi tiết -> lưu xong đứng nguyên ở chi tiết bạn đó ────────────────
  await page.evaluate(id => studentDetail(id), s.id);
  await page.waitForTimeout(1500);
  ok('Mở được màn chi tiết', await page.locator('#overlay.show').count() === 1);
  await page.evaluate(id => studentForm(id), s.id);
  await page.waitForTimeout(1500);
  ok('Mở form Sửa (lớp con)', await page.locator('#modal #f_name').count() === 1);
  await page.evaluate(id => saveStudent(id), s.id);
  await page.waitForTimeout(2500);
  ok('Lưu xong modal VẪN MỞ (không nhảy về danh sách)', await page.locator('#overlay.show').count() === 1);
  const noiDung = (await page.locator('#modal').textContent()) || '';
  ok('Đang đứng ở đúng chi tiết bạn vừa sửa', noiDung.includes(s.name), noiDung.slice(0, 80));
  ok('Không còn là form Sửa nữa', await page.locator('#modal #f_name').count() === 0);
  await page.evaluate(() => closeModalNgay());

  // ── Sửa phiếu MỞ TỪ danh sách Tiền phòng -> lưu xong đóng modal, ở lại danh sách ──────
  await page.goto('/tien-phong');
  await page.waitForTimeout(3000);
  const coPhieu = await page.evaluate(() => (_invAll || []).length > 0);
  if (coPhieu) {
    const iid = await page.evaluate(() => _invAll[0].id);
    await page.evaluate(id => invoiceForm(id), iid);
    await page.waitForTimeout(1200);
    ok('Mở form phiếu từ danh sách', await page.locator('#modal #i_month').count() === 1);
    await page.evaluate(id => saveInvoice(id), iid);
    await page.waitForTimeout(2500);
    ok('Từ danh sách: lưu xong ĐÓNG modal như cũ', await page.locator('#overlay.show').count() === 0);
    ok('Vẫn đứng ở màn Tiền phòng', /Phiếu báo tiền phòng/.test((await page.locator('#content').textContent()) || ''));
  } else console.log('  [BỎ QUA] kỳ hiện tại không có phiếu nào');

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Lưu xong quay về màn chi tiết chạy đúng');
  process.exit(fail ? 1 : 0);
})();
