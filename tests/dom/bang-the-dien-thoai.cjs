// Test giao diện (Playwright), KHÔNG ghi dữ liệu: ở khổ điện thoại (390px) các bảng .card-tbl gấp thành thẻ,
// mỗi ô có nhãn trùng tiêu đề cột (mỗi thẻ chỉ một ô không nhãn làm tên thẻ, cột nút để trơn), và trang không cuộn ngang.
// Bảng có thể trống trên CSDL thử thì được trả dữ liệu giả qua route GET.
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

const NHAN_RIENG = { GT: 'Giới tính' };   // tiêu đề viết tắt -> nhãn viết đủ trên thẻ
const LUC = '2026-09-28T03:00:00Z';
const GIA = {
  '/api/applications': [
    { id: 990001, status: 'pending', name: 'Đơn thử một', phone: '0900000001', gender: 'female', created_at: LUC, desired_check_in: '2026-10-05', pref: 'Tầng thấp', wants_parking: true, plate: '59A-123.45' },
    { id: 990002, status: 'approved', name: 'Đơn thử hai', phone: '0900000002', gender: 'male', created_at: LUC, class_name: 'Lớp thử' },
  ],
  '/api/requests/checkout': [
    { id: 990011, status: 'pending', student_name: 'HV thử', room_name: '201', created_at: LUC, desired_date: '2026-10-10', reason: 'other', note: 'Về quê' },
  ],
  '/api/requests/damage': [
    { id: 990021, category: 'damage', status: 'new', title: 'Hỏng vòi nước', description: 'Rò nước', student_name: 'HV thử', room_name: '201', created_at: LUC },
    { id: 990022, category: 'violation', status: 'processing', title: 'Ồn sau 23h', student_name: 'HV thử', room_name: '202', created_at: LUC },
  ],
  '/api/violations': [
    { id: 990031, student_id: 990099, student_name: 'HV thử', student_code: 'HV-THU', room_name: '201', type_name: 'Về trễ', severity: 'minor', level: 3, date: '2026-09-27', note: 'Về lúc 23h40', notified_school: false },
  ],
  '/api/violations/stats': { threshold: 3, needMail: 1 },
  '/api/vehicles/plate-requests': { rows: [
    { id: 990041, plate_cu: '59A-111.11', plate_moi: '59A-111.12', student_id: 990099, student_name: 'HV thử', room_name: '201', note: 'Đọc sai số cuối', requested_by: 'anninh', requested_at: LUC },
  ] },
  '/api/vehicles/parking-reports': { rows: [
    { id: 990051, report_date: '2026-09-28', kind: 'stranger', plate: '51F-999.99', note: 'Xe lạ đậu qua đêm', reported_by: 'anninh', status: 'new' },
  ] },
};
const HV = {
  '/api/me/profile': { id: 990099, name: 'HV thử', gender: 'female', code: 'HV-THU', phone: '0900000009', status: 'in', check_in_date: '2026-01-05', room_name: '201', deposit_status: 'held', washing_fee: 50000 },
  '/api/me/invoices': [], '/api/me/checkout-request': [], '/api/me/violations': [], '/api/me/roommates': [],
  '/api/me/assets': [], '/api/me/chores': [], '/api/me/logs': [], '/api/me/notifications': [],
  '/api/me/damage': [
    { id: 990061, category: 'damage', status: 'processing', title: 'Bóng đèn cháy', description: 'Đèn nhà tắm', created_at: LUC },
  ],
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [], daGhi = [];
  page.on('pageerror', e => loiJs.push(String(e)));
  page.on('dialog', d => d.dismiss());
  let gia = GIA;
  await page.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      daGhi.push(route.request().method() + ' ' + p);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (p in gia) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gia[p]) });
    return route.continue();
  });

  const cho = async (fn, arg, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); }
    return false;
  };
  const soi = sel => page.evaluate(([s, nr]) => {
    const bang = [...document.querySelectorAll(s)].map(w => {
      const t = w.querySelector('table');
      if (!t) return null;
      const th = [...t.querySelectorAll('thead th')].map(h => h.textContent.replace(/\s+/g, ' ').trim());
      const hang = [...t.querySelectorAll('tbody > tr')].filter(r => !r.classList.contains('no-result') && r.style.display !== 'none');
      const loi = [];
      let theDung = hang.length > 0 && getComputedStyle(t.querySelector('thead')).position === 'absolute';
      hang.forEach((r, ri) => {
        if (getComputedStyle(r).display !== 'block') theDung = false;
        const tron = [];
        [...r.children].forEach((td, i) => {
          const nhan = td.getAttribute('data-label'), tieuDe = th[i] || '';
          if (nhan !== null) {
            if (nhan !== tieuDe && nr[tieuDe] !== nhan) loi.push(`cột ${i + 1}: nhãn "${nhan}" khác tiêu đề "${tieuDe}"`);
            const truoc = getComputedStyle(td, '::before').content;
            if (truoc !== JSON.stringify(nhan)) loi.push(`cột ${i + 1}: nhãn không hiện (::before = ${truoc})`);
          } else if (tieuDe) tron.push(tieuDe);
          else if (td.textContent.trim() && !td.querySelector('button')) loi.push(`cột ${i + 1} không tiêu đề mà có chữ`);
        });
        if (tron.length > 1) loi.push(`hàng ${ri + 1}: ${tron.length} ô không nhãn (${tron.join(', ')})`);
      });
      return { th: th.filter(Boolean).slice(0, 3).join('/'), hang: hang.length, theDung, loi: [...new Set(loi)].slice(0, 5), tran: w.scrollWidth - w.clientWidth };
    }).filter(Boolean);
    return { bang, cuonNgang: document.documentElement.scrollWidth - innerWidth };
  }, [sel, NHAN_RIENG]);
  const kiem = async (ten, sel) => {
    const kq = await soi(sel);
    if (!kq.bang.length) return ok(`${ten}: có bảng dạng thẻ`, false, 'không thấy bảng nào trong ' + sel);
    for (const b of kq.bang) {
      ok(`${ten} [${b.th}…, ${b.hang} hàng]: gấp thành thẻ, tiêu đề cột ẩn`, b.theDung);
      ok(`${ten} [${b.th}…]: mọi ô có nhãn trùng tiêu đề, một ô tên thẻ, cột nút trơn`, !b.loi.length, b.loi.join(' | '));
      ok(`${ten} [${b.th}…]: bảng không tràn ngang`, b.tran <= 1, `tràn ${b.tran}px`);
    }
    ok(`${ten}: trang không cuộn ngang`, kq.cuonNgang <= 0, `rộng hơn màn ${kq.cuonNgang}px`);
  };

  await page.goto('/'); await cho(() => typeof ST !== 'undefined' && ST.students && ST.students.length > 0);

  // ── Tiếp nhận & hỗ trợ (dữ liệu giả) ───────────────────────────────────────
  for (const [view, ten] of [
    ['reg', 'Đơn đăng ký'], ['checkout', 'Đơn trả phòng'], ['repair', 'Báo hư hỏng'],
    ['violations', 'Vi phạm'], ['feedback', 'Góp ý / hỗ trợ'],
  ]) {
    await page.evaluate(v => {
      regFilter = coutFilter = dmgFilter = fbFilter = vioFilter = 'all';
      adminGo(v);
    }, view);
    await cho(v => ST.view === v && !!document.querySelector('#pnDon table'), view);
    await kiem(ten, '#pnDon .card-tbl');
  }

  // ── Dịch vụ: gửi xe (đề nghị sửa biển + báo cáo an ninh giả; xe thật) và máy giặt (thật) ──
  await page.evaluate(() => { svcTab = 'parking'; pkAdminLoc = 'all'; adminGo('services'); });
  await cho(() => !!document.querySelector('#pk_panel_bien table') && !!document.querySelector('#pk_panel_baocao table'));
  await kiem('Gửi xe', '#svcBody .card-tbl');
  const dangO = await page.evaluate(() => {
    const ds = ST.students.filter(isOccupying);
    if (!ds.some(s => s.uses_washing)) ds.slice(0, 2).forEach(s => { s.uses_washing = true; s.washing_from = '2026-09-01'; });
    svcGo('washing');
    return ds.length;
  });
  await cho(() => svcTab === 'washing' && !!document.querySelector('[data-act="addWashingForm"]'));
  if (dangO) await kiem('Máy giặt', '#svcBody .panel:last-child .card-tbl');
  else ok('Máy giặt (BỎ QUA: không ai đang ở)', true);

  // ── Doanh thu, Nhật ký (dữ liệu thật) ──────────────────────────────────────
  await page.evaluate(() => adminGo('revenue'));
  await cho(() => ST.view === 'revenue' && !!document.querySelector('#content .panel table, #content .panel .empty'));
  const coThang = await page.evaluate(() => {
    const p = [...document.querySelectorAll('#content .panel')].find(x => /theo tháng/.test((x.querySelector('h2') || {}).textContent || ''));
    return !!p && !!p.querySelector('table');
  });
  if (coThang) await kiem('Doanh thu', '#content .card-tbl');
  else ok('Doanh thu (BỎ QUA: năm nay chưa có phiếu báo)', true);
  await page.evaluate(() => adminGo('audit'));
  await cho(() => ST.view === 'audit' && !!document.querySelector('#content table, #content .empty'));
  await kiem('Nhật ký', '#content .card-tbl');

  // ── Cổng học viên: bảng Hỗ trợ (dữ liệu giả) ───────────────────────────────
  gia = HV;
  await page.evaluate(() => { Auth.user = { id: 990099, username: 'hvthu', full_name: 'HV thử', role: 'student' }; renderStudent(); });
  await cho(() => !!document.querySelector('#pnHoTro table'));
  await kiem('Cổng học viên / Hỗ trợ', '#pnHoTro .card-tbl');

  ok('Không request ghi nào (đều bị chặn, và không có cái nào)', daGhi.length === 0, daGhi.join(', '));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Bảng dạng thẻ trên điện thoại: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
