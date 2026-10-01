// Test giao diện (Playwright), KHÔNG ghi dữ liệu: lỗi tải hiện câu tiếng Việt kèm nút Thử lại, chi tiết kỹ thuật chỉ
// nằm trong title; nhãn cấu hình email bằng tiếng Việt mà giá trị lưu không đổi. Lỗi máy chủ giả bằng page.route.
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
const LOI = 'loi-ky-thuat-xyz';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [];
  page.on('pageerror', e => loiJs.push(String(e)));
  let hongPhieu = false, hongKiem = false;
  await page.route('**/api/**', route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if ((hongPhieu && p === '/api/invoices') || (hongKiem && p === '/api/admin/data-health')) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: LOI }) });
    }
    return route.continue();
  });
  const cho = async (fn, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(200); }
    return false;
  };

  // ── Hộp "Chưa lập phiếu báo" ───────────────────────────────────────────────
  await page.goto('/'); await cho(() => (el('pgTitle') || {}).textContent === 'Tổng quan');
  hongPhieu = true;
  await page.evaluate(() => { billOverdueModal(); });
  ok('Chưa lập phiếu báo: lỗi tải → có nút Thử lại', await cho(() => !!document.querySelector('#modal [data-act="napChuaLapPhieu"]')));
  const m = await page.evaluate(() => ({ chu: el('modal').textContent, title: (document.querySelector('#modal .bang-tin') || {}).title || '' }));
  ok('… câu "Không tải được danh sách phiếu báo.", chi tiết kỹ thuật chỉ nằm trong title',
    m.chu.includes('Không tải được danh sách phiếu báo.') && !m.chu.includes(LOI) && m.title.includes(LOI), JSON.stringify(m).slice(0, 300));
  hongPhieu = false;
  await page.click('#modal [data-act="napChuaLapPhieu"]');
  ok('… bấm Thử lại → tải được, hiện danh sách', await cho(() => /Chưa lập phiếu báo \(\d+\)/.test((document.querySelector('#modal .mh h3') || {}).textContent || '')));
  await page.evaluate(() => closeModalNgay()); await page.waitForTimeout(400);

  // ── Kiểm dữ liệu (Cài đặt › Hệ thống) ─────────────────────────────────────
  hongKiem = true;
  await page.evaluate(() => { settingsTab = 'hethong'; adminGo('settings'); });
  ok('Kiểm dữ liệu: lỗi → có nút Thử lại', await cho(() => !!document.querySelector('#dataHealth [data-act="loadDataHealth"]')));
  const h = await page.evaluate(() => { const b = el('dataHealth'), s = b.querySelector('[title]'); return { chu: b.textContent, title: s ? s.title : '' }; });
  ok('… câu "Không kiểm tra được dữ liệu.", chi tiết kỹ thuật chỉ nằm trong title',
    h.chu.includes('Không kiểm tra được dữ liệu.') && !h.chu.includes(LOI) && h.title.includes(LOI), JSON.stringify(h));
  hongKiem = false;
  await page.click('#dataHealth [data-act="loadDataHealth"]');
  ok('… bấm Thử lại → có kết quả kiểm', await cho(() => !el('dataHealth').querySelector('[data-act="loadDataHealth"]') && !/Đang kiểm tra/.test(el('dataHealth').textContent)));

  // ── Cấu hình email ─────────────────────────────────────────────────────────
  await page.evaluate(() => settingsGo('email'));
  await cho(() => !!el('set_smtp_secure'));
  const nhan = await page.evaluate(() => {
    const lab = id => ((el(id) && el(id).closest('.field').querySelector('label').textContent) || '').trim();
    return {
      host: lab('set_smtp_host'), port: lab('set_smtp_port'), user: lab('set_smtp_user'), from: lab('set_smtp_from'), secure: lab('set_smtp_secure'),
      opts: [...el('set_smtp_secure').options].map(o => [o.value, o.textContent.trim()]),
    };
  });
  ok('Email: nhãn Máy chủ SMTP / Cổng / Tài khoản / Tên người gửi / Bảo mật',
    nhan.host === 'Máy chủ SMTP' && nhan.port === 'Cổng' && nhan.user === 'Tài khoản' && nhan.from === 'Tên người gửi' && nhan.secure === 'Bảo mật', JSON.stringify(nhan));
  ok('… lựa chọn bảo mật không còn chữ false/true, giá trị lưu giữ nguyên',
    JSON.stringify(nhan.opts) === JSON.stringify([['false', 'STARTTLS (cổng 587)'], ['true', 'SSL/TLS (cổng 465)']]), JSON.stringify(nhan.opts));

  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Lỗi tải có Thử lại: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
