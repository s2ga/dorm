// Một công thức giường trống duy nhất: KPI Tổng quan, màn Phòng (lọc 'trong'), thẻ chi tiết phòng
// phải ra CÙNG con số trên cùng bộ dữ liệu — trước đây bốn màn bốn định nghĩa.
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

  await page.goto('/tong-quan');
  await page.waitForTimeout(3200);

  const s = await page.evaluate(() => {
    const T = tongChiSo(ST.rooms);
    const tungPhong = ST.rooms.filter(phongTinhGiuong).reduce((a, r) => a + chiSoPhong(r).trong, 0);
    const kpiText = [...document.querySelectorAll('.kpis .kpi')].map(k => k.textContent).find(t => /Giường còn trống/.test(t)) || '';
    const mauWhole = tongChiSo(ST.rooms.filter(r => (r.room_type || 'shared') !== 'whole')).cap;
    return { trong: T.trong, cap: T.cap, vuot: T.vuot, datCho: T.datCho, thucCon: T.thucCon, tungPhong, kpiText, mauWhole };
  });

  ok('Σ từng phòng == tổng (không lệch tích luỹ)', s.tungPhong === s.trong, `${s.tungPhong} vs ${s.trong}`);
  // Owner chốt 21/08: KPI hiện MỘT con số = thực còn (đã trừ chỗ đặt trước), không bắt người đọc làm toán
  ok('KPI Tổng quan: số to là THỰC CÒN / mẫu số tongChiSo',
    s.kpiText.includes(`${s.thucCon}`) && s.kpiText.includes(`/ ${s.cap}`), s.kpiText.slice(0, 120));
  ok('KPI KHÔNG còn chuỗi ba số gây rối (→ thực còn / quá tải)',
    !s.kpiText.includes('→') && !/quá tải/.test(s.kpiText), s.kpiText.slice(0, 160));
  ok('Phòng whole KHÔNG góp vào mẫu số', s.mauWhole === s.cap, `bỏ whole=${s.mauWhole} vs mẫu=${s.cap}`);
  if (s.datCho > 0) {
    ok('KPI ghi chú đã trừ N chỗ đặt trước', s.kpiText.includes(`đã trừ ${s.datCho} chỗ đặt trước`), s.kpiText.slice(0, 160));
  } else console.log('  [BỎ QUA] CSDL này không có ai đặt chỗ trước');

  // Màn Phòng, lọc còn trống: dải "Đang lọc" phải nói đúng con số của tongChiSo
  await page.evaluate(() => roomGo('trong'));
  await page.waitForTimeout(1800);
  const dai = await page.locator('.pill-row .badge.gray').first().textContent();
  ok('Dải lọc "còn trống" khớp KPI (cùng số thực còn)', dai.includes(`${s.thucCon} giường`), dai);

  // Thẻ chi tiết một phòng còn chỗ: số trên thẻ == chiSoPhong của đúng phòng đó
  const p1 = await page.evaluate(() => {
    const r = ST.rooms.find(phongConCho);
    return r ? { id: r.id, ...chiSoPhong(r) } : null;
  });
  if (p1) {
    await page.evaluate(id => roomDetail(id), p1.id);
    await page.waitForTimeout(1500);
    const the = await page.locator('#modal .cards').textContent();
    ok('Thẻ phòng: ô "Còn nhận được" đúng thucCon', the.includes('Còn nhận được') && the.includes(`${p1.thucCon}`), the.slice(0, 200));
    await page.evaluate(() => closeModal());
  } else console.log('  [BỎ QUA] không có phòng nào còn chỗ');

  // Phòng quá tải: badge "vượt" phải hiện, và lọc 'vuot' ra đúng phòng
  const pv = await page.evaluate(() => {
    const r = ST.rooms.find(phongQuaTai);
    return r ? { id: r.id, vuot: chiSoPhong(r).vuot, n: ST.rooms.filter(phongQuaTai).length } : null;
  });
  if (pv) {
    await page.evaluate(() => roomGo('vuot'));
    await page.waitForTimeout(1500);
    const hang = await page.locator('.card-tbl tbody tr:not(.no-result)').count();
    ok('Lọc "vuot" ra đúng số phòng quá tải', hang === pv.n, `hàng=${hang} mong=${pv.n}`);
    ok('Hàng phòng có badge "vượt N"', (await page.locator('.card-tbl').textContent()).includes(`vượt ${pv.vuot}`));
  } else console.log('  [BỎ QUA] CSDL này không có phòng quá tải');

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Số giường đồng bộ một nguồn duy nhất');
  process.exit(fail ? 1 : 0);
})();
