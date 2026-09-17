// BL-123 — owner chốt 17/09/2026: có bản scan HĐ + số HĐ + ngày ký thì hợp đồng là "Đã hoàn tất".
// Máy chủ tự nâng contract_status = 'done' lúc tải scan và lúc lưu hồ sơ; thiếu một trong ba thì KHÔNG đụng.
const P = '__test_hdht';
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n').toString('base64');

async function clean(db) {
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
}

module.exports = {
  name: 'Hợp đồng đủ scan + số + ngày ký thì là Đã hoàn tất',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const mk = async (ma, soHD, ngayKy, tinhTrang) => (await t.db.query(
      `INSERT INTO students (code, name, gender, contract_no, contract_date, contract_status)
       VALUES ($1, $1, 'male', $2, $3, $4) RETURNING id`, [P + ma, soHD, ngayKy, tinhTrang])).rows[0].id;
    const tt = async id => (await t.db.query('SELECT contract_status FROM students WHERE id=$1', [id])).rows[0].contract_status;
    const scan = id => t.api('POST', `/api/students/${id}/contract-scan`, T, { data: PDF });

    // ── Đủ ba thứ khi tải scan -> Đã hoàn tất ─────────────────────────────────────────────
    const A = await mk('_A', '90/2026/HĐKTX-S2', '2026-09-01', 'unsigned');
    const rA = await scan(A);
    t.eq('Tải scan → 200', rA.status, 200, `HTTP ${rA.status} ${rA.json && rA.json.error || ''}`);
    t.ok('Response báo vừa nâng lên hoàn tất', rA.json && rA.json.hoan_tat === true, JSON.stringify(rA.json));
    t.eq('Có số + ngày ký, tải scan xong → Đã hoàn tất', await tt(A), 'done');

    // ── Trạng thái "Không ký HĐ" nhưng đủ ba thứ -> vẫn nâng ────────────────────────────────
    const B = await mk('_B', '91/2026/HĐKTX-S2', '2026-09-01', 'none');
    await scan(B);
    t.eq('"Không ký HĐ" mà đủ ba thứ → Đã hoàn tất', await tt(B), 'done');

    // ── Có scan trước, lưu hồ sơ điền đủ số + ngày -> nâng ngay trong response ─────────────
    const C = await mk('_C', '', null, 'unsigned');
    await scan(C);
    t.eq('Mới có scan, chưa số chưa ngày → giữ nguyên', await tt(C), 'unsigned');
    const rC = await t.api('PUT', `/api/students/${C}`, T, { contract_no: '92/2026/HĐKTX-S2', contract_date: '2026-09-02' });
    t.eq('Lưu hồ sơ → 200', rC.status, 200, `HTTP ${rC.status} ${rC.json && rC.json.error || ''}`);
    t.eq('Lưu đủ số + ngày khi đã có scan → response trả Đã hoàn tất', rC.json && rC.json.contract_status, 'done');
    t.eq('CSDL cũng là Đã hoàn tất', await tt(C), 'done');

    // ── Thiếu một trong ba thứ -> KHÔNG đụng ───────────────────────────────────────────────
    const D = await mk('_D', '', '2026-09-01', 'unsigned');
    await scan(D);
    t.eq('Có scan + ngày ký nhưng KHÔNG có số → giữ nguyên', await tt(D), 'unsigned');
    const E = await mk('_E', '93/2026/HĐKTX-S2', null, 'unsigned');
    await scan(E);
    t.eq('Có scan + số nhưng KHÔNG có ngày ký → giữ nguyên', await tt(E), 'unsigned');
    const F = await mk('_F', 'x', '2026-09-01', 'unsigned');
    await scan(F);
    t.eq('Số HĐ "x" (di sản) không tính là có số → giữ nguyên', await tt(F), 'unsigned');
    const G = await mk('_G', '94/2026/HĐKTX-S2', '2026-09-01', 'unsigned');
    await t.api('PUT', `/api/students/${G}`, T, { note: 'chỉ sửa ghi chú' });
    t.eq('Có số + ngày nhưng CHƯA có scan → giữ nguyên', await tt(G), 'unsigned');

    // ── Đã hoàn tất sẵn thì không báo nâng lần nữa ─────────────────────────────────────────
    const rA2 = await scan(A);
    t.ok('Tải lại scan cho hồ sơ đã hoàn tất → hoan_tat=false (không nâng lại)', rA2.json && rA2.json.hoan_tat === false, JSON.stringify(rA2.json));
  },
};
