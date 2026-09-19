// Owner chốt 17/09: mã học viên KHÔNG được trùng (giữ ràng buộc trong CSDL). Vì vậy bấm "vẫn lưu"
// (confirm_duplicate) lúc trùng mã phải được báo rõ phải làm gì, KHÔNG được rơi thành "Lỗi máy chủ".
const P = '__test_trungma';

const clean = async db => {
  await db.query(`DELETE FROM applications WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Trùng mã học viên khi duyệt đơn — báo rõ, không 500',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const ma = P + '_MA1';
    try {
      await t.db.query(`INSERT INTO students (name, code, gender) VALUES ($1,$2,'male')`, [P + ' Cu', ma]);
      const don = (await t.db.query(
        `INSERT INTO applications (name, phone, code, gender, status) VALUES ($1,'0900111222',$2,'male','pending') RETURNING id`,
        [P + ' Moi', ma])).rows[0].id;

      const chan = await t.api('POST', `/api/applications/${don}/approve`, T, {});
      t.eq('Duyệt đơn trùng mã → 409 (chặn trước, có chỉ đường)', chan.status, 409, `HTTP ${chan.status}`);

      const ep = await t.api('POST', `/api/applications/${don}/approve`, T, { confirm_duplicate: true });
      t.eq('Bấm "vẫn lưu" khi trùng mã → 409, KHÔNG phải 500', ep.status, 409, `HTTP ${ep.status} ${ep.json && ep.json.error || ''}`);
      const loi = ep.json && ep.json.error || '';
      t.ok('Lời báo nói rõ mã đã có hồ sơ khác dùng', loi.includes(ma), loi);
      t.ok('Lời báo chỉ đường xử lý (sửa mã, hoặc dùng hồ sơ cũ)', /sửa mã|Chuyển phòng|Từ chối/i.test(loi), loi);
      t.ok('Không lộ lỗi kỹ thuật của CSDL', !/duplicate key|constraint|SQLSTATE|Lỗi máy chủ/i.test(loi), loi);

      const soHoSo = (await t.db.query(`SELECT count(*)::int n FROM students WHERE name LIKE '${P}%'`)).rows[0].n;
      t.eq('Không tạo hồ sơ thứ hai', soHoSo, 1, `${soHoSo} hồ sơ`);
      const trangThai = (await t.db.query('SELECT status FROM applications WHERE id=$1', [don])).rows[0].status;
      t.eq('Đơn vẫn ở trạng thái chờ duyệt để xử lý lại', trangThai, 'pending');

      // Sửa mã trên đơn rồi duyệt lại thì đi tiếp bình thường.
      await t.db.query('UPDATE applications SET code=$1 WHERE id=$2', [P + '_MA2', don]);
      const ok = await t.api('POST', `/api/applications/${don}/approve`, T, {});
      t.eq('Đổi mã khác rồi duyệt → 200', ok.status, 200, `HTTP ${ok.status} ${ok.json && ok.json.error || ''}`);
    } finally {
      await clean(t.db);
    }
  },
};
