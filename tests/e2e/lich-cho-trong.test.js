// GET /rooms/lich: ma trận phòng × ngày. Bài 1 là hồi quy chốt: tu=den=X phải ra ĐÚNG con số
// GET /rooms?date=X — lịch không được đẻ định nghĩa "ai đang ở" thứ hai.
const P = '__test_lich';

const ngay = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function clean(db) {
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%' OR code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Lịch chỗ trống — ma trận phòng × ngày (GET /rooms/lich)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);

    const rid = (await t.db.query(
      `INSERT INTO rooms (name, floor, gender, capacity, monthly_fee) VALUES ($1, 9, 'male', 2, 1000000) RETURNING id`,
      [P + '_A'])).rows[0].id;
    const ridWhole = (await t.db.query(
      `INSERT INTO rooms (name, floor, gender, capacity, monthly_fee, room_type) VALUES ($1, 9, 'male', 3, 1000000, 'whole') RETURNING id`,
      [P + '_W'])).rows[0].id;
    const hv = async (ten, vao, ra) => (await t.db.query(
      `INSERT INTO students (name, code, gender, room_id, check_in_date, check_out_date, rental_type)
       VALUES ($1, $2, 'male', $3, $4, $5, 'ghep') RETURNING id`,
      [P + ' ' + ten, P + '_' + ten, rid, vao, ra])).rows[0].id;

    await hv('A', ngay(-30), ngay(10));   // đang ở, rời ngày +10
    await hv('B', ngay(5), null);         // vào ngày +5, ở mãi
    await hv('C', ngay(-30), null);       // đang ở
    // Phòng 2 giường: hôm nay 2 người (A, C) + B sắp vào -> ngày +5..+9 là 3 người (quá tải), +10 trở đi còn 2

    const lich = async (tu, den) => (await t.api('GET', `/api/rooms/lich?tu=${tu}&den=${den}`, T)).json;
    const phongCua = (j, id) => (j.phong || []).find(p => p.id === id);

    // ── Bài 1: hồi quy lịch == ?date= với 3 mốc, so MỌI phòng ─────────────────────────
    for (const m of [0, 5, 30]) {
      const X = ngay(m);
      const a = await t.api('GET', `/api/rooms?date=${X}`, T);
      const b = await lich(X, X);
      let lech = [];
      for (const r of a.json) {
        const p = phongCua(b, r.id);
        if (!p) { lech.push(r.name + ': thiếu trong lịch'); continue; }
        if (p.dang_o[0] !== r.occupancy || p.sap_vao[0] !== r.upcoming || p.sap_ra[0] !== r.leaving) {
          lech.push(`${r.name}: lịch ${p.dang_o[0]}/${p.sap_vao[0]}/${p.sap_ra[0]} vs rooms ${r.occupancy}/${r.upcoming}/${r.leaving}`);
        }
      }
      t.ok(`Mốc +${m}: lịch tu=den=X khớp ?date=X trên mọi phòng`, lech.length === 0, lech.slice(0, 3).join(' | ') || `khớp ${a.json.length} phòng`);
    }

    // ── Hình dạng ────────────────────────────────────────────────────────────────────
    const j = await lich(ngay(0), ngay(14));
    t.ok('so_ngay đúng', j.so_ngay === 15, String(j.so_ngay));
    const pA = phongCua(j, rid);
    t.ok('Mảng dài đúng so_ngay', pA.dang_o.length === 15 && pA.sap_vao.length === 15 && pA.sap_ra.length === 15,
      `${pA.dang_o.length}/${pA.sap_vao.length}/${pA.sap_ra.length}`);

    // ── Biên vào/ra ──────────────────────────────────────────────────────────────────
    t.ok('Ngày +4: B chưa vào → đang ở 2', pA.dang_o[4] === 2, String(pA.dang_o[4]));
    t.ok('Ngày +5: B vào (<=) → 3 người, KHÔNG kẹp về sức chứa 2', pA.dang_o[5] === 3, String(pA.dang_o[5]));
    t.ok('Ngày +9: A còn ở → vẫn 3', pA.dang_o[9] === 3, String(pA.dang_o[9]));
    t.ok('Ngày +10: A rời (> chứ không >=) → còn 2', pA.dang_o[10] === 2, String(pA.dang_o[10]));
    t.ok('sap_vao[0] = 1 (B), về 0 từ ngày +5', pA.sap_vao[0] === 1 && pA.sap_vao[5] === 0,
      `${pA.sap_vao[0]}→${pA.sap_vao[5]}`);
    t.ok('sap_ra chỉ đếm người ĐÃ vào ở: ngày 0 chỉ A (không tính B)', pA.sap_ra[0] === 1, String(pA.sap_ra[0]));

    // ── dem_giuong ───────────────────────────────────────────────────────────────────
    t.ok('Phòng thường dem_giuong=true, whole=false',
      pA.dem_giuong === true && phongCua(j, ridWhole).dem_giuong === false,
      `${pA.dem_giuong}/${phongCua(j, ridWhole).dem_giuong}`);

    // ── Validate ─────────────────────────────────────────────────────────────────────
    for (const [q, ten] of [
      [`tu=xxx&den=${ngay(1)}`, 'tu rác'],
      [`tu=${ngay(0)}`, 'thiếu den'],
      [`tu=${ngay(5)}&den=${ngay(0)}`, 'den < tu'],
      [`tu=${ngay(0)}&den=${ngay(180)}`, 'khoảng 181 ngày'],
    ]) {
      t.ok(`${ten} → 400`, (await t.api('GET', '/api/rooms/lich?' + q, T)).status === 400, q);
    }
    t.ok('Khoảng đúng 180 ngày → 200', (await t.api('GET', `/api/rooms/lich?tu=${ngay(0)}&den=${ngay(179)}`, T)).status === 200, '');

    // ── Quyền ────────────────────────────────────────────────────────────────────────
    t.ok('Không đăng nhập → 401', (await t.api('GET', `/api/rooms/lich?tu=${ngay(0)}&den=${ngay(1)}`, null)).status === 401, '');
  },
};
