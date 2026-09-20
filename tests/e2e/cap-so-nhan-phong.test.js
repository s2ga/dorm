// Số hợp đồng: xác nhận nhận phòng KHÔNG tự cấp số — số chỉ lấy bằng nút ⚡ (GET /contract-no/next).
// Gợi ý theo khuôn pháp lý "NN/YYYY/HĐKTX-XX" (chữ Đ), nối tiếp MAX theo NĂM + PHÁP NHÂN.
const P = '__test_capso';

async function clean(db) {
  await db.query(`DELETE FROM room_leaders WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs         WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Số HĐ — nhận phòng KHÔNG tự cấp số · nút ⚡ gợi ý khuôn NN/YYYY/HĐKTX-XX',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    const mkRoom = async (n, loai) => (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,6,'male','B',1200000,$3) RETURNING id`, [P + n, fac, loai || 'shared'])).rows[0].id;
    // Hồ sơ SẮP VÀO (BL-117): chỉ có lịch dự kiến, chưa có ngày vào thật.
    // cccd_front/back phải có: nhận phòng đòi đủ 2 mặt (luật 12/09/2026), khoá riêng ở xac-nhan-vao-ra.
    const mkStu = async (n, ten, soHD) => (await t.db.query(
      `INSERT INTO students (code,name,gender,birth_date,planned_check_in,status,rental_type,residency_status,contract_no,cccd_front,cccd_back)
       VALUES ($1,$2,'male','2004-05-06','2026-09-01','out','ghep','unregistered',$3,'test/f.jpg','test/b.jpg') RETURNING id`,
      [P + n, ten, soHD || ''])).rows[0].id;
    const checkin = (id, body) => t.api('POST', `/api/students/${id}/checkin`, T, body);
    const soTrongCSDL = async id => (await t.db.query('SELECT contract_no, contract_date FROM students WHERE id=$1', [id])).rows[0];
    const keTiep = (ngay = '2026-09-06') =>
      t.api('GET', `/api/students/contract-no/next?gender=male&date=${ngay}`, T);

    const goc = (await keTiep()).json;
    const ent = goc.entity;
    t.ok('Máy chủ trả pháp nhân nam', !!ent, JSON.stringify(goc));
    const R = await mkRoom('_R', 'shared');
    // Chiếm số CAO HƠN MAX hiện có của CSDL thử (kể cả rác của bộ test khác) để phép đếm là của mình.
    const N = (goc.seq || 1) + 99;
    const so = (n, nam = '2026') => `${n}/${nam}/HĐKTX-${ent}`;
    await mkStu('_moi', 'Moi day so', so(N));

    // ── Xác nhận nhận phòng KHÔNG được tự cấp số ───────────────────────────────────────────
    const A = await mkStu('_A', 'Tran Van A');
    const rA = await checkin(A, { date: '2026-09-05', room_id: R });
    t.eq('Xác nhận nhận phòng → 200', rA.status, 200, `HTTP ${rA.status} ${rA.json && rA.json.error || ''}`);
    const dbA = await soTrongCSDL(A);
    t.ok('Nhận phòng xong ô số hợp đồng vẫn TRỐNG', !String(dbA.contract_no || '').trim(), JSON.stringify(dbA));
    t.ok('Nhận phòng không tự ghi ngày ký', !dbA.contract_date, JSON.stringify(dbA));
    t.ok('Response không còn trường cấp số (so_hd_moi / ten_file_hd)',
      rA.json && !('so_hd_moi' in rA.json) && !('ten_file_hd' in rA.json), JSON.stringify(Object.keys(rA.json || {})));
    t.eq('Dãy số KHÔNG nhích lên sau khi nhận phòng', (await keTiep()).json.seq, N + 1);

    // ── Hồ sơ đã có số thì nhận phòng giữ nguyên ───────────────────────────────────────────
    const E = await mkStu('_E', 'Co So E', '77/2026/HĐKTX-TEST');
    const rE = await checkin(E, { date: '2026-09-03', room_id: R });
    t.eq('Hồ sơ đã có số giữ nguyên số cũ', rE.json && rE.json.contract_no, '77/2026/HĐKTX-TEST');

    // ── Ngày dự kiến trả vẫn được giữ và vẫn bị kiểm (dùng để xếp diện ở ngắn) ──────────────
    const C = await mkStu('_C', 'Ngan Han C');
    const rC = await checkin(C, { date: '2026-09-01', room_id: R, planned_check_out: '2026-09-20' });
    t.eq('Ở ngắn → 200', rC.status, 200, `HTTP ${rC.status} ${rC.json && rC.json.error || ''}`);
    t.eq('Ngày dự kiến trả được GIỮ sau xác nhận', String(rC.json && rC.json.planned_check_out || '').slice(0, 10), '2026-09-20');
    const G = await mkStu('_G', 'Sai Ngay G');
    const rG = await checkin(G, { date: '2026-09-05', room_id: R, planned_check_out: '2026-09-01' });
    t.eq('Dự kiến trả trước ngày vào → 400', rG.status, 400, `HTTP ${rG.status}`);

    // ── Nút ⚡: đúng khuôn pháp lý, chữ Đ, nối tiếp MAX ─────────────────────────────────────
    const g1 = (await keTiep()).json;
    t.eq('Gợi ý nối tiếp số lớn nhất của dãy', g1.contract_no, so(N + 1), JSON.stringify(g1));
    t.ok('Gợi ý dùng chữ Đ, KHÔNG phải chữ D', /HĐKTX/.test(g1.contract_no || ''), g1.contract_no);

    // ── Chuỗi khuôn tên file "NN.HDTP-XX" không phải số hợp đồng ──────────────────────────
    await mkStu('_rac', 'Rac Ten File', `${N + 900}.HDTP-${ent}`);
    t.eq('Chuỗi "NN.HDTP-XX" không vào phép đếm', (await keTiep()).json.seq, N + 1);

    // ── Số của NĂM KHÁC không ảnh hưởng dãy năm nay ────────────────────────────────────────
    await mkStu('_2025', 'Nam Truoc', so(N + 800, '2025'));
    t.eq('Số năm 2025 không đẩy dãy 2026 lên', (await keTiep()).json.seq, N + 1);
    t.eq('Hỏi số cho năm 2025 thì đếm theo dãy 2025', (await keTiep('2025-03-01')).json.seq, N + 801);

    // ── BẪY CHỮ Đ/D: số cũ viết "HDKTX" (chữ D) phải được ĐẾM CHUNG ────────────────────────
    // Postgres so khớp chính xác: khuôn chữ Đ không thấy số chữ D. Đếm sót là gợi ý trùng số đã ký.
    const CU = N + 50;
    await mkStu('_chuD', 'So Viet Chu D', `${CU}/2026/HDKTX-${ent}`);
    t.eq('Gợi ý NHÌN THẤY số viết chữ D thường', (await keTiep()).json.seq, CU + 1,
      `gợi ý ${(await keTiep()).json.contract_no} trong khi đang có ${CU}/2026/HDKTX-${ent}`);
  },
};
