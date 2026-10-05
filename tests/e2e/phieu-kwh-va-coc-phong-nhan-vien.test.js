// Hai lỗi trên phiếu của người ở phòng nhân viên (UAT 10/2026, ca phòng 105):
// 1) Phòng an ninh / nhân viên không thu tiền phòng thì KHÔNG giữ cọc — kể cả người thuê ghép.
// 2) Nút "Sửa phiếu" không có ô kWh: lưu xong số kWh không được về 0 trong khi tiền điện vẫn còn.
const P = '__test_kwhcoc';

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
  name: 'Phiếu: phòng nhân viên không thu cọc · Sửa phiếu không xoá số kWh',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const mkRoom = (ten, loai) => t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,6,'female','B',1200000,$3) RETURNING id`, [P + ten, fac, loai]).then(r => r.rows[0].id);
    const rNV = await mkRoom('_NV', 'staff');
    const rGhep = await mkRoom('_GHEP', 'shared');
    const mk = async (ma, rid) => {
      const id = (await t.db.query(
        `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,deposit_status,facility_id)
         VALUES ($1,$1,'female',$2,$3,'in','ghep','none',$4) RETURNING id`, [P + ma, rid, congNgay(-40), fac])).rows[0].id;
      await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [id, rid, congNgay(-40)]);
      return id;
    };
    const nv = await mk('_NV', rNV);       // như Ngân: thuê ghép ở phòng nhân viên, chưa từng có phiếu
    const ghep = await mk('_GHEP', rGhep);  // đối chứng: phòng cho thuê thường
    const le = await mk('_LE', rGhep);      // dùng cho phiếu lẻ nhập tay

    const ky = congNgay(0).slice(0, 7);
    const [ny, nm] = ky.split('-').map(Number);
    const kyTruoc = nm === 1 ? `${ny - 1}-12` : `${ny}-${String(nm - 1).padStart(2, '0')}`;
    const soNgay = new Date(ny, nm, 0).getDate();
    for (const rid of [rNV, rGhep]) {
      await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,501,632,131)`, [rid, kyTruoc]);
    }
    const st = (await t.api('GET', '/api/settings', T)).json || {};
    const coc = +st.deposit_fee || 0;
    const donGia = +st.electric_unit || 0;
    t.ok('Cài đặt có mức cọc và đơn giá điện để so', coc > 0 && donGia > 0, `deposit_fee=${coc} electric_unit=${donGia}`);

    /* ===== LỖI 1: cọc ở phòng nhân viên ===== */
    const lap = async sid => {
      const r = await t.api('POST', '/api/invoices/generate-one', T, { student_id: sid, month: ky });
      return { r, row: (await t.db.query(
        `SELECT id, room_charge::int AS phong, deposit_charge::int AS coc, electric_kwh::float AS kwh, electric_charge::int AS dien, total::int AS tong
           FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL`, [sid, ky])).rows[0] };
    };
    const a = await lap(nv);
    t.eq('Lập phiếu người ở phòng nhân viên → 200', a.r.status, 200, `HTTP ${a.r.status} ${a.r.json && a.r.json.error || ''}`);
    t.eq('Phòng nhân viên: tiền phòng = 0', a.row && a.row.phong, 0, JSON.stringify(a.row));
    t.eq('Phòng nhân viên, thuê ghép, phiếu đầu tiên: KHÔNG thu cọc', a.row && a.row.coc, 0, JSON.stringify(a.row));
    await t.api('POST', `/api/invoices/${a.row.id}/recalc`, T);
    t.eq('Bấm Tính lại cũng không mọc lại dòng cọc',
      (await t.db.query('SELECT deposit_charge::int c FROM invoices WHERE id=$1', [a.row.id])).rows[0].c, 0);

    const b = await lap(ghep);
    t.eq('Đối chứng: phòng cho thuê thường VẪN thu cọc ở phiếu đầu tiên', b.row && b.row.coc, coc, JSON.stringify(b.row));

    /* ===== LỖI 2: Sửa phiếu xoá số kWh ===== */
    const iid = b.row.id;
    await t.db.query(`UPDATE invoices SET electric_kwh=36.3, electric_charge=108900 WHERE id=$1`, [iid]);
    // Đúng thân request mà nút Lưu của form Sửa phiếu gửi (saveInvoice) — không có electric_kwh.
    const form = over => Object.assign({
      student_id: ghep, month: ky, days_stayed: soNgay, room_charge: 1200000, electric_charge: 108900,
      water_charge: 100000, service_charge: 50000, washing_charge: 0, parking_charge: 0,
      other_charge: 0, deposit_charge: 0, other_note: '',
    }, over || {});
    const sua = async (ten, body) => {
      const r = await t.api('PUT', `/api/invoices/${iid}`, T, body);
      t.eq(ten + ' → 200', r.status, 200, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
      return (await t.db.query('SELECT electric_kwh::float k, electric_charge::int d FROM invoices WHERE id=$1', [iid])).rows[0];
    };
    let x = await sua('Sửa phiếu, giữ nguyên tiền điện (bỏ dòng cọc)', form());
    t.eq('Tiền điện không đổi → số kWh GIỮ NGUYÊN 36,3 (bản cũ về 0)', x.k, 36.3, JSON.stringify(x));
    t.eq('Tiền điện vẫn đúng 108.900', x.d, 108900);

    x = await sua('Sửa phiếu, đổi tiền điện', form({ electric_charge: 120000 }));
    t.eq('Đổi tiền điện → kWh suy theo tiền (tiền ÷ đơn giá)', x.k, Math.round(120000 / donGia * 100) / 100, JSON.stringify(x));

    x = await sua('Gửi rõ số kWh', form({ electric_charge: 120000, electric_kwh: 12.5 }));
    t.eq('Gửi rõ electric_kwh → dùng đúng số đó', x.k, 12.5, JSON.stringify(x));

    const tao = await t.api('POST', '/api/invoices', T, {
      student_id: le, month: ky, days_stayed: soNgay, room_charge: 1200000, electric_charge: 90000,
      water_charge: 0, service_charge: 0, washing_charge: 0, parking_charge: 0, other_charge: 0, deposit_charge: 0, other_note: '',
    });
    t.eq('Thêm phiếu lẻ nhập tay → 201', tao.status, 201, `HTTP ${tao.status} ${tao.json && tao.json.error || ''}`);
    const kLe = (await t.db.query('SELECT electric_kwh::float k FROM invoices WHERE student_id=$1 AND month=$2', [le, ky])).rows[0];
    t.eq('Phiếu lẻ có tiền điện mà không nhập kWh → kWh suy theo tiền, không để 0',
      kLe && kLe.k, Math.round(90000 / donGia * 100) / 100, JSON.stringify(kLe));

    await clean(t.db);
  },
};
