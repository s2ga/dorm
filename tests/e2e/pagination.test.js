// Phân trang TUỲ CHỌN cho /students, /violations, /logs.
// Điểm mấu chốt: KHÔNG gửi page/limit -> phải trả MẢNG như cũ (frontend hiện tại dựa vào mảng
// đầy đủ để tính dashboard/chuông). Có page/limit -> trả { rows, total, page, limit }.
// Đây là nền cho frontend đa cơ sở; test này khoá lại để đừng vô tình phá tương thích ngược.

module.exports = {
  name: 'Phân trang tuỳ chọn (tương thích ngược)',
  needsServer: true,

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);

    // ---- Tương thích ngược: không param -> MẢNG ----
    for (const path of ['/api/students', '/api/violations', '/api/logs?type=in']) {
      const r = await t.api('GET', path, T);
      t.ok(`${path} (không param) trả MẢNG như cũ`, Array.isArray(r.json),
        Array.isArray(r.json) ? `mảng ${r.json.length} phần tử` : `KHÔNG phải mảng: ${typeof r.json}`);
    }

    // ---- Phân trang: page/limit -> { rows, total, page, limit } ----
    const p = await t.api('GET', '/api/students?page=1&limit=10', T);
    const j = p.json || {};
    t.ok('/students?page=1&limit=10 trả object {rows,total,page,limit}',
      j && Array.isArray(j.rows) && typeof j.total === 'number' && j.page === 1 && j.limit === 10,
      `rows=${j.rows && j.rows.length} total=${j.total} page=${j.page} limit=${j.limit}`);
    t.ok('trang 1 không quá limit', Array.isArray(j.rows) && j.rows.length <= 10,
      `${j.rows && j.rows.length} dòng (≤10)`);

    // Trang 2 khác trang 1 (nếu đủ dữ liệu)
    if (j.total > 10) {
      const p2 = await t.api('GET', '/api/students?page=2&limit=10', T);
      const ids1 = (j.rows || []).map(r => r.id).join(',');
      const ids2 = (p2.json.rows || []).map(r => r.id).join(',');
      t.ok('trang 2 ra dòng khác trang 1', ids1 !== ids2 && (p2.json.rows || []).length > 0,
        `trang1 ${(j.rows || []).length} dòng · trang2 ${(p2.json.rows || []).length} dòng`);
    }

    // ---- Tìm kiếm server-side ----
    if (j.rows && j.rows[0]) {
      const kw = String(j.rows[0].name || '').split(' ').pop();
      if (kw && kw.length >= 2) {
        const s = await t.api('GET', `/api/students?limit=50&q=${encodeURIComponent(kw)}`, T);
        const all = (s.json.rows || []).every(r => new RegExp(kw, 'i').test(`${r.name} ${r.code} ${r.phone} ${r.room_name}`));
        t.ok(`tìm "${kw}" -> kết quả đều khớp`, s.json.total > 0 && all,
          `${s.json.total} kết quả, tất cả khớp: ${all}`);
      }
    }

    // ---- Lọc cơ sở ----
    const fac = (await t.db.query('SELECT id FROM facilities WHERE deleted_at IS NULL LIMIT 1')).rows[0];
    if (fac) {
      const f = await t.api('GET', `/api/students?limit=200&facility=${fac.id}`, T);
      const dung = (f.json.rows || []).length <= f.json.total;
      t.ok(`lọc theo cơ sở #${fac.id} chạy`, f.json && Array.isArray(f.json.rows) && dung,
        `${f.json && f.json.total} HV thuộc cơ sở này`);
    }
  },
};
