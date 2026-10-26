// Quỹ cọc chỉ lưu thông tin: đếm người đang giữ cọc, người đã trả phòng cần xử lý cọc, người đang ở chưa ghi nhận cọc,
// và ghi kết quả Hoàn cọc / Không hoàn cọc (bắt buộc lý do). Hồ sơ giả chỉ nằm trong bộ nhớ trang, lệnh ghi bị chặn.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));
  const daGhi = [];
  await page.route(/\/api\/students\/\d+\/(deposit|deposit-settle)$/, r => {
    daGhi.push({ url: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await page.waitForTimeout(3000);
  const G = await page.evaluate(() => {
    const phong = ST.rooms.find(r => roomType(r) === 'shared');
    const hv = (id, x) => ({ id, name: 'Cọc Thử ' + id, code: 'KT' + id, gender: 'female', room_id: phong.id, room_name: phong.name,
      check_in_date: '2026-03-01', check_out_date: null, planned_check_in: null, planned_check_out: null, deleted_at: null,
      deposit_status: 'none', deposit_amount: 0, deposit_date: null, deposit_refund_date: null, deposit_deduction_note: null, ...x });
    const ds = [
      hv(990001, { check_out_date: '2026-09-30', deposit_status: 'held', deposit_amount: 1200000 }),
      hv(990002, {}),
      hv(990003, { check_out_date: '2026-08-31', deposit_status: 'forfeited', deposit_amount: 1200000, deposit_refund_date: '2026-09-02', deposit_deduction_note: 'Báo trước dưới 30 ngày' }),
      hv(990004, { check_out_date: '2026-08-31', deposit_status: 'refunded', deposit_amount: 1200000, deposit_refund_date: '2026-09-03' }),
    ];
    ST.students.push(...ds);
    window.refreshCache = async () => {};
    return { ids: ds.map(s => s.id) };
  });
  const [CAN, CHUA, KHONG, HOAN] = G.ids;

  await page.evaluate(() => quyCoc());
  await page.waitForTimeout(500);
  const chu = (await page.locator('#modal .mb').textContent() || '').replace(/\s+/g, ' ');
  ok('Ba ô: Tổng quỹ cọc đang giữ · Học viên đang giữ cọc · Cần xử lý cọc',
    /Tổng quỹ cọc đang giữ/.test(chu) && /Học viên đang giữ cọc/.test(chu) && /Cần xử lý cọc/.test(chu), chu.slice(0, 200));
  ok('Không còn chữ "Cần hoàn cọc" / dải đỏ "đang chờ hoàn cọc"', !/Cần hoàn cọc|đang chờ hoàn cọc/.test(chu));
  ok('Người đã trả phòng còn giữ cọc có nút "Xử lý cọc"', await page.locator(`#modal [data-act="xuLyCocTuQuy"][data-args='[${CAN}]']`).count() === 1);
  ok('Người đang ở chưa ghi nhận cọc hiện riêng, có nút "Ghi nhận cọc"',
    /Đang ở mà chưa ghi nhận cọc/.test(chu) && await page.locator(`#modal [data-act="ghiCocTuQuy"][data-args='[${CHUA}]']`).count() === 1);
  await page.locator('#modal details summary', { hasText: 'Đã xử lý cọc' }).click();
  const daXuLy = (await page.locator('#modal details', { hasText: 'Đã xử lý cọc' }).textContent() || '').replace(/\s+/g, ' ');
  ok('Đã xử lý cọc: hiện kết quả và lý do', /Không hoàn cọc/.test(daXuLy) && /Báo trước dưới 30 ngày/.test(daXuLy) && /Hoàn cọc/.test(daXuLy), daXuLy.slice(0, 200));

  console.log('\n-- Ghi kết quả xử lý cọc');
  await page.click(`#modal [data-act="xuLyCocTuQuy"][data-args='[${CAN}]']`);
  await page.waitForTimeout(400);
  ok('Form mở, chưa chọn sẵn kết quả', await page.locator('#xc_kq').inputValue() === '');
  ok('Form không còn bảng trừ hư hao, số tài khoản', await page.locator('#modal [data-dqty], #modal #r_acc').count() === 0);
  await page.click('#modal [data-act="luuXuLyCoc"]');
  await page.waitForTimeout(300);
  ok('Chưa chọn kết quả → báo tại ô, chưa gửi', daGhi.length === 0 && await page.locator('#modal .co-loi #xc_kq').count() === 1);
  await page.selectOption('#xc_kq', 'forfeit');
  ok('Chọn Không hoàn cọc → ô lý do thành bắt buộc', /Lý do \*/.test(await page.locator('#xc_ld_nhan').textContent() || ''));
  await page.click('#modal [data-act="luuXuLyCoc"]');
  await page.waitForTimeout(300);
  ok('Không hoàn mà để trống lý do → báo tại ô, chưa gửi', daGhi.length === 0 && await page.locator('#modal .co-loi #xc_ld').count() === 1);
  await page.fill('#xc_ld', 'Tự dọn đi, chưa ký biên bản');
  await page.click('#modal [data-act="luuXuLyCoc"]');
  await page.waitForTimeout(1200);
  ok('Lưu → gửi đúng kết quả + lý do', daGhi.length === 1 && daGhi[0].url.endsWith(`/${CAN}/deposit-settle`)
    && daGhi[0].body.action === 'forfeit' && daGhi[0].body.deduction_note === 'Tự dọn đi, chưa ký biên bản' && /^\d{4}-\d{2}-\d{2}$/.test(daGhi[0].body.date || ''), JSON.stringify(daGhi));
  ok('… quay về Quỹ cọc', /Quỹ cọc/.test(await page.locator('#modal .mh h3').textContent().catch(() => '') || ''));

  console.log('\n-- Sau khi trả phòng: gợi ý theo điều kiện hoàn cọc');
  await page.evaluate(id => { closeModalNgay(); depositSettlePrompt(id, { eligible: false, reason: 'Báo trước 10 ngày, cần tối thiểu 30 ngày' }); }, CAN);
  await page.waitForTimeout(300);
  ok('Hộp sau trả phòng chỉ còn "Để sau" và "Ghi kết quả xử lý cọc"',
    JSON.stringify((await page.locator('#modal .mf .btn').allTextContents()).map(x => x.trim())) === JSON.stringify(['Để sau', 'Ghi kết quả xử lý cọc']));
  await page.click('#modal [data-act="ghiKetQuaCocSauTra"]');
  await page.waitForTimeout(400);
  ok('Chưa đủ điều kiện → chọn sẵn Không hoàn cọc, điền sẵn lý do',
    await page.locator('#xc_kq').inputValue() === 'forfeit' && await page.locator('#xc_ld').inputValue() === 'Báo trước 10 ngày, cần tối thiểu 30 ngày');

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Quỹ cọc lưu thông tin và ghi kết quả đúng');
  process.exit(fail ? 1 : 0);
})();
