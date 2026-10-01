// Test giao diện (Playwright), KHÔNG ghi dữ liệu: ô chọn người / giới tính / cơ sở trong form TẠO MỚI mở ra
// với dòng "— Chọn … —" (không chọn sẵn người đầu danh sách), bấm lưu khi chưa chọn thì báo lỗi ngay tại ô.
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
  const loiJs = [], daGhi = [];
  const chuanBi = async ctx => {
    const page = await ctx.newPage();
    page.on('pageerror', e => loiJs.push(String(e)));
    page.on('dialog', d => d.dismiss());
    await page.route('**/api/**', route => {
      if (route.request().method() === 'GET') return route.continue();
      daGhi.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    return page;
  };
  const oChon = (page, id) => page.evaluate(i => {
    const s = document.getElementById(i);
    if (!s) return null;
    return { dau: s.options[0] ? s.options[0].value : null, chu: s.options[0] ? s.options[0].textContent.trim() : '', gt: s.value, so: s.options.length, tat: s.disabled };
  }, id);
  const loiO = (page, id) => page.evaluate(i => {
    const o = document.getElementById(i);
    const f = o && (o.closest('.field') || o.parentElement);
    const d = f && f.querySelector('.loi-o');
    return f && f.classList.contains('co-loi') && d ? d.textContent.trim() : '';
  }, id);
  const cho = async (page, fn, arg, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); }
    return false;
  };
  const dongModal = page => page.evaluate(() => { if (typeof closeModal === 'function') closeModal(); });
  const trong = (o, ten) => ok(`${ten}: dòng đầu là "— Chọn … —" (giá trị rỗng) và đang được chọn`,
    o && o.dau === '' && /^— Chọn/.test(o.chu) && o.gt === '', JSON.stringify(o));

  // ── Trang đăng ký công khai (không đăng nhập) ──────────────────────────────
  const khach = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  let page = await chuanBi(khach);
  await page.goto('/dang-ky');
  await cho(page, () => !!document.getElementById('applyForm'));
  let o = await oChon(page, 'a_gender');
  trong(o, 'Đăng ký công khai / Giới tính');
  ok('… vẫn đủ hai lựa chọn Nữ, Nam', o && o.so === 3);
  o = await oChon(page, 'a_facility');
  if (!o) ok('Đăng ký công khai / Cơ sở (BỎ QUA: không hiện ô cơ sở)', true);
  else if (o.so === 1) ok('Đăng ký công khai / Cơ sở: chỉ một cơ sở thì chọn sẵn, không bắt chọn', o.gt !== '' && o.dau !== '', JSON.stringify(o));
  else trong(o, 'Đăng ký công khai / Cơ sở (nhiều cơ sở)');
  await page.fill('#a_name', 'Thử Chọn Trống');
  await page.fill('#a_phone', '0900000000');
  if (o && o.so > 1) {
    await page.click('#applyForm [type=submit]');
    ok('… gửi khi chưa chọn cơ sở → lỗi tại ô Cơ sở', /Chọn cơ sở/.test(await loiO(page, 'a_facility')));
    await page.selectOption('#a_facility', { index: 1 });
  }
  await page.click('#applyForm [type=submit]');
  ok('… gửi khi chưa chọn giới tính → lỗi tại ô Giới tính', /Chọn giới tính/.test(await loiO(page, 'a_gender')), await loiO(page, 'a_gender'));
  await page.selectOption('#a_gender', 'female');
  await page.click('#applyForm [type=submit]');
  ok('… chọn Nữ rồi gửi → qua ô Giới tính, dừng ở Ngày sinh', !(await loiO(page, 'a_gender')) && /ngày sinh/i.test(await loiO(page, 'a_birth')));
  await khach.close();

  // ── Quản trị ───────────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  page = await chuanBi(ctx);
  await page.goto('/');
  await cho(page, () => typeof ST !== 'undefined' && ST.students && ST.students.length > 0);

  // Check-out nhanh
  await page.evaluate(() => quickPick('out'));
  await cho(page, () => !!document.getElementById('q_stu'));
  trong(await oChon(page, 'q_stu'), 'Chọn học viên trả phòng');
  await page.click('#modal [data-act="quickPickGo"]');
  ok('… bấm Tiếp tục khi chưa chọn → lỗi tại ô, form vẫn mở', /Chọn học viên/.test(await loiO(page, 'q_stu')) && await page.evaluate(() => !!document.getElementById('q_stu')));
  await page.selectOption('#q_stu', { index: 1 });
  await page.click('#modal [data-act="quickPickGo"]');
  ok('… chọn một người rồi Tiếp tục → sang form trả phòng', await cho(page, () => !document.getElementById('q_stu') && !!document.querySelector('#modal .mh')));
  await dongModal(page);

  // Thêm học viên dùng máy giặt
  if (await page.evaluate(() => ST.students.some(s => !s.uses_washing && isOccupying(s)))) {
    await page.evaluate(() => addWashingForm());
    await cho(page, () => !!document.getElementById('wash_stu'));
    trong(await oChon(page, 'wash_stu'), 'Thêm HV dùng máy giặt');
    await page.click('#modal [data-act="washAdd"]');
    ok('… bấm Thêm khi chưa chọn → lỗi tại ô, không gửi gì', /Chọn học viên/.test(await loiO(page, 'wash_stu')) && !daGhi.length, daGhi.join(', '));
    await dongModal(page);
  } else ok('Thêm HV dùng máy giặt (BỎ QUA: ai đang ở cũng đã dùng)', true);

  // Ghi nhận vi phạm
  await page.evaluate(() => violationForm());
  await cho(page, () => !!document.getElementById('vf_stu'));
  trong(await oChon(page, 'vf_stu'), 'Ghi nhận vi phạm / Học viên');
  const coLoai = await page.evaluate(() => (ST.vtypes || []).some(t => t.active !== false));
  if (coLoai) trong(await oChon(page, 'vf_type'), 'Ghi nhận vi phạm / Loại vi phạm');
  await page.click('#modal [data-act="saveViolation"]');
  ok('… Lưu khi chưa chọn học viên → lỗi tại ô Học viên', /Chọn học viên/.test(await loiO(page, 'vf_stu')));
  if (coLoai) {
    await page.selectOption('#vf_stu', { index: 1 });
    await page.click('#modal [data-act="saveViolation"]');
    ok('… chọn học viên, chưa chọn loại → lỗi tại ô Loại vi phạm', /Chọn loại vi phạm/.test(await loiO(page, 'vf_type')));
  }
  await dongModal(page);
  const mot = await page.evaluate(() => ST.students[0].id);
  await page.evaluate(id => violationForm(id), mot);
  await cho(page, () => !!document.getElementById('vf_stu'));
  o = await oChon(page, 'vf_stu');
  ok('Ghi vi phạm từ hồ sơ một học viên → ô Học viên khoá, chọn đúng người đó', o && o.tat && +o.gt === mot, JSON.stringify(o));
  await dongModal(page);

  // Thêm xe từ màn Gửi xe (chưa biết xe của ai)
  await page.evaluate(() => vehicleForm(0, 0));
  await cho(page, () => !!document.getElementById('v_stu'));
  trong(await oChon(page, 'v_stu'), 'Thêm xe / Chủ xe');
  ok('… chưa chọn chủ xe thì ô "Hiệu lực từ" để trống (không lấy ngày của người đầu danh sách)',
    await page.evaluate(() => !el('v_from').dataset.iso));
  const nguoi = await page.evaluate(() => {
    const s = ST.students.filter(isOccupying).find(x => x.check_in_date);
    return s ? { id: s.id, vao: String(s.check_in_date).slice(0, 10) } : null;
  });
  if (nguoi) {
    await page.selectOption('#v_stu', String(nguoi.id));
    ok('… chọn chủ xe → "Hiệu lực từ" lấy ngày nhận phòng của người đó', await page.evaluate(v => el('v_from').dataset.iso === v, nguoi.vao));
    await page.selectOption('#v_stu', '');
  }
  await page.click('#modal [data-act="saveVehicle"]');
  ok('… Lưu khi chưa chọn chủ xe → lỗi tại ô', /Chọn chủ xe/.test(await loiO(page, 'v_stu')));
  await dongModal(page);

  // Thêm phiếu báo lẻ
  await page.evaluate(() => invoiceForm(0));
  await cho(page, () => !!document.getElementById('i_stu'));
  trong(await oChon(page, 'i_stu'), 'Thêm phiếu báo lẻ / Học viên');
  await dongModal(page);

  // Cử phòng trưởng: phòng có người ở mà chưa có phòng trưởng / phòng đã có
  const phong = await page.evaluate(() => {
    const coNguoi = ST.rooms.filter(r => ST.students.some(s => s.room_id === r.id && isOccupying(s)));
    const chua = coNguoi.find(r => !leaderOf(r.id)), co = coNguoi.find(r => leaderOf(r.id));
    return { chua: chua && chua.id, co: co && co.id, ten: co && leaderOf(co.id).id };
  });
  if (phong.chua) {
    await page.evaluate(id => leaderForm(id), phong.chua);
    await cho(page, () => !!document.getElementById('l_stu'));
    trong(await oChon(page, 'l_stu'), 'Cử phòng trưởng (phòng chưa có)');
    await page.click('#modal [data-act="doSetLeader"]');
    ok('… bấm cử khi chưa chọn → lỗi tại ô', /Chọn học viên/.test(await loiO(page, 'l_stu')));
    await dongModal(page);
  } else ok('Cử phòng trưởng, phòng chưa có (BỎ QUA: không có phòng như vậy)', true);
  if (phong.co) {
    await page.evaluate(id => leaderForm(id), phong.co);
    await cho(page, () => !!document.getElementById('l_stu'));
    o = await oChon(page, 'l_stu');
    ok('Phòng đã có phòng trưởng → chọn sẵn người đang làm, không có dòng trống', o && o.dau !== '' && +o.gt === phong.ten, JSON.stringify(o));
    await dongModal(page);
  } else ok('Phòng đã có phòng trưởng (BỎ QUA: chưa phòng nào có)', true);

  // Tạo đơn đăng ký hộ
  await page.evaluate(() => appForm());
  await cho(page, () => !!document.getElementById('ap_gender'));
  trong(await oChon(page, 'ap_gender'), 'Tạo đơn đăng ký / Giới tính');
  await page.fill('#ap_name', 'Thử Chọn Trống');
  await page.fill('#ap_phone', '0900000000');
  await page.click('#modal [data-act="saveApp"]');
  ok('… Tạo đơn khi chưa chọn giới tính → lỗi tại ô', /Chọn giới tính/.test(await loiO(page, 'ap_gender')), await loiO(page, 'ap_gender'));
  o = await oChon(page, 'ap_fac');
  if (o && o.so > 1) {
    trong(o, 'Tạo đơn đăng ký / Cơ sở (nhiều cơ sở)');
    await page.selectOption('#ap_gender', 'female');
    await page.click('#modal [data-act="saveApp"]');
    ok('… chọn giới tính, chưa chọn cơ sở → lỗi tại ô Cơ sở', /Chọn cơ sở/.test(await loiO(page, 'ap_fac')), await loiO(page, 'ap_fac'));
  } else ok('Tạo đơn đăng ký / Cơ sở: một cơ sở thì chọn sẵn', !o || (o.gt !== '' && o.dau !== ''), JSON.stringify(o));
  await dongModal(page);

  // Duyệt tài khoản đăng nhập Microsoft thành học viên mới (tài khoản giả trong bộ nhớ trang)
  await page.evaluate(() => {
    window._usrCache = [{ id: 990077, username: 'sso-thu', full_name: 'SSO Thử', email: 'sso-thu@example.com', role: 'pending' }];
    duyetTaiKhoanForm(990077, 'hocvien');
  });
  await cho(page, () => !!document.getElementById('ap_gender'));
  trong(await oChon(page, 'ap_gender'), 'Duyệt tài khoản → hồ sơ học viên mới / Giới tính');
  await page.click('#modal [data-act="saveApprove"]');
  ok('… Duyệt khi chưa chọn giới tính → lỗi tại ô', /Chọn giới tính/.test(await loiO(page, 'ap_gender')), await loiO(page, 'ap_gender'));
  await dongModal(page);

  ok('Không request ghi nào (đều bị chặn, và không có cái nào)', daGhi.length === 0, daGhi.join(', '));
  ok('Không có lỗi JavaScript', loiJs.length === 0, loiJs.join(' | '));
  await browser.close();
  console.log(`\n  Ô chọn có dòng trống: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
