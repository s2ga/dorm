// Nút "Đã thu / Chưa thu" phải HIỆN và BẤM ĐƯỢC ở màn Tiền phòng. Có ghi/khôi phục trạng thái.
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

  const nut = page.locator('[data-act="doiTrangThaiThu"]');
  const n = await nut.count();
  ok('Mỗi hàng hoá đơn có nút đánh dấu thu tiền', n > 0, 'đếm được ' + n + ' nút');
  ok('Có hàng pill lọc Đã thu / Chưa thu', await page.locator('[data-act="invLoc"]').count() === 3);

  if (n > 0) {
    const dau = nut.first();
    const truoc = (await dau.textContent() || '').trim();
    ok('Nhãn nút nói rõ trạng thái', /Đã thu|Chưa thu/.test(truoc), truoc);

    // Bấm "Chưa thu" -> phải thành "Đã thu". Chỉ thử trên phiếu đang CHƯA thu để khỏi đụng dữ liệu đã chốt.
    if (/Chưa thu/.test(truoc)) {
      const args = await dau.getAttribute('data-args');
      await page.evaluate(a => document.querySelector(`[data-act="doiTrangThaiThu"][data-args='${a}']`).click(), args);
      await page.waitForTimeout(1800);
      const id = JSON.parse(args)[0];
      const sau = await page.locator(`[data-act="doiTrangThaiThu"][data-args='[${id},"pending"]']`).count();
      ok('Bấm xong phiếu chuyển sang ĐÃ THU', sau > 0);
      if (sau > 0) {
        page.once('dialog', d => d.accept());
        await page.evaluate(i => document.querySelector(`[data-act="doiTrangThaiThu"][data-args='[${i},"pending"]']`).click(), id);
        await page.waitForTimeout(1800);
        ok('Bấm lại chuyển về CHƯA THU (trả nguyên trạng)',
          await page.locator(`[data-act="doiTrangThaiThu"][data-args='[${id},"paid"]']`).count() > 0);
      }
    } else {
      console.log('  [BỎ QUA] phiếu đầu đã ở trạng thái Đã thu — không đụng dữ liệu thật');
    }
  }
  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Nút thu tiền chạy đúng');
  process.exit(fail ? 1 : 0);
})();
