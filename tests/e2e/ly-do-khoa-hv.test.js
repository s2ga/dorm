// Khoá hồ sơ học viên phải kèm LÝ DO. Bỏ trống thì máy chủ tự điền lý do mặc định —
// cột lý do rỗng thì khoá xong không ai truy được vì sao.
const P = '__test_lydo';
const MAC_DINH = 'Ngừng dịch vụ thuê phòng';

async function clean(db) {
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'`);
}

module.exports = {
  name: 'Khoá hồ sơ học viên — lý do khoá',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const moi = async ma => {
      const r = await t.api('POST', '/api/students', T, {
        name: P + ' ' + ma, code: P + ma, gender: 'male', check_in_date: '2026-03-08', rental_type: 'ghep',
      });
      t.eq('Dựng hồ sơ thử ' + ma, r.status, 201, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
      return r.json.id;
    };
    const lyDo = async id => (await t.db.query('SELECT lock_reason, deleted_at FROM students WHERE id=$1', [id])).rows[0];

    // ── Bỏ trống -> lý do mặc định ─────────────────────────────────────────────────────
    const a = await moi('A');
    const ra = await t.api('DELETE', `/api/students/${a}`, T, {});
    t.eq('Khoá không kèm lý do → 200', ra.status, 200, `HTTP ${ra.status}`);
    const da = await lyDo(a);
    t.eq('Bỏ trống → máy chủ điền lý do mặc định', da.lock_reason, MAC_DINH);
    t.ok('Hồ sơ đã bị khoá', !!da.deleted_at, String(da.deleted_at));
    t.eq('Phản hồi trả lại đúng lý do đã ghi', ra.json && ra.json.lock_reason, MAC_DINH);

    // ── Chỉ khoảng trắng cũng coi như bỏ trống ─────────────────────────────────────────
    const b = await moi('B');
    await t.api('DELETE', `/api/students/${b}`, T, { reason: '    ' });
    t.eq('Lý do toàn khoảng trắng → vẫn là lý do mặc định', (await lyDo(b)).lock_reason, MAC_DINH);

    // ── Có lý do thì giữ nguyên, kể cả dấu tiếng Việt ──────────────────────────────────
    const c = await moi('C');
    await t.api('DELETE', `/api/students/${c}`, T, { reason: '  Vi phạm nội quy nhiều lần  ' });
    t.eq('Giữ nguyên lý do đã nhập, cắt khoảng trắng thừa', (await lyDo(c)).lock_reason, 'Vi phạm nội quy nhiều lần');

    // ── Danh sách đã khoá phải trả kèm lý do ───────────────────────────────────────────
    const ds = await t.api('GET', '/api/students?deleted=1', T);
    const dong = (ds.json.rows || ds.json || []).find(x => x.id === c);
    t.ok('Danh sách "đã khoá" trả kèm lock_reason để hiện lên bảng', dong && dong.lock_reason === 'Vi phạm nội quy nhiều lần',
      JSON.stringify(dong && dong.lock_reason));

    // ── Mở khoá thì lý do hết hiệu lực ────────────────────────────────────────────────
    const mo = await t.api('POST', `/api/students/${c}/restore`, T);
    t.eq('Mở khoá → 200', mo.status, 200, `HTTP ${mo.status}`);
    const sau = await lyDo(c);
    t.eq('Mở khoá xoá luôn lý do, không để lẫn vào hồ sơ đang hoạt động', sau.lock_reason, '');
    t.eq('Mở khoá bỏ cờ đã khoá', sau.deleted_at, null);

    // ── Khoá lại lần nữa ghi lý do MỚI, không giữ lý do cũ ────────────────────────────
    await t.api('DELETE', `/api/students/${c}`, T, { reason: 'Hết hợp đồng' });
    t.eq('Khoá lại ghi đè bằng lý do mới', (await lyDo(c)).lock_reason, 'Hết hợp đồng');
  },
};
