// Mọi ô chọn KỲ (tháng) phải là lịch VN "Tháng MM/YYYY" — không còn <input type="month"> native
// (máy cài tiếng Anh hiện "September 2026") lẫn dropdown tháng ở màn An ninh/Bảo trì.
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
  page.on('dialog', d => d.dismiss());

  // Ô kỳ hợp lệ: chỉ đọc (chỉ bấm ra lịch), nhãn tiếng Việt, giá trị thật nằm ở dataset.ym
  const kiemO = async (id, nhan) => {
    const o = await page.evaluate(sel => {
      const e = document.getElementById(sel);
      if (!e) return null;
      return { tag: e.tagName, type: e.getAttribute('type'), ro: e.readOnly, val: e.value, ym: e.dataset.ym || '' };
    }, id);
    if (!o) { ok(`${nhan}: có ô #${id}`, false, 'không thấy ô'); return false; }
    ok(`${nhan}: không còn native/dropdown`, o.tag === 'INPUT' && o.type === null, `${o.tag} type=${o.type}`);
    ok(`${nhan}: nhãn tiếng Việt "Tháng MM/YYYY"`, /^Tháng \d{2}\/\d{4}$/.test(o.val), o.val);
    ok(`${nhan}: giá trị thật ở dataset.ym`, /^\d{4}-\d{2}$/.test(o.ym), o.ym);
    ok(`${nhan}: chỉ đọc (bấm ra lịch, không gõ tay)`, o.ro === true, 'readOnly=' + o.ro);
    return true;
  };
  // Bấm mở lịch: phải ra bảng 12 tháng
  const moLich = async (id, nhan) => {
    await page.click('#' + id);
    await page.waitForTimeout(500);
    const n = await page.locator('.cal-pop .mo-cell').count();
    ok(`${nhan}: bấm ra lịch 12 tháng`, n === 12, 'đếm được ' + n);
    return n === 12;
  };

  await page.goto('/tien-phong');
  await page.waitForTimeout(3000);

  // ── 1. Tạo hoá đơn theo tháng: chọn tháng khác phải VẼ LẠI form theo kỳ mới ──────────
  await page.evaluate(() => generateForm());
  await page.waitForTimeout(2500);
  if (await kiemO('g_month', 'Tạo hoá đơn')) {
    if (await moLich('g_month', 'Tạo hoá đơn')) {
      const nam = await page.evaluate(() => el('g_month').dataset.ym.slice(0, 4));
      const cu = await page.evaluate(() => el('g_month').dataset.ym);
      const moi = `${nam}-${cu.endsWith('-01') ? '02' : '01'}`;
      await page.click(`.cal-pop .mo-cell[data-ym="${moi}"]`);
      await page.waitForTimeout(2500);
      const sau = await page.evaluate(() => (el('g_month') || {}).dataset ? el('g_month').dataset.ym : '');
      ok('Tạo hoá đơn: chọn kỳ khác → form vẽ lại theo kỳ mới', sau === moi, `${cu} → ${sau} (mong ${moi})`);
    }
  }
  await page.evaluate(() => closeModalNgay());
  await page.waitForTimeout(400);

  // ── 2. Chỉ số điện ──────────────────────────────────────────────────────────────────
  await page.evaluate(() => electricForm());
  await page.waitForTimeout(2500);
  if (await kiemO('e_month', 'Chỉ số điện')) await moLich('e_month', 'Chỉ số điện');
  await page.evaluate(() => closeModalNgay());
  await page.waitForTimeout(400);

  // ── 3. HĐ cho 1 HV ──────────────────────────────────────────────────────────────────
  await page.evaluate(() => oneInvoiceForm());
  await page.waitForTimeout(1200);
  await kiemO('oi_month', 'HĐ cho 1 HV');
  await page.evaluate(() => closeModalNgay());
  await page.waitForTimeout(400);

  // ── 4. Sửa phiếu (✎) ────────────────────────────────────────────────────────────────
  const iid = await page.evaluate(() => (_invAll && _invAll[0]) ? _invAll[0].id : 0);
  if (iid) {
    await page.evaluate(id => invoiceForm(id), iid);
    await page.waitForTimeout(1200);
    await kiemO('i_month', 'Sửa phiếu');
    await page.evaluate(() => closeModalNgay());
    await page.waitForTimeout(400);
  } else console.log('  [BỎ QUA] kỳ hiện tại không có phiếu nào để mở form Sửa phiếu');

  // ── 5. An ninh/Bảo trì → Nhận phòng: dropdown tháng cũ nay là lịch ───────────────────
  await page.evaluate(() => { maintTab = 'nhan'; renderMaintenance(); });
  await page.waitForTimeout(3000);
  ok('An ninh/Bảo trì: không còn dropdown chọn tháng', await page.locator('#maintBody select').count() === 0);
  if (await kiemO('ho_month', 'An ninh/Bảo trì')) await moLich('ho_month', 'An ninh/Bảo trì');

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Mọi ô chọn kỳ đều là lịch VN');
  process.exit(fail ? 1 : 0);
})();
