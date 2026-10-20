// Đơn trả phòng của học viên: ô Số tài khoản nhận cọc + Ngân hàng luôn hiện; bắt buộc khi app ghi đang giữ cọc,
// còn cọc chưa ghi nhận thì vẫn điền được (không bắt). Dựng form trong trang với hồ sơ giả, lệnh gửi đơn bị chặn.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));
  const daGui = [];
  await page.route('**/api/me/checkout-request', r => { daGui.push(r.request().postDataJSON()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });

  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.loadStudentPortal = () => {}; });

  const moForm = async coc => {
    await page.evaluate(c => { closeModalNgay(); window._myProfile = { deposit_status: c, deposit_notice_min_days: 30 }; checkoutReqForm(); }, coc);
    await page.check('#co_doc');
    await page.click('#co_tiep');
    await page.waitForTimeout(300);
    await page.evaluate(() => { const o = el('co_date'); o.dataset.iso = today(); o.value = fmtDate(today()); });
  };
  const nhan = () => page.evaluate(() => [...document.querySelectorAll('#modal .field label')].map(l => l.textContent.replace(/\s+/g, ' ').trim()));

  console.log('\n-- Cọc chưa ghi nhận trong app');
  await moForm('none');
  ok('Có ô Số tài khoản nhận cọc và Ngân hàng', await page.locator('#co_stk').count() === 1 && await page.locator('#co_nh').count() === 1);
  ok('Ô số tài khoản ghi "(nếu đã đóng cọc)", không đánh dấu bắt buộc', (await nhan()).some(t => /Số tài khoản nhận cọc \(nếu đã đóng cọc\)/.test(t)), (await nhan()).join(' | '));
  ok('Bàn phím số cho ô số tài khoản', await page.getAttribute('#co_stk', 'inputmode') === 'numeric');
  await page.click('#modal [data-act="submitCheckoutReq"]');
  await page.waitForTimeout(600);
  ok('Để trống vẫn gửi được đơn', daGui.length === 1 && daGui[0].bank_account === '', JSON.stringify(daGui));

  await moForm('none');
  await page.fill('#co_stk', '0123456789');
  await page.click('#modal [data-act="submitCheckoutReq"]');
  await page.waitForTimeout(400);
  ok('Có số tài khoản mà thiếu ngân hàng → báo tại ô, chưa gửi', daGui.length === 1 && await page.locator('#modal .co-loi #co_nh').count() === 1);
  await page.fill('#co_nh', 'Vietcombank');
  await page.click('#modal [data-act="submitCheckoutReq"]');
  await page.waitForTimeout(600);
  ok('Điền đủ → gửi kèm số tài khoản và ngân hàng', daGui.length === 2 && daGui[1].bank_account === '0123456789' && daGui[1].bank_name === 'Vietcombank', JSON.stringify(daGui[1]));

  console.log('\n-- App đang ghi giữ cọc');
  await moForm('held');
  ok('Ô số tài khoản bắt buộc', (await nhan()).some(t => /^Số tài khoản nhận cọc \*/.test(t)), (await nhan()).join(' | '));
  await page.click('#modal [data-act="submitCheckoutReq"]');
  await page.waitForTimeout(400);
  ok('Để trống → báo tại ô, chưa gửi', daGui.length === 2 && /Nhập số tài khoản/.test(await page.locator('#modal').textContent() || ''));

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Đơn trả phòng luôn có ô số tài khoản');
  process.exit(fail ? 1 : 0);
})();
