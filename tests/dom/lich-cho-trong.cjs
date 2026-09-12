// Tab "Lịch chỗ trống" ở màn Phòng: lưới tháng ăn CÙNG nguồn số với KPI (tongChiSo),
// ô hôm nay phải khớp tuyệt đối Tổng quan — không được thành định nghĩa thứ sáu.
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
  let goiLich = 0;
  page.on('request', r => { if (/\/api\/rooms\/lich\?/.test(r.url())) goiLich++; });

  await page.goto('/phong?tab=lich');
  await page.waitForTimeout(3200);

  ok('Lưới lịch tồn tại (#lctGrid)', await page.locator('#lctGrid').count() > 0);
  const soO = await page.locator('#lctGrid .lct-d:not(.mo)').count();
  ok('Đủ ô ngày trong tháng (28-31)', soO >= 28 && soO <= 31, String(soO));
  ok('KHÔNG nằm trong card-tbl (bẫy display:block ở mobile)',
    await page.locator('.card-tbl #lctGrid').count() === 0);
  ok('Ô ngày là <button> focus được', await page.locator('#lctGrid button.lct-d').count() > 0);
  ok('Ô hôm nay có class nay', await page.locator('#lctGrid .lct-d.nay').count() === 1);
  // Kiểu Booking/Agoda: MỖI Ô MỘT con số lớn + nền theo mức; nam/nữ xuống dòng phụ nhỏ.
  ok('Mỗi ô đúng MỘT con số lớn', await page.locator('#lctGrid .lct-so').count() === soO,
    `${await page.locator('#lctGrid .lct-so').count()}/${soO}`);
  ok('Không còn kiểu cũ nhồi 4 số/ô (.lct-gt/.lct-v/.lct-k)',
    await page.locator('#lctGrid .lct-gt, #lctGrid .lct-v, #lctGrid .lct-k').count() === 0);
  ok('Chế độ "Tất cả": dòng phụ tách ♂/♀',
    /♂\d+ · ♀\d+/.test(await page.locator('#lctGrid .lct-ph').first().textContent() || ''),
    await page.locator('#lctGrid .lct-ph').first().textContent());
  ok('Có chip "Tất cả" để bỏ lọc giới tính',
    await page.locator('[data-act="lichGioiTinh"][data-args=\'[""]\']').count() === 1);
  ok('Mỗi ô được tô một mức còn chỗ (còn / sắp hết / hết / quá tải)',
    await page.locator('#lctGrid .lct-d.co, #lctGrid .lct-d.it, #lctGrid .lct-d.het, #lctGrid .lct-d.vuot').count() === soO);
  ok('Có chú giải màu thay cho ký hiệu ▨ ⌀ ▾ ▴', await page.locator('.lct-legend .lct-lg').count() === 3);

  // Ô hôm nay khớp tuyệt đối KPI (tongChiSo trên ST.rooms)
  const so = await page.evaluate(() => {
    const T = tongChiSo(ST.rooms);
    const nam = tongNgay(today(), 'male'), nu = tongNgay(today(), 'female');
    return { kpi: T.thucCon, lich: (nam ? nam.thucCon : 0) + (nu ? nu.thucCon : 0) };
  });
  ok('Ô hôm nay == KPI Tổng quan (cùng số thực còn)', so.kpi === so.lich, JSON.stringify(so));

  // Bấm một ngày → panel phải đổi theo, hiện danh sách phòng
  await page.locator('#lctGrid button.lct-d').nth(10).click();
  await page.waitForTimeout(1500);
  ok('Bấm ngày → panel phải có bảng phòng', await page.locator('#lctNgayPanel table').count() > 0);
  ok('URL mang ?ngay= (deep-link)', /ngay=\d{4}-\d{2}-\d{2}/.test(page.url()), page.url());

  // Lọc giới tính → ô lịch chuyển sang MỘT số + màu
  await page.locator('[data-act="lichGioiTinh"][data-args*="male"]').first().click();
  await page.waitForTimeout(1500);
  ok('Lọc Nam: vẫn một số/ô, dòng phụ bỏ tách ♂/♀',
    await page.locator('#lctGrid .lct-so').count() > 0
    && !/♂/.test(await page.locator('#lctGrid .lct-ph').first().textContent() || ''),
    await page.locator('#lctGrid .lct-ph').first().textContent());

  // Lật tháng trong cửa sổ đệm → không gọi mạng thêm
  const truoc = goiLich;
  await page.locator('[data-act="lichThang"][data-args="[1]"]').click();
  await page.waitForTimeout(1200);
  ok('Lật tháng trong cửa sổ đã tải → có thể thêm tối đa 1 lượt gọi', goiLich - truoc <= 1, `thêm ${goiLich - truoc}`);

  // Deep-link ?tab=lich&gt=female
  await page.goto('/phong?tab=lich&gt=female');
  await page.waitForTimeout(2500);
  ok('Deep-link gt=female: nút Nữ đang bật',
    await page.locator('[data-act="lichGioiTinh"][aria-pressed="true"]').count() === 1);

  // Không cuộn ngang ở khổ 1140
  await page.setViewportSize({ width: 1140, height: 900 });
  await page.waitForTimeout(600);
  const cuon = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('Không cuộn ngang ngoài ý muốn', cuon <= 1, `tràn ${cuon}px`);

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Tab Lịch chỗ trống chạy đúng');
  process.exit(fail ? 1 : 0);
})();
