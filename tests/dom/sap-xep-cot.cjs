// Nhấp tiêu đề cột phải SẮP XẾP — ở mọi màn có bảng, không riêng màn Học viên.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

const MAN = [['/phong', 'Phòng'], ['/tien-phong', 'Tiền phòng'], ['/ho-so', 'Hồ sơ lưu trữ'],
  ['/check-in', 'Check-in/out'], ['/lich-su', 'Lịch sử']];

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));

  const cot = async () => page.evaluate(() => {
    const t = [...document.querySelectorAll('.table-wrap table')]
      .find(x => x.tBodies[0] && x.tBodies[0].querySelectorAll('tr').length > 2);
    if (!t) return null;
    const n = t.tHead.rows[0].cells.length;
    const i = [...t.tHead.rows[0].cells].findIndex(th => (th.textContent || '').trim());
    const val = () => [...t.tBodies[0].rows].filter(r => r.cells.length === n && r.style.display !== 'none')
      .map(r => (r.cells[i].textContent || '').trim()).slice(0, 8);
    return { idx: i, truoc: val() };
  });

  for (const [duong, ten] of MAN) {
    await page.goto(duong);
    await page.waitForTimeout(2700);
    const c = await cot();
    if (!c) { console.log(`  [BỎ QUA] ${ten} — không đủ dữ liệu để so`); continue; }
    const coSortable = await page.locator('.table-wrap table th.sortable').count();
    ok(`${ten}: tiêu đề cột nhấp được để sắp xếp`, coSortable > 0, `${coSortable} cột`);
    await page.evaluate(i => {
      const t = [...document.querySelectorAll('.table-wrap table')]
        .find(x => x.tBodies[0] && x.tBodies[0].querySelectorAll('tr').length > 2);
      t.tHead.rows[0].cells[i].click();
    }, c.idx);
    await page.waitForTimeout(600);
    const sau = await cot();
    ok(`${ten}: nhấp xong thứ tự ĐỔI hoặc đã đúng thứ tự`,
      JSON.stringify(sau.truoc) !== JSON.stringify(c.truoc) || sau.truoc.join() === [...sau.truoc].sort((a, b) => a.localeCompare(b, 'vi')).join(),
      `trước ${JSON.stringify(c.truoc.slice(0, 3))} · sau ${JSON.stringify(sau.truoc.slice(0, 3))}`);
    const mui = await page.locator('.table-wrap table th.sortable .sort-ar').first().textContent();
    ok(`${ten}: có mũi tên chỉ chiều sắp xếp`, /[▲▼]/.test(await page.locator('.table-wrap table .sort-ar').allTextContents().then(a => a.join('')) || ''), 'mũi tên = ' + mui);
  }
  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Sắp xếp theo cột chạy trên mọi màn có bảng');
  process.exit(fail ? 1 : 0);
})();
