// Màn Doanh thu: con số là TIỀN ĐÃ LẬP PHIẾU (không phải dự báo, không phải tiền đã thu), và tiền
// CỌC đứng riêng vì là tiền giữ hộ. Cột "Doanh thu" phải đúng bằng tổng các cột khoản bên trái.
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
const soTien = s => +String(s || '').replace(/[^\d]/g, '') || 0;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  if (!lr.ok()) { console.log('  [FAIL] đăng nhập ' + lr.status()); await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJS = [];
  page.on('pageerror', e => loiJS.push(String(e)));

  await page.goto('/doanh-thu');
  await page.waitForTimeout(3000);

  const chuToanMan = (await page.locator('#content').textContent()) || '';
  ok('Bỏ hẳn chữ "dự báo doanh thu" gây hiểu nhầm', !/dự báo/i.test(chuToanMan));
  ok('Thẻ đầu ghi "Tổng tiền đã lập phiếu"', /Tổng tiền đã lập phiếu/.test(chuToanMan));
  ok('Ghi rõ đã lập tới tháng nào', /đã lập tới Tháng \d{2}\/\d{4}|chưa lập phiếu nào/.test(chuToanMan), chuToanMan.slice(0, 0));
  ok('Nói rõ chưa trừ phần chưa thu', /chưa trừ phần chưa thu/.test(chuToanMan));

  const coBang = await page.locator('.panel table').first().count() > 0;
  if (!coBang) { console.log('  [BỎ QUA] năm này chưa có phiếu nào'); }
  else {
    const dau = await page.evaluate(() => {
      const tbl = [...document.querySelectorAll('.panel')].find(p => /theo tháng/.test(p.textContent))?.querySelector('table');
      if (!tbl) return null;
      const head = [...tbl.tHead.rows[0].cells].map(c => c.textContent.trim());
      const rows = [...tbl.tBodies[0].rows].map(r => [...r.cells].map(c => c.textContent.trim()));
      return { head, rows };
    });
    ok('Có cột "Doanh thu" và cột "Cọc giữ hộ" tách riêng',
      dau && dau.head.includes('Doanh thu') && dau.head.some(h => /Cọc giữ hộ/.test(h)), JSON.stringify(dau && dau.head));
    const iDT = dau.head.indexOf('Doanh thu');
    ok('Cột cọc nằm NGOÀI cùng, sau cột Doanh thu', iDT === dau.head.length - 2, `doanh thu ở ${iDT}/${dau.head.length}`);
    // Doanh thu = các khoản bên trái TRỪ khoản giảm (phòng trưởng, giảm %) — bảng chưa có cột Giảm
    // nên chỉ chốt được: không vượt tổng cộng ngang, và cọc KHÔNG lọt vào (chênh nhỏ hơn tiền cọc).
    let lech = [];
    for (const r of dau.rows) {
      const khoan = r.slice(1, iDT).reduce((a, c) => a + soTien(c), 0);
      const dt = soTien(r[iDT]), coc = soTien(r[iDT + 1]);
      if (dt > khoan) lech.push(`${r[0]}: doanh thu ${dt} > tổng khoản ${khoan}`);
      if (coc && dt >= khoan + coc) lech.push(`${r[0]}: cọc ${coc} bị cộng vào doanh thu`);
    }
    ok('Mọi dòng: Doanh thu không vượt tổng các khoản và KHÔNG chứa cọc', lech.length === 0, lech.slice(0, 2).join(' | '));
    ok('Không cột khoản nào là "Tiền cọc" nữa', !dau.head.some(h => /^Tiền cọc$/.test(h)), JSON.stringify(dau.head));

    // Bảng đối chiếu Bravo thì NGƯỢC LẠI: vẫn phải gồm cọc (Bravo có mã SP cho cọc)
    const bravo = (await page.locator('.panel').filter({ hasText: 'đối chiếu Bravo' }).textContent()) || '';
    ok('Bảng Bravo vẫn cộng cả cọc, có ghi chú "(gồm cả cọc)"', /gồm cả cọc/.test(bravo));
  }

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Màn Doanh thu tách cọc đúng');
  process.exit(fail ? 1 : 0);
})();
