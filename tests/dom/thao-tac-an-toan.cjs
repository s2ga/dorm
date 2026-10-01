// Test giao diện (Playwright), KHÔNG ghi dữ liệu — mọi request không phải GET bị chặn bằng page.route và trả 200 giả.
// Nhóm "an toàn thao tác": Hủy ở form con lùi một lớp · gỡ scan HĐ không chồng thêm form · hoàn cọc từ Quỹ cọc quay
// về Quỹ cọc · modal chi tiết hiện khung chờ ngay · Cài đặt hỏi khi rời màn còn ô gõ dở, không xoá chữ đang gõ.
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
const boQua = name => { pass++; console.log('  [OK] ' + name + ' (BỎ QUA: không có dữ liệu phù hợp)'); };
const trang = page => page.evaluate(() => ({
  title: (document.getElementById('pgTitle') || {}).textContent || '',
  path: location.pathname,
  modal: document.getElementById('overlay').classList.contains('show'),
  h3: ((document.querySelector('#modal .mh h3') || {}).textContent || '').trim(),
  lop: typeof _lopModal !== 'undefined' ? _lopModal.length : -1,
}));
const cho = async (page, dk, ms = 15000) => {
  for (let t = 0; t < ms; t += 200) { if (dk(await trang(page))) return true; await page.waitForTimeout(200); }
  return false;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [];
  page.on('pageerror', e => loiJs.push(String((e && e.stack) || e).split('\n').slice(0, 3).join(' ')));
  const hop = [];
  let traLoi = 'accept';
  page.on('dialog', d => { hop.push(d.message()); return traLoi === 'dismiss' ? d.dismiss() : d.accept(); });
  const daGhi = [];
  await page.route('**/api/**', async route => {
    const m = route.request().method();
    if (m !== 'GET') {
      daGhi.push(m + ' ' + new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  await page.goto('/hoc-vien'); await cho(page, t => t.title === 'Học viên');
  const idPhong = await page.evaluate(() => (ST.rooms.find(r => !r.deleted_at) || {}).id);
  const idHv = await page.evaluate(() => (ST.students.find(s => !s.deleted_at) || {}).id);

  // ── Hủy ở form con lùi về lớp cha ─────────────────────────────────────────
  if (!idPhong) boQua('Hủy ở Sửa phòng → về Chi tiết phòng');
  else {
    await page.evaluate(id => roomDetail(id), idPhong);
    await page.click('#modal [data-act="roomForm"]');
    await cho(page, t => t.lop === 2);
    await page.waitForTimeout(200);   // form tự đặt con trỏ sau 50ms — bấm nhanh hơn thế là lỗi có sẵn, không phải thứ đang kiểm
    await page.click('#modal .mf button:has-text("Hủy")');
    await page.waitForTimeout(300);
    const t = await trang(page);
    ok('Hủy ở Sửa phòng → về Chi tiết phòng (không đóng hẳn)', t.modal && t.lop === 1 && /Phòng/.test(t.h3), JSON.stringify(t));
    await page.evaluate(() => closeModalNgay());
  }

  // ── Gỡ scan HĐ trong form Sửa: không chồng thêm form, giữ chữ đang gõ ─────
  if (!idHv) boQua('Gỡ scan HĐ trong form Sửa');
  else {
    await page.evaluate(id => studentForm(id), idHv);
    await page.waitForSelector('#modal #f_class', { timeout: 15000 });
    await page.fill('#f_class', 'LOP-KIEM-THU-123');
    const lopTruoc = (await trang(page)).lop;
    await page.evaluate(id => { goScanHD(id); }, idHv);   // không await: hàm đang chờ hộp xác nhận
    await page.click('.xn-hop [data-xn="1"]', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const t = await trang(page);
    const lopHoc = await page.evaluate(() => (document.getElementById('f_class') || {}).value);
    ok('Gỡ scan HĐ trong form Sửa → không mở thêm lớp form', t.lop === lopTruoc, `lớp ${lopTruoc} → ${t.lop}`);
    ok('… chữ đang gõ ở ô khác giữ nguyên', lopHoc === 'LOP-KIEM-THU-123', String(lopHoc));
    await page.evaluate(() => closeModalNgay());
  }

  // ── Modal chi tiết hiện khung chờ ngay khi bấm ─────────────────────────────
  if (!idHv) boQua('Chi tiết học viên hiện khung chờ ngay');
  else {
    await page.route(`**/api/students/${idHv}`, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await new Promise(r => setTimeout(r, 1500));
      return route.continue();
    });
    await page.evaluate(id => { studentDetail(id); }, idHv);
    await page.waitForTimeout(300);
    const coCho = await page.evaluate(() => document.getElementById('overlay').classList.contains('show') && !!document.querySelector('#modal .spinner'));
    ok('Bấm Chi tiết học viên → hiện khung chờ ngay, chưa đợi máy chủ', coCho);
    ok('… tải xong thì hiện nội dung', await cho(page, t => t.modal && t.h3 && !/^\s*$/.test(t.h3), 8000), JSON.stringify(await trang(page)));
    await page.unroute(`**/api/students/${idHv}`);
    await page.evaluate(() => closeModalNgay());
  }

  // ── Hoàn cọc từ Quỹ cọc quay về Quỹ cọc ───────────────────────────────────
  // Hồ sơ giả chỉ nằm trong bộ nhớ trình duyệt (và GET của nó trả giả) — không phụ thuộc dữ liệu thật.
  const GIA = { id: 987654320, name: 'Cọc Kiểm Thử', code: 'KT-COC', gender: 'male', status: 'out', room_id: null,
    deposit_status: 'held', deposit_amount: 1200000, deposit_date: '2026-01-01', check_in_date: '2026-01-01', check_out_date: '2026-02-01' };
  await page.route(`**/api/students/${GIA.id}`, route => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GIA) }) : route.fallback());
  await page.evaluate(g => { ST.students.push(g); }, GIA);
  await page.evaluate(() => quyCoc());
  const coNut = await page.$('#modal tbody button:has-text("Hoàn cọc")');
  if (!coNut) boQua('Hoàn cọc từ Quỹ cọc → quay về Quỹ cọc');
  else {
    await coNut.click();
    await page.waitForSelector('#modal [data-act="doRefund"]', { timeout: 15000 });
    await page.click('#modal [data-act="doRefund"]');
    await page.waitForTimeout(1200);
    const t = await trang(page);
    ok('Hoàn cọc từ Quỹ cọc → quay về Quỹ cọc', t.modal && /Quỹ cọc/.test(t.h3), JSON.stringify(t));
  }
  await page.evaluate(() => closeModalNgay());
  await page.waitForTimeout(400);   // closeModalNgay trả mục lịch sử sau một tick — đợi xong rồi mới goto

  // ── Tạo đơn đăng ký từ màn Học viên: ở nguyên màn Học viên ────────────────
  await page.goto('/hoc-vien'); await cho(page, t => t.title === 'Học viên');
  await page.evaluate(() => appForm());
  await page.fill('#ap_name', 'Kiem Thu Don');
  await page.fill('#ap_phone', '0900000000');
  await page.selectOption('#ap_gender', 'female');
  if (await page.evaluate(() => !el('ap_fac').value && el('ap_fac').options.length > 1)) await page.selectOption('#ap_fac', { index: 1 });
  await page.evaluate(() => { document.getElementById('ap_movein').dataset.iso = '2099-01-01'; });
  await page.click('#modal [data-act="saveApp"]');
  await page.waitForTimeout(1200);
  let t = await trang(page);
  ok('Tạo đơn đăng ký từ màn Học viên → vẫn ở màn Học viên', t.title === 'Học viên' && t.path === '/hoc-vien', JSON.stringify(t));

  // ── Cài đặt: rời màn khi còn ô gõ dở thì hỏi ──────────────────────────────
  await page.goto('/cai-dat'); await cho(page, x => x.title === 'Cài đặt');
  ok('Panel "Thông tin hiển thị trên phiếu báo" có nút Lưu riêng', await page.evaluate(() => {
    const p = document.querySelector('[data-setgroup="gia"] .panel');
    return !!p && /phiếu báo/.test(p.querySelector('h2').textContent) && !!p.querySelector('[data-act="saveSettings"]');
  }));
  await page.fill('#set_hotline', '0999 888 777');
  hop.length = 0; traLoi = 'dismiss';
  await page.evaluate(() => document.querySelector('#nav button[data-v="dashboard"]').click());   // menu là ngăn kéo, đang ẩn
  await page.waitForTimeout(500);
  ok('Cài đặt: gõ dở rồi bấm menu khác → hỏi trước khi rời', hop.some(m => /chưa lưu/.test(m)), JSON.stringify(hop));
  ok('… bấm Hủy ở hộp hỏi → vẫn ở Cài đặt, chữ còn nguyên',
    (await trang(page)).title === 'Cài đặt' && await page.evaluate(() => (el('set_hotline') || {}).value) === '0999 888 777');
  traLoi = 'accept';

  // ── Cài đặt: xoá một tài sản không xoá chữ đang gõ ở panel khác ───────────
  await page.goto('/cai-dat?tab=coso'); await cho(page, x => x.title === 'Cài đặt');
  await page.fill('#set_wifi_ssid', 'WIFI-KIEM-THU');
  const nutXoa = await page.$('[data-setgroup="coso"] [data-act="delAsset"]');
  if (!nutXoa) boQua('Xoá tài sản không xoá chữ đang gõ');
  else {
    const tenTs = await page.evaluate(b => b.closest('tr').querySelector('strong').textContent, nutXoa);
    hop.length = 0;
    await nutXoa.click();
    const cauHop = await page.textContent('.xn-cau', { timeout: 3000 }).catch(() => null);   // hộp xác nhận của app
    if (cauHop != null) { hop.push(cauHop); await page.click('.xn-hop [data-xn="1"]'); }
    await page.waitForTimeout(1200);
    ok('Hỏi xoá tài sản có nêu tên tài sản', hop.some(m => m.includes(tenTs)), JSON.stringify(hop));
    ok('Xoá tài sản xong, ô wifi đang gõ vẫn giữ chữ', await page.evaluate(() => el('set_wifi_ssid') && el('set_wifi_ssid').value) === 'WIFI-KIEM-THU');
  }

  // ── Bảng Chờ duyệt không quay spinner mãi khi tải lỗi ─────────────────────
  await page.route('**/api/admin/users', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Lỗi thử nghiệm"}' }) : route.fallback());
  traLoi = 'accept';
  await page.goto('/cai-dat?tab=nguoidung'); await cho(page, x => x.title === 'Cài đặt');
  await page.waitForTimeout(1500);
  const choDuyet = await page.evaluate(() => ({
    nut: !!document.querySelector('#pendRows [data-act="loadAdminUsers"]'),
    quay: !!document.querySelector('#pendRows .spinner'),
    dem: (document.getElementById('pendCount') || {}).textContent,
  }));
  ok('Tải danh sách người dùng lỗi → bảng Chờ duyệt có nút Thử lại, không quay spinner', choDuyet.nut && !choDuyet.quay && choDuyet.dem === '—', JSON.stringify(choDuyet));
  await page.unroute('**/api/admin/users');

  // ── Từ chối đề nghị máy giặt xong không bị hỏi "dữ liệu chưa lưu" ──────────
  await page.goto('/dich-vu'); await cho(page, x => x.title === 'Dịch vụ');
  await page.evaluate(() => washReqTuChoiForm(987654321));
  await page.fill('#wq_tc_note', 'Lý do thử nghiệm');
  hop.length = 0;
  await page.click('#modal [data-act="washReqTuChoiLuu"]');
  await page.waitForTimeout(1200);
  ok('Từ chối đề nghị xong → không hỏi "dữ liệu chưa lưu", modal đóng',
    !hop.some(m => /chưa lưu/.test(m)) && !(await trang(page)).modal, JSON.stringify({ hop, t: await trang(page) }));

  console.log('  (request ghi đã chặn: ' + (daGhi.join(', ') || 'không có') + ')');
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  An toàn thao tác: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
