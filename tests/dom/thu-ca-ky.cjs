// Màn Tiền phòng có nút "Đã thu cả kỳ" (admin) mở hộp xác nhận nêu đúng SỐ PHIẾU chưa thu của kỳ;
// nút chốt bị chặn khi chưa tick xác nhận. KHÔNG bấm chốt thật — đổi trạng thái hàng loạt là dữ liệu.
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
  await page.goto('/tien-phong');
  await page.waitForTimeout(3000);

  const chuaThu = await page.evaluate(() => (_invAll || []).filter(i => i.status !== 'paid').length);
  const nut = page.locator('[data-act="thuCaKyForm"]');
  if (chuaThu === 0) {
    ok('Kỳ không còn phiếu chưa thu → KHÔNG hiện nút', await nut.count() === 0);
  } else {
    ok('Có phiếu chưa thu → hiện nút "Đã thu cả kỳ"', await nut.count() === 1, 'đếm được ' + await nut.count());
    await nut.first().click();
    await page.waitForTimeout(1500);
    const modal = page.locator('#modal');
    ok('Mở hộp xác nhận', await page.locator('#overlay.show').count() === 1);
    const chu = (await modal.textContent()) || '';
    // Số máy chủ đếm (would_update) có thể lớn hơn số đang hiện vì phiếu 0đ của thành viên thuê nguyên
    // phòng bị ẩn — chỉ đòi hộp nêu MỘT con số ≥ số đang hiện.
    const m = chu.match(/(\d+)\s*phiếu/);
    ok('Hộp nêu số phiếu sẽ đổi', !!m && +m[1] >= chuaThu, `hộp: ${m && m[1]} · đang hiện ${chuaThu}`);
    ok('Nói rõ KHÔNG hoàn tác hàng loạt', /không hoàn tác/i.test(chu));
    ok('Có ô tick xác nhận', await page.locator('#tck_ok').count() === 1);

    // Bấm chốt khi CHƯA tick -> phải bị chặn, số phiếu chưa thu không đổi
    await page.locator('[data-act="doThuCaKy"]').click();
    await page.waitForTimeout(1200);
    ok('Chưa tick → chặn, hộp vẫn mở', await page.locator('#overlay.show').count() === 1);
    const sau = await page.evaluate(() => (_invAll || []).filter(i => i.status !== 'paid').length);
    ok('Chưa tick → không phiếu nào bị đổi', sau === chuaThu, `${chuaThu} → ${sau}`);
    await page.evaluate(() => closeModalNgay());
  }
  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Nút "Đã thu cả kỳ" chạy đúng');
  process.exit(fail ? 1 : 0);
})();
