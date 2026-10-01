// Test giao diện (Playwright), KHÔNG ghi dữ liệu: danh sách rỗng theo hai mẫu câu ("Chưa có …" / "Không có … khớp
// bộ lọc." + nút "Xóa bộ lọc"), và nút đó bỏ được hết — ô tìm, phễu cột, bộ lọc riêng của màn — ở Học viên, Phòng,
// Phiếu báo, Hồ sơ lưu trữ, Đơn đăng ký, Nhật ký, Tài khoản học viên.
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
const VO_NGHIA = 'zzqx-khong-ai-ten-nay';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [], daGhi = [];
  page.on('pageerror', e => loiJs.push(String(e)));
  page.on('dialog', d => d.dismiss());
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.continue();
    daGhi.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  let donGia = null;   // null = để đơn đăng ký thật đi qua; mảng = trả mảng này
  await page.route(u => new URL(u).pathname === '/api/applications', route =>
    donGia && route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(donGia) })
      : route.fallback());

  const cho = async (fn, arg, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); }
    return false;
  };
  const go = async (sel, txt) => { await page.fill(sel, txt); await page.waitForTimeout(350); };
  const hangRong = sel => page.evaluate(s => {
    const r = document.querySelector(s + ' .no-result');
    return r ? { hien: r.style.display !== 'none', chu: r.textContent.replace(/\s+/g, ' ').trim(), nut: !!r.querySelector('[data-act="xoaLocBang"]') } : null;
  }, sel);
  const soHangHien = sel => page.evaluate(s => [...document.querySelectorAll(s + ' tbody tr:not(.no-result)')]
    .filter(r => r.style.display !== 'none').length, sel);
  const oTrong = () => page.evaluate(() => {
    const d = document.querySelector('#content .empty');
    return d ? { chu: d.textContent.replace(/\s+/g, ' ').trim(), nut: [...d.querySelectorAll('button')].map(b => b.textContent.trim()) } : null;
  });

  // ── Học viên ───────────────────────────────────────────────────────────────
  await page.goto('/hoc-vien'); await cho(() => !!document.getElementById('ss') && ST.students.length > 0);
  const truoc = await soHangHien('#content');
  await go('#ss', VO_NGHIA);
  let r = await hangRong('#content');
  ok('Học viên: tìm không ra → "Không có học viên khớp bộ lọc." + nút "Xóa bộ lọc"',
    r && r.hien && r.chu.startsWith('Không có học viên khớp bộ lọc.') && /Xóa bộ lọc/.test(r.chu) && r.nut, JSON.stringify(r));
  await page.click('#content .no-result [data-act="xoaLocBang"]');
  await page.waitForTimeout(400);
  let s = await page.evaluate(() => ({ q: el('ss').value, url: location.search, bien: stuSearch }));
  ok('… bấm "Xóa bộ lọc" → ô tìm trống, URL bỏ ?q=, danh sách hiện lại như trước',
    s.q === '' && s.bien === '' && !/[?&]q=/.test(s.url) && await soHangHien('#content') === truoc, JSON.stringify(s));

  await page.evaluate(() => stuGoAdmin('in_ktx'));
  await cho(() => stuFilter === 'in_ktx' && !!document.getElementById('ss'));
  if (await soHangHien('#content') === 0) ok('Học viên lọc "Đang ở" + tìm (BỎ QUA: không ai đang ở)', true);
  else {
    await go('#ss', VO_NGHIA);
    await page.click('#content .no-result [data-act="xoaLocBang"]');
    await page.waitForTimeout(700);
    s = await page.evaluate(() => ({ loc: stuFilter, q: (el('ss') || {}).value, thanhLoc: !!document.querySelector('#content .pill-row [data-act="stuGo"]') }));
    ok('Học viên đang lọc "Đang ở" + tìm không ra → "Xóa bộ lọc" bỏ cả bộ lọc màn lẫn ô tìm',
      s.loc === 'all' && s.q === '' && !s.thanhLoc, JSON.stringify(s));
  }

  await page.evaluate(() => xuatCanhGo('1999'));
  await cho(() => stuFilter === 'departure' && !!document.querySelector('#content .empty'));
  let e = await oTrong();
  ok('Học viên lọc ra rỗng → "Không có học viên khớp bộ lọc." (không nói "Chưa có") + nút',
    e && e.chu.startsWith('Không có học viên khớp bộ lọc.') && e.nut.includes('✕ Xóa bộ lọc'), JSON.stringify(e));
  await page.click('#content .empty [data-act="stuGo"]');
  ok('… bấm → về "Tất cả", có danh sách', await cho(() => stuFilter === 'all' && document.querySelectorAll('#content tbody tr:not(.no-result)').length > 0));
  ok('Thanh "Đang lọc" dùng cùng nhãn "Xóa bộ lọc"', await page.evaluate(() => {
    xuatCanhGo('1999');
    const b = document.querySelector('#content .pill-row [data-act="stuGo"]');
    return !!b && b.textContent.trim() === '✕ Xóa bộ lọc';
  }));

  // ── Phòng ──────────────────────────────────────────────────────────────────
  await page.goto('/phong'); await cho(() => !!document.getElementById('rs'));
  await go('#rs', VO_NGHIA);
  r = await hangRong('#content');
  ok('Phòng: tìm không ra → "Không có phòng khớp bộ lọc." + nút', r && r.hien && r.chu.startsWith('Không có phòng khớp bộ lọc.') && r.nut, JSON.stringify(r));
  await page.click('#content .no-result [data-act="xoaLocBang"]');
  await page.waitForTimeout(400);
  ok('… bấm → ô tìm trống, phòng hiện lại', await page.evaluate(() => el('rs').value === '' && roomSearch === '') && await soHangHien('#content') > 0);
  if (await page.evaluate(() => ST.rooms.some(phongQuaTai))) ok('Phòng lọc "quá tải" rỗng (BỎ QUA: đang có phòng quá tải)', true);
  else {
    await page.evaluate(() => roomGo('vuot'));
    await cho(() => roomFilter === 'vuot' && !!document.querySelector('#content .empty'));
    e = await oTrong();
    ok('Phòng lọc "quá tải" ra rỗng → "Không có phòng khớp bộ lọc." chứ không "Chưa có phòng nào. Bấm Thêm phòng"',
      e && e.chu.startsWith('Không có phòng khớp bộ lọc.') && !/Chưa có phòng/.test(e.chu) && e.nut.includes('✕ Xóa bộ lọc'), JSON.stringify(e));
    await page.evaluate(() => roomGo('all'));
  }

  // ── Phiếu báo: pill "Đã thu/Chưa thu" là bộ lọc riêng của màn ──────────────
  const ky = await page.evaluate(async () => {
    for (const m of [curMonth(), _thangTruoc(curMonth()), _thangTruoc(_thangTruoc(curMonth()))]) if ((await API.invoices(m)).length) return m;
    return null;
  });
  if (!ky) ok('Phiếu báo (BỎ QUA: ba kỳ gần nhất không có phiếu nào)', true);
  else {
    await page.evaluate(m => { invMonth = m; invFilter = 'all'; invSearch = ''; adminGo('invoices'); }, ky);
    await cho(() => !!document.getElementById('invs') && !!_invTbl);
    await page.evaluate(() => invLoc('paid'));
    await go('#invs', VO_NGHIA);
    r = await hangRong('#content');
    ok(`Phiếu báo kỳ ${ky}: tìm không ra → "Không có phiếu báo khớp bộ lọc." + nút`, r && r.hien && r.chu.startsWith('Không có phiếu báo khớp bộ lọc.') && r.nut, JSON.stringify(r));
    await page.click('#content .no-result [data-act="xoaLocBang"]');
    await page.waitForTimeout(500);
    s = await page.evaluate(() => ({ loc: invFilter, q: el('invs').value, bien: invSearch, url: location.search }));
    ok('… bấm → bỏ cả pill "Đã thu" lẫn ô tìm', s.loc === 'all' && s.q === '' && s.bien === '' && !/[?&]q=/.test(s.url), JSON.stringify(s));
  }

  // ── Hồ sơ lưu trữ ──────────────────────────────────────────────────────────
  await page.goto('/ho-so'); await cho(() => !!document.getElementById('hsSearch'));
  let daThuTim = false;
  for (const [loc, ten] of [['du', 'Đủ giấy tờ'], ['thieu', 'Còn thiếu']]) {
    await page.evaluate(k => { hsLoc = 'all'; hsGo(k); }, loc);
    await cho(k => hsLoc === k && !!document.getElementById('hsSearch'), loc);
    if (await soHangHien('#content') === 0) {
      e = await oTrong();
      ok(`Hồ sơ lọc "${ten}" ra rỗng → "Không có hồ sơ khớp bộ lọc." + nút`, e && e.chu.startsWith('Không có hồ sơ khớp bộ lọc.') && e.nut.includes('✕ Xóa bộ lọc'), JSON.stringify(e));
      continue;
    }
    await go('#hsSearch', VO_NGHIA);
    r = await hangRong('#content');
    ok(`Hồ sơ lọc "${ten}" + tìm không ra → có hàng "Không có hồ sơ khớp bộ lọc." (trước đây bảng trắng trơn) + nút`,
      r && r.hien && r.chu.startsWith('Không có hồ sơ khớp bộ lọc.') && r.nut, JSON.stringify(r));
    await page.click('#content .no-result [data-act="xoaLocBang"]');
    await page.waitForTimeout(700);
    s = await page.evaluate(() => ({ loc: hsLoc, q: (el('hsSearch') || {}).value }));
    ok(`… bấm → bỏ cả pill "${ten}" lẫn ô tìm`, s.loc === 'all' && s.q === '', JSON.stringify(s));
    daThuTim = true;
    break;
  }
  if (!daThuTim) ok('Hồ sơ: tìm trong bộ lọc (BỎ QUA: cả hai bộ lọc đều rỗng)', true);

  // ── Đơn đăng ký (dữ liệu giả): tab mặc định rỗng = tin tốt, tab khác rỗng = khớp bộ lọc ──
  donGia = [{ id: 999901, status: 'approved', name: 'Đơn thử', phone: '0900000000', gender: 'female', created_at: '2026-10-01T00:00:00Z' }];
  await page.evaluate(() => { regFilter = 'pending'; adminGo('reg'); });
  await cho(() => ST.view === 'reg' && !!document.querySelector('#pnDon'));
  e = await oTrong();
  ok('Đơn đăng ký: tab "Chờ duyệt" rỗng → "Không có đơn đăng ký chờ duyệt.", không kèm nút xoá lọc',
    e && e.chu === 'Không có đơn đăng ký chờ duyệt.' && !e.nut.length, JSON.stringify(e));
  await page.evaluate(() => regGo('rejected'));
  await cho(() => regFilter === 'rejected' && !!document.querySelector('#pnDon .empty'));
  e = await oTrong();
  ok('… tab "Từ chối" rỗng → "Không có đơn đăng ký khớp bộ lọc." + nút', e && e.chu.startsWith('Không có đơn đăng ký khớp bộ lọc.') && e.nut.includes('✕ Xóa bộ lọc'), JSON.stringify(e));
  await page.click('#pnDon .empty [data-act="regGo"]');
  ok('… bấm → tab "Tất cả", hiện đơn', await cho(() => regFilter === 'all' && document.querySelectorAll('#pnDon tbody tr').length === 1));
  donGia = [];
  await page.evaluate(() => { regFilter = 'pending'; viewRequests(); });
  await cho(() => !!document.querySelector('#pnDon .empty'));
  e = await oTrong();
  ok('… chưa có đơn nào → "Chưa có đơn đăng ký nào."', e && e.chu === 'Chưa có đơn đăng ký nào.', JSON.stringify(e));
  donGia = null;

  // ── Nhật ký ────────────────────────────────────────────────────────────────
  await page.goto('/nhat-ky'); await cho(() => !!document.getElementById('auUser'));
  await page.evaluate(v => { auditFilter = { user: v, from: '', to: '', offset: 0 }; viewAudit(); }, VO_NGHIA);
  await cho(() => !!document.querySelector('#content .empty'));
  e = await oTrong();
  ok('Nhật ký lọc không ra → "Không có bản ghi khớp bộ lọc." + nút', e && e.chu.startsWith('Không có bản ghi khớp bộ lọc.') && e.nut.includes('✕ Xóa bộ lọc'), JSON.stringify(e));
  await page.click('#content .empty [data-act="xoaLocNhatKy"]');
  ok('… bấm → bỏ lọc, có bản ghi', await cho(() => auditFilter.user === '' && document.querySelectorAll('#content tbody tr').length > 0));

  // ── Tài khoản học viên (Cài đặt) ───────────────────────────────────────────
  await page.evaluate(() => gotoUsers());
  await cho(() => document.querySelectorAll('#stuAccRows tr[data-s]').length > 0, null, 20000);
  if (!await page.evaluate(() => document.querySelectorAll('#stuAccRows tr[data-s]').length)) ok('Tài khoản học viên (BỎ QUA: chưa có tài khoản nào)', true);
  else {
    await go('#stuAccSearch', VO_NGHIA);
    r = await hangRong('#stuAccPanel');
    ok('Tài khoản học viên: tìm không ra → có hàng "Không có tài khoản học viên khớp bộ lọc." (trước đây bảng trắng) + nút',
      r && r.hien && r.chu.startsWith('Không có tài khoản học viên khớp bộ lọc.') && r.nut, JSON.stringify(r));
    await page.click('#stuAccPanel .no-result [data-act="xoaLocBang"]');
    await page.waitForTimeout(400);
    ok('… bấm → ô tìm trống, tài khoản hiện lại', await page.evaluate(() => el('stuAccSearch').value === '') && await soHangHien('#stuAccPanel') > 0);
  }

  ok('Không request ghi nào (đều bị chặn, và không có cái nào)', daGhi.length === 0, daGhi.join(', '));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Danh sách rỗng: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
