// Chụp cổng BẢO TRÌ ở khổ điện thoại và máy tính, đo tràn ngang + kích cỡ nút chạm.
// READ-ONLY: chỉ đăng nhập, bấm tab, chụp ảnh. Chạy qua tests/dom/run.sh.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const USER = process.env.MAINT_USER;
const PASS = process.env.MAINT_PASS;
if (!USER || !PASS) { console.error('Thiếu MAINT_USER / MAINT_PASS.'); process.exit(2); }

const KHO = [
  { ten: 'dienthoai', width: 390, height: 844 },
  { ten: 'maytinh', width: 1440, height: 900 },
];
const TABS = [
  ['nhan', 'Nhận phòng'],
  ['tra', 'Trả phòng'],
  ['sua', 'Sửa chữa'],
  ['xe', 'Xe'],
];

(async () => {
  const browser = await chromium.launch();
  let loi = 0;
  for (const k of KHO) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: k.width, height: k.height } });
    const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
    if (!lr.ok()) { console.log('  [FAIL] đăng nhập ' + k.ten + ' -> ' + lr.status()); loi++; await ctx.close(); continue; }
    const page = await ctx.newPage();
    const loiJS = [];
    page.on('pageerror', e => loiJS.push(String(e)));
    await page.goto('/');
    await page.waitForTimeout(2500);

    for (const [key, nhan] of TABS) {
      const nut = page.locator(`[data-act="maintGo"][data-args='["${key}"]']`);
      if (await nut.count()) { await nut.first().click(); await page.waitForTimeout(1200); }
      await page.screenshot({ path: `/work/tests/dom/anh/${k.ten}-${key}.png`, fullPage: true });

      const doc = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        tran: [...document.querySelectorAll('body *')]
          .filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 4).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 40)),
        nutNho: [...document.querySelectorAll('button,select,a.btn')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32; })
          .slice(0, 4).map(e => (e.textContent || '').trim().slice(0, 28) + ' [' + Math.round(e.getBoundingClientRect().height) + 'px]'),
      }));
      const tranNgang = doc.scrollW > doc.clientW + 1;
      console.log(`  ${k.ten} · ${nhan}: rộng ${doc.scrollW}/${doc.clientW}` +
        (tranNgang ? '  [FAIL] TRÀN NGANG -> ' + doc.tran.join(' | ') : '  [OK] không tràn') +
        (doc.nutNho.length ? '\n      [WARN] nút < 32px: ' + doc.nutNho.join(' · ') : ''));
      if (tranNgang) loi++;
    }
    if (loiJS.length) { console.log('  [FAIL] lỗi JS ' + k.ten + ': ' + loiJS.slice(0, 3).join(' | ')); loi++; }
    await ctx.close();
  }
  await browser.close();
  console.log(loi ? `\n==> ${loi} vấn đề` : '\n==> Không tràn ngang, không lỗi JS');
  process.exit(loi ? 1 : 0);
})();
