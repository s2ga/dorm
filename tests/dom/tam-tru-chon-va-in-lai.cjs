// Màn Tạm trú 4 tab, lọc tháng bằng lịch: ba tab đầu có ô chọn tình trạng (chọn là lưu), tab in lập lại được đợt
// "Đang xử lý" theo tháng; ô "Đăng ký Tạm Trú" ở Tổng quan vào thẳng màn này.
// Lệnh PUT hồ sơ bị chặn bằng page.route — không ghi gì vào CSDL; tình trạng chỉ đặt trong bộ nhớ trang.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };
const TEN_TAB = ['Chưa đăng ký', 'Đang xử lý', 'Đã hoàn thành', 'Tạo danh sách gửi cơ quan chức năng'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));

  const daGui = [];
  let hongId = 0;
  await page.route(/\/api\/students\/\d+$/, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const id = +route.request().url().match(/(\d+)$/)[1];
    daGui.push({ id, body: route.request().postDataJSON() });
    if (id === hongId) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Lỗi thử"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/students/*/cccd/*', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540"/>' }));

  await page.goto('/');
  await page.waitForTimeout(3000);
  // Dựng dữ liệu trong bộ nhớ: 3 người "Đang xử lý" vào tháng này (đủ ảnh), 1 người "Đã hoàn thành".
  const d = await page.evaluate(() => {
    const thang = curMonth();
    const occ = ST.students.filter(s => isOccupying(s) && !s.deleted_at);
    const dang = occ.slice(0, 3), xong = occ.slice(3, 4);
    dang.forEach((s, i) => { s.residency_status = 'processing'; s.has_cccd_front = true; s.has_cccd_back = true; s.check_in_date = `${thang}-0${i + 1}`; });
    xong.forEach(s => { s.residency_status = 'registered'; });
    viewDashboard();
    const dem = st => ST.students.filter(s => isOccupying(s) && s.residency_status === st).length;
    return { thang, dang: dang.map(s => s.id), tenDang: dang.map(s => s.name), so: { chua: dem('unregistered'), dang: dem('processing'), xong: dem('registered') } };
  });
  ok('Có đủ học viên đang ở để thử', d.dang.length === 3, JSON.stringify(d.dang));

  console.log('\n-- Tổng quan → màn Tạm trú');
  const o = page.locator('.todo-grid .todo', { hasText: 'Đăng ký Tạm Trú' });
  if (await o.getAttribute('data-act') === 'tamTruGo') {
    await o.click();
    await page.waitForTimeout(1500);
    ok('Bấm ô "Đăng ký Tạm Trú" → vào thẳng màn Tạm trú, không mở hộp', /\/tam-tru/.test(page.url()) && !(await page.locator('#overlay.show').count()), page.url());
  } else {
    ok('Ô "Đăng ký Tạm Trú" trỏ tới màn Tạm trú (BỎ QUA: số trên ô = 0 nên ô không bấm được)', true);
    await page.evaluate(() => tamTruGo('chua'));
    await page.waitForTimeout(1500);
  }
  ok('Không còn hàm hộp "Đăng ký tạm trú" cũ', await page.evaluate(() => typeof residencyModal === 'undefined'));

  const nhanTab = (await page.locator('#content .seg-thu.tab .seg').allTextContents()).map(x => x.trim());
  ok('Đủ 4 tab đúng tên, đúng thứ tự', TEN_TAB.every((t, i) => (nhanTab[i] || '').startsWith(t)), nhanTab.join(' | '));
  ok('Số trên tab đúng số người', nhanTab[0] === `Chưa đăng ký (${d.so.chua})` && nhanTab[1] === `Đang xử lý (${d.so.dang})` && nhanTab[2] === `Đã hoàn thành (${d.so.xong})`, nhanTab.slice(0, 3).join(' | '));
  const chu = (await page.locator('#content').textContent() || '');
  ok('Không còn các dòng ghi chú cũ', !/xếp theo phòng rồi theo tên|thứ tự ảnh trên giấy|Bản in chỉ có ảnh|sẽ in/.test(chu));

  console.log('\n-- Lọc tháng bằng lịch');
  ok('Mặc định tất cả tháng: ô tháng trống, nút "Tất cả tháng" đang bật', await page.locator('#ttThang').inputValue() === ''
    && await page.locator('[data-act="tamTruTatCaThang"]').getAttribute('aria-pressed') === 'true');
  await page.click('#ttThang');
  await page.waitForTimeout(300);
  ok('Bấm ô tháng mở lịch 12 tháng', await page.locator('.cal-pop .mo-cell').count() === 12);
  await page.locator(`.cal-pop .mo-cell[data-ym="${d.thang}"]`).click();
  await page.waitForTimeout(800);
  ok('Chọn tháng → ghi lên đường dẫn', page.url().includes('thang=' + d.thang), page.url());

  console.log('\n-- Tab Đang xử lý: ô chọn tình trạng');
  await page.click('#content .seg-thu.tab .seg:nth-child(2)');
  await page.waitForTimeout(800);
  ok('Đường dẫn ghi tab', page.url().includes('tab=dang-xu-ly'), page.url());
  const tieuDe = (await page.locator('#content thead').first().textContent() || '').replace(/\s+/g, ' ');
  ok('Bảng có cột Tình trạng, không có Hợp đồng/Cọc/Trả phòng', /Tình trạng/.test(tieuDe) && !/Hợp đồng|Cọc/.test(tieuDe)
    && await page.locator('#content [data-act="checkOutForm"]').count() === 0, tieuDe);
  const oChon = id => page.locator(`#content select[data-change="doiTamTru"][data-args='[${id}]']`);
  ok('3 người đang xử lý tháng này đều có ô chọn đang "Đang xử lý"',
    (await Promise.all(d.dang.map(async id => (await oChon(id).count()) && oChon(id).inputValue()))).every(v => v === 'processing'));
  ok('Ô chọn có 3 tình trạng trùng tên tab', JSON.stringify(await oChon(d.dang[0]).locator('option').allTextContents()) === JSON.stringify(TEN_TAB.slice(0, 3)));

  await oChon(d.dang[0]).selectOption('registered');
  for (let t = 0; t < 3000 && !daGui.length; t += 100) await page.waitForTimeout(100);
  await page.waitForTimeout(600);
  ok('Chọn "Đã hoàn thành" → gửi đúng một lệnh lưu cho đúng người',
    daGui.length === 1 && daGui[0].id === d.dang[0] && JSON.stringify(daGui[0].body) === '{"residency_status":"registered"}', JSON.stringify(daGui));
  ok('Hồ sơ rời tab Đang xử lý, số trên tab cập nhật', await oChon(d.dang[0]).count() === 0
    && (await page.locator('#content .seg-thu.tab .seg:nth-child(2)').textContent() || '').includes('(2)'));
  ok('Có báo đã chuyển', /Đã hoàn thành/.test(await page.locator('#toast').textContent() || ''));

  hongId = d.dang[1];
  await oChon(d.dang[1]).selectOption('unregistered');
  await page.waitForTimeout(1200);
  ok('Lưu hỏng → ô chọn quay về tình trạng cũ, hồ sơ vẫn ở tab', await oChon(d.dang[1]).inputValue() === 'processing');
  hongId = 0;

  console.log('\n-- Tab Tạo danh sách gửi cơ quan chức năng');
  await page.click('#content .seg-thu.tab .seg:nth-child(4)');
  await page.waitForTimeout(800);
  ok('Mặc định lập danh sách người "Chưa đăng ký"', await page.locator('#ttTT').inputValue() === 'unregistered');
  await page.selectOption('#ttTT', 'processing');
  await page.waitForTimeout(800);
  const bang = await page.locator('#content .rc-noprint').first().textContent() || '';
  ok('Chọn "Đang xử lý" + tháng → ra lại đợt đã gửi', d.tenDang.slice(1).every(t => bang.includes(t)), d.tenDang.slice(1).join(', '));
  ok('Nút in ghi đúng số', /In danh sách \(2\)/.test(await page.locator('#topActions').textContent() || ''));
  const doMo = () => page.evaluate(() => getComputedStyle(document.querySelector('#printArea .tt-cong-cu')).opacity);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  ok('Nút sửa ảnh ẩn khi chưa trỏ chuột vào ảnh', await doMo() === '0', await doMo());
  await page.hover('#printArea .tt-cell');
  await page.waitForTimeout(400);
  ok('Trỏ chuột vào ảnh → hiện nút xoay, cắt', await doMo() === '1', await doMo());
  await page.mouse.move(5, 5);
  ok('Đường dẫn ghi đủ tab + tháng + tình trạng', /tab=danh-sach-gui/.test(page.url()) && /tt=dang-xu-ly/.test(page.url()) && page.url().includes('thang=' + d.thang), page.url());
  await page.evaluate(() => { window.__soLanIn = 0; window.print = () => { window.__soLanIn++; }; });
  await page.click('#topActions [data-act="tamTruIn"]');
  await page.waitForTimeout(500);
  ok('In lại đợt đang xử lý: mở hộp in, không hỏi chuyển lần nữa', await page.evaluate(() => window.__soLanIn) === 1 && !(await page.locator('#overlay.show').count()));

  await page.reload();
  await page.waitForTimeout(3000);
  ok('F5 giữ đúng tab, tháng, tình trạng', await page.locator('#ttTT').inputValue().catch(() => '') === 'processing'
    && (await page.locator('#content .seg-thu.tab .seg.on').textContent() || '').startsWith(TEN_TAB[3])
    && (await page.locator('#ttThang').inputValue()) === `Tháng ${d.thang.slice(5)}/${d.thang.slice(0, 4)}`);

  await page.click('[data-act="tamTruTatCaThang"]');
  await page.waitForTimeout(800);
  ok('Bấm "Tất cả tháng" → bỏ lọc tháng', !page.url().includes('thang=') && await page.locator('#ttThang').inputValue() === '', page.url());

  console.log('\n-- Điện thoại 390px');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => tamTruTab('chua'));
  await page.waitForTimeout(1000);
  ok('Trang không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0);

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Màn Tạm trú 4 tab chạy đúng');
  process.exit(fail ? 1 : 0);
})();
