// BL-122: xoay ảnh CCCD phải đủ 4 chiều và không giới hạn số lượt.
// Ca hỏng cũ: anhNap() dùng fetch, mà CSP connect-src chỉ mở 'self' -> fetch một data: URL bị chặn,
// nên ảnh vừa chọn từ máy xoay hỏng ngay lượt đầu, ảnh đã lưu chỉ xoay được đúng một lượt.
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
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  const lr = await ctx.request.post('/api/auth/login', { data: { username: USER, password: PASS } });
  if (!lr.ok()) { console.log('  [FAIL] đăng nhập ' + lr.status()); await browser.close(); process.exit(1); }
  const page = await ctx.newPage();
  const loiJS = [];
  page.on('pageerror', e => loiJS.push(String(e)));

  await page.goto('/tong-quan');
  await page.waitForTimeout(3500);

  // Ảnh giả 60x20 (nằm ngang rõ rệt) dạng data: URL — đúng thứ FileReader trả về khi chọn tệp.
  const anhGia = await page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 60; cv.height = 20;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#c8d8ee'; cx.fillRect(0, 0, 60, 20);
    cx.fillStyle = '#22252e'; cx.fillRect(0, 0, 10, 20);
    return cv.toDataURL('image/jpeg', 0.92);
  });

  // ── anhNap phải đọc được data: URL (trước đây CSP chặn fetch nên ném "Failed to fetch") ────────
  const nap = await page.evaluate(async src => {
    try { const bm = await anhNap(src); return { w: bm.width, h: bm.height }; }
    catch (e) { return { loi: String(e && e.message || e) }; }
  }, anhGia);
  ok('anhNap đọc được ảnh data: URL', nap.w === 60 && nap.h === 20, JSON.stringify(nap));

  const napUrl = await page.evaluate(async () => {
    try { const bm = await anhNap('/icons/icon.svg'); return { w: bm.width, h: bm.height }; }
    catch (e) { return { loi: String(e && e.message || e) }; }
  });
  ok('anhNap vẫn đọc được ảnh cùng gốc theo URL', !napUrl.loi && napUrl.w > 0, JSON.stringify(napUrl));

  // ── Xoay 4 lượt liên tiếp: 90 → 180 → 270 → 360, mỗi lượt dựng lại từ ảnh GỐC ─────────────────
  const vong = await page.evaluate(async src => {
    const bm = await anhNap(src);
    return [90, 180, 270, 360].map(g => { const cv = anhVeXoay(bm, g); return `${cv.width}x${cv.height}`; });
  }, anhGia);
  ok('90° đảo cạnh (60x20 -> 20x60)', vong[0] === '20x60', vong.join(' · '));
  ok('180° giữ nguyên cạnh', vong[1] === '60x20', vong.join(' · '));
  ok('270° đảo cạnh', vong[2] === '20x60', vong.join(' · '));
  ok('360° về đúng ảnh gốc', vong[3] === '60x20', vong.join(' · '));

  // ── Form hồ sơ học viên: bấm nút Xoay 4 lượt thật, ảnh phải đổi chiều đủ vòng ──────────────────
  const sid = await page.evaluate(() => {
    const s = ST.students.find(x => !x.deleted_at);
    return s ? s.id : 0;
  });
  if (!sid) { ok('Có học viên để mở form', false, 'CSDL không có học viên nào'); }
  else {
    await page.evaluate(id => studentForm(id), sid);
    await page.waitForTimeout(2500);
    // Đổ ảnh giả vào ô xem trước y như lúc chọn tệp từ máy.
    await page.evaluate(src => { cccdDatGoc('front', src); cccdVeAnh('front', src, true); }, anhGia);
    await page.waitForTimeout(400);
    const co = await page.locator('#cccdFrontPrev [data-act="cccdXoay"]').count();
    ok('Ô ảnh có nút xoay trái/phải', co === 2, String(co));

    const cd = async () => page.evaluate(() => new Promise(r => {
      const img = document.querySelector('#cccdFrontPrev img');
      if (!img) return r(null);
      const doc = () => r({ w: img.naturalWidth, h: img.naturalHeight });
      if (img.complete && img.naturalWidth) return doc();
      img.addEventListener('load', doc, { once: true });
    }));
    const dau = await cd();
    ok('Ảnh ban đầu nằm ngang', dau && dau.w > dau.h, JSON.stringify(dau));

    const bam = async n => {
      for (let i = 0; i < n; i++) {
        await page.locator('#cccdFrontPrev [data-act="cccdXoay"]').last().click();
        await page.waitForTimeout(700);
      }
      return cd();
    };
    const l1 = await bam(1);
    ok('Lượt 1: ảnh thành DỌC', l1 && l1.h > l1.w, JSON.stringify(l1));
    const l2 = await bam(1);
    ok('Lượt 2 vẫn chạy (ca hỏng cũ dừng đúng ở đây): về NGANG', l2 && l2.w > l2.h, JSON.stringify(l2));
    const l3 = await bam(1);
    ok('Lượt 3: lại DỌC — đủ 4 chiều', l3 && l3.h > l3.w, JSON.stringify(l3));
    const l4 = await bam(1);
    ok('Lượt 4: khép vòng về đúng chiều ảnh gốc',
      l4 && l4.w === dau.w && l4.h === dau.h, `${JSON.stringify(l4)} vs gốc ${JSON.stringify(dau)}`);
    const l8 = await bam(4);
    ok('Bấm tiếp 4 lượt nữa vẫn chạy (không giới hạn lượt)',
      l8 && l8.w === dau.w && l8.h === dau.h, JSON.stringify(l8));
    ok('Nút xoay không bị kẹt ở trạng thái vô hiệu',
      await page.locator('#cccdFrontPrev [data-act="cccdXoay"][disabled]').count() === 0);
    ok('Cảnh báo "ảnh đang DỌC" đã tắt khi ảnh về ngang',
      await page.locator('#cccdDoc_front').isHidden());

    // Xoay dựng lại từ GỐC nên sau 4 lượt ảnh không mờ dần: cỡ data URL không phình theo số lượt.
    const cuoi = await page.evaluate(() => (document.querySelector('#cccdFrontPrev img') || {}).src || '');
    ok('Ảnh sau nhiều lượt vẫn là JPEG hợp lệ', /^data:image\/jpeg/.test(cuoi), cuoi.slice(0, 30));
    await page.evaluate(() => closeModal());
    await page.waitForTimeout(500);
  }

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 3).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Xoay ảnh CCCD đủ 4 chiều, không giới hạn lượt');
  process.exit(fail ? 1 : 0);
})();
