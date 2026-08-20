// Ô "Ngày" trong modal xếp phòng bung lịch có SỐ GIƯỜNG TRỐNG từng ngày (lọc theo giới tính HV).
// Lịch chỉ nuôi phần tô màu; <select> vẫn tự hỏi ?date= (BL-107) — hỏng lịch không được chặn xếp phòng.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));
  const goiDate = [];
  page.on('request', r => { const m = r.url().match(/\/api\/rooms\?[^ ]*date=([^&]+)/); if (m) goiDate.push(decodeURIComponent(m[1])); });
  let goiLich = 0;
  page.on('request', r => { if (/\/api\/rooms\/lich\?/.test(r.url())) goiLich++; });

  await page.goto('/hoc-vien');
  await page.waitForTimeout(2800);
  const sid = await page.evaluate(() => (ST.students.find(s => !s.deleted_at) || {}).id);
  ok('Có học viên để thử', !!sid);

  await page.evaluate(id => transferForm(+id), sid);
  await page.waitForTimeout(1200);
  await page.locator('#t_date').click();
  await page.waitForTimeout(2500);

  ok('Lịch bung ra ở chế độ chỗ trống (.cal-ct)', await page.locator('.cal-pop.cal-ct').count() > 0);
  ok('Đã gọi ma trận /rooms/lich', goiLich > 0, 'gọi ' + goiLich + ' lần');
  const soO = await page.locator('.cal-ct .cd-so').count();
  ok('Có số giường trống trong ô ngày', soO > 0, soO + ' ô có số');
  ok('Có ô mang màu tình trạng (co/het/vuot)',
    await page.locator('.cal-ct .cal-d.co, .cal-ct .cal-d.het, .cal-ct .cal-d.vuot').count() > 0);
  const nutO = page.locator('.cal-ct button.cal-d').first();
  ok('Ô có số là <button> (bàn phím focus được)', await nutO.count() > 0);
  ok('Ô có aria-label đọc được', /còn \d+ giường/.test(await nutO.getAttribute('aria-label') || ''),
    await nutO.getAttribute('aria-label'));

  // Số trong ô phải khớp phép tính độc lập từ chính ma trận (lọc giới tính HV)
  const so = await page.evaluate(sid2 => {
    const s = ST.students.find(x => x.id === +sid2);
    const b = document.querySelector('.cal-ct button.cal-d');
    const T = tongNgay(b.dataset.d, s.gender);
    return { o: +b.querySelector('.cd-so').textContent, tinh: T ? T.trong : null };
  }, sid);
  ok('Số trên ô == tongNgay (lọc đúng giới tính)', so.o === so.tinh, JSON.stringify(so));

  // Chọn một ngày: <select> phòng phải nạp lại qua ?date= — BL-107 còn sống
  goiDate.length = 0;
  await page.locator('.cal-ct button.cal-d').first().click();
  await page.waitForTimeout(2200);
  ok('Chọn ngày trên lịch → <select> vẫn hỏi ?date= (BL-107)', goiDate.length > 0, JSON.stringify(goiDate));
  ok('<select> phòng không rỗng', await page.locator('#t_room option').count() > 1);
  await page.evaluate(() => closeModal());

  // Lịch hỏng → vẫn xếp được phòng: xoá đệm (nếu còn đệm thì dùng đệm là ĐÚNG) rồi chặn /rooms/lich
  await page.route('**/api/rooms/lich**', r => r.fulfill({ status: 500, body: '{}' }));
  await page.evaluate(() => quenLich());
  await page.evaluate(id => transferForm(+id), sid);
  await page.waitForTimeout(1000);
  await page.locator('#t_date').click();
  await page.waitForTimeout(1800);
  ok('Ma trận 500 → lịch VẪN MỞ, chỉ không có số', await page.locator('.cal-pop').count() > 0
    && await page.locator('.cal-ct .cd-so').count() === 0,
  'pop=' + await page.locator('.cal-pop').count() + ' so=' + await page.locator('.cal-ct .cd-so').count());
  ok('<select> phòng vẫn có lựa chọn (không chặn việc xếp)', await page.locator('#t_room option').count() > 1);

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Lịch trong ô ngày chạy đúng');
  process.exit(fail ? 1 : 0);
})();
