// Bấm menu "Hồ sơ lưu trữ" phải RA MÀN, không im lặng chết; bảng có cột Trạng thái tính như màn Học viên. READ-ONLY.
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
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }

  const page = await ctx.newPage();
  const loiJS = [];
  page.on('pageerror', e => loiJS.push(String(e)));
  await page.goto('/');
  await page.waitForTimeout(2500);

  const nut = page.locator('#nav button[data-v="hoso"]');
  ok('Menu có mục Hồ sơ lưu trữ', await nut.count() > 0);
  if (await nut.count()) {
    // Menu bên có thể nằm ngoài khung nhìn — bắn click thẳng trên DOM, đúng đường người dùng đi.
    await page.evaluate(() => document.querySelector('#nav button[data-v="hoso"]').click());
    await page.waitForTimeout(1800);
  }

  const tieuDe = (await page.locator('#pgTitle').textContent() || '').trim();
  ok('Tiêu đề trang đổi sang Hồ sơ lưu trữ', tieuDe === 'Hồ sơ lưu trữ', 'đang là "' + tieuDe + '"');
  ok('Đường dẫn đổi sang /ho-so', new URL(page.url()).pathname === '/ho-so', page.url());

  const coBang = await page.locator('#content table').count();
  const coRong = await page.locator('#content .empty').count();
  ok('Vùng nội dung có bảng hoặc trạng thái rỗng — KHÔNG trắng trơn', coBang + coRong > 0,
    'html dài ' + ((await page.locator('#content').innerHTML()) || '').length + ' ký tự');
  ok('Có hàng pill lọc thiếu giấy tờ', await page.locator('[data-act="hsGo"]').count() >= 4);

  // Cột Trạng thái (đang ở / sắp vào / đã trả…) cạnh cột Phòng, cùng cách tính với màn Học viên
  const tt = await page.evaluate(() => {
    const th = [...document.querySelectorAll('#content thead th')].map(h => h.textContent.trim());
    const i = th.indexOf('Trạng thái');
    const sai = [];
    let so = 0;
    document.querySelectorAll('#content tbody tr:not(.no-result)').forEach(tr => {
      const a = tr.querySelector('[data-act="studentDetail"]');
      if (!a || i < 0) return;
      const s = studentById(JSON.parse(a.dataset.args)[0]);
      const mong = STATUS_INFO[liveStatus(s)][0], co = tr.children[i].textContent.trim();
      so++;
      if (co !== mong || tr.children[i].dataset.label !== 'Trạng thái') sai.push(`${s.name}: ${co} ≠ ${mong}`);
    });
    return { th, i, so, sai: sai.slice(0, 3) };
  });
  ok('Bảng có cột "Trạng thái" ngay sau "Phòng", cột hợp đồng ghi "Tình trạng HĐ"',
    tt.i === tt.th.indexOf('Phòng') + 1 && tt.th.includes('Tình trạng HĐ'), JSON.stringify(tt.th));
  ok(`… mọi hàng (${tt.so}) ghi đúng trạng thái như màn Học viên`, tt.so > 0 && !tt.sai.length, tt.sai.join(' | '));
  const dangO = await page.evaluate(() => ST.students.filter(s => !s.deleted_at && liveStatus(s) === 'staying').length);
  await page.fill('#hsSearch', 'đang ở');
  await page.waitForTimeout(400);
  const hien = await page.evaluate(() => [...document.querySelectorAll('#content tbody tr:not(.no-result)')].filter(r => r.style.display !== 'none').length);
  ok('Gõ "đang ở" vào ô tìm → còn đúng những người đang ở', hien === dangO, `hiện ${hien} · đang ở ${dangO}`);
  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Màn Hồ sơ lưu trữ mở được bình thường');
  process.exit(fail ? 1 : 0);
})();
