// Đơn trả phòng ở cổng học viên: phải qua bước đọc quy trình trả phòng (tick "đã đọc") mới gửi được.
// Máy chủ chặn cả đơn gửi từ giao diện cũ không có bước này, và lưu lại lúc học viên xác nhận đã đọc.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_dtpqt';
const PW = 'quanly2026a';

const congNgay = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM checkout_requests WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Đơn trả phòng: phải đọc quy trình trả phòng trước khi gửi',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities ORDER BY id LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,6,'male','B',1200000,'shared') RETURNING id`, [P + '_R', fac])).rows[0].id;
    const sid = (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,facility_id,check_in_date,status,rental_type,deposit_status,deposit_amount)
       VALUES ($1,$1,'male',$2,$3,$4,'in','ghep','held',1200000) RETURNING id`, [P + '_A', rid, fac, congNgay(-60)])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [sid, rid, congNgay(-60)]);
    await t.db.query(`INSERT INTO users (username,password_hash,role,student_id,facility_id,must_change_password)
      VALUES ($1,$2,'student',$3,$4,false)`, [P + '_A', bcrypt.hashSync(PW, 10), sid, fac]);
    const hv = await t.login(P + '_A', PW);
    t.ok('Học viên đăng nhập được', !!hv);

    const st = (await t.api('GET', '/api/settings', T)).json || {};
    const pf = (await t.api('GET', '/api/me/profile', hv)).json || {};
    t.eq('Cổng học viên nhận số ngày báo trước theo Cài đặt (để dựng quy trình)',
      String(pf.deposit_notice_min_days), String(st.deposit_notice_min_days), JSON.stringify({ hv: pf.deposit_notice_min_days, cd: st.deposit_notice_min_days }));
    t.ok('Cổng học viên nhận người liên hệ của Ban Quản lý', 'contact_person' in pf, Object.keys(pf).join(','));

    const don = { desired_date: congNgay(40), reason: 'departure', note: 'Về nước', bank_account: '0123456789', bank_name: 'Vietcombank' };
    const soDon = async () => (await t.db.query('SELECT COUNT(*)::int c FROM checkout_requests WHERE student_id=$1', [sid])).rows[0].c;

    const r1 = await t.api('POST', '/api/me/checkout-request', hv, don);
    t.eq('Gửi đơn KHÔNG qua bước đọc quy trình (giao diện cũ) → 400', r1.status, 400, `HTTP ${r1.status} ${r1.json && r1.json.error || ''}`);
    t.eq('Bị chặn thì không tạo đơn nào', await soDon(), 0);
    t.eq('Gửi kèm "chưa đọc" → 400',
      (await t.api('POST', '/api/me/checkout-request', hv, { ...don, da_doc_quy_trinh: false })).status, 400);

    const r2 = await t.api('POST', '/api/me/checkout-request', hv, { ...don, da_doc_quy_trinh: true });
    t.eq('Đã tick đọc quy trình → gửi đơn được (201)', r2.status, 201, `HTTP ${r2.status} ${r2.json && r2.json.error || ''}`);
    const row = (await t.db.query(
      `SELECT rules_ack_at IS NOT NULL AS da_doc, bank_account, bank_name, desired_date::text AS ngay, status
         FROM checkout_requests WHERE student_id=$1`, [sid])).rows[0] || {};
    t.eq('Lưu lại lúc học viên xác nhận đã đọc quy trình', row.da_doc, true, JSON.stringify(row));
    t.ok('Lưu số tài khoản và ngân hàng nhận cọc', row.bank_account === '0123456789' && row.bank_name === 'Vietcombank', JSON.stringify(row));
    t.eq('Đơn ở trạng thái chờ duyệt', row.status, 'pending');
    t.eq('Gửi đơn thứ hai khi còn chờ → 400',
      (await t.api('POST', '/api/me/checkout-request', hv, { ...don, da_doc_quy_trinh: true })).status, 400);

    await clean(t.db);
  },
};
