// Cổng học viên: bảng Phiếu báo tiền phòng và hộp chi tiết phiếu KHÔNG hiện trạng thái thu (Chưa thu / Đã thu).
// Dữ liệu giả qua page.route, mọi request ghi đều bị chặn.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

const phieu = (id, month, status, paid) => ({
  id, month, status, paid_date: paid || null, days_stayed: 30, room_charge: 1200000, electric_charge: 55140, electric_kwh: 15.2,
  water_charge: 100000, service_charge: 100000, washing_charge: 50000, parking_charge: 0, other_charge: 0, deposit_charge: 0,
  leader_discount: 0, room_discount: 0, fee_discount: 0, total: 1505140,
});
const HV = {
  '/api/me/profile': { id: 990099, name: 'HV thử', gender: 'female', code: 'HV-THU', status: 'in', check_in_date: '2026-01-05', room_name: '201', deposit_status: 'held' },
  '/api/me/invoices': [phieu(990201, '2026-11', 'pending'), phieu(990202, '2026-10', 'paid', '2026-10-05')],
  '/api/me/checkout-request': [], '/api/me/violations': [], '/api/me/roommates': [], '/api/me/assets': [],
  '/api/me/chores': [], '/api/me/logs': [], '/api/me/notifications': [], '/api/me/damage': [],
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [], daGhi = [];
  page.on('pageerror', e => loi.push(String(e)));
  await page.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      daGhi.push(route.request().method() + ' ' + p);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (p in HV) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HV[p]) });
    return route.continue();
  });

  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.evaluate(() => { Auth.user = { id: 990099, username: 'hvthu', full_name: 'HV thử', role: 'student' }; renderStudent(); });
  await page.waitForSelector('#pnPhieu tbody tr', { timeout: 15000 });

  const bang = (await page.locator('#pnPhieu').textContent()) || '';
  ok('Bảng phiếu có đủ 2 kỳ', /Tháng 11\/2026/.test(bang) && /Tháng 10\/2026/.test(bang), bang.slice(0, 200));
  ok('Bảng phiếu không có chữ "Chưa thu" / "Đã thu"', !/Chưa thu|Đã thu/.test(bang), bang.slice(0, 300));
  ok('Bảng phiếu không có huy hiệu trạng thái ở cột Kỳ', await page.locator('#pnPhieu tbody td:first-child .badge').count() === 0);

  await page.click('#pnPhieu tbody tr:nth-child(2)');
  await page.waitForSelector('#modal .mh', { timeout: 5000 });
  const hop = (await page.locator('#modal').textContent()) || '';
  ok('Hộp chi tiết phiếu mở đúng kỳ', /Chi tiết phiếu Tháng 10\/2026/.test(hop), hop.slice(0, 120));
  ok('Hộp chi tiết không có chữ "Chưa thu" / "Đã thu"', !/Chưa thu|Đã thu/.test(hop), hop.slice(0, 300));
  ok('Hộp chi tiết vẫn có số ngày ở và tổng cộng', /Số ngày ở trong kỳ: 30 ngày/.test(hop) && /Tổng cộng/.test(hop), hop.slice(0, 300));

  ok('Không request ghi nào', daGhi.length === 0, daGhi.join(', '));
  ok('Không có lỗi JavaScript', loi.length === 0, loi.join(' | '));
  await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Cổng học viên không hiện trạng thái thu');
  process.exit(fail ? 1 : 0);
})();
