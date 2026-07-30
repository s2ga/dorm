// Test giao diện (Playwright), READ-ONLY. Chạy: npm run test:dom (qua Docker, xem tests/dom/run.sh).

const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const USER = process.env.TEST_ADMIN_USER || 'admin';
const PASS = process.env.TEST_ADMIN_PASS; // BẮT BUỘC qua env (repo công khai — không hard-code mật khẩu)
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS (đặt qua biến môi trường).'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? ' -- ' + extra : '')); }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });

  // Đăng nhập qua API -> cookie vào context (page dùng chung cookie).
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); return; }

  const page = await ctx.newPage();

  // BL-20: thẻ drill-through mở modal (trước truyền chuỗi thô -> bấm không mở gì).
  await page.goto('/dieu-hanh'); await page.waitForTimeout(2500);
  await page.click('[data-act="residencyModal"]').catch(() => {});
  await page.waitForTimeout(600);
  const modalOpen = await page.evaluate(() => document.getElementById('overlay') && document.getElementById('overlay').classList.contains('show'));
  const modalTitle = await page.evaluate(() => { const h = document.querySelector('#modal .mh h3'); return h ? h.textContent.trim() : ''; });
  ok('BL-20: bấm thẻ "Tạm trú" -> modal mở', !!modalOpen && /tạm trú/i.test(modalTitle), 'title=' + modalTitle);
  await page.evaluate(() => window.closeModalNgay && closeModalNgay());

  // BL-39: popover lọc cột -> checkbox KHÔNG bị kéo giãn full-width (rộng < 20px).
  await page.goto('/hoc-vien'); await page.waitForTimeout(2800);
  const cbW = await page.evaluate(() => {
    const th = [].slice.call(document.querySelectorAll('.table-wrap th')).find(t => /CỌC|TRẠNG THÁI/i.test(t.textContent));
    if (th && th.querySelector('.col-filt')) th.querySelector('.col-filt').click();
    const b = document.querySelector('#colPop input[type=checkbox]');
    return b ? Math.round(b.getBoundingClientRect().width) : -1;
  });
  if (cbW === -1) console.log('  [SKIP] BL-39 (CSDL chưa có hàng -> không có phễu lọc)');
  else ok('BL-39: checkbox popover không giãn (< 20px)', cbW > 0 && cbW < 20, 'width=' + cbW + 'px');
  await page.keyboard.press('Escape');

  // BL-23: mở Sửa HV (có ngày sinh) rồi đóng -> KHÔNG bật confirm "chưa lưu".
  const sid = await page.evaluate(() => { const s = ST.students.find(x => x.birth_date) || ST.students[0]; return s && s.id; });
  if (!sid) { console.log('  [SKIP] BL-23/BL-47 (CSDL chưa có học viên)'); }
  else {
    let dialogFired = false;
    page.on('dialog', d => { dialogFired = true; d.dismiss(); });
    await page.evaluate(id => studentForm(id), sid);
    await page.waitForTimeout(1400); // async API + attachDate + re-snapshot
    await page.evaluate(() => closeModal());
    await page.waitForTimeout(400);
    ok('BL-23: Sửa HV -> đóng không báo nhầm "chưa lưu"', !dialogFired);

    // BL-47: bảng Học viên -> THẺ trên mobile (td[data-label] chuyển display block/flex).
    const mob = await ctx.newPage();
    await mob.setViewportSize({ width: 390, height: 844 });
    await mob.goto('/hoc-vien'); await mob.waitForTimeout(2600);
    const tdDisp = await mob.evaluate(() => {
      const td = document.querySelector('.card-tbl tbody td[data-label]');
      return td ? getComputedStyle(td).display : 'no-td';
    });
    ok('BL-47: bảng Học viên -> thẻ trên mobile', tdDisp === 'flex' || tdDisp === 'block', 'display=' + tdDisp);
  }

  await browser.close();
})().then(() => {
  console.log('\n  DOM smoke: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('LỖI:', e.message); process.exit(2); });
