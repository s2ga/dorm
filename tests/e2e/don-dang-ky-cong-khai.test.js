// QA-036: form đăng ký công khai (cũng là đường nhân viên tạo "đơn hộ") phải chặn mã HTML như cửa nội
// bộ, và báo đúng lỗi khi thân gửi lên không đọc được thay vì nuốt lỗi rồi kêu "Vui lòng nhập họ tên".
// Trần 10 đơn/phút/IP: bài này gọi tối đa 6 lần.
const { BASE } = require('../lib/harness');
const P = '__test_donck';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const clean = db => db.query(`DELETE FROM applications WHERE name LIKE '${P}%' OR name LIKE '%${P}%'`);

module.exports = {
  name: 'Đơn đăng ký công khai — chặn mã HTML, báo đúng lỗi thân hỏng',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1')).rows[0];
    if (!fac) { t.ok('Có cơ sở để gửi đơn', false, 'CSDL không có cơ sở nào'); return; }
    const don = (them = {}) => ({
      name: P + ' An', phone: '0900100200', gender: 'male', facility_id: fac.id,
      birth_date: '2004-05-06', desired_check_in: '2026-12-01', rental_type: 'ghep',
      cccd_front: PNG, cccd_back: PNG, ...them,
    });
    try {
      const html = await t.api('POST', '/api/public/apply', null, don({ name: `${P} <script>alert(1)</script>` }));
      t.eq('Họ tên chứa thẻ script → 400', html.status, 400, `HTTP ${html.status} ${html.json && html.json.error || ''}`);
      t.ok('Lỗi nói rõ là do mã HTML', /HTML/.test(html.json && html.json.error || ''), html.json && html.json.error);

      const sdt = await t.api('POST', '/api/public/apply', null, don({ phone: '<b>0900100200</b>' }));
      t.eq('SĐT chứa thẻ HTML → 400 (kiểm SĐT cũ bỏ qua được vì nó lọc hết ký tự không phải số)', sdt.status, 400,
        `HTTP ${sdt.status} ${sdt.json && sdt.json.error || ''}`);

      const ghiChu = await t.api('POST', '/api/public/apply', null, don({ note: `<img src=x onerror=1> ${P}` }));
      t.eq('Ghi chú chứa thẻ img → 400', ghiChu.status, 400, `HTTP ${ghiChu.status}`);

      const hong = await fetch(BASE + '/api/public/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":',
      });
      const hongJson = await hong.json().catch(() => null);
      t.eq('Thân JSON hỏng → 400', hong.status, 400, `HTTP ${hong.status}`);
      t.ok('Báo đúng là không đọc được dữ liệu, KHÔNG phải "Vui lòng nhập họ tên"',
        /không đọc được/.test(hongJson && hongJson.error || ''), hongJson && hongJson.error);

      const sach = await t.api('POST', '/api/public/apply', null, don({ note: 'phòng 3 người, gần cầu thang' }));
      if (sach.status === 501) { t.ok('S3 chưa cấu hình — bỏ qua ca đơn hợp lệ', true, '501'); return; }
      t.eq('Đơn bình thường vẫn gửi được → 201', sach.status, 201, `HTTP ${sach.status} ${sach.json && sach.json.error || ''}`);
      const luu = (await t.db.query(`SELECT count(*)::int n FROM applications WHERE name LIKE '${P}%'`)).rows[0].n;
      t.eq('Chỉ đơn hợp lệ được lưu, các đơn có HTML thì không', luu, 1, `${luu} đơn trong CSDL`);
    } finally {
      await clean(t.db);
    }
  },
};
