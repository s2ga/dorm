// Sửa NGÀY TRẢ PHÒNG ở form hồ sơ — học viên báo trả ngày này rồi đổi sang ngày khác.
// Chỉ đặt/đổi được ngày TƯƠNG LAI: ngày đã qua thì phiếu tháng đó đã phát và công-tơ đã chốt.
// Kèm canh lỗi nhân bản lượt ở: sửa hồ sơ người ĐÃ trả phòng từng đẻ thêm một dòng room_stays mỗi
// lần lưu — roster() cộng dồn ngày của cùng một người nên tiền điện cả phòng chia sai mà tổng vẫn khớp.
const P = '__test_ntp';

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const clean = async db => {
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Ngày trả phòng — chỉ sửa được ngày tương lai, lượt ở đồng bộ theo',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    try {
      const room = (await t.db.query(
        `INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,8,'female','B',1200000) RETURNING id`,
        [P + '_R', fac])).rows[0].id;

      const themHV = async (ma, ten) => {
        const id = (await t.db.query(
          `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status)
           VALUES ($1,$2,'female',$3,'2026-05-01','in','ghep','unregistered') RETURNING id`,
          [ma, ten, room])).rows[0].id;
        await t.db.query('INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,$3,NULL)', [id, room, '2026-05-01']);
        return id;
      };
      const luu = async (id, patch) => {
        const cur = (await t.api('GET', `/api/students/${id}`, T)).json;
        return t.api('PUT', `/api/students/${id}`, T, { ...cur, _v: cur._v, ...patch });
      };
      const luot = async id => (await t.db.query('SELECT to_date FROM room_stays WHERE student_id=$1 ORDER BY id', [id])).rows;
      const hoSo = async id => (await t.db.query('SELECT status, check_out_date FROM students WHERE id=$1', [id])).rows[0];

      const id = await themHV(P + '_1', 'Bạn Báo Trả');

      // --- Đặt ngày trả ở tương lai ---
      const r1 = await luu(id, { check_out_date: iso(30) });
      t.eq('Đặt ngày trả trong tương lai → lưu được', r1.status, 200);
      const s1 = await hoSo(id);
      t.eq('Hồ sơ ghi đúng ngày', String(s1.check_out_date).slice(0, 10), iso(30));
      t.eq('Chưa tới ngày → vẫn là "đang ở" (sắp trả), không phải đã trả', s1.status, 'in');
      const l1 = await luot(id);
      t.eq('Vẫn đúng MỘT lượt ở', l1.length, 1);
      t.eq('Lượt ở đóng đúng ngày trả — tiền điện chia khớp với tiền phòng',
        String(l1[0].to_date).slice(0, 10), iso(30));

      // --- Đổi sang ngày tương lai khác ---
      t.eq('Đổi sang ngày tương lai khác → lưu được', (await luu(id, { check_out_date: iso(60) })).status, 200);
      const l2 = await luot(id);
      t.eq('Đổi ngày KHÔNG đẻ thêm lượt ở', l2.length, 1);
      t.eq('Lượt ở dời theo ngày mới', String(l2[0].to_date).slice(0, 10), iso(60));

      // --- Ngày đã qua / hôm nay: chặn ---
      t.eq('Ngày trả trong quá khứ → chặn', (await luu(id, { check_out_date: iso(-5) })).status, 400);
      t.eq('Ngày trả là hôm nay → chặn (phải dùng nút Check-out)', (await luu(id, { check_out_date: iso(0) })).status, 400);

      // --- Xoá ngày = huỷ báo trả ---
      t.eq('Xoá ngày trả → lưu được', (await luu(id, { check_out_date: null })).status, 200);
      t.ok('Huỷ báo trả → hồ sơ hết ngày trả', !(await hoSo(id)).check_out_date);
      const l3 = await luot(id);
      t.eq('Huỷ báo trả → lượt ở mở lại (to_date rỗng)', l3.length === 1 && l3[0].to_date, null);

      // --- Người ĐÃ trả phòng ---
      const id2 = await themHV(P + '_2', 'Bạn Đã Đi');
      const co = await t.api('POST', `/api/students/${id2}/checkout`, T, { date: iso(-3), reason: 'other' });
      t.eq('Dựng người đã trả phòng', co.status, 200);

      const rCam = await luu(id2, { check_out_date: iso(30) });
      t.eq('Đổi ngày trả của người ĐÃ đi → chặn', rCam.status, 400);
      t.ok('Báo lỗi nói rõ lý do', /đã trả phòng/i.test((rCam.json && rCam.json.error) || ''),
        (rCam.json && rCam.json.error) || '');

      // Hồi quy: sửa field khác của người đã đi vẫn phải chạy, và KHÔNG được nhân bản lượt ở
      for (let i = 0; i < 3; i++) {
        t.eq(`Sửa SĐT người đã đi (lần ${i + 1}) → vẫn lưu được`, (await luu(id2, { phone: '091122334' + i })).status, 200);
      }
      const l4 = await luot(id2);
      t.eq('Sửa hồ sơ 3 lần KHÔNG đẻ thêm lượt ở (nhân bản = chia điện sai)', l4.length, 1);
      t.eq('Lượt ở giữ nguyên ngày trả thật', String(l4[0].to_date).slice(0, 10), iso(-3));
    } finally {
      await clean(t.db);
    }
  },
};
