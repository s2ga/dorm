// Bấm menu "Hồ sơ lưu trữ" phải RA MÀN, không im lặng chết; bảng có cột Trạng thái tính như màn Học viên,
// cột Pháp nhân, cột Giấy tạm trú và nút lọc "Thiếu giấy tạm trú". READ-ONLY.
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

  // Cột Pháp nhân ngay sau Số HĐ (theo giới tính như form hồ sơ) · cột Giấy tạm trú ở cuối, có tệp thì là đường mở tệp
  const pn = await page.evaluate(() => {
    const th = [...document.querySelectorAll('#content thead th')].map(h => h.textContent.trim());
    const iPn = th.indexOf('Pháp nhân'), iTt = th.indexOf('Giấy tạm trú');
    const sai = [];
    let so = 0;
    document.querySelectorAll('#content tbody tr:not(.no-result)').forEach(tr => {
      const a = tr.querySelector('[data-act="studentDetail"]');
      if (!a || iPn < 0 || iTt < 0) return;
      const s = studentById(JSON.parse(a.dataset.args)[0]);
      const oPn = tr.children[iPn], oTt = tr.children[iTt], link = oTt.querySelector('a');
      so++;
      if (oPn.textContent.trim() !== legalEntityCell(s.gender) || oPn.dataset.label !== 'Pháp nhân') sai.push(`${s.name}: pháp nhân "${oPn.textContent.trim()}"`);
      if (oTt.dataset.label !== 'Giấy tạm trú' || !!link !== !!s.has_residency_doc
        || (link && link.getAttribute('href') !== `/api/students/${s.id}/residency-doc`)) sai.push(`${s.name}: giấy tạm trú`);
    });
    return { th, iPn, iTt, so, sai: sai.slice(0, 3) };
  });
  ok('Có cột "Pháp nhân" ngay sau "Số HĐ"', pn.iPn > 0 && pn.iPn === pn.th.indexOf('Số HĐ') + 1, JSON.stringify(pn.th));
  ok('Có cột "Giấy tạm trú" ở cuối bảng', pn.iTt > 0 && pn.iTt === pn.th.length - 1, JSON.stringify(pn.th));
  ok(`… mọi hàng (${pn.so}) ghi đúng pháp nhân và đúng ô giấy tạm trú`, pn.so > 0 && !pn.sai.length, pn.sai.join(' | '));
  const thieuTT = await page.evaluate(() => ST.students.filter(s => !s.deleted_at && !s.has_residency_doc).length);
  const nutTT = page.locator('[data-act="hsGo"][data-args=\'["thieu_tamtru"]\']');
  ok('Có nút lọc "Thiếu giấy tạm trú" kèm đúng số hồ sơ thiếu',
    await nutTT.count() === 1 && (await nutTT.textContent()).replace(/\s+/g, ' ').trim() === `Thiếu giấy tạm trú ${thieuTT}`,
    await nutTT.count() ? (await nutTT.textContent()).trim() : 'không có nút');
  if (await nutTT.count()) {
    await nutTT.click();
    await page.waitForTimeout(500);
    const loc = await page.evaluate(() => ({
      hang: document.querySelectorAll('#content tbody tr:not(.no-result)').length,
      coGiay: [...document.querySelectorAll('#content tbody tr:not(.no-result)')].filter(tr => tr.lastElementChild.querySelector('a')).length,
      bam: document.querySelector('[data-act="hsGo"][data-args=\'["thieu_tamtru"]\']').getAttribute('aria-pressed'),
    }));
    ok('… bấm vào → bảng còn đúng những hồ sơ chưa có giấy tạm trú', loc.hang === thieuTT && loc.coGiay === 0 && loc.bam === 'true', JSON.stringify(loc));
    await page.evaluate(() => hsGo('all'));
    await page.waitForTimeout(400);
  }
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
