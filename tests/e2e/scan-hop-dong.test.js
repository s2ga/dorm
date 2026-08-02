// Đính kèm bản scan hợp đồng: nhận ẢNH hoặc PDF, lưu KHOÁ S3 (không phải data URL trong CSDL),
// và chỉ nhân viên hoặc chính chủ mới xem được.
const P = '__test_scanhd';

// PNG 1x1 và PDF tối thiểu — đủ chữ ký để qua kiểm magic bytes.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n').toString('base64');
const GIA_MAO = 'data:application/pdf;base64,' + Buffer.from('day khong phai PDF').toString('base64');

async function clean(db) {
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'`);
}

module.exports = {
  name: 'Đính kèm bản scan hợp đồng',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const sid = (await t.db.query(
      `INSERT INTO students (name, code, gender) VALUES ($1,$2,'male') RETURNING id`, [P + ' An', P + '_MA'])).rows[0].id;
    const cot = async () => (await t.db.query('SELECT contract_scan FROM students WHERE id=$1', [sid])).rows[0].contract_scan;

    // ── Chặn tệp không đúng chữ ký ────────────────────────────────────────────────────
    const gia = await t.api('POST', `/api/students/${sid}/contract-scan`, T, { data: GIA_MAO });
    t.ok('Tệp khai là PDF nhưng không đúng chữ ký → chặn', gia.status === 400 || gia.status === 501,
      `HTTP ${gia.status} ${gia.json && gia.json.error || ''}`);
    if (gia.status === 501) { t.ok('S3 chưa cấu hình — bỏ qua phần còn lại', true, '501'); return; }
    t.eq('Chặn rồi thì cột vẫn trống', await cot(), null);

    // ── Ảnh ──────────────────────────────────────────────────────────────────────────
    const anh = await t.api('POST', `/api/students/${sid}/contract-scan`, T, { data: PNG });
    t.eq('Đính kèm ảnh → 200', anh.status, 200, `HTTP ${anh.status} ${anh.json && anh.json.error || ''}`);
    const k1 = await cot();
    t.ok('CSDL lưu KHOÁ S3, không phải data URL', !!k1 && !String(k1).startsWith('data:'), String(k1));
    t.ok('Khoá đặt trong thư mục hopdong/', String(k1).startsWith('hopdong/'), String(k1));

    // Hồ sơ trả về ĐƯỜNG XEM có kiểm quyền, kèm đuôi tệp để giao diện biết ảnh hay PDF.
    const hs = await t.api('GET', `/api/students/${sid}`, T);
    t.eq('Hồ sơ trả đường proxy', hs.json.contract_scan, `/api/students/${sid}/contract-scan`);
    t.eq('Kèm đuôi tệp', hs.json.contract_scan_ext, 'png');

    // ── Đổi sang PDF: khoá đổi đuôi, tệp cũ được dọn ─────────────────────────────────
    const pdf = await t.api('POST', `/api/students/${sid}/contract-scan`, T, { data: PDF });
    t.eq('Đính kèm PDF → 200', pdf.status, 200, `HTTP ${pdf.status} ${pdf.json && pdf.json.error || ''}`);
    const k2 = await cot();
    t.ok('Khoá đổi sang .pdf', String(k2).endsWith('.pdf'), String(k2));
    const hs2 = await t.api('GET', `/api/students/${sid}`, T);
    t.eq('Đuôi tệp cập nhật theo', hs2.json.contract_scan_ext, 'pdf');

    // ── Xem được ─────────────────────────────────────────────────────────────────────
    const xem = await t.api('GET', `/api/students/${sid}/contract-scan`, T);
    t.eq('Nhân viên xem được bản scan', xem.status, 200, `HTTP ${xem.status}`);

    // ── Gỡ ───────────────────────────────────────────────────────────────────────────
    const go = await t.api('DELETE', `/api/students/${sid}/contract-scan`, T);
    t.eq('Gỡ → 200', go.status, 200, `HTTP ${go.status}`);
    t.eq('Cột về trống', await cot(), null);
    const xem2 = await t.api('GET', `/api/students/${sid}/contract-scan`, T);
    t.eq('Gỡ rồi thì xem ra 404', xem2.status, 404, `HTTP ${xem2.status}`);
  },
};
