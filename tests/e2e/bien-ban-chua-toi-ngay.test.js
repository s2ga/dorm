// Huy hiệu "cần lập biên bản" của an ninh chỉ đếm người ĐÃ TỚI NGÀY nhận / trả phòng. Người hẹn ngày mai vẫn có
// trong danh sách tháng (trả sớm thì lập được) nhưng không bị tính là thiếu biên bản. CHỈ LOCAL.
const bcrypt = require('../../node_modules/bcryptjs');
const P = '__test_bbtn';
const PW = 'anninh26';
const ngay = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM handover_reports WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Biên bản bàn giao — chưa tới ngày thì không tính là thiếu biên bản',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    if (ngay(1).slice(0, 7) !== ngay(0).slice(0, 7)) {
      t.ok('BỎ QUA: hôm nay là ngày cuối tháng, không có "ngày mai" cùng tháng để thử', true);
      return;
    }
    // Cơ sở riêng: huy hiệu của an ninh đếm theo cơ sở, nên số đếm chỉ gồm dữ liệu của bộ test này.
    const fac = (await t.db.query(`INSERT INTO facilities (name, address) VALUES ($1,'') RETURNING id`, [P + '_CS'])).rows[0].id;
    const rm = (await t.db.query(`INSERT INTO rooms (name,facility_id,capacity,gender,hang,monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`, [P + '_R', fac])).rows[0].id;
    await t.db.query(`INSERT INTO users (username,password_hash,role,approved,facility_id) VALUES ($1,$2,'maintenance',true,$3)`, [P + '_an', bcrypt.hashSync(PW, 10), fac]);
    const AN = await t.login(P + '_an', PW);
    const dem = async () => (await t.api('GET', '/api/maintenance/handovers/summary', AN)).json || {};

    const dangO = async (ma, tra) => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,facility_id,check_in_date,checkin_confirmed_at,status,rental_type,planned_check_out)
       VALUES ($1,$1,'male',$2,$3,$4,now(),'in','ghep',$5) RETURNING id`, [ma, rm, fac, ngay(-30), tra])).rows[0].id;
    const sapVao = async (ma, vao) => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,facility_id,planned_check_in,status,rental_type)
       VALUES ($1,$1,'male',$2,$3,$4,'in','ghep') RETURNING id`, [ma, rm, fac, vao])).rows[0].id;

    await dangO(P + '_tra_mai', ngay(1));
    await sapVao(P + '_vao_mai', ngay(1));
    const d0 = await dem();
    t.eq('Hẹn trả ngày mai: không tính là thiếu biên bản trả phòng', d0.pendingCheckout, 0);
    t.eq('Hẹn vào ngày mai: không tính là thiếu biên bản nhận phòng', d0.pendingCheckin, 0);

    await dangO(P + '_tra_nay', ngay(0));
    await sapVao(P + '_vao_nay', ngay(0));
    const d1 = await dem();
    t.eq('Hẹn trả hôm nay: tính là cần lập biên bản', d1.pendingCheckout, 1);
    t.eq('Hẹn vào hôm nay: tính là cần lập biên bản', d1.pendingCheckin, 1);

    const ds = (await t.api('GET', `/api/maintenance/handovers?month=${ngay(0).slice(0, 7)}`, AN)).json || {};
    const ten = (ds.checkouts || []).map(x => x.name);
    t.ok('Danh sách trả phòng tháng vẫn có cả người hẹn ngày mai (trả sớm thì lập được)',
      ten.includes(P + '_tra_mai') && ten.includes(P + '_tra_nay'), ten.join(', '));

    await clean(t.db);
  },
};
