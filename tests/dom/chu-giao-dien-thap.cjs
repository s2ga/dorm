// Test giao diện (Playwright), KHÔNG ghi dữ liệu: các mục mức Thấp có hành vi — trang đăng nhập một đường tới /dang-ky,
// để trống thì báo tại ô; bộ chọn cơ sở có nhãn; lỗi tải Doanh thu/Nhật ký báo một lần; form vi phạm chưa có loại có
// đường sang Cài đặt; Tiền phòng báo khi phần phụ tải lỗi; hướng dẫn cắt ảnh luôn hiện; toast kiểu thông tin.
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
  const loiJs = [];

  // ── Trang đăng nhập (chưa đăng nhập) ───────────────────────────────────────
  const khach = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  const p0 = await khach.newPage();
  p0.on('pageerror', e => loiJs.push(String(e)));
  let goiDangNhap = 0;
  await p0.route('**/api/auth/login', route => { goiDangNhap++; return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"x"}' }); });
  await p0.goto('/');
  await p0.waitForSelector('#loginForm', { state: 'attached', timeout: 20000 });
  const dn = await p0.evaluate(() => ({
    soLinkDangKy: document.querySelectorAll('a[href="/dang-ky"]').length,
    benTrai: document.querySelectorAll('.auth-left a[href="/dang-ky"]').length,
    nut: [...document.querySelectorAll('.auth-form button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()),
    user: (() => { const u = document.getElementById('lg_user'); return { cap: u.getAttribute('autocapitalize'), spell: u.getAttribute('spellcheck') }; })(),
  }));
  ok('Đăng nhập: chỉ còn một đường tới /dang-ky (thẻ bên phải)', dn.soLinkDangKy === 1 && dn.benTrai === 0, JSON.stringify(dn));
  ok('… không còn mũi tên "→" trên nút; nút Microsoft ghi gọn', !dn.nut.some(t => t.includes('→')) && !dn.nut.some(t => /bằng tài khoản Microsoft/.test(t)), JSON.stringify(dn.nut));
  ok('… ô tên đăng nhập không tự viết hoa, không soát chính tả', dn.user.cap === 'off' && dn.user.spell === 'false', JSON.stringify(dn.user));
  await p0.evaluate(() => { const f = el('loginForm'); f.hidden = false; });
  await p0.click('#loginForm [type=submit]');
  await p0.waitForTimeout(300);
  const loiUser = await p0.evaluate(() => ((el('lg_user').closest('.field') || {}).querySelector('.loi-o') || {}).textContent || '');
  ok('… bấm Đăng nhập khi để trống → báo tại ô, không gửi lên máy chủ', /Nhập tên đăng nhập/.test(loiUser) && goiDangNhap === 0, `${loiUser} · gọi ${goiDangNhap}`);
  await khach.close();

  // ── Quản trị ───────────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  page.on('pageerror', e => loiJs.push(String(e)));
  page.on('dialog', d => d.dismiss());
  const hong = new Set();
  await page.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (hong.has(p)) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Lỗi thử nghiệm"}' });
    return route.continue();
  });
  const cho = async (fn, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(200); }
    return false;
  };
  await page.goto('/');
  await cho(() => typeof ST !== 'undefined' && ST.students && ST.students.length > 0);

  ok('Thanh bên: nút Đăng xuất tách riêng (lớp foot-out)', await page.evaluate(() => !!document.querySelector('.side .foot .foot-out[data-act="logout"]')));
  const cs = await page.evaluate(() => {
    if ((ST.facilities || []).length < 2) return 'mot';
    const l = document.querySelector('#facSel .fac-sel'), s = document.querySelector('#facSel select');
    return { chu: l ? l.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '', aria: s && s.getAttribute('aria-label') };
  });
  if (cs === 'mot') ok('Bộ chọn cơ sở (BỎ QUA: chỉ có một cơ sở)', true);
  else ok('Bộ chọn cơ sở có nhãn "Cơ sở:" ngoài ô chọn, ô chọn có aria-label', /Cơ sở:/.test(cs.chu) && cs.aria === 'Lọc theo cơ sở', JSON.stringify(cs));

  // Lỗi tải Doanh thu / Nhật ký: chỉ một khối lỗi, không kèm toast đỏ
  for (const [view, duong, ten] of [['revenue', '/api/reports/years', 'Doanh thu'], ['audit', '/api/admin/audit', 'Nhật ký']]) {
    hong.add(duong);
    await page.evaluate(() => tatToast());
    await page.evaluate(v => adminGo(v), view);
    for (let t = 0; t < 15000; t += 200) {
      if (await page.evaluate(v => ST.view === v && /Không tải được dữ liệu/.test(el('content').textContent), view)) break;
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);
    const kq = await page.evaluate(() => ({ toastDo: el('toast').classList.contains('show') && el('toast').classList.contains('err'), coThuLai: /Thử lại/.test(el('content').textContent) }));
    ok(`${ten}: lỗi tải → một khối lỗi có Thử lại, không kèm toast đỏ`, kq.coThuLai && !kq.toastDo, JSON.stringify(kq));
    hong.delete(duong);
  }

  // Form ghi vi phạm khi chưa có loại nào
  await page.evaluate(() => { window._vtCu = ST.vtypes; ST.vtypes = []; violationForm(); });
  await cho(() => !!document.getElementById('vf_type'));
  const coLink = await page.evaluate(() => !!document.querySelector('#modal [data-act="gotoLoaiViPham"]'));
  ok('Ghi vi phạm, chưa có loại → có đường "Thêm loại vi phạm trong Cài đặt"', coLink);
  if (coLink) {
    await page.click('#modal [data-act="gotoLoaiViPham"]');
    ok('… bấm → sang Cài đặt, mở đúng nhóm Loại vi phạm', await cho(() => ST.view === 'settings' && !document.querySelector('[data-setgroup="vipham"]').hidden));
  } else await page.evaluate(() => closeModal());
  await page.evaluate(() => { ST.vtypes = window._vtCu; });

  // Tiền phòng: phần phụ (lịch sử điện) tải lỗi thì có dòng báo + Thử lại
  hong.add('/api/electric/history');
  await page.evaluate(() => adminGo('invoices'));
  await cho(() => ST.view === 'invoices' && !document.querySelector('#content .spinner') && !!document.getElementById('invs'));
  const phu = await page.evaluate(() => { const p = [...document.querySelectorAll('#content p.muted')].find(x => /Không tải được/.test(x.textContent)); return p ? { chu: p.textContent.trim().slice(0, 80), nut: !!p.querySelector('[data-act="viewInvoices"]') } : null; });
  ok('Tiền phòng: lịch sử điện tải lỗi → dòng "Không tải được lịch sử điện theo phòng" + Thử lại', !!phu && /lịch sử điện/.test(phu.chu) && phu.nut, JSON.stringify(phu));
  hong.delete('/api/electric/history');

  // Cắt & xoay ảnh: hướng dẫn hiện sẵn, không bị gom vào nút Ghi chú
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 40;
    const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 60, 40);
    anhSuaMo(c.toDataURL('image/png'), 'Thử cắt ảnh', () => {});
  });
  await cho(() => !!document.getElementById('anhKhung'));
  const hd = await page.evaluate(() => {
    const d = [...document.querySelectorAll('#modal .mb div')].find(x => /Kéo trong ảnh để khoanh vùng/.test(x.textContent) && !x.querySelector('div'));
    const r = d && d.getBoundingClientRect();
    return d ? { trongGhiChu: !!d.closest('.hint'), hien: r.width > 0 && r.height > 0, nut: [...document.querySelectorAll('#modal .mf .btn')].map(b => b.textContent.trim()) } : null;
  });
  ok('Cắt ảnh: hướng dẫn hiện sẵn (không nằm trong Ghi chú), nút Huỷ trái — Xong phải', !!hd && !hd.trongGhiChu && hd.hien && /Huỷ|Hủy/.test(hd.nut[0]) && /Xong/.test(hd.nut[hd.nut.length - 1]), JSON.stringify(hd));
  await page.evaluate(() => anhSuaDong());

  // Toast kiểu thông tin: icon ⓘ, không phải dấu tích "thành công"
  const ts = await page.evaluate(() => {
    toast('Thử thông tin', 'info');
    const t = el('toast'), mau = document.createElement('span');
    mau.innerHTML = IC.info;
    return { cls: t.className, dau: t.innerHTML.startsWith(mau.innerHTML) };
  });
  ok('Toast "info": nền trung tính, icon ⓘ', /\binfo\b/.test(ts.cls) && !/\bok\b/.test(ts.cls) && ts.dau, JSON.stringify(ts));

  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Chữ và giao diện mức Thấp: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
