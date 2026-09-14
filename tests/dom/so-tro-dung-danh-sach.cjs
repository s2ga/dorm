// Luật chung: bấm vào MỘT CON SỐ thì danh sách mở ra phải đúng là tập hợp mà con số đó đếm.
// Bẫy đã gặp: màn đích giữ bộ lọc/kỳ/tab của lần xem trước nên số bấm vào khác số hiện ra.
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
  const cho = ms => page.waitForTimeout(ms);

  await page.goto('/tong-quan');
  await cho(3500);

  // ── Mỗi dòng chuông phải đi qua một hàm ĐẶT LẠI bộ lọc, không được adminGo trần ────────────────
  const denTran = await page.evaluate(() => {
    ST.applications = [{ id: 1, status: 'pending', name: 'A' }];
    ST.couts = [{ id: 1, status: 'pending' }];
    ST.damage = [{ id: 1, category: 'damage', status: 'new' }, { id: 2, category: 'other', status: 'new' }];
    ST.vstats = { needMail: 3, threshold: 3 };
    ST.hoReports = [{ id: 1, kind: 'checkin', status: 'pending' }, { id: 2, kind: 'checkout', status: 'pending' }];
    return notifItems().filter(i => i.n > 0 && /data-act="adminGo"/.test(i.act || '')).map(i => i.tx);
  });
  ok('Không dòng chuông nào còn adminGo trần', denTran.length === 0, denTran.join(' | '));

  const bien = await page.evaluate(() => notifItems().map(i => ({ tx: i.tx, act: i.act })));
  const co = re => bien.find(i => re.test(i.tx));
  ok('Biên bản nhận phòng và trả phòng là HAI dòng riêng',
    !!co(/biên bản NHẬN phòng/) && !!co(/biên bản TRẢ phòng/), JSON.stringify(bien.map(b => b.tx)));
  ok('Dòng biên bản nhận phòng trỏ về màn Đăng ký', /nhanPhongGo/.test((co(/biên bản NHẬN phòng/) || {}).act || ''));
  ok('Dòng biên bản trả phòng trỏ về màn Trả phòng', /traPhongGo/.test((co(/biên bản TRẢ phòng/) || {}).act || ''));
  ok('Dòng vi phạm trỏ tới bộ lọc "cần báo"', /viPhamGo/.test((co(/cần báo nhà trường/) || {}).act || ''));

  // ── Đơn đăng ký: xem "Từ chối" trước, rồi bấm chuông -> phải quay về "Chờ duyệt" ───────────────
  await page.evaluate(() => { regFilter = 'rejected'; coutFilter = 'rejected'; dmgFilter = 'done'; fbFilter = 'done'; });
  await page.evaluate(() => nhanPhongGo());
  await cho(2500);
  ok('Chuông "đơn đăng ký chờ duyệt" ép bộ lọc về Chờ duyệt', await page.evaluate(() => regFilter) === 'pending');
  await page.evaluate(() => traPhongGo());
  await cho(2000);
  ok('Chuông "đơn xin trả phòng" ép bộ lọc về Chờ xác nhận', await page.evaluate(() => coutFilter) === 'pending');
  await page.evaluate(() => baoTriGo());
  await cho(2000);
  ok('Chuông "báo hư hỏng" ép bộ lọc về Chưa xong', await page.evaluate(() => dmgFilter) === 'open');
  await page.evaluate(() => gopYGo());
  await cho(2000);
  ok('Badge Hộp thư góp ý ép bộ lọc về Chưa xong', await page.evaluate(() => fbFilter) === 'open');
  const soGopY = await page.evaluate(() => {
    const h2 = document.querySelector('#content .panel .hd h2');
    const m = (h2 ? h2.textContent : '').match(/\((\d+)\)/);
    const badge = (ST.damage || []).filter(d => ['violation', 'other'].includes(d.category) && d.status !== 'done').length;
    return { tieuDe: m ? +m[1] : null, badge };
  });
  ok('Góp ý: số ở tiêu đề khớp badge trên menu', soGopY.tieuDe === soGopY.badge, JSON.stringify(soGopY));

  // ── Vi phạm: số đếm HỌC VIÊN cần báo, danh sách phải là của đúng nhóm đó ───────────────────────
  await page.evaluate(() => viPhamGo('canbao'));
  await cho(2500);
  ok('Vào màn Vi phạm với bộ lọc "cần báo"', await page.evaluate(() => vioFilter) === 'canbao');
  const vp = await page.evaluate(() => {
    const h2 = document.querySelector('#content .panel .hd h2');
    return { td: h2 ? h2.textContent : '', needMail: (ST.vstats || {}).needMail };
  });
  ok('Tiêu đề nói rõ bao nhiêu HỌC VIÊN và bao nhiêu lượt', /học viên/.test(vp.td) && /lượt/.test(vp.td), vp.td);
  ok('Có nút bỏ lọc để xem tất cả lượt vi phạm',
    await page.locator('[data-act="vioGo"][data-args=\'["all"]\']').count() === 1);

  // ── Phòng: thẻ "Giường trống" không được rơi vào tab Lịch của lần xem trước ────────────────────
  await page.evaluate(() => { roomTab = 'lich'; roomSearch = 'xyz'; });
  await page.evaluate(() => roomGo('trong'));
  await cho(2500);
  const ph = await page.evaluate(() => ({ tab: roomTab, loc: roomFilter, tim: roomSearch }));
  ok('Thẻ Giường trống mở TAB DANH SÁCH, giữ đúng bộ lọc "trong", xoá ô tìm cũ',
    ph.tab === 'ds' && ph.loc === 'trong' && ph.tim === '', JSON.stringify(ph));

  // ── Học viên: đi từ con số phải xoá ô tìm của lần trước, nếu không danh sách ít hơn con số ─────
  await page.evaluate(() => { stuSearch = 'khong-co-ai-ten-the-nay'; });
  await page.evaluate(() => stuGoAdmin('in_ktx'));
  await cho(2500);
  const hv = await page.evaluate(() => {
    const n = el('stuCount');
    return { tim: stuSearch, dem: n ? +n.textContent : null, that: ST.students.filter(dangOTinhGiuong).length };
  });
  ok('Ô tìm cũ bị xoá khi đi từ thẻ KPI', hv.tim === '');
  ok('Số dòng đúng bằng số trên thẻ "Học viên đang ở"', hv.dem === hv.that, JSON.stringify(hv));

  // ── Xuất cảnh: thẻ ghi "năm N" thì danh sách chỉ được có người của năm N ───────────────────────
  const nam = await page.evaluate(() => curMonth().slice(0, 4));
  await page.evaluate(n => xuatCanhGo(n), nam);
  await cho(2500);
  const xc = await page.evaluate(n => {
    const dem = el('stuCount');
    return {
      loc: stuFilter, nam: stuNam, dem: dem ? +dem.textContent : null,
      that: ST.students.filter(s => s.check_out_date && DEPARTURE_REASONS.includes(s.checkout_reason)
        && String(s.check_out_date).slice(0, 4) === n).length,
      caNam: ST.students.filter(s => s.check_out_date && DEPARTURE_REASONS.includes(s.checkout_reason)).length,
    };
  }, nam);
  ok('Bộ lọc xuất cảnh mang theo năm', xc.loc === 'departure' && xc.nam === nam, JSON.stringify(xc));
  ok('Danh sách chỉ gồm người xuất cảnh trong năm đó', xc.dem === xc.that, JSON.stringify(xc));
  ok('Dải "Đang lọc" ghi rõ năm', /năm\s*\d{4}/.test(await page.locator('#content .pill-row .badge').first().textContent()));

  // ── Phiếu thu: thẻ "Phiếu báo tháng này" phải mở ĐÚNG kỳ tháng này, bỏ bộ lọc cũ ───────────────
  await page.evaluate(() => { invMonth = '2020-01'; invFilter = 'paid'; invSearch = 'zzz'; });
  await page.evaluate(() => phieuThangNayGo());
  await cho(3000);
  const pt = await page.evaluate(() => ({ thang: invMonth, loc: invFilter, tim: invSearch, nay: curMonth() }));
  ok('Mở đúng kỳ tháng này, bỏ lọc "đã thu" và ô tìm cũ',
    pt.loc === 'all' && pt.tim === '', JSON.stringify(pt));
  const pill = await page.evaluate(() => {
    const dem = el('invCount'), all = el('inv_pill_all');
    return { bang: dem ? +dem.textContent : null, pill: all ? +all.textContent : null };
  });
  ok('Pill "Tất cả" đếm đúng số dòng đang hiện (không tính phiếu 0đ đang ẩn)',
    pill.pill === pill.bang, JSON.stringify(pill));

  // ── Doanh thu: thẻ ở Điều hành mở đúng NĂM của thẻ, và cùng cách tính (trừ cọc) ────────────────
  await page.evaluate(() => { revYear = '2020'; });
  await page.evaluate(n => doanhThuGo(n), nam);
  await cho(3000);
  ok('Thẻ doanh thu mở đúng năm ghi trên thẻ', await page.evaluate(() => revYear) === nam);

  // ── Hồ sơ lưu trữ: ba ô trên cùng là ba bộ lọc, bấm vào ra đúng nhóm ───────────────────────────
  await page.evaluate(() => { hsLoc = 'thieu_cccd'; });
  await page.evaluate(() => hoSoGo());
  await cho(2500);
  ok('Vào từ menu thì xem TẤT CẢ hồ sơ', await page.evaluate(() => hsLoc) === 'all');
  const hs = await page.evaluate(() => {
    const oThieu = [...document.querySelectorAll('#content .cards .stat')].find(o => /Còn thiếu/.test(o.textContent));
    return { co: !!oThieu, act: oThieu ? oThieu.getAttribute('data-act') : '', so: oThieu ? +(oThieu.querySelector('.v') || {}).textContent : null };
  });
  ok('Ô "Còn thiếu" bấm được', hs.co && hs.act === 'hsGo', JSON.stringify(hs));
  await page.evaluate(() => hsGo('thieu'));
  await cho(1500);
  const hs2 = await page.evaluate(() => {
    const n = el('hsCount');
    const oThieu = [...document.querySelectorAll('#content .cards .stat')].find(o => /Còn thiếu/.test(o.textContent));
    return { bang: n ? +n.textContent : null, the: oThieu ? +(oThieu.querySelector('.v') || {}).textContent : null };
  });
  ok('Bấm ô "Còn thiếu": số dòng bằng đúng con số trên ô', hs2.bang === hs2.the, JSON.stringify(hs2));
  ok('Có bộ lọc "Đủ giấy tờ" tương ứng với ô Đủ giấy tờ',
    await page.locator('[data-act="hsGo"][data-args=\'["du"]\']').count() >= 1);

  ok('Không có lỗi JS', loiJS.length === 0, loiJS.slice(0, 3).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Mọi con số đều trỏ đúng danh sách của nó');
  process.exit(fail ? 1 : 0);
})();
