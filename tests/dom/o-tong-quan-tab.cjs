// 4 ô đầu Tổng quan chỉ còn con số + tên ô; bấm vào ra hộp có tab E2 / S2 / Nhân viên / An ninh.
// Số trên ô = tổng các tab = số dòng của từng tab, khớp phép đếm độc lập từ ST; màn điện thoại không tràn ngang.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };
const O = [['dang_o', 'Học viên đang ở'], ['giuong', 'Giường trống'], ['sap_tra', 'Sắp trả phòng'], ['sap_vao', 'Sắp vào']];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));

  await page.goto('/tong-quan');
  await page.waitForTimeout(3200);

  // Đếm độc lập: chia theo LOẠI PHÒNG đọc thẳng từ ST.rooms, không gọi kpiNhom.
  const mong = await page.evaluate(() => {
    const phong = new Map(ST.rooms.map(r => [r.id, r]));
    const loaiPhong = s => { const r = phong.get(s.room_id); return r && ['security', 'staff'].includes(r.room_type) ? r.room_type : 'thue'; };
    const nhom = s => { const k = loaiPhong(s); return k === 'security' ? 'An ninh' : k === 'staff' ? 'Nhân viên' : legalEntity(s.gender === 'female' ? 'female' : 'male'); };
    const d = v => (v ? String(v).slice(0, 10) : ''), t = today();
    const dangO = s => d(s.check_in_date) && !d(s.check_out_date);
    const dem = loc => { const m = {}; ST.students.filter(s => !s.deleted_at && loc(s)).forEach(s => { m[nhom(s)] = (m[nhom(s)] || 0) + 1; }); return m; };
    const giuong = {};
    ST.rooms.filter(r => !['security', 'staff'].includes(r.room_type)).forEach(r => {
      const con = Math.max(0, Math.max(0, (+r.capacity || 0) - (+r.occupancy || 0)) - (+r.upcoming || 0));
      const k = legalEntity(r.gender === 'female' ? 'female' : 'male');
      giuong[k] = (giuong[k] || 0) + con;
    });
    return {
      dang_o: dem(dangO),
      sap_tra: dem(s => dangO(s) && !!d(s.planned_check_out)),
      sap_vao: dem(s => !d(s.check_in_date) && !d(s.check_out_date) && !!d(s.planned_check_in)),
      giuong, homNay: t,
    };
  });

  for (const [loai, nhan] of O) {
    console.log(`\n-- ${nhan}`);
    const o = page.locator('.kpi.clickable', { has: page.locator('.l', { hasText: nhan }) }).first();
    ok('Có ô', await o.count() > 0);
    if (!await o.count()) continue;
    const chuNhan = ((await o.locator('.l').textContent()) || '').trim();
    ok('Ô chỉ còn tên, không còn dòng chữ phụ', chuNhan === nhan, chuNhan);
    const so = +(((await o.locator('.v').textContent()) || '').match(/\d+/) || [NaN])[0];
    ok('Ô có con số', Number.isFinite(so), String(so));

    await o.click();
    await page.waitForTimeout(400);
    const tieuDe = (await page.locator('#modal .mh h3').textContent()) || '';
    ok('Bấm vào mở hộp đúng tên, kèm tổng', tieuDe.includes(nhan) && tieuDe.includes(`(${so})`), tieuDe);

    const tabs = page.locator('#modal .seg-thu .seg');
    const nhanTab = (await tabs.allTextContents()).map(x => x.trim());
    const soTab = Object.fromEntries(nhanTab.map(x => { const m = x.match(/^(.*):\s*(\d+)$/); return m ? [m[1], +m[2]] : [x, NaN]; }));
    const tenTab = Object.keys(soTab);
    const legal = await page.evaluate(() => [legalEntity('female'), legalEntity('male')]);
    ok('Tab đúng thứ tự: E2, S2' + (loai === 'giuong' ? '' : ', Nhân viên, An ninh'),
      JSON.stringify(tenTab) === JSON.stringify(loai === 'giuong' ? legal : [...legal, 'Nhân viên', 'An ninh']), nhanTab.join(' | '));
    const tong = Object.values(soTab).reduce((a, n) => a + n, 0);
    ok('Số trên ô = tổng các tab', tong === so, `ô=${so} · tab=${tong}`);
    const sai = tenTab.filter(k => (mong[loai][k] || 0) !== soTab[k]);
    ok('Từng tab khớp phép đếm độc lập', sai.length === 0,
      sai.map(k => `${k}: app=${soTab[k]} · đếm=${mong[loai][k] || 0}`).join(', '));

    for (let i = 0; i < tenTab.length; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(150);
      const dangChon = await page.locator('#modal .seg-thu .seg.on').textContent();
      const n = soTab[tenTab[i]];
      if (loai === 'giuong') {
        const cot = (await page.locator('#modal td[data-label="Giường trống"]').allTextContents()).reduce((a, x) => a + (+x || 0), 0);
        ok(`Tab ${tenTab[i]}: cộng cột "Giường trống" bằng số trên tab`, cot === n, `cột=${cot} · tab=${n}`);
      } else {
        const hang = await page.locator('#modal tbody tr').count();
        ok(`Tab ${tenTab[i]}: số dòng bằng số trên tab`, hang === n && (dangChon || '').startsWith(tenTab[i]), `dòng=${hang} · tab=${n}`);
        if (!n) ok(`Tab ${tenTab[i]} rỗng: có câu báo`, await page.locator('#modal .empty').count() > 0);
      }
    }
    await page.locator('#modal .mf .btn', { hasText: 'Đóng' }).click();
    await page.waitForTimeout(300);
    ok('Nút Đóng đóng hộp', !(await page.locator('#overlay').getAttribute('class') || '').includes('show'));
  }

  console.log('\n-- Màn điện thoại 390px');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tong-quan');
  await page.waitForTimeout(2600);
  await page.locator('.kpi.clickable', { has: page.locator('.l', { hasText: 'Học viên đang ở' }) }).first().click();
  await page.waitForTimeout(400);
  const tran = await page.evaluate(() => {
    const g = document.querySelector('#modal .seg-thu');
    return { tab: g ? g.scrollWidth - g.clientWidth : -1, trang: document.documentElement.scrollWidth - window.innerWidth };
  });
  ok('Đủ 4 tab hiện trọn, không phải cuộn ngang', tran.tab >= 0 && tran.tab <= 1, `dư ${tran.tab}px`);
  ok('Trang không tràn ngang', tran.trang <= 0, `dư ${tran.trang}px`);

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> 4 ô Tổng quan tách tab đúng');
  process.exit(fail ? 1 : 0);
})();
