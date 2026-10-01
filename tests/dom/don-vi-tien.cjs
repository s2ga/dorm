// Test giao diện (Playwright), CHỈ ĐỌC: đơn vị tiền hiện đúng chỗ — số đứng riêng kèm "đ", ô tiền trong bảng không
// kèm vì đầu bảng đã ghi đơn vị.
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
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [];
  page.on('pageerror', e => loiJs.push(String(e)));

  await page.goto('/tien-phong'); await page.waitForTimeout(3000);
  const tp = await page.evaluate(() => {
    const the = [...document.querySelectorAll('#content .stat')].find(s => /Tổng tiền phiếu/.test(s.textContent));
    const o = document.querySelector('#content table tbody tr td[data-label="Tổng"]');
    return { kpi: the ? the.querySelector('.v').textContent.trim() : null, o: o ? o.textContent.trim() : null,
      donVi: /Đơn vị: đồng/.test(document.getElementById('content').textContent) };
  });
  ok('Tiền phòng: ô "Tổng tiền phiếu" kèm đơn vị đ', !!tp.kpi && /\d\s?đ$/.test(tp.kpi), String(tp.kpi));
  if (tp.o == null) ok('Tiền phòng: bảng phiếu (BỎ QUA: kỳ này chưa có phiếu)', true);
  else {
    ok('Tiền phòng: ô tiền trong bảng không kèm đ', !/đ/.test(tp.o), tp.o);
    ok('Tiền phòng: đầu bảng ghi "Đơn vị: đồng"', tp.donVi);
    const idPhieu = await page.evaluate(() => (_invAll || [])[0] && _invAll[0].id);
    await page.evaluate(id => phieuBao(id), idPhieu);
    await page.waitForSelector('#receiptArea table', { timeout: 15000 });
    const pb = await page.evaluate(() => ({
      th: [...document.querySelectorAll('#receiptArea thead th')].map(x => x.textContent.trim()),
      tong: (document.querySelector('#receiptArea .rc-total td.n') || {}).textContent,
    }));
    ok('Phiếu báo in: cột Đơn giá và Thành tiền ghi đơn vị ở tiêu đề', pb.th.includes('Đơn giá (đồng)') && pb.th.includes('Thành tiền (đồng)'), pb.th.join(' | '));
    ok('Phiếu báo in: dòng tổng không lặp đơn vị', pb.tong != null && !/đ/.test(pb.tong), String(pb.tong));
    await page.evaluate(() => closeModalNgay());
    await page.waitForTimeout(400);
  }

  await page.goto('/phong'); await page.waitForTimeout(2500);
  const ph = await page.evaluate(() => {
    const th = [...document.querySelectorAll('#content thead th')].map(x => x.textContent.trim());
    const o = document.querySelector('#content tbody td[data-label^="Giá thuê"]');
    return { th, o: o ? o.textContent.trim() : null };
  });
  ok('Phòng: tiêu đề cột "Giá thuê (đ)"', ph.th.includes('Giá thuê (đ)'), ph.th.join(' | '));
  ok('Phòng: ô giá thuê không kèm đ', ph.o != null && !/\d\s?đ/.test(ph.o), String(ph.o));

  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Đơn vị tiền: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
