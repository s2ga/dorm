// Test giao diện (Playwright), KHÔNG ghi dữ liệu — request ghi bị chặn bằng page.route và trả 200 giả; GET hồ sơ được
// chèn trường giấy tạm trú giả theo đúng thứ máy chủ sẽ trả. Kiểm: form Sửa có ô đính kèm giấy tạm trú, chọn tệp là gửi
// ngay, nộp giấy thì ô Tạm trú chuyển "Đã đăng ký" mà đóng form không bị hỏi nhầm, gỡ phải hỏi, tệp sai loại bị chặn.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const USER = process.env.TEST_ADMIN_USER || 'admin';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS (đặt qua biến môi trường).'); process.exit(2); }

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  [OK] ' + name);
  else { fail++; console.log('  [FAIL] ' + name + (extra ? ' -- ' + extra : '')); }
};
const doi = async (page, dk, ms = 8000) => {
  for (let t = 0; t < ms; t += 150) { if (await dk()) return true; await page.waitForTimeout(150); }
  return false;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  ok('Đăng nhập admin (200)', lr.ok(), 'status ' + lr.status());
  if (!lr.ok()) { await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJs = [], hopHeThong = [];
  page.on('pageerror', e => loiJs.push(String((e && e.stack) || e).split('\n').slice(0, 3).join(' ')));
  page.on('dialog', d => { hopHeThong.push(d.message()); d.accept(); });

  let idHv = null;
  const BAN_DAU = { residency_doc: null, residency_status: 'unregistered', _v: 'v-truoc' };
  let gia = { ...BAN_DAU };
  const ghi = [];
  await page.route('**/api/**', async route => {
    const rq = route.request(), m = rq.method(), duong = new URL(rq.url()).pathname;
    if (m !== 'GET') {
      ghi.push({ m, duong, than: rq.postData() || '' });
      let tra = { ok: true };
      if (duong === `/api/students/${idHv}/residency-doc`) {
        if (m === 'POST') {
          tra = { ok: true, ext: 'pdf', da_dang_ky: gia.residency_status !== 'registered' };
          gia = { residency_doc: `/api/students/${idHv}/residency-doc?v=v-sau`, residency_doc_ext: 'pdf', residency_status: 'registered', _v: 'v-sau' };
        } else gia = { residency_doc: null, residency_status: gia.residency_status, _v: 'v-sau-go' };
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tra) });
    }
    if (idHv && duong === `/api/students/${idHv}`) {
      const r = await route.fetch();
      return route.fulfill({ response: r, json: { ...(await r.json()), ...gia } });
    }
    return route.continue();
  });

  await page.goto('/hoc-vien');
  await doi(page, () => page.evaluate(() => typeof ST !== 'undefined' && Array.isArray(ST.students) && ST.students.length > 0), 15000);
  idHv = await page.evaluate(() => (ST.students.find(s => !s.deleted_at) || {}).id);
  if (!idHv) {
    console.log('  [OK] Bỏ qua: không có học viên nào để mở hồ sơ');
    await browser.close(); process.exit(0);
  }
  const daGuiNop = () => ghi.some(g => g.m === 'POST' && g.duong === `/api/students/${idHv}/residency-doc`);

  const khoiChiTiet = () => page.evaluate(() => {
    const nhan = [...document.querySelectorAll('#modal .muted')].find(d => d.textContent.trim().startsWith('Giấy tạm trú'));
    const o = nhan && nhan.parentElement;
    const anh = o && o.querySelector('img');
    return o ? { chu: o.textContent, anh: anh ? anh.alt : '', src: anh ? anh.getAttribute('src') : '' } : null;
  });

  // ── Thẻ chi tiết: chỉ xem ───────────────────────────────────────────────────
  await page.evaluate(id => studentDetail(id), idHv);
  await doi(page, async () => !!(await khoiChiTiet()));
  const ct1 = await khoiChiTiet();
  ok('Chi tiết học viên có mục "Giấy tạm trú"', !!ct1);
  ok('… chưa nộp thì ghi "Chưa đính kèm."', !!ct1 && ct1.chu.includes('Chưa đính kèm.'), ct1 && ct1.chu);
  ok('… thẻ chi tiết không có ô chọn tệp nào', await page.locator('#modal input[type=file]').count() === 0);
  await page.evaluate(() => closeModalNgay());

  gia = { residency_doc: `/api/students/${idHv}/residency-doc?v=1`, residency_doc_ext: 'png', residency_status: 'registered', _v: 'v-truoc' };
  await page.evaluate(id => studentDetail(id), idHv);
  await doi(page, async () => !!(await khoiChiTiet()));
  const ct2 = await khoiChiTiet();
  ok('Đã nộp ảnh → chi tiết hiện ảnh giấy tạm trú', !!ct2 && ct2.anh === 'Giấy tạm trú' && ct2.src.startsWith(`/api/students/${idHv}/residency-doc`), JSON.stringify(ct2));
  await page.evaluate(() => closeModalNgay());

  // ── Form chưa sửa gì: nộp giấy → ô Tạm trú chuyển "Đã đăng ký", đóng không bị hỏi ─
  gia = { ...BAN_DAU };
  await page.evaluate(id => studentForm(id), idHv);
  ok('Form Sửa có khối giấy tạm trú', await doi(page, async () => await page.locator('#f_tamtru').count() > 0));
  await page.waitForTimeout(300);
  const bo = await page.evaluate(() => {
    const o = document.getElementById('f_tamtru');
    const inp = document.getElementById('f_tamtru_tep');
    return {
      nhan: o.closest('.field').querySelector('label').textContent.trim(),
      cungNhom: o.closest('.form-nhom') === document.getElementById('f_residency').closest('.form-nhom'),
      accept: inp ? inp.getAttribute('accept') : null,
      coGo: !!o.querySelector('[data-act="goGiayTamTru"]'),
      chu: o.textContent,
      tinhTrang: document.getElementById('f_residency').value,
    };
  });
  ok('Nhãn ô là "Giấy tạm trú (ảnh hoặc PDF)"', bo.nhan === 'Giấy tạm trú (ảnh hoặc PDF)', bo.nhan);
  ok('… nằm cùng nhóm với ô chọn tình trạng Tạm trú', bo.cungNhom);
  ok('… ô chọn tệp chỉ nhận PDF/PNG/JPG', /application\/pdf/.test(bo.accept || '') && /image\/png/.test(bo.accept || '')
    && /image\/jpeg/.test(bo.accept || '') && !/image\/\*/.test(bo.accept || ''), bo.accept);
  ok('… chưa nộp thì không có nút Gỡ, ghi "Chưa đính kèm."', !bo.coGo && bo.chu.includes('Chưa đính kèm.'), bo.chu);
  ok('… ô Tạm trú đang là "Chưa đăng ký"', bo.tinhTrang === 'unregistered', bo.tinhTrang);

  await page.setInputFiles('#f_tamtru_tep', { name: 'tam-tru.pdf', mimeType: 'application/pdf', buffer: PDF });
  ok('Chọn tệp PDF → gửi lên ngay, không chờ bấm Lưu', await doi(page, async () => daGuiNop()), JSON.stringify(ghi.map(g => g.m + ' ' + g.duong)));
  const post = ghi.find(g => g.m === 'POST' && g.duong.endsWith('/residency-doc'));
  ok('… thân gửi là data URL của PDF', !!post && String(JSON.parse(post.than).data).startsWith('data:application/pdf;base64,'), post && post.than.slice(0, 60));
  ok('… rồi vẽ lại khối: có nút Gỡ', await doi(page, async () => await page.locator('#f_tamtru [data-act="goGiayTamTru"]').count() > 0));
  await page.waitForTimeout(300);
  const sach = await page.evaluate(id => ({
    tinhTrang: document.getElementById('f_residency').value,
    dangDo: formDangDo(), v: window._svV,
    toast: (document.getElementById('toast') || {}).textContent || '',
    nho: (({ has_residency_doc, residency_status }) => ({ has_residency_doc, residency_status }))(studentById(id) || {}),
    nut: ((document.querySelector('#f_tamtru a.btn') || {}).textContent || '').trim(),
  }), idHv);
  ok('… ô Tạm trú trong form tự chuyển "Đã đăng ký"', sach.tinhTrang === 'registered', sach.tinhTrang);
  ok('… báo cho người dùng biết đã chuyển', sach.toast.includes('"Đã đăng ký"'), sach.toast);
  ok('… form không bị coi là đang sửa dở', sach.dangDo === false);
  ok('… form nhận phiên bản hồ sơ mới (bấm Lưu không báo "người khác vừa sửa")', sach.v === 'v-sau', String(sach.v));
  ok('… PDF hiện nút "Mở giấy tạm trú (PDF)"', sach.nut === 'Mở giấy tạm trú (PDF)', sach.nut);
  ok('… danh sách đang nhớ cập nhật ngay (bảng phía sau thấy giấy mới)',
    sach.nho.has_residency_doc === true && sach.nho.residency_status === 'registered', JSON.stringify(sach.nho));
  await page.click('#modal .mf [data-act="modalBack"]');
  await page.waitForTimeout(400);
  ok('Bấm Hủy → đóng form, không hỏi "dữ liệu chưa lưu"',
    hopHeThong.length === 0 && !(await page.evaluate(() => document.getElementById('overlay').classList.contains('show'))), hopHeThong.join(' | '));
  await page.evaluate(() => closeModalNgay());

  // ── Form đang sửa dở: chữ giữ nguyên, tệp sai loại bị chặn, gỡ phải hỏi ─────────
  gia = { ...BAN_DAU };
  ghi.length = 0;
  await page.evaluate(id => studentForm(id), idHv);
  await doi(page, async () => await page.locator('#f_tamtru').count() > 0);
  await page.waitForTimeout(300);
  await page.fill('#f_class', 'LOP-TAM-TRU-1');
  const lopTruoc = await page.evaluate(() => _lopModal.length);

  await page.setInputFiles('#f_tamtru_tep', { name: 'giay.heic', mimeType: 'image/heic', buffer: Buffer.from('khong phai anh') });
  await page.waitForTimeout(500);
  const loiTep = await page.evaluate(() => ((document.querySelector('#f_tamtru .tep-loi') || {}).textContent || ''));
  ok('Chọn tệp HEIC → báo lỗi ngay dưới ô', loiTep.startsWith('Giấy tạm trú: chỉ nhận'), loiTep);
  ok('… và không gửi gì lên máy chủ', !ghi.some(g => g.duong.endsWith('/residency-doc')), JSON.stringify(ghi));

  await page.setInputFiles('#f_tamtru_tep', { name: 'tam-tru.pdf', mimeType: 'application/pdf', buffer: PDF });
  await doi(page, async () => daGuiNop());
  await doi(page, async () => await page.locator('#f_tamtru [data-act="goGiayTamTru"]').count() > 0);
  await page.waitForTimeout(300);
  const doDang = await page.evaluate(() => ({
    lop: _lopModal.length, lopHoc: document.getElementById('f_class').value,
    tinhTrang: document.getElementById('f_residency').value, dangDo: formDangDo(),
    loi: !!document.querySelector('#f_tamtru .tep-loi'),
  }));
  ok('Đang sửa dở mà nộp giấy → không mở thêm lớp form, chữ ở ô khác giữ nguyên',
    doDang.lop === lopTruoc && doDang.lopHoc === 'LOP-TAM-TRU-1', JSON.stringify(doDang));
  ok('… ô Tạm trú vẫn chuyển "Đã đăng ký"', doDang.tinhTrang === 'registered', doDang.tinhTrang);
  ok('… và vẫn nhớ là còn chữ chưa lưu (đóng sẽ hỏi)', doDang.dangDo === true);
  ok('… báo lỗi tệp cũ đã biến mất', !doDang.loi);

  await page.click('#f_tamtru [data-act="goGiayTamTru"]');
  const hoi = await doi(page, async () => await page.locator('.xn-hop').count() > 0, 3000);
  const cauHoi = hoi ? await page.locator('.xn-hop .xn-cau').textContent() : '';
  ok('Bấm Gỡ → hỏi lại trước khi xoá', hoi && cauHoi.startsWith('Gỡ giấy tạm trú?'), cauHoi);
  await page.click('.xn-hop [data-xn="0"]').catch(() => {});
  await page.waitForTimeout(400);
  ok('… bấm Hủy thì không gửi lệnh xoá', !ghi.some(g => g.m === 'DELETE'));
  await page.click('#f_tamtru [data-act="goGiayTamTru"]');
  await page.click('.xn-hop [data-xn="1"]', { timeout: 3000 }).catch(() => {});
  ok('… đồng ý thì gửi lệnh gỡ', await doi(page, async () => ghi.some(g => g.m === 'DELETE' && g.duong === `/api/students/${idHv}/residency-doc`)));
  ok('… khối về "Chưa đính kèm.", hết nút Gỡ', await doi(page, () => page.evaluate(() => {
    const o = document.getElementById('f_tamtru');
    return !!o && !o.querySelector('[data-act="goGiayTamTru"]') && o.textContent.includes('Chưa đính kèm.');
  })));
  const sauGo = await page.evaluate(id => ({ v: window._svV, tinhTrang: document.getElementById('f_residency').value, co: (studentById(id) || {}).has_residency_doc }), idHv);
  ok('… form nhận phiên bản hồ sơ sau khi gỡ', sauGo.v === 'v-sau-go', String(sauGo.v));
  ok('… gỡ giấy không đổi ngược ô Tạm trú', sauGo.tinhTrang === 'registered', sauGo.tinhTrang);
  ok('… danh sách đang nhớ ghi là không còn giấy', sauGo.co === false, String(sauGo.co));

  // ── Lưu: gửi đúng phiên bản mới + tình trạng "Đã đăng ký", không gửi cột giấy tạm trú ─
  await page.click('#modal [data-act="saveStudent"]');
  const daLuu = await doi(page, async () => ghi.some(g => g.m === 'PUT' && g.duong === `/api/students/${idHv}`));
  const put = ghi.find(g => g.m === 'PUT' && g.duong === `/api/students/${idHv}`);
  const than = put ? JSON.parse(put.than) : {};
  ok('Bấm Lưu → gửi phiên bản hồ sơ mới nhất', daLuu && than._v === 'v-sau-go', put && put.than.slice(0, 80));
  ok('… gửi tình trạng tạm trú "Đã đăng ký", không ghi ngược về cũ', than.residency_status === 'registered', String(than.residency_status));
  ok('… không gửi cột residency_doc', !('residency_doc' in than));

  ok('Không có lỗi JS', loiJs.length === 0, loiJs.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Giấy tạm trú: form Sửa nộp/gỡ được, nộp là "Đã đăng ký", thẻ chi tiết chỉ xem');
  process.exit(fail ? 1 : 0);
})();
