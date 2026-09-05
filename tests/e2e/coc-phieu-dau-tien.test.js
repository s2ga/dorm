// Owner 05/09 (ca Nguyễn Duy Khanh): vào ở từ kỳ trước nhưng kỳ ĐÓ chưa từng lập phiếu (UAT bắt đầu
// thu giữa chừng) -> cọc "chưa đóng" rơi vào khe, không kỳ nào đòi. Luật mới: cọc chưa thu đòi ở
// PHIẾU SỚM NHẤT của học viên; đã có phiếu kỳ trước thì kỳ sau không đòi lại; hồ sơ "đang giữ" vẫn 0.
const P = '__test_cpd';

const congNgay = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM electric_readings WHERE room_id IN (SELECT id FROM rooms WHERE name LIKE '${P}%')`);
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Cọc chưa thu đòi ở PHIẾU SỚM NHẤT — vào từ kỳ trước không còn rơi vào khe',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,6,'male','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;
    const mk = async (ma, depStatus) => {
      const id = (await t.db.query(
        `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,deposit_status)
         VALUES ($1,$1,'male',$2,$3,'in','ghep',$4) RETURNING id`, [ma, rid, congNgay(-40), depStatus])).rows[0].id;
      await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [id, rid, congNgay(-40)]);
      return id;
    };
    const s1 = await mk(P + '_A', 'none');   // chưa đóng cọc, chưa từng có phiếu
    const s2 = await mk(P + '_B', 'none');   // chưa đóng cọc NHƯNG đã có phiếu kỳ trước
    const s3 = await mk(P + '_C', 'held');   // đã ghi nhận cọc
    const ky = congNgay(0).slice(0, 7);
    const [ny, nm] = ky.split('-').map(Number);
    const kyTruoc = nm === 1 ? `${ny - 1}-12` : `${ny}-${String(nm - 1).padStart(2, '0')}`;
    await t.db.query(`INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, total, status)
      VALUES ($1,$2,$3,31,1200000,1200000,'pending')`, [s2, rid, kyTruoc]);
    await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,0,90,90)`, [rid, kyTruoc]);

    const coc = +((await t.api('GET', '/api/settings', T)).json.deposit_fee || 0);
    const g = await t.api('POST', '/api/invoices/generate', T, { month: ky });
    t.eq('Lập phiếu kỳ này → 200', g.status, 200, `HTTP ${g.status} ${g.json && g.json.error || ''}`);
    const cocCua = async sid => { const r = (await t.db.query(
      `SELECT deposit_charge FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [sid, ky])).rows[0]; return r ? +r.deposit_charge : null; };
    t.eq('Vào kỳ trước + CHƯA từng có phiếu → phiếu sớm nhất PHẢI đòi cọc', await cocCua(s1), coc, `deposit_fee=${coc}`);
    t.eq('Đã có phiếu kỳ trước → kỳ này KHÔNG đòi lại', await cocCua(s2), 0);
    t.eq('Hồ sơ "đang giữ cọc" → vẫn không đòi', await cocCua(s3), 0);

    // Tính lại phiếu s1: khoản cọc khác 0 phải GIỮ NGUYÊN (không mất khi recalc tự động)
    const iid = (await t.db.query(`SELECT id FROM invoices WHERE student_id=$1 AND month=$2`, [s1, ky])).rows[0].id;
    await t.api('POST', `/api/invoices/${iid}/recalc`, T);
    t.eq('Tính lại xong cọc vẫn còn', await cocCua(s1), coc);

    await clean(t.db);
  },
};
