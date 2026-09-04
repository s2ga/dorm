// TUYẾN PHÒNG THỦ: chặn tạo TRÙNG hồ sơ + ràng buộc ở CSDL.
//
// Vì sao có bộ này: tháng 07/2026 có 5 học viên bị THU DƯ 5.709.087đ, vì nhân viên tạo hồ sơ MỚI
// khi họ chuyển phòng (app cũ không giữ được lịch sử phòng nên đó là cách duy nhất "giữ" phòng cũ)
// -> mỗi người 2 hồ sơ -> 2 phiếu.
const P = '__test_dup';

async function clean(db) {
  await db.query(`DELETE FROM invoices   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%')`);
  await db.query(`DELETE FROM vehicles   WHERE plate LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%' OR name LIKE '${P}%' OR id_card LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Tuyến phòng thủ — chặn trùng hồ sơ & ràng buộc CSDL',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    try {
      const R1 = (await t.db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'female','B',1200000) RETURNING id`, [P + '_R1', fac])).rows[0].id;
      const R2 = (await t.db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'female','B',1200000) RETURNING id`, [P + '_R2', fac])).rows[0].id;

      const base = { name: P + ' An', gender: 'female', code: P + '_MA1', id_card: P + '_CCCD1', room_id: R1, check_in_date: '2026-07-01', rental_type: 'ghep' };
      const a = await t.api('POST', '/api/students', T, base);
      t.eq('Tạo học viên mới → OK', a.status, 201, `HTTP ${a.status} ${a.json && a.json.error || ''}`);
      const id1 = a.json.id;

      // ===== ĐÂY LÀ KỊCH BẢN GÂY THU DƯ: chuyển phòng bằng cách tạo hồ sơ mới
      const dup = await t.api('POST', '/api/students', T, { ...base, room_id: R2 });
      t.ok('Tạo lại cùng MÃ HV (kịch bản "chuyển phòng bằng hồ sơ mới") → phải CHẶN',
        dup.status === 409, `HTTP ${dup.status} — ${dup.json && dup.json.error}`);
      t.ok('Lời chặn phải CHỈ ĐƯỜNG sang "Chuyển phòng", không chỉ báo lỗi cụt ngủn',
        /Chuyển phòng/i.test(dup.json && dup.json.error || ''), (dup.json && dup.json.error || '').slice(-100));
      t.ok('Trả kèm hồ sơ CŨ để giao diện mở thẳng được', !!(dup.json && dup.json.existing && dup.json.existing.id === id1),
        JSON.stringify(dup.json && dup.json.existing));

      const n1 = (await t.db.query(`SELECT COUNT(*)::int c FROM students WHERE code=$1 AND deleted_at IS NULL`, [P + '_MA1'])).rows[0].c;
      t.eq('Sau khi chặn · vẫn CHỈ 1 hồ sơ (không đẻ hồ sơ thứ hai)', n1, 1);

      // ===== Trùng CCCD nhưng mã khác -> vẫn chặn (2 người không thể chung 1 CCCD)
      const dup2 = await t.api('POST', '/api/students', T, { ...base, code: P + '_MA_KHAC' });
      t.ok('Khác mã HV nhưng TRÙNG CCCD → phải CHẶN', dup2.status === 409, `HTTP ${dup2.status} — ${dup2.json && dup2.json.error}`);

      // ===== Chặn cả đường SỬA (tạo mã A rồi sửa thành mã B là lách được tuyến trên)
      const b = await t.api('POST', '/api/students', T, { ...base, name: P + ' Binh', code: P + '_MA2', id_card: P + '_CCCD2' });
      t.eq('Tạo người thứ hai (mã + CCCD khác) → OK', b.status, 201, `HTTP ${b.status} ${b.json && b.json.error || ''}`);
      const id2 = b.json.id;
      const edit = await t.api('PUT', `/api/students/${id2}`, T, { name: P + ' Binh', gender: 'female', code: P + '_MA1' });
      t.ok('SỬA hồ sơ sang mã HV của người khác → phải CHẶN', edit.status === 409, `HTTP ${edit.status} — ${edit.json && edit.json.error}`);

      // ===== KHÔNG được chặn nhầm người ngay tình
      const ok1 = await t.api('PUT', `/api/students/${id2}`, T, { name: P + ' Binh sua ten', gender: 'female', code: P + '_MA2', id_card: P + '_CCCD2' });
      t.eq('Sửa hồ sơ mà GIỮ NGUYÊN mã của chính mình → phải cho qua', ok1.status, 200, `HTTP ${ok1.status} — ${ok1.json && ok1.json.error || ''}`);
      const ok2 = await t.api('POST', '/api/students', T, { name: P + ' Cuc', gender: 'female', check_in_date: '2026-07-01', rental_type: 'ghep' });
      t.eq('Tạo học viên KHÔNG có mã, KHÔNG có CCCD → phải cho qua (ô trống không tính là trùng)', ok2.status, 201, `HTTP ${ok2.status} — ${ok2.json && ok2.json.error || ''}`);
      const ok3 = await t.api('POST', '/api/students', T, { name: P + ' Dung', gender: 'female', check_in_date: '2026-07-01', rental_type: 'ghep' });
      t.eq('Tạo người thứ hai cũng không mã → vẫn cho qua (không đụng nhau)', ok3.status, 201, `HTTP ${ok3.status}`);

      // ===== Hồ sơ đã XOÁ thì mã được dùng lại
      await t.api('DELETE', `/api/students/${id1}`, T);
      const reuse = await t.api('POST', '/api/students', T, { ...base, name: P + ' Nguoi khac' });
      t.eq('Hồ sơ cũ đã xoá → mã HV được dùng lại', reuse.status, 201, `HTTP ${reuse.status} — ${reuse.json && reuse.json.error || ''}`);

      // ===== RÀNG BUỘC Ở CSDL — tuyến cuối, gọi thẳng SQL cũng không lách được
      console.log('     \x1b[2m(dưới đây ghi thẳng vào CSDL, bỏ qua toàn bộ kiểm tra của app)\x1b[0m');
      const chan = async (ten, sql, params) => {
        let ok = false, msg = '';
        try { await t.db.query(sql, params); } catch (e) { ok = true; msg = String(e.message).split('\n')[0]; }
        t.ok(ten, ok, ok ? 'CSDL chặn: ' + msg.slice(0, 78) : '>>> LỌT VÀO CSDL <<<');
      };
      const sid = ok2.json.id;
      await chan('Tiền phòng ÂM ghi thẳng vào CSDL → phải bị chặn',
        `INSERT INTO invoices (student_id, month, room_charge, total) VALUES ($1,'2026-07',-500000,0)`, [sid]);
      await chan('Tổng tiền ÂM → phải bị chặn',
        `INSERT INTO invoices (student_id, month, total) VALUES ($1,'2026-07',-1)`, [sid]);
      await chan('Kỳ "xyz" (sai định dạng) → phải bị chặn',
        `INSERT INTO invoices (student_id, month, total) VALUES ($1,'xyz',0)`, [sid]);
      await chan('Kỳ tháng 13 → phải bị chặn',
        `INSERT INTO invoices (student_id, month, total) VALUES ($1,'2026-13',0)`, [sid]);
      await chan('Sức chứa phòng ÂM → phải bị chặn',
        `INSERT INTO rooms (name, facility_id, capacity, gender) VALUES ($1,$2,-5,'female')`, [P + '_XAU', fac]);
      await chan('Sức chứa 999 người/phòng → phải bị chặn',
        `INSERT INTO rooms (name, facility_id, capacity, gender) VALUES ($1,$2,999,'female')`, [P + '_XAU2', fac]);
      await chan('Hai phòng CÙNG TÊN trong một cơ sở → phải bị chặn',
        `INSERT INTO rooms (name, facility_id, capacity, gender) VALUES ($1,$2,4,'female')`, [P + '_R1', fac]);
      await chan('Chỉ số điện cuối < đầu (công-tơ quay ngược) → phải bị chặn',
        `INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,'2026-09',500,100,0)`, [R1]);
      await chan('Tiền cọc ÂM → phải bị chặn',
        `UPDATE students SET deposit_amount=-1 WHERE id=$1`, [sid]);
      await chan('Nhiệm kỳ phòng trưởng kết thúc TRƯỚC khi bắt đầu → phải bị chặn',
        `INSERT INTO room_leaders (room_id, student_id, from_date, to_date) VALUES ($1,$2,'2026-07-20','2026-07-01')`, [R1, sid]);
      await chan('Hai xe cùng BIỂN SỐ → phải bị chặn', `INSERT INTO vehicles (student_id, plate) VALUES ($1,$2),($1,$2)`, [sid, P + '_51A1']);
      await chan('Hai tài khoản trùng tên chỉ khác hoa/thường → phải bị chặn',
        `INSERT INTO users (username, password_hash, role) VALUES ('${P}_U','x','staff'),('${P}_u','x','staff')`, []);
      await t.db.query(`DELETE FROM users WHERE lower(username) LIKE lower('${P}%')`);

      // Hai người CÙNG CCCD ghi thẳng vào CSDL
      await chan('Hai học viên cùng CCCD → phải bị chặn',
        `UPDATE students SET id_card=$2 WHERE id=$1`, [sid, P + '_CCCD2']);
    } finally {
      await clean(t.db);
    }
  },
};
