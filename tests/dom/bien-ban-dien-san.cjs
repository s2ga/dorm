// BL-121: an ninh LẬP biên bản (số công-tơ là bắt buộc), quản trị chỉ XÁC NHẬN. Mở Check-in/out từ
// hồ sơ hay danh sách (không bấm từ thẻ biên bản) thì vẫn phải điền sẵn số của an ninh, không bắt
// quản trị đọc lại đồng hồ lần hai. Bài này nhét biên bản giả vào ST (không ghi CSDL).
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
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  if (!lr.ok()) { console.log('  [FAIL] đăng nhập ' + lr.status()); await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJS = [];
  page.on('pageerror', e => loiJS.push(String(e)));
  page.on('dialog', d => d.dismiss());

  await page.goto('/hoc-vien');
  await page.waitForTimeout(3000);

  const sid = await page.evaluate(() => {
    const s = (ST.students || []).find(x => !x.deleted_at && x.room_id && isOccupying(x));
    return s ? s.id : 0;
  });
  if (!sid) { console.log('  [BỎ QUA] không có học viên nào đang ở để thử'); await browser.close(); process.exit(0); }

  // Giả lập biên bản TRẢ PHÒNG an ninh vừa gửi (chỉ nằm trong bộ nhớ trang)
  await page.evaluate(id => {
    ST.hoReports = [{
      id: 999001, student_id: id, kind: 'checkout', status: 'pending',
      actual_date: today(), meter_reading: 1234.5, damages: [], damage_amount: 0,
      cleanliness: 'sach', keys_count: 2, plates: '', note: 'Thu đủ chìa',
      created_by: 'an-ninh-test', created_at: new Date().toISOString(),
    }];
  }, sid);

  // Mở Check-out THEO ĐƯỜNG THƯỜNG (từ hồ sơ), KHÔNG truyền id biên bản
  await page.evaluate(id => checkOutForm(id), sid);
  await page.waitForTimeout(1200);
  const chu = (await page.locator('#modal').textContent()) || '';
  ok('Hiện banner biên bản của an ninh', /Biên bản #999001/.test(chu), chu.slice(0, 90));
  ok('Ô công-tơ điền sẵn số an ninh đã ghi', (await page.inputValue('#c_meter')) === '1234.5',
    await page.inputValue('#c_meter'));
  ok('Nhãn nói rõ số đến từ biên bản, không bắt nhập lại',
    /an ninh đã ghi ở biên bản/.test(chu) && !/không bắt buộc/.test(chu));
  ok('Ngày rời lấy theo ngày an ninh ghi', (await page.inputValue('#c_date')) !== '');
  ok('Nút xác nhận đi đường DUYỆT BIÊN BẢN (kèm id biên bản)',
    await page.locator('[data-act="doCheckOut"][data-args*="999001"]').count() === 1);
  await page.evaluate(() => closeModalNgay());
  await page.waitForTimeout(400);

  // Không có biên bản nào chờ -> vẫn cho nhập tay như cũ
  await page.evaluate(() => { ST.hoReports = []; });
  await page.evaluate(id => checkOutForm(id), sid);
  await page.waitForTimeout(1000);
  const chu2 = (await page.locator('#modal').textContent()) || '';
  ok('Không có biên bản: ô công-tơ trống, ghi "không bắt buộc"',
    (await page.inputValue('#c_meter')) === '' && /không bắt buộc/.test(chu2));
  ok('Không có biên bản: nút đi đường check-out thường',
    await page.locator('[data-act="doCheckOut"][data-args="[' + sid + ']"]').count() === 1);
  await page.evaluate(() => closeModalNgay());

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Biên bản an ninh điền sẵn cho quản trị');
  process.exit(fail ? 1 : 0);
})();
