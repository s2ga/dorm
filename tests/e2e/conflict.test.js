// Hai người sửa CÙNG một hồ sơ (UX-40).
// Trước 16/07/2026: người lưu sau ĐÈ MẤT thay đổi của người trước, không một lời cảnh báo.
// Chặn bằng cột hệ thống `xmin` của PostgreSQL — tự đổi mỗi lần dòng bị sửa, không cần thêm cột.
const P = '__test_xd';

const clean = async db => {
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Hai người sửa cùng lúc — chặn đè mất dữ liệu',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    try {
      // Phòng RỘNG RÃI: dùng phòng đầy thì mọi lần lưu vướng cảnh báo quá tải, không chạm tới
      // được phần cần kiểm (chính chỗ này làm hỏng lần chạy đầu).
      const room = (await t.db.query(
        `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,8,'female','B',1200000) RETURNING id`,
        [P + '_R', fac])).rows[0].id;
      const id = (await t.db.query(
        `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,note)
         VALUES ($1,'Hai Tab Test','female',$2,'2026-07-01','in','ghep','unregistered','GỐC') RETURNING id`,
        [P + '_1', room])).rows[0].id;

      const ho = { name: 'Hai Tab Test', gender: 'female', code: P + '_1' };

      // Hai "tab" cùng mở hồ sơ -> cùng một phiên bản
      const A = (await t.api('GET', `/api/students/${id}`, T)).json;
      const B = (await t.api('GET', `/api/students/${id}`, T)).json;
      t.ok('Mở hồ sơ → có số hiệu phiên bản để so lúc lưu', !!A._v, `_v = ${A._v}`);
      t.eq('Hai tab mở cùng lúc → cùng một phiên bản', A._v, B._v);

      // Tab A lưu trước
      const r1 = await t.api('PUT', `/api/students/${id}`, T, { ...ho, note: 'TAB A sửa', _v: A._v });
      t.eq('Tab A lưu (đúng phiên bản) → cho qua', r1.status, 200, `HTTP ${r1.status} ${r1.json && r1.json.error || ''}`);
      t.eq('Ghi chú của A vào được CSDL',
        (await t.db.query('SELECT note FROM students WHERE id=$1', [id])).rows[0].note, 'TAB A sửa');

      // Tab B lưu sau, cầm phiên bản CŨ -> phải chặn
      const r2 = await t.api('PUT', `/api/students/${id}`, T, { ...ho, note: 'TAB B đè lên', _v: B._v });
      t.ok('Tab B lưu bằng phiên bản CŨ → phải CHẶN', r2.status === 409 && r2.json && r2.json.conflict === true,
        `HTTP ${r2.status} — ${(r2.json && r2.json.error || '').split('\n')[0]}`);
      t.ok('Lời chặn nói rõ "người khác vừa sửa", không phải lỗi kỹ thuật',
        /người khác sửa/i.test(r2.json && r2.json.error || ''), (r2.json && r2.json.error || '').split('\n')[0]);
      t.eq('Thay đổi của A KHÔNG bị đè mất',
        (await t.db.query('SELECT note FROM students WHERE id=$1', [id])).rows[0].note, 'TAB A sửa');

      // Đọc lại rồi lưu -> phải được
      const B2 = (await t.api('GET', `/api/students/${id}`, T)).json;
      t.ok('Phiên bản đổi sau khi A lưu', B2._v !== B._v, `${B._v} → ${B2._v}`);
      const r3 = await t.api('PUT', `/api/students/${id}`, T, { ...ho, note: 'TAB B sau khi đọc lại', _v: B2._v });
      t.eq('Đọc lại bản mới rồi lưu → cho qua', r3.status, 200, `HTTP ${r3.status}`);

      // ---- KHÔNG được chặn nhầm ----
      const r4 = await t.api('PUT', `/api/students/${id}`, T, { ...ho, note: 'không gửi _v' });
      t.eq('Không gửi số hiệu phiên bản → vẫn lưu bình thường (không chặn nhầm đường gọi cũ)', r4.status, 200, `HTTP ${r4.status}`);

      const r5 = await t.api('PUT', '/api/students/999999', T, { name: 'x', gender: 'female', _v: '123' });
      t.eq('Hồ sơ KHÔNG tồn tại → 404, không nhầm thành "người khác vừa sửa"', r5.status, 404, `HTTP ${r5.status} — ${r5.json && r5.json.error}`);
    } finally {
      await clean(t.db);
    }
  },
};
