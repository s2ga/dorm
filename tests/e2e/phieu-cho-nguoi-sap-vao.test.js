// Owner 04/09: người SẮP VÀO trong kỳ (mới có ngày DỰ KIẾN, chưa xác nhận check-in) phải có mặt khi
// lập hoá đơn kỳ đó — kèm CỌC — vì tiền phòng thu trước theo lịch. Xác nhận check-in xong phiếu tự
// tính lại theo ngày thật. Trước đây roster chỉ nhìn ngày thật nên các bạn này bị SÓT hẳn khỏi kỳ.
const P = '__test_psv';

const congNgay = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const soNgayThang = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM logs WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Lập phiếu cho người SẮP VÀO — theo ngày dự kiến, kèm cọc, xác nhận xong tính lại',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const rid = (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
      [P + '_R', fac])).rows[0].id;
    const sapVao = async ma => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,planned_check_in,status,rental_type)
       VALUES ($1,$1,'male',$2,$3,'in','ghep') RETURNING id`, [ma, rid, lichVao])).rows[0].id;

    const lichVao = congNgay(3);            // dự kiến vào 3 ngày nữa
    const ky = lichVao.slice(0, 7);
    const dim = soNgayThang(ky);
    const ngayO = dim - +lichVao.slice(8) + 1;
    const coc = +((await t.api('GET', '/api/settings', T)).json.deposit_fee || 0);
    const s1 = await sapVao(P + '_A');

    // ── Lập hoá đơn theo THÁNG: người sắp vào phải có phiếu + cọc, không bị sót ──────────
    const g = await t.api('POST', '/api/invoices/generate', T, { month: ky });
    t.eq('Lập phiếu kỳ có người sắp vào → 200', g.status, 200, `HTTP ${g.status} ${g.json && g.json.error || ''}`);
    const i1 = (await t.db.query(
      `SELECT days_stayed, room_charge, deposit_charge, total FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`,
      [s1, ky])).rows[0];
    t.ok('Người sắp vào CÓ phiếu trong kỳ (hết sót)', !!i1, 'không có phiếu nào');
    t.eq('Số ngày ở tính từ ngày DỰ KIẾN vào', i1 && +i1.days_stayed, ngayO, JSON.stringify(i1));
    t.eq('Cọc đi kèm phiếu kỳ nhận phòng', i1 && +i1.deposit_charge, coc, `deposit_fee=${coc} · ${JSON.stringify(i1)}`);
    t.eq('Tiền phòng chia đúng theo ngày dự kiến', i1 && +i1.room_charge, Math.round(1200000 / dim * ngayO), JSON.stringify(i1));

    // ── Phiếu LẺ (HĐ cho 1 HV) cho người sắp vào: cũng phải kèm cọc ─────────────────────
    const s2 = await sapVao(P + '_B');
    const g1 = await t.api('POST', '/api/invoices/generate-one', T, { student_id: s2, month: ky });
    t.eq('Tạo phiếu lẻ cho người sắp vào → 200', g1.status, 200, `HTTP ${g1.status} ${g1.json && g1.json.error || ''}`);
    const i2 = (await t.db.query(
      `SELECT days_stayed, deposit_charge FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [s2, ky])).rows[0];
    t.ok('Phiếu lẻ có cọc + đúng ngày dự kiến', !!i2 && +i2.deposit_charge === coc && +i2.days_stayed === ngayO, JSON.stringify(i2));

    // ── Xác nhận check-in NGÀY THẬT (hôm nay, sớm hơn lịch) → phiếu tự tính lại ─────────
    if (congNgay(0).slice(0, 7) === ky) {
      const ci = await t.api('POST', `/api/students/${s1}/checkin`, T, { date: congNgay(0), room_id: rid, confirm_overload: true });
      t.eq('Xác nhận check-in hôm nay → 200', ci.status, 200, `HTTP ${ci.status} ${ci.json && ci.json.error || ''}`);
      const ngayThat = dim - +congNgay(0).slice(8) + 1;
      const i1b = (await t.db.query(
        `SELECT days_stayed, deposit_charge FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [s1, ky])).rows[0];
      t.eq('Phiếu tính lại theo NGÀY THẬT (vào sớm hơn lịch)', +i1b.days_stayed, ngayThat, JSON.stringify(i1b));
      t.eq('Cọc vẫn nằm trên phiếu kỳ nhận phòng', +i1b.deposit_charge, coc, JSON.stringify(i1b));
    } else console.log('  [BỎ QUA] hôm nay và ngày dự kiến lệch tháng — ca tính lại chạy ở lần test giữa tháng');

    await clean(t.db);
  },
};
