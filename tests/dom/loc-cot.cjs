// Phễu lọc theo cột phải có ở MỌI màn có bảng, không riêng màn Học viên.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

const MAN = [['/hoc-vien', 'Học viên'], ['/phong', 'Phòng'], ['/tien-phong', 'Tiền phòng'],
  ['/ho-so', 'Hồ sơ lưu trữ'], ['/check-in', 'Check-in/out'], ['/dich-vu', 'Dịch vụ'],
  ['/dang-ky-noi-tru', 'Đăng ký'], ['/tra-phong', 'Trả phòng'], ['/bao-hong', 'Báo hư hỏng'],
  ['/vi-pham', 'Vi phạm'], ['/lich-su', 'Lịch sử']];

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));

  for (const [duong, ten] of MAN) {
    await page.goto(duong);
    await page.waitForTimeout(2600);
    const r = await page.evaluate(() => {
      const bang = [...document.querySelectorAll('.table-wrap table')]
        .filter(t => t.tBodies[0] && t.tBodies[0].querySelector('tr'));
      const cotCoChu = bang.reduce((a, t) => a + [...(t.tHead ? t.tHead.rows[0].cells : [])]
        .filter(th => (th.textContent || '').trim()).length, 0);
      return { bang: bang.length, phieu: document.querySelectorAll('.table-wrap table .col-filt').length, cotCoChu };
    });
    if (!r.bang) { console.log(`  [BỎ QUA] ${ten} — không có bảng nào có dữ liệu`); continue; }
    ok(`${ten}: có phễu lọc cột`, r.phieu > 0, `${r.bang} bảng · ${r.cotCoChu} cột có chữ · ${r.phieu} phễu`);
  }
  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} màn thiếu phễu lọc` : '\n==> Mọi màn có bảng đều có phễu lọc cột');
  process.exit(fail ? 1 : 0);
})();
