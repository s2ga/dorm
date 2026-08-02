// Duyệt đơn trả phòng KHÔNG có nghĩa là học viên đã dọn đi — ngày trả thường ở tương lai.
// Danh sách phải trả kèm ngày trả THẬT trên hồ sơ để màn quản trị phân biệt
// "Đã xác nhận" (chưa tới ngày) với "Đã trả phòng" (đã qua ngày).
const P = '__test_cout';

async function clean(db) {
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

const congNgay = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

module.exports = {
  name: 'Đơn trả phòng — trạng thái sau khi duyệt',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const R = (await t.db.query(
      `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee,room_type)
       VALUES ($1,$2,4,'male','B',1200000,'shared') RETURNING id`, [P + '_R', fac])).rows[0].id;

    const dựng = async (ma, ngayTra) => {
      const s = await t.api('POST', '/api/students', T, {
        name: P + ' ' + ma, code: P + ma, gender: 'male', room_id: R,
        check_in_date: '2026-03-01', rental_type: 'ghep', confirm_overload: true,
      });
      t.eq('Dựng hồ sơ ' + ma, s.status, 201, `HTTP ${s.status} ${s.json && s.json.error || ''}`);
      const cr = (await t.db.query(
        `INSERT INTO checkout_requests (student_id, desired_date, reason) VALUES ($1,$2,'departure') RETURNING id`,
        [s.json.id, ngayTra])).rows[0].id;
      return { sid: s.json.id, crid: cr };
    };
    const tim = async crid => {
      const r = await t.api('GET', '/api/requests/checkout', T);
      t.eq('Đọc danh sách đơn trả phòng', r.status, 200, `HTTP ${r.status}`);
      return (r.json.rows || r.json || []).find(x => x.id === crid);
    };

    // ── Duyệt với ngày trả TƯƠNG LAI ────────────────────────────────────────────────────
    const mai = congNgay(14);
    const A = await dựng('A', mai);
    const dA = await t.api('POST', `/api/requests/checkout/${A.crid}/confirm`, T, { date: mai });
    t.eq('Duyệt đơn ngày tương lai → 200', dA.status, 200, `HTTP ${dA.status} ${dA.json && dA.json.error || ''}`);
    const rA = await tim(A.crid);
    t.eq('Đơn chuyển sang done', rA && rA.status, 'done');
    t.eq('Danh sách trả kèm ngày trả THẬT trên hồ sơ', String(rA.student_check_out || '').slice(0, 10), mai,
      `nhận ${JSON.stringify(rA && rA.student_check_out)}`);
    t.ok('Ngày trả còn ở tương lai → màn quản trị phải gọi là "Đã xác nhận", không phải "Đã trả phòng"',
      String(rA.student_check_out).slice(0, 10) > new Date().toISOString().slice(0, 10),
      `ngày trả ${String(rA.student_check_out).slice(0, 10)}`);
    t.eq('Học viên vẫn ĐANG Ở cho tới ngày trả', rA.student_status, 'in',
      `student_status = ${rA.student_status}`);

    // ── Duyệt với ngày trả ĐÃ QUA ──────────────────────────────────────────────────────
    const hom_qua = congNgay(-3);
    const B = await dựng('B', hom_qua);
    const dB = await t.api('POST', `/api/requests/checkout/${B.crid}/confirm`, T, { date: hom_qua });
    t.eq('Duyệt đơn ngày đã qua → 200', dB.status, 200, `HTTP ${dB.status} ${dB.json && dB.json.error || ''}`);
    const rB = await tim(B.crid);
    t.eq('Ngày trả đã qua → hồ sơ chuyển sang đã trả phòng', rB.student_status, 'out');
    t.eq('Ngày trả ghi đúng', String(rB.student_check_out || '').slice(0, 10), hom_qua);
  },
};
