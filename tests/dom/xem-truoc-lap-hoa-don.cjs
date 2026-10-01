// Test giao diện (Playwright), CHỈ ĐỌC: màn "Xem trước — lập hoá đơn" — các dòng tổng kết bấm được ra danh sách tên
// và nút Quay lại về đúng màn xem trước. Xem trước là chạy khô (máy chủ ROLLBACK), không ghi gì.
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
const tieuDe = page => page.evaluate(() => { const h = document.querySelector('#modal .mh h3'); return h ? h.textContent.trim() : ''; });
// CSP của app chặn eval nên không dùng được waitForFunction — tự hỏi lại tiêu đề modal tới khi khớp.
const choTieuDe = async (page, re, ms = 30000) => {
  for (let t = 0; t < ms; t += 250) { if (re.test(await tieuDe(page))) return true; await page.waitForTimeout(250); }
  return false;
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

  await page.goto('/tien-phong'); await page.waitForTimeout(2500);
  await page.click('[data-act="generateForm"]');
  await page.waitForSelector('[data-act="runGenerate"]', { timeout: 15000 });
  await page.click('[data-act="runGenerate"]');
  ok('Mở được màn xem trước', await choTieuDe(page, /Xem trước/), await tieuDe(page));

  const dong = await page.evaluate(() => [...document.querySelectorAll('#modal .gen-dong')].map(d => ({
    nhan: (d.querySelector('.gen-nhan') || {}).textContent, bam: d.getAttribute('data-act'),
  })));
  const taoMoi = dong.find(d => d.nhan === 'Tạo mới');
  if (!taoMoi) {
    ok('Dòng "Tạo mới" bấm được (BỎ QUA: kỳ này không có phiếu tạo mới)', true);
  } else {
    ok('Dòng "Tạo mới" bấm được', taoMoi.bam === 'genXemDs', JSON.stringify(taoMoi));
    await page.click('#modal .gen-dong[data-act="genXemDs"]');
    await page.waitForTimeout(500);
    const t2 = await tieuDe(page);
    const soDong = await page.evaluate(() => document.querySelectorAll('#modal tbody tr').length);
    ok('Bấm "Tạo mới" → mở danh sách tên', /phiếu tạo mới/.test(t2) && soDong > 0, `title=${t2} · ${soDong} dòng`);
    const soTrenTieuDe = +(t2.match(/(\d+)\s+phiếu/) || [])[1];
    ok('… số trên tiêu đề danh sách bằng số dòng trong bảng', soTrenTieuDe === soDong, `${soTrenTieuDe} vs ${soDong}`);
    await page.click('#modal .mf [data-act="modalBack"]');
    await page.waitForTimeout(400);
    ok('Quay lại → về đúng màn xem trước', /Xem trước/.test(await tieuDe(page)), await tieuDe(page));
  }
  const conChet = dong.filter(d => ['Không đổi', 'Bỏ qua — đã thu', 'Không lập phiếu — tổng 0 đồng'].includes(d.nhan) && d.bam !== 'genXemDs');
  ok('Các dòng Không đổi / Đã thu / 0 đồng (nếu có) đều bấm được', conChet.length === 0, JSON.stringify(conChet));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));

  await browser.close();
  console.log(`\n  Xem trước lập hoá đơn: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
