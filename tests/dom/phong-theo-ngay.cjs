// BL-107: đổi ô Ngày trong modal xếp phòng thì ô Xếp phòng phải TÍNH LẠI theo mốc đó,
// và nhãn phải nói rõ đang tính theo ngày nào.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

const ngay = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));
  const goi = [];
  page.on('request', r => { const m = r.url().match(/\/api\/rooms\?[^ ]*date=([^&]+)/); if (m) goi.push(decodeURIComponent(m[1])); });

  await page.goto('/hoc-vien');
  await page.waitForTimeout(2800);

  const sid = await page.evaluate(() => (ST.students.find(s => !s.deleted_at) || {}).id);
  ok('Có học viên để mở modal chuyển phòng', !!sid, 'ST.students rỗng');
  if (!sid) { await ctx.close(); await browser.close(); process.exit(1); }

  goi.length = 0;
  await page.evaluate(id => transferForm(+id), sid);
  await page.waitForTimeout(1500);

  const co = await page.locator('#t_room').count();
  ok('Modal có ô Xếp phòng', co > 0);

  const nhanDau = await page.locator('#t_room').textContent();
  ok('Mặc định (hôm nay) KHÔNG dán mốc ngày vào nhãn', !/vào \d{2}\/\d{2}/.test(nhanDau || ''), (nhanDau || '').slice(0, 90));

  // Đổi ngày sang +10: attachDate phát sự kiện change khi chọn, ở đây đặt tay rồi phát cho giống
  goi.length = 0;
  const moc = ngay(10);
  await page.evaluate(d => {
    const i = document.getElementById('t_date');
    i.dataset.iso = d; i.value = d;
    i.dispatchEvent(new Event('change'));
  }, moc);
  await page.waitForTimeout(2200);

  ok('Đổi ngày → gọi máy chủ với ?date= đúng mốc', goi.includes(moc), 'đã gọi: ' + JSON.stringify(goi));

  const nhanSau = await page.locator('#t_room').textContent();
  ok('Nhãn phòng nói rõ đang tính theo ngày nào', /vào \d{2}\/\d{2}/.test(nhanSau || ''), (nhanSau || '').slice(0, 120));
  ok('Danh sách phòng KHÔNG bị rỗng sau khi tính lại',
    await page.locator('#t_room option').count() > 1, 'chỉ còn ' + await page.locator('#t_room option').count() + ' lựa chọn');

  // Đóng rồi mở modal khác: mốc cũ không được dính sang
  await page.evaluate(() => closeModal());
  await page.waitForTimeout(400);
  await page.evaluate(id => checkInForm(+id), sid);
  await page.waitForTimeout(1500);
  const nhanMoi = await page.locator('#c_room').textContent();
  ok('Mở modal khác: KHÔNG dính mốc ngày của modal trước',
    !/vào \d{2}\/\d{2}/.test(nhanMoi || ''), (nhanMoi || '').slice(0, 90));

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Xếp phòng theo ngày chạy đúng');
  process.exit(fail ? 1 : 0);
})();
