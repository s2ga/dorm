// BL-112: Cần xử lý phải có ô "Lập phiếu thu", bấm ra danh sách ĐÚNG NGƯỜI,
// và người đã trả phòng trong kỳ cũng phải nằm trong đó.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASS = process.env.TEST_ADMIN_PASS;
if (!PASS) { console.error('Thiếu TEST_ADMIN_PASS.'); process.exit(2); }

let fail = 0;
const ok = (t, d, x = '') => { if (d) console.log('  [OK] ' + t); else { fail++; console.log('  [FAIL] ' + t + (x ? ' -- ' + x : '')); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  await ctx.request.post('/api/auth/login', { data: { username: 'admin', password: PASS } });
  const page = await ctx.newPage();
  const loi = [];
  page.on('pageerror', e => loi.push(String(e)));

  await page.goto('/tong-quan');
  await page.waitForTimeout(3200);

  const o = page.locator('.todo-grid .todo', { hasText: 'Lập phiếu thu' });
  ok('Cần xử lý có ô "Lập phiếu thu"', await o.count() > 0);
  if (!await o.count()) { await ctx.close(); await browser.close(); process.exit(1); }

  const soTren = (await o.locator('.n').textContent() || '').trim();
  ok('Ô có con số', /^\d+$/.test(soTren), soTren);

  // So với phép tính độc lập dựng lại từ ST — bắt lỗi đếm sai mẫu số
  const mong = await page.evaluate(async () => {
    const inv = await API.invoices(curMonth());
    const daCo = new Set(inv.map(i => i.student_id));
    const ds = ST.students.filter(s => !s.deleted_at
      && (isOccupying(s) || (liveStatus(s) === 'left' && (s.check_out_date || '').slice(0, 7) === curMonth()))
      && !daCo.has(s.id) && stayDays(s) > overdueDays());
    return { n: ds.length, daRoi: ds.filter(s => liveStatus(s) === 'left').length };
  });
  ok('Con số khớp phép tính độc lập', +soTren === mong.n, `ô=${soTren} · tính lại=${mong.n}`);

  await o.click();
  await page.waitForTimeout(2200);

  const mh = await page.locator('#modal .mh h3').textContent();
  ok('Bấm vào ra modal "Chưa lập phiếu thu"', /Chưa lập phiếu thu/.test(mh || ''), mh);

  if (mong.n > 0) {
    const hang = await page.locator('#modal tbody tr').count();
    ok('Modal liệt kê đúng số người', hang === mong.n, `hàng=${hang} · mong=${mong.n}`);
    ok('Có cột "Đã ở" để biết quá hạn bao lâu',
      /Đã ở/.test(await page.locator('#modal thead').textContent() || ''));
    ok('Bấm tên mở được hồ sơ', await page.locator('#modal [data-act="studentDetail"]').count() > 0);
    ok('Có nút sang màn Tiền phòng', await page.locator('#modal [data-act="adminGo"]').count() > 0);
    if (mong.daRoi > 0) {
      ok('Người ĐÃ TRẢ PHÒNG trong kỳ cũng có mặt (ca dễ mất tiền nhất)',
        await page.locator('#modal .badge.red', { hasText: 'Đã trả' }).count() === mong.daRoi,
        'thấy ' + await page.locator('#modal .badge.red').count() + ' · mong ' + mong.daRoi);
    } else {
      console.log('  [BỎ QUA] CSDL này không có ai đã trả phòng mà thiếu phiếu');
    }
  } else {
    ok('Không sót ai → modal nói rõ chứ không để bảng trống',
      /Không sót ai/.test(await page.locator('#modal .mb').textContent() || ''));
  }

  ok('Không có lỗi JS', loi.length === 0, loi.slice(0, 2).join(' | '));
  await ctx.close(); await browser.close();
  console.log(fail ? `\n==> ${fail} lỗi` : '\n==> Ô nhắc lập phiếu thu chạy đúng');
  process.exit(fail ? 1 : 0);
})();
