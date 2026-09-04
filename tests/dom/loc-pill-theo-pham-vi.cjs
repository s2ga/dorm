// Màn Tiền phòng: 3 pill Tất cả / Chưa thu / Đã thu phải ĐẾM VÀ LỌC TRONG PHẠM VI đang lọc
// (ô tìm kiếm / phễu cột), và bấm pill không được vẽ lại cả màn làm mất bộ lọc (owner 04/09).
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
  await page.goto('/tien-phong');
  await page.waitForTimeout(3000);

  // Chọn một phòng có phiếu; kỳ vọng tính từ chính dữ liệu _invAll (khớp chuỗi như data-s).
  const cho = await page.evaluate(() => {
    const rooms = {};
    (_invAll || []).forEach(i => { if (i.room_name) (rooms[i.room_name] = rooms[i.room_name] || []).push(i); });
    const ten = Object.keys(rooms).sort((a, b) => rooms[b].length - rooms[a].length)[0];
    if (!ten) return null;
    const q = ten.toLowerCase();
    const khop = (_invAll || []).filter(i =>
      (((i.student_name || '') + ' ' + (i.student_code || '') + ' ' + (i.room_name || '')).toLowerCase()).includes(q));
    return { ten, tong: khop.length, chuaThu: khop.filter(i => i.status !== 'paid').length, daThu: khop.filter(i => i.status === 'paid').length };
  });
  if (!cho) { console.log('  [BỎ QUA] kỳ hiện tại không có phiếu nào'); await browser.close(); process.exit(0); }

  await page.fill('#invs', cho.ten);
  await page.waitForTimeout(800);
  const pill = async k => +((await page.locator('#inv_pill_' + k).textContent()) || '0');
  ok(`Lọc "${cho.ten}": pill Tất cả đếm trong phạm vi lọc`, await pill('all') >= cho.tong && await pill('all') <= cho.tong + 2, `pill=${await pill('all')} · kỳ vọng≈${cho.tong}`);
  ok('Pill Chưa thu + Đã thu = Tất cả (cùng phạm vi)', (await pill('unpaid')) + (await pill('paid')) === await pill('all'),
    `${await pill('unpaid')} + ${await pill('paid')} vs ${await pill('all')}`);

  // Bấm "Chưa thu": vẫn ở màn này, ô tìm giữ nguyên, chỉ còn hàng chưa thu, pill không đổi số
  const truoc = { all: await pill('all'), unpaid: await pill('unpaid') };
  await page.locator('[data-act="invLoc"][data-args=\'["unpaid"]\']').click();
  await page.waitForTimeout(600);
  ok('Bấm Chưa thu: KHÔNG vẽ lại màn — ô tìm còn nguyên', (await page.inputValue('#invs')) === cho.ten);
  ok('Vẫn đứng ở Tiền phòng', /tien-phong/.test(page.url()));
  const hienN = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-id]')].filter(r => r.style.display !== 'none').map(r => r.dataset.thu));
  ok('Chỉ còn hàng CHƯA THU trong phạm vi lọc', hienN.length === truoc.unpaid && hienN.every(v => v === 'unpaid'),
    `hiện ${hienN.length} · kỳ vọng ${truoc.unpaid}`);
  ok('Số trên pill giữ nguyên phạm vi (không nhảy về đếm cả kỳ)', await pill('all') === truoc.all,
    `${await pill('all')} vs ${truoc.all}`);

  // Bấm lại "Chưa thu" = bỏ lọc nhóm -> hiện đủ như cũ
  await page.locator('[data-act="invLoc"][data-args=\'["unpaid"]\']').click();
  await page.waitForTimeout(600);
  const du = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-id]')].filter(r => r.style.display !== 'none').length);
  ok('Bấm lại để bỏ lọc nhóm → hiện đủ trong phạm vi', du === truoc.all, `${du} vs ${truoc.all}`);

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Pill đếm theo phạm vi lọc chạy đúng');
  process.exit(fail ? 1 : 0);
})();
