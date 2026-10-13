// Tổng quan: mỗi ô bấm vào phải ra nơi hiện ĐÚNG con số trên ô. Kèm: 3 ô owner bỏ (26/08) không còn,
// "Thuê phòng / trả phòng" đã tách thành Nhận phòng + Trả phòng.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };
const soTrong = s => { const m = String(s || '').match(/\((\d+)\)/); return m ? +m[1] : null; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));

  const veTongQuan = async () => { await page.goto('/tong-quan'); await page.waitForTimeout(3000); };
  await veTongQuan();

  // ── Cấu trúc ────────────────────────────────────────────────────────────────────
  const chu = await page.locator('.todo-grid').first().textContent();
  ok('Không còn ô "Tiền cọc"', !/Tiền cọc/.test(chu));
  ok('Không còn ô "Dự kiến xuất cảnh"', !/Dự kiến xuất cảnh/.test(chu));
  ok('Không còn KPI "HV chưa lập phiếu tháng này"', !/chưa lập phiếu tháng này/.test(await page.locator('.kpis').textContent()));
  ok('Có ô "Nhận phòng" riêng', /Nhận phòng/.test(chu));
  ok('Có ô "Trả phòng" riêng', /Trả phòng/.test(chu));
  ok('Không còn ô gộp "Thuê phòng / trả phòng"', !/Thuê phòng \/ trả phòng/.test(chu));

  // Đọc số trên từng ô
  const so = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.todo-grid .todo').forEach(t => { out[t.querySelector('.tx').textContent.trim()] = +t.querySelector('.n').textContent.trim(); });
    const kpi = [...document.querySelectorAll('.kpis .kpi')];
    const k = nhan => { const e = kpi.find(x => x.textContent.includes(nhan)); return e ? +(e.querySelector('.v').textContent.match(/\d+/) || [0])[0] : null; };
    out.__dangO = k('Học viên đang ở'); out.__giuong = k('Giường trống');
    return out;
  });
  console.log('  số trên Tổng quan:', JSON.stringify(so));

  const bam = async nhan => { await page.locator('.todo-grid .todo', { hasText: nhan }).first().click(); await page.waitForTimeout(1800); };

  // ── Nhận phòng → Đơn đăng ký (N) ─────────────────────────────────────────────────
  if (so['Nhận phòng'] > 0) {
    await bam('Nhận phòng');
    const hd = await page.locator('.panel .hd h2').first().textContent();
    ok('Nhận phòng → tiêu đề "Đơn đăng ký (N)" khớp', soTrong(hd) === so['Nhận phòng'], `${hd} vs ${so['Nhận phòng']}`);
    ok('…và số dòng bảng khớp', await page.locator('.panel tbody tr').count() === so['Nhận phòng']);
    await veTongQuan();
  } else console.log('  [BỎ QUA] Nhận phòng = 0 (ô không bấm được — đúng thiết kế)');

  // ── Trả phòng → Đơn trả phòng (N) ─────────────────────────────────────────────────
  if (so['Trả phòng'] > 0) {
    await bam('Trả phòng');
    const hd = await page.locator('.panel .hd h2').first().textContent();
    ok('Trả phòng → tiêu đề "Đơn trả phòng (N)" khớp', soTrong(hd) === so['Trả phòng'], `${hd} vs ${so['Trả phòng']}`);
    ok('…và số dòng bảng khớp', await page.locator('.panel tbody tr').count() === so['Trả phòng']);
    await veTongQuan();
  } else console.log('  [BỎ QUA] Trả phòng = 0');

  // ── Bảo trì → Báo hư hỏng (N) ────────────────────────────────────────────────────
  if (so['Bảo trì'] > 0) {
    await bam('Bảo trì');
    const hd = await page.locator('.panel .hd h2').first().textContent();
    ok('Bảo trì → tiêu đề "Báo hư hỏng (N)" khớp', soTrong(hd) === so['Bảo trì'], `${hd} vs ${so['Bảo trì']}`);
    await veTongQuan();
  } else console.log('  [BỎ QUA] Bảo trì = 0');

  // ── Đăng ký Tạm Trú → màn Tạm trú tab "Chưa đăng ký": số người quá hạn (dòng "đã ở N ngày") == số ô ──
  if (so['Đăng ký Tạm Trú'] > 0) {
    await bam('Đăng ký Tạm Trú');
    const tre = await page.locator('#content tbody tr', { hasText: /đã ở \d+ ngày/ }).count();
    ok('Tạm trú → màn Tạm trú, số người quá hạn khớp số ô', /\/tam-tru/.test(page.url()) && tre === so['Đăng ký Tạm Trú'], `${tre} vs ${so['Đăng ký Tạm Trú']}`);
    await veTongQuan();
  } else console.log('  [BỎ QUA] Tạm trú = 0');

  // ── Hợp đồng → modal, tổng các hàng == số ô ───────────────────────────────────────
  if (so['Hợp đồng'] > 0) {
    await bam('Hợp đồng');
    const tong = await page.evaluate(() => [...document.querySelectorAll('#modal .todo .n')].reduce((a, e) => a + (+e.textContent || 0), 0));
    ok('Hợp đồng → tổng các nhóm trong modal khớp', tong === so['Hợp đồng'], `${tong} vs ${so['Hợp đồng']}`);
    await page.evaluate(() => closeModal());
  } else console.log('  [BỎ QUA] Hợp đồng = 0');

  // ── Lập phiếu báo → modal, số dòng == số ô ────────────────────────────────────────
  if (so['Lập phiếu báo'] > 0) {
    await bam('Lập phiếu báo');
    await page.waitForTimeout(1500);
    const hang = await page.locator('#modal tbody tr').count();
    ok('Lập phiếu báo → modal liệt kê đúng số người', hang === so['Lập phiếu báo'], `${hang} vs ${so['Lập phiếu báo']}`);
    await page.evaluate(() => closeModal());
  } else console.log('  [BỎ QUA] Lập phiếu báo = 0');

  // ── KPI Học viên đang ở → hộp tab E2/S2/Nhân viên/An ninh, tổng các tab == số ô ─────
  const tongTab = async () => (await page.locator('#modal .seg-thu .seg').allTextContents())
    .reduce((a, x) => a + (+(x.match(/(\d+)\s*$/) || [0, 0])[1]), 0);
  await page.locator('.kpis .kpi', { hasText: 'Học viên đang ở' }).click();
  await page.waitForTimeout(600);
  const tdIn = await page.locator('#modal .mh h3').textContent();
  ok('KPI Học viên đang ở → hộp có tiêu đề đúng số', soTrong(tdIn) === so.__dangO, `${tdIn} vs ${so.__dangO}`);
  const tabIn = await tongTab();
  ok('…và tổng các tab khớp', tabIn === so.__dangO, `${tabIn} vs ${so.__dangO}`);
  await page.evaluate(() => closeModal());

  // ── KPI Giường trống → hộp tab E2/S2 → "Sang màn Phòng" lọc "còn trống" ────────────
  await page.locator('.kpis .kpi', { hasText: 'Giường trống' }).click();
  await page.waitForTimeout(600);
  const tabGiuong = await tongTab();
  ok('KPI Giường trống → tổng tab E2 + S2 khớp', tabGiuong === so.__giuong, `${tabGiuong} vs ${so.__giuong}`);
  await page.locator('#modal .mf .btn', { hasText: 'Sang màn Phòng' }).click();
  await page.waitForTimeout(2000);
  const dai = await page.locator('.pill-row .badge').first().textContent();
  ok('…bấm "Sang màn Phòng" → dải lọc nói đúng số giường', (dai || '').includes(`${so.__giuong} giường`), `${dai} vs ${so.__giuong}`);

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Mọi ô Tổng quan trỏ tới đúng con số');
  process.exit(fail ? 1 : 0);
})();
