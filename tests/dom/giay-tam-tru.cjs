// Test giao diện (Playwright), KHÔNG ghi dữ liệu — request ghi bị chặn bằng page.route và trả 200 giả; GET hồ sơ được
// chèn trường giấy tạm trú giả theo đúng thứ máy chủ sẽ trả. Kiểm: form Sửa có ô đính kèm giấy tạm trú, chọn tệp là gửi
// ngay rồi vẽ lại khối + nhận phiên bản hồ sơ mới, gỡ phải hỏi, tệp sai loại bị chặn tại chỗ, thẻ chi tiết chỉ để xem.
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
  const loiJs = [];
  page.on('pageerror', e => loiJs.push(String((e && e.stack) || e).split('\n').slice(0, 3).join(' ')));

  let idHv = null;
  let gia = { residency_doc: null, _v: 'v-truoc' };
  const ghi = [];
  await page.route('**/api/**', async route => {
    const rq = route.request(), m = rq.method(), duong = new URL(rq.url()).pathname;
    if (m !== 'GET') {
      ghi.push({ m, duong, than: rq.postData() || '' });
      if (duong === `/api/students/${idHv}/residency-doc`) {
        gia = m === 'POST'
          ? { residency_doc: `/api/students/${idHv}/residency-doc?v=v-sau`, residency_doc_ext: 'pdf', _v: 'v-sau' }
          : { residency_doc: null, _v: 'v-sau-go' };
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
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

  const khoiChiTiet = () => page.evaluate(() => {
    const nhan = [...document.querySelectorAll('#modal .muted')].find(d => d.textContent.trim().startsWith('Giấy tạm trú'));
    const o = nhan && nhan.parentElement;
    return o ? { chu: o.textContent, anh: (o.querySelector('img') || {}).alt || '', src: (o.querySelector('img') || {}).getAttribute?.('src') || '' } : null;
  });

  // ── Thẻ chi tiết: chỉ xem ───────────────────────────────────────────────────
  await page.evaluate(id => studentDetail(id), idHv);
  await doi(page, async () => !!(await khoiChiTiet()));
  const ct1 = await khoiChiTiet();
  ok('Chi tiết học viên có mục "Giấy tạm trú"', !!ct1);
  ok('… chưa nộp thì ghi "Chưa đính kèm."', !!ct1 && ct1.chu.includes('Chưa đính kèm.'), ct1 && ct1.chu);
  ok('… thẻ chi tiết không có ô chọn tệp nào', await page.locator('#modal input[type=file]').count() === 0);
  await page.evaluate(() => closeModalNgay());

  gia = { residency_doc: `/api/students/${idHv}/residency-doc?v=1`, residency_doc_ext: 'png', _v: 'v-truoc' };
  await page.evaluate(id => studentDetail(id), idHv);
  await doi(page, async () => !!(await khoiChiTiet()));
  const ct2 = await khoiChiTiet();
  ok('Đã nộp ảnh → chi tiết hiện ảnh giấy tạm trú', !!ct2 && ct2.anh === 'Giấy tạm trú' && ct2.src.startsWith(`/api/students/${idHv}/residency-doc`), JSON.stringify(ct2));
  await page.evaluate(() => closeModalNgay());

  // ── Form Sửa: ô đính kèm ────────────────────────────────────────────────────
  gia = { residency_doc: null, _v: 'v-truoc' };
  await page.evaluate(id => studentForm(id), idHv);
  ok('Form Sửa có khối giấy tạm trú', await doi(page, async () => await page.locator('#f_tamtru').count() > 0));
  const bo = await page.evaluate(() => {
    const o = document.getElementById('f_tamtru');
    const inp = document.getElementById('f_tamtru_tep');
    return {
      nhan: o.closest('.field').querySelector('label').textContent.trim(),
      cungNhom: o.closest('.form-nhom') === document.getElementById('f_residency').closest('.form-nhom'),
      accept: inp ? inp.getAttribute('accept') : null,
      coGo: !!o.querySelector('[data-act="goGiayTamTru"]'),
      chu: o.textContent,
    };
  });
  ok('Nhãn ô là "Giấy tạm trú (ảnh hoặc PDF)"', bo.nhan === 'Giấy tạm trú (ảnh hoặc PDF)', bo.nhan);
  ok('… nằm cùng nhóm với ô chọn tình trạng Tạm trú', bo.cungNhom);
  ok('… ô chọn tệp chỉ nhận PDF/PNG/JPG', /application\/pdf/.test(bo.accept || '') && /image\/png/.test(bo.accept || '')
    && /image\/jpeg/.test(bo.accept || '') && !/image\/\*/.test(bo.accept || ''), bo.accept);
  ok('… chưa nộp thì không có nút Gỡ, ghi "Chưa đính kèm."', !bo.coGo && bo.chu.includes('Chưa đính kèm.'), bo.chu);

  await page.fill('#f_class', 'LOP-TAM-TRU-1');
  const lopTruoc = await page.evaluate(() => _lopModal.length);

  await page.setInputFiles('#f_tamtru_tep', { name: 'giay.heic', mimeType: 'image/heic', buffer: Buffer.from('khong phai anh') });
  await page.waitForTimeout(500);
  const loiTep = await page.evaluate(() => ((document.querySelector('#f_tamtru .tep-loi') || {}).textContent || ''));
  ok('Chọn tệp HEIC → báo lỗi ngay dưới ô', loiTep.startsWith('Giấy tạm trú: chỉ nhận'), loiTep);
  ok('… và không gửi gì lên máy chủ', !ghi.some(g => g.duong.endsWith('/residency-doc')), JSON.stringify(ghi));

  await page.setInputFiles('#f_tamtru_tep', { name: 'tam-tru.pdf', mimeType: 'application/pdf', buffer: PDF });
  const daGui = await doi(page, async () => ghi.some(g => g.m === 'POST' && g.duong === `/api/students/${idHv}/residency-doc`));
  ok('Chọn tệp PDF → gửi lên ngay, không chờ bấm Lưu', daGui, JSON.stringify(ghi.map(g => g.m + ' ' + g.duong)));
  const post = ghi.find(g => g.m === 'POST' && g.duong.endsWith('/residency-doc'));
  ok('… thân gửi là data URL của PDF', !!post && String(JSON.parse(post.than).data).startsWith('data:application/pdf;base64,'), post && post.than.slice(0, 60));
  const veLai = await doi(page, async () => await page.locator('#f_tamtru [data-act="goGiayTamTru"]').count() > 0);
  ok('… rồi vẽ lại khối: có nút Gỡ', veLai);
  const sau = await page.evaluate(() => ({
    nut: ((document.querySelector('#f_tamtru a.btn') || {}).textContent || '').trim(),
    href: (document.querySelector('#f_tamtru a.btn') || { getAttribute: () => '' }).getAttribute('href'),
    v: window._svV, lop: _lopModal.length, lopHoc: document.getElementById('f_class').value,
    loi: !!document.querySelector('#f_tamtru .tep-loi'),
  }));
  ok('… PDF hiện nút "Mở giấy tạm trú (PDF)" trỏ đúng đường xem', sau.nut === 'Mở giấy tạm trú (PDF)' && String(sau.href).startsWith(`/api/students/${idHv}/residency-doc`), JSON.stringify(sau));
  ok('… form nhận phiên bản hồ sơ mới (bấm Lưu không báo "người khác vừa sửa")', sau.v === 'v-sau', String(sau.v));
  ok('… không mở thêm lớp form, chữ đang gõ ở ô khác giữ nguyên', sau.lop === lopTruoc && sau.lopHoc === 'LOP-TAM-TRU-1', JSON.stringify(sau));
  ok('… báo lỗi tệp cũ đã biến mất', !sau.loi);

  // ── Gỡ phải hỏi ─────────────────────────────────────────────────────────────
  await page.click('#f_tamtru [data-act="goGiayTamTru"]');
  const hoi = await doi(page, async () => await page.locator('.xn-hop').count() > 0, 3000);
  const cauHoi = hoi ? await page.locator('.xn-hop .xn-cau').textContent() : '';
  ok('Bấm Gỡ → hỏi lại trước khi xoá', hoi && cauHoi.startsWith('Gỡ giấy tạm trú?'), cauHoi);
  await page.click('.xn-hop [data-xn="0"]').catch(() => {});
  await page.waitForTimeout(400);
  ok('… bấm Hủy thì không gửi lệnh xoá', !ghi.some(g => g.m === 'DELETE'));
  await page.click('#f_tamtru [data-act="goGiayTamTru"]');
  await page.click('.xn-hop [data-xn="1"]', { timeout: 3000 }).catch(() => {});
  const daXoa = await doi(page, async () => ghi.some(g => g.m === 'DELETE' && g.duong === `/api/students/${idHv}/residency-doc`));
  ok('… đồng ý thì gửi lệnh gỡ', daXoa);
  ok('… khối về "Chưa đính kèm.", hết nút Gỡ', await doi(page, () => page.evaluate(() => {
    const o = document.getElementById('f_tamtru');
    return !!o && !o.querySelector('[data-act="goGiayTamTru"]') && o.textContent.includes('Chưa đính kèm.');
  })));
  ok('… form nhận phiên bản hồ sơ sau khi gỡ', await page.evaluate(() => window._svV) === 'v-sau-go');

  // ── Lưu: gửi đúng phiên bản mới, không gửi cột giấy tạm trú ─────────────────
  await page.click('#modal [data-act="saveStudent"]');
  const daLuu = await doi(page, async () => ghi.some(g => g.m === 'PUT' && g.duong === `/api/students/${idHv}`));
  const put = ghi.find(g => g.m === 'PUT' && g.duong === `/api/students/${idHv}`);
  const than = put ? JSON.parse(put.than) : {};
  ok('Bấm Lưu → gửi phiên bản hồ sơ mới nhất', daLuu && than._v === 'v-sau-go', put && put.than.slice(0, 80));
  ok('… không gửi cột residency_doc', !('residency_doc' in than));

  ok('Không có lỗi JS', loiJs.length === 0, loiJs.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Giấy tạm trú: form Sửa nộp/gỡ được, thẻ chi tiết chỉ xem');
  process.exit(fail ? 1 : 0);
})();
