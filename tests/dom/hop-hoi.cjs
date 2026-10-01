// Test giao diện (Playwright), KHÔNG ghi dữ liệu: hộp hỏi của app (xacNhan/thongBao/nhapLyDo) thay confirm()/alert()/
// prompt() gốc — nút tiếng Việt, con trỏ mặc định ở "Hủy", Tab không lọt ra sau, Esc chỉ đóng hộp chứ không đóng
// luôn modal bên dưới, đóng xong trả con trỏ về chỗ cũ.
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [], hopGoc = [];
  page.on('pageerror', e => loiJs.push(String(e)));
  page.on('dialog', d => { hopGoc.push(d.message()); d.dismiss(); });
  await page.goto('/'); await page.waitForTimeout(2500);

  const coHam = await page.evaluate(() => typeof xacNhan === 'function' && typeof thongBao === 'function' && typeof nhapLyDo === 'function');
  ok('Trang có xacNhan, thongBao, nhapLyDo', coHam);
  if (!coHam) { await browser.close(); console.log(`\n  Hộp hỏi: ${pass} pass, ${fail} fail`); process.exit(1); }

  const kq = () => page.evaluate(() => window._kq);
  const conHop = () => page.evaluate(() => document.querySelectorAll('.xn-hop').length);
  const dangDung = () => page.evaluate(() => {
    const a = document.activeElement;
    return a ? (a.dataset.xn != null ? 'xn' + a.dataset.xn : a.id || a.tagName) : '';
  });

  // ── Hỏi xoá khi đang mở modal ──────────────────────────────────────────────
  await page.evaluate(() => { openModal('<div class="mb"><button type="button" class="btn" id="nutThu">Nút trong modal</button></div>'); el('nutThu').focus(); });
  await page.evaluate(() => { window._kq = undefined; xacNhan('Xoá phòng 104?', { dongY: 'Xoá', nguyHiem: true }).then(v => { window._kq = v; }); });
  await page.waitForSelector('.xn-hop', { timeout: 3000 });
  const hop = await page.evaluate(() => {
    const h = document.querySelector('.xn-hop'), r = h.getBoundingClientRect();
    const tren = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return {
      role: h.getAttribute('role'), cau: h.querySelector('.xn-cau').textContent,
      nut: [...h.querySelectorAll('button')].map(b => b.textContent.trim()),
      doDo: h.querySelector('[data-xn="1"]').classList.contains('danger'),
      nam_tren: !!(tren && tren.closest('.xn-hop')),
    };
  });
  ok('Hộp có role="alertdialog" và đúng câu hỏi', hop.role === 'alertdialog' && hop.cau === 'Xoá phòng 104?', JSON.stringify(hop));
  ok('Hai nút tiếng Việt: "Hủy" và "Xoá"', JSON.stringify(hop.nut) === '["Hủy","Xoá"]', JSON.stringify(hop.nut));
  ok('Hành động nguy hiểm: nút đồng ý tô đỏ', hop.doDo);
  ok('Hộp nằm TRÊN modal đang mở (bấm được)', hop.nam_tren);
  ok('Con trỏ mặc định ở "Hủy" (Enter không xoá nhầm)', (await dangDung()) === 'xn0', await dangDung());
  await page.keyboard.press('Tab');
  const sau1 = await dangDung();
  await page.keyboard.press('Tab');
  const sau2 = await dangDung();
  await page.keyboard.press('Shift+Tab');
  const sau3 = await dangDung();
  ok('Tab chỉ đi vòng trong hộp (Hủy → Xoá → Hủy, Shift+Tab → Xoá)', sau1 === 'xn1' && sau2 === 'xn0' && sau3 === 'xn1', [sau1, sau2, sau3].join(' → '));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Esc → trả về false, hộp đóng', (await kq()) === false && (await conHop()) === 0, `kq=${await kq()} hộp=${await conHop()}`);
  ok('Esc KHÔNG đóng luôn modal bên dưới', await page.evaluate(() => el('overlay').classList.contains('show')));
  ok('Đóng hộp → con trỏ về lại nút trong modal', (await dangDung()) === 'nutThu', await dangDung());

  await page.evaluate(() => { window._kq = undefined; xacNhan('Xoá phòng 104?', { dongY: 'Xoá', nguyHiem: true }).then(v => { window._kq = v; }); });
  await page.waitForSelector('.xn-hop', { timeout: 3000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  ok('Enter ngay khi hộp vừa hiện → Hủy (false)', (await kq()) === false, String(await kq()));

  await page.evaluate(() => { window._kq = undefined; xacNhan('Xoá?').then(v => { window._kq = v; }); });
  await page.waitForSelector('.xn-hop', { timeout: 3000 });
  await page.mouse.click(8, 8);
  await page.waitForTimeout(200);
  ok('Bấm ra nền tối → false', (await kq()) === false && (await conHop()) === 0, String(await kq()));

  await page.evaluate(() => { window._kq = undefined; xacNhan('Xoá?', { dongY: 'Xoá' }).then(v => { window._kq = v; }); });
  await page.click('.xn-hop [data-xn="1"]');
  await page.waitForTimeout(200);
  ok('Bấm "Xoá" → true', (await kq()) === true, String(await kq()));
  ok('Modal bên dưới vẫn mở sau khi trả lời', await page.evaluate(() => el('overlay').classList.contains('show')));

  // ── Ô nhập lý do ───────────────────────────────────────────────────────────
  await page.evaluate(() => { window._kq = undefined; nhapLyDo('Trả lại biên bản?', { dongY: 'Trả lại', oNhap: 'Lý do trả lại' }).then(v => { window._kq = v; }); });
  await page.waitForSelector('.xn-hop .xn-o', { timeout: 3000 });
  ok('Hộp nhập lý do: con trỏ đứng sẵn trong ô nhập', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('xn-o')));
  await page.keyboard.type('  sai số công tơ  ');
  await page.click('.xn-hop [data-xn="1"]');
  await page.waitForTimeout(200);
  ok('Gửi → trả về lý do đã cắt khoảng trắng', (await kq()) === 'sai số công tơ', JSON.stringify(await kq()));
  await page.evaluate(() => { window._kq = undefined; nhapLyDo('Trả lại biên bản?', { oNhap: 'Lý do' }).then(v => { window._kq = v; }); });
  await page.waitForSelector('.xn-hop .xn-o', { timeout: 3000 });
  await page.keyboard.type('abc');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Esc ở hộp nhập lý do → null (huỷ, không gửi chữ đã gõ)', (await kq()) === null, JSON.stringify(await kq()));

  // ── Báo một nút ────────────────────────────────────────────────────────────
  await page.evaluate(() => { window._kq = undefined; thongBao('Phòng đã đầy.').then(v => { window._kq = v; }); });
  await page.waitForSelector('.xn-hop', { timeout: 3000 });
  const nutBao = await page.evaluate(() => [...document.querySelectorAll('.xn-hop button')].map(b => b.textContent.trim()));
  ok('Hộp báo chỉ có một nút "Đã hiểu"', JSON.stringify(nutBao) === '["Đã hiểu"]', JSON.stringify(nutBao));
  await page.click('.xn-hop [data-xn="1"]');
  await page.waitForTimeout(200);
  ok('Bấm "Đã hiểu" → hộp đóng', (await conHop()) === 0);

  // ── Hai hộp chồng nhau: Esc chỉ đóng hộp trên cùng ────────────────────────
  await page.evaluate(() => {
    window._a = window._b = undefined;
    xacNhan('Hộp A').then(v => { window._a = v; });
    xacNhan('Hộp B').then(v => { window._b = v; });
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const ab = await page.evaluate(() => ({ a: window._a, b: window._b, con: [...document.querySelectorAll('.xn-cau')].map(x => x.textContent) }));
  ok('Hai hộp chồng: Esc chỉ đóng hộp trên (B), hộp A còn', ab.b === false && ab.a === undefined && ab.con.join() === 'Hộp A', JSON.stringify(ab));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok('… Esc lần nữa mới đóng hộp A', (await page.evaluate(() => window._a)) === false && (await conHop()) === 0);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok('Hết hộp hỏi thì Esc lại đóng modal như cũ', await page.evaluate(() => !el('overlay').classList.contains('show')));
  ok('Không bật hộp thoại gốc của trình duyệt', hopGoc.length === 0, hopGoc.join(' | '));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));

  await browser.close();
  console.log(`\n  Hộp hỏi: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
