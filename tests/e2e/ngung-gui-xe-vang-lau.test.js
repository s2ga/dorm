// Nút "Ngưng gửi xe" ở bảng xe vắng nhiều ngày gửi đúng một việc: ngày ngừng = hôm qua (thôi gửi từ hôm nay).
// Sau đó xe phải hết báo vắng NGAY (chuông + bảng) và ra khỏi danh sách điểm danh, còn phí tháng này vẫn tính.
const P = '__test_ngxe';

const congNgay = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function clean(db) {
  const sub = `(SELECT id FROM students WHERE code LIKE '${P}%')`;
  await db.query(`DELETE FROM parking_checks WHERE plate_norm LIKE '${P.toUpperCase().replace(/[^0-9A-Z]/g, '')}%'`);
  await db.query(`DELETE FROM invoices WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM vehicles WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN ${sub}`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Ngưng gửi xe vắng lâu: hết báo vắng ngay, ra khỏi điểm danh, phí tháng này vẫn tính',
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
      `INSERT INTO students (code,name,gender,room_id,facility_id,check_in_date,status,rental_type,deposit_status)
       VALUES ($1,$1,'male',$2,$3,$4,'in','ghep','held') RETURNING id`, [P + '_A', rid, fac, congNgay(-60)])).rows[0].id;
    await t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date) VALUES ($1,$2,$3)`, [sid, rid, congNgay(-60)]);
    const bien = P.toUpperCase() + '-99';
    const norm = bien.replace(/[^0-9A-Z]/g, '');
    const vid = (await t.db.query(`INSERT INTO vehicles (student_id, plate, vehicle_type, from_date) VALUES ($1,$2,'Xe máy',$3) RETURNING id`,
      [sid, bien, congNgay(-40)])).rows[0].id;
    // An ninh đánh VẮNG 10 ngày liền gần nhất (ngưỡng báo mặc định 7 ngày).
    for (let i = 1; i <= 10; i++) {
      await t.db.query(`INSERT INTO parking_checks (check_date, facility_id, vehicle_id, plate, plate_norm, status, checked_by)
        VALUES ($1,$2,$3,$4,$5,'absent','test')`, [congNgay(-i), fac, vid, bien, norm]);
    }
    const coTrongBao = async () => ((((await t.api('GET', '/api/vehicles/parking-alerts', T)).json || {}).vang_lau) || [])
      .some(x => x.vehicle_id === vid);
    // Danh sách trả MỌI xe (thẻ "Đã trả" của an ninh cần), cờ phai_kiem mới là "phải điểm danh hôm nay".
    const coTrongDiemDanh = async () => ((((await t.api('GET', `/api/maintenance/parking?date=${congNgay(0)}`, T)).json || {}).vehicles) || [])
      .some(x => (x.vehicle_id || x.id) === vid && x.phai_kiem === true);
    t.ok('Mốc: xe vắng 10 ngày đang bị báo trong danh sách xe vắng lâu', await coTrongBao());
    t.ok('Mốc: xe đang nằm trong danh sách điểm danh hôm nay', await coTrongDiemDanh());

    // Đúng thân request nút Ngưng gửi xe gửi khi chọn "thôi gửi từ hôm nay".
    const r = await t.api('PUT', `/api/vehicles/${vid}`, T, { to_date: congNgay(-1) });
    t.eq('Ngưng gửi xe → 200', r.status, 200, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
    const xe = (await t.db.query('SELECT plate, vehicle_type, from_date::text tu, to_date::text den FROM vehicles WHERE id=$1', [vid])).rows[0];
    t.ok('Chỉ đổi ngày ngừng, biển/loại xe/ngày bắt đầu giữ nguyên',
      xe.plate === bien && xe.vehicle_type === 'Xe máy' && xe.tu === congNgay(-40) && xe.den === congNgay(-1), JSON.stringify(xe));
    t.ok('Ngưng xong HẾT báo vắng ngay (chuông + bảng xe vắng lâu)', !(await coTrongBao()));
    t.ok('Ngưng xong xe RA KHỎI danh sách điểm danh hôm nay', !(await coTrongDiemDanh()));

    // Phí gửi xe: tháng còn ngày xe gửi vẫn tính, tháng sau thôi.
    const ky = congNgay(0).slice(0, 7);
    const [ny, nm] = ky.split('-').map(Number);
    const kySau = nm === 12 ? `${ny + 1}-01` : `${ny}-${String(nm + 1).padStart(2, '0')}`;
    const xePhi = async m => {
      const id = (await t.db.query(`INSERT INTO invoices (student_id, room_id, month, status) VALUES ($1,$2,$3,'pending') RETURNING id`, [sid, rid, m])).rows[0].id;
      const rr = await t.api('POST', `/api/invoices/${id}/recalc`, T);
      const row = (await t.db.query('SELECT parking_charge::int xe, room_charge::int phong FROM invoices WHERE id=$1', [id])).rows[0];
      if (rr.status !== 200 || !(row.phong > 0)) t.ok(`Tính lại phiếu ${m} phải chạy được`, false, `HTTP ${rr.status} ${JSON.stringify(row)}`);
      return row.xe;
    };
    const phi = +(((await t.api('GET', '/api/settings', T)).json || {}).parking_fee || 0);
    if (congNgay(-1).slice(0, 7) === ky) {
      t.eq('Phiếu THÁNG NÀY vẫn tính phí gửi xe', await xePhi(ky), phi);
    }
    t.eq('Phiếu THÁNG SAU thôi tính phí gửi xe', await xePhi(kySau), 0);

    await clean(t.db);
  },
};
