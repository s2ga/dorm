// Trực nhật xoay vòng theo NGÀY (owner chốt 29/09). Luật: lần lượt từng người đang ở phòng, và
// KHÔNG AI trực hai ngày liên tiếp — kể cả khi có người trả phòng giữa chừng. Đúng ca hỏng của bản
// cũ: phòng 206 tuần 21/9 và tuần 28/9 đều rơi vào một bạn vì công thức chia lấy dư đổi theo sĩ số.
const P = '__test_trucngay';

const clean = async db => {
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Trực nhật xoay vòng theo ngày (không ai hai ngày liền)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const lichCuaPhong = async rid => {
      const r = await t.api('GET', '/api/rooms/chores', T);
      return ((r.json || []).find(x => x.room_id === rid) || {}).lich || [];
    };
    const trungLienTiep = lich => {
      for (let i = 1; i < lich.length; i++) if (lich[i].student_id === lich[i - 1].student_id) return lich[i];
      return null;
    };

    try {
      const fac = (await t.db.query('SELECT id FROM facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1')).rows[0];
      const rid = (await t.db.query(
        `INSERT INTO rooms (name, facility_id, capacity, gender, monthly_fee) VALUES ($1,$2,6,'female',1200000) RETURNING id`,
        [P + '_206', fac && fac.id])).rows[0].id;
      const ids = [];
      for (const [i, ten] of ['An', 'Bình', 'Chi', 'Dung'].entries()) {
        ids.push((await t.db.query(
          `INSERT INTO students (name, gender, room_id, check_in_date, status) VALUES ($1,'female',$2,$3,'in') RETURNING id`,
          [`${P} ${ten}`, rid, `2026-0${i + 1}-15`])).rows[0].id);
      }

      // ── Lịch thường ngày ────────────────────────────────────────────────────────────
      const lich = await lichCuaPhong(rid);
      t.ok('TC-1 · API trả lịch cho phòng', lich.length > 0, 'không có dòng nào — cổng giáo viên sẽ trống');
      t.ok('TC-2 · mỗi dòng là MỘT NGÀY (trường date), không còn khoảng from–to',
        lich.every(w => !!w.date && !w.from && !w.to), JSON.stringify(lich[0]));
      const ngayLienTiep = lich.every((w, i) => {
        if (i === 0) return true;
        // Phải tính ở mốc UTC: dùng giờ máy rồi toISOString() là lệch một ngày vì VN là UTC+7.
        const truoc = new Date(lich[i - 1].date + 'T00:00:00Z');
        return w.date === new Date(truoc.getTime() + 86400000).toISOString().slice(0, 10);
      });
      t.ok('TC-3 · các ngày nối nhau, không nhảy cóc', ngayLienTiep, lich.map(w => w.date).join(' · '));
      t.ok('TC-4 · KHÔNG ai trực hai ngày liên tiếp', !trungLienTiep(lich),
        JSON.stringify(trungLienTiep(lich) || {}));
      t.eq('TC-5 · 4 người thì đúng 4 ngày quay lại lượt cũ',
        lich.length >= 5 ? lich[4].student_id : lich[0].student_id, lich[0].student_id,
        lich.map(w => w.name.replace(P + ' ', '')).join(' → '));

      // ── Có người trả phòng giữa chừng: đúng ca đã gây lỗi ───────────────────────────
      for (const [i, id] of ids.entries()) {
        await t.db.query(`UPDATE students SET check_out_date=NULL, status='in' WHERE id = ANY($1)`, [ids]);
        const ngayRoi = (await t.db.query(`SELECT (CURRENT_DATE + 2)::text AS d`)).rows[0].d;
        await t.db.query(`UPDATE students SET check_out_date=$1, status='out' WHERE id=$2`, [ngayRoi, id]);
        const sau = await lichCuaPhong(rid);
        const xau = trungLienTiep(sau);
        t.ok(`TC-6.${i + 1} · người thứ ${i + 1} trả phòng ${ngayRoi} → vẫn không ai trực hai ngày liền`,
          !xau, xau ? `${xau.name} trực liền hai ngày tới ${xau.date}` : '');
        const conTen = sau.filter(w => w.student_id === id && w.date > ngayRoi);
        t.ok(`TC-7.${i + 1} · … và người đã trả phòng không còn bị xếp trực sau ngày rời`,
          conTen.length === 0, JSON.stringify(conTen));
      }

      // ── Phòng còn một người: vẫn có lịch, trực mỗi ngày ─────────────────────────────
      await t.db.query(`UPDATE students SET check_out_date=NULL, status='in' WHERE id = ANY($1)`, [ids]);
      const homQua = (await t.db.query(`SELECT (CURRENT_DATE - 1)::text AS d`)).rows[0].d;
      await t.db.query(`UPDATE students SET check_out_date=$1, status='out' WHERE id = ANY($2)`, [homQua, ids.slice(1)]);
      const motNguoi = await lichCuaPhong(rid);
      t.ok('TC-8 · phòng còn một người vẫn có lịch (không bỏ trống)', motNguoi.length > 0, 'lịch rỗng');
      t.ok('TC-9 · … và ngày nào cũng là bạn đó', motNguoi.every(w => w.student_id === ids[0]),
        JSON.stringify(motNguoi.map(w => w.name)));
    } finally {
      await clean(t.db);
    }
  },
};
