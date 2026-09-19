// Trang giới thiệu công khai: giường trống tách phòng NAM / phòng NỮ (owner yêu cầu 19/09 — bỏ ô
// "Phòng ở"), giường "sắp trống" phải trừ chỗ đã có người đặt, và /stats đếm phòng khớp /info.
// So DELTA trước/sau chứ không so số tuyệt đối: /api/public/* tính trên toàn bộ dữ liệu của CSDL.
const P = '__test_solieu';

const clean = async db => {
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Số liệu công khai — giường trống nam/nữ',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const q = (sql, p) => t.db.query(sql, p);
    const info = async () => (await t.api('GET', '/api/public/info')).json;
    const stats = async () => (await t.api('GET', '/api/public/stats')).json;

    const truoc = await info();
    const statTruoc = await stats();
    t.eq('/public/stats đếm phòng KHỚP /public/info', statTruoc.rooms, truoc.room_count,
      `stats ${statTruoc.rooms} · info ${truoc.room_count}`);
    t.eq('Tổng giường trống = nam + nữ', truoc.bed_free, (truoc.bed_free_male || 0) + (truoc.bed_free_female || 0),
      `tổng ${truoc.bed_free} · nam ${truoc.bed_free_male} · nữ ${truoc.bed_free_female}`);
    t.ok('Giường trống không vượt tổng số giường', truoc.bed_free + truoc.bed_soon <= truoc.bed_count,
      `${truoc.bed_free} + ${truoc.bed_soon} vs ${truoc.bed_count}`);

    try {
      const phong = async (ten, gt, cap) => (await q(
        `INSERT INTO rooms (name, gender, capacity, room_type) VALUES ($1,$2,$3,'shared') RETURNING id`, [P + ten, gt, cap])).rows[0].id;
      const hv = (ten, rid, cot) => q(
        `INSERT INTO students (name, gender, room_id, ${cot.k}) VALUES ($1,'male',$2,${cot.v})`, [P + ten, rid]);

      // Phòng nam 1 giường: người đang ở đã có lịch trả + một người đã ĐẶT chỗ. Giường sắp trống đó đã
      // có chủ nên KHÔNG được khoe ra ngoài (đây là ca bắt lỗi).
      const pNam = await phong('_nam1', 'male', 1);
      await hv('_nam_dango', pNam, { k: 'check_in_date, planned_check_out', v: `CURRENT_DATE - 30, CURRENT_DATE + 10` });
      await hv('_nam_datcho', pNam, { k: 'planned_check_in', v: `CURRENT_DATE + 5` });
      // Phòng nữ 2 giường, chưa ai ở.
      const pNu = await phong('_nu1', 'female', 2);

      const sau = await info();
      const d = k => (sau[k] || 0) - (truoc[k] || 0);
      t.eq('Phòng nữ trống 2 giường → giường trống NỮ tăng 2', d('bed_free_female'), 2,
        `nữ: ${truoc.bed_free_female} → ${sau.bed_free_female}`);
      t.eq('Phòng nam đã kín và chỗ sắp trống đã có người đặt → giường trống NAM không tăng', d('bed_free_male'), 0,
        `nam: ${truoc.bed_free_male} → ${sau.bed_free_male}`);
      t.eq('Giường "sắp trống" đã có người đặt thì KHÔNG khoe ra ngoài', d('bed_soon_male'), 0,
        `sắp trống nam: ${truoc.bed_soon_male} → ${sau.bed_soon_male}`);
      t.eq('Tổng giường trống vẫn bằng nam + nữ', sau.bed_free, (sau.bed_free_male || 0) + (sau.bed_free_female || 0),
        `tổng ${sau.bed_free} · nam ${sau.bed_free_male} · nữ ${sau.bed_free_female}`);
      t.eq('Tổng "sắp trống" vẫn bằng nam + nữ', sau.bed_soon, (sau.bed_soon_male || 0) + (sau.bed_soon_female || 0),
        `tổng ${sau.bed_soon} · nam ${sau.bed_soon_male} · nữ ${sau.bed_soon_female}`);
      t.eq('Thêm 2 phòng ở → số phòng tăng 2', d('room_count'), 2, `${truoc.room_count} → ${sau.room_count}`);

      // Người đặt chỗ nhận phòng thật: giường trống nữ giảm 1, không còn ai "đặt" nữa.
      const pNu2 = await phong('_nu2', 'female', 2);
      await hv('_nu_dango', pNu2, { k: 'check_in_date', v: `CURRENT_DATE - 1` });
      const sau2 = await info();
      t.eq('Thêm phòng nữ 2 giường có 1 người ở → giường trống nữ tăng thêm 1', (sau2.bed_free_female || 0) - (sau.bed_free_female || 0), 1,
        `nữ: ${sau.bed_free_female} → ${sau2.bed_free_female}`);

      // Phòng cho thuê nguyên căn vẫn nằm trong "phòng ở" của cả hai endpoint (BL-125).
      await q(`INSERT INTO rooms (name, gender, capacity, room_type) VALUES ($1,'male',4,'whole')`, [P + '_tron']);
      const sau3 = await info();
      const stat3 = await stats();
      t.eq('/public/stats vẫn khớp /public/info sau khi thêm phòng thuê nguyên căn', stat3.rooms, sau3.room_count,
        `stats ${stat3.rooms} · info ${sau3.room_count}`);

      // Phòng an ninh/nhân viên không phải chỗ ở học viên → không được tính.
      await q(`INSERT INTO rooms (name, gender, capacity, room_type) VALUES ($1,'male',4,'security')`, [P + '_anninh']);
      const sau4 = await info();
      t.eq('Phòng an ninh KHÔNG tính vào số phòng công khai', sau4.room_count, sau3.room_count,
        `${sau3.room_count} → ${sau4.room_count}`);
      t.eq('Phòng an ninh KHÔNG tính vào giường trống nam', sau4.bed_free_male, sau3.bed_free_male,
        `${sau3.bed_free_male} → ${sau4.bed_free_male}`);
    } finally {
      await clean(t.db);
    }
  },
};
