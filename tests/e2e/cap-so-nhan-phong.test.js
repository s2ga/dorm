// Cấp số HĐ lúc xác nhận nhận phòng: MAX+1 theo NĂM + PHÁP NHÂN, khuôn pháp lý "NN/YYYY/HĐKTX-XX"
// (chữ Đ). Tên file bản scan "NN.HDTP-XX_YYYYMMDD_TÊN" là thứ KHÁC, không phải số hợp đồng.
// Không cấp: ở ngắn dưới ngưỡng / phòng an ninh / hồ sơ đã có số.
const P = '__test_capso';

async function clean(db) {
  await db.query(`DELETE FROM room_leaders WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs         WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Cấp số HĐ khi xác nhận nhận phòng — khuôn pháp lý NN/YYYY/HĐKTX-XX',
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
    const mkStu = async (n, ten, soHD) => (await t.db.query(
      `INSERT INTO students (code,name,gender,planned_check_in,status,rental_type,residency_status,contract_no)
       VALUES ($1,$2,'male','2026-09-01','out','ghep','unregistered',$3) RETURNING id`,
      [P + n, ten, soHD || ''])).rows[0].id;
    const checkin = (id, body) => t.api('POST', `/api/students/${id}/checkin`, T, body);
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

    // ── Xác nhận = cấp số đúng khuôn pháp lý, ngày ký = ngày nhận phòng ────────────────────
    const A = await mkStu('_A', 'Đặng Văn Ú');
    const rA = await checkin(A, { date: '2026-09-05', room_id: R });
    t.eq('Xác nhận nhận phòng → 200', rA.status, 200, `HTTP ${rA.status} ${rA.json && rA.json.error || ''}`);
    t.eq('Cấp số nối tiếp MAX, đúng khuôn NN/YYYY/HĐKTX-XX', rA.json && rA.json.contract_no, so(N + 1),
      String(rA.json && rA.json.contract_no));
    t.ok('Số hợp đồng dùng chữ Đ, KHÔNG phải chữ D', /HĐKTX/.test(String(rA.json && rA.json.contract_no || '')),
      String(rA.json && rA.json.contract_no));
    t.eq('Trả so_hd_moi cho frontend hiện', rA.json && rA.json.so_hd_moi, so(N + 1));
    t.ok('Ngày ký = ngày nhận phòng', String(rA.json && rA.json.contract_date || '').slice(0, 10) === '2026-09-05',
      String(rA.json && rA.json.contract_date));

    // ── TÊN FILE là thứ KHÁC số hợp đồng: khuôn NN.HDTP-XX, không có dấu "/" ───────────────
    t.eq('Tên file scan đúng quy ước lưu trữ', rA.json && rA.json.ten_file_hd,
      `${N + 1}.HDTP-${ent}_20260905_DANG VAN U`);
    t.ok('Tên file KHÔNG chứa "/" (đặt tên file được)', !String(rA.json && rA.json.ten_file_hd || '').includes('/'),
      String(rA.json && rA.json.ten_file_hd));
    t.ok('Tên file KHÁC số hợp đồng', rA.json && rA.json.ten_file_hd !== rA.json.contract_no);

    // ── Người xác nhận sau lấy số sau ──────────────────────────────────────────────────────
    const B = await mkStu('_B', 'Tran Van B');
    const rB = await checkin(B, { date: '2026-09-05', room_id: R });
    t.eq('Người xác nhận sau nhận số kế tiếp', rB.json && rB.json.contract_no, so(N + 2));

    // ── Ở ngắn dưới ngưỡng (điền ngày dự kiến trả) -> phiếu bàn giao, KHÔNG cấp số ─────────
    const C = await mkStu('_C', 'Ngan Han C');
    const rC = await checkin(C, { date: '2026-09-01', room_id: R, planned_check_out: '2026-09-20' });
    t.eq('Ở ngắn → 200', rC.status, 200, `HTTP ${rC.status} ${rC.json && rC.json.error || ''}`);
    t.ok('Ở ngắn KHÔNG cấp số', !(rC.json && rC.json.contract_no), String(rC.json && rC.json.contract_no));
    t.eq('Ngày dự kiến trả được GIỮ sau xác nhận (không bị bước xác nhận xoá mất)',
      String(rC.json && rC.json.planned_check_out || '').slice(0, 10), '2026-09-20');

    // ── Dự kiến trả XA (trên ngưỡng) vẫn là dài hạn -> CÓ cấp số ───────────────────────────
    const F = await mkStu('_F', 'Dai Han F');
    const rF = await checkin(F, { date: '2026-09-01', room_id: R, planned_check_out: '2026-12-01' });
    t.eq('Ở dài (dự kiến trả sau ngưỡng) vẫn cấp số', rF.json && rF.json.contract_no, so(N + 3));

    // ── Phòng an ninh không ký gì -> không cấp ─────────────────────────────────────────────
    const AN = await mkRoom('_AN', 'security');
    const D = await mkStu('_D', 'An Ninh D');
    const rD = await checkin(D, { date: '2026-09-02', room_id: AN });
    t.ok('Phòng an ninh KHÔNG cấp số', !(rD.json && rD.json.contract_no), String(rD.json && rD.json.contract_no));

    // ── Đã có số thì giữ nguyên, không cấp đè ──────────────────────────────────────────────
    const E = await mkStu('_E', 'Co So E', '77/2026/HĐKTX-TEST');
    const rE = await checkin(E, { date: '2026-09-03', room_id: R });
    t.eq('Hồ sơ đã có số giữ nguyên số cũ', rE.json && rE.json.contract_no, '77/2026/HĐKTX-TEST');
    t.ok('Không trả so_hd_moi khi không cấp', !(rE.json && rE.json.so_hd_moi));

    // ── Ngày dự kiến trả sai (trước ngày vào) bị chặn ──────────────────────────────────────
    const G = await mkStu('_G', 'Sai Ngay G');
    const rG = await checkin(G, { date: '2026-09-05', room_id: R, planned_check_out: '2026-09-01' });
    t.eq('Dự kiến trả trước ngày vào → 400', rG.status, 400, `HTTP ${rG.status}`);

    // ── Rác khuôn tên file KHÔNG được tính là số hợp đồng ──────────────────────────────────
    await mkStu('_rac', 'Rac Ten File', `${N + 900}.HDTP-${ent}`);
    t.eq('Chuỗi "NN.HDTP-XX" không phải số HĐ nên không vào phép đếm', (await keTiep()).json.seq, N + 4,
      `đếm được ${(await keTiep()).json.contract_no}`);

    // ── Số của NĂM KHÁC không ảnh hưởng dãy năm nay ────────────────────────────────────────
    await mkStu('_2025', 'Nam Truoc', so(N + 800, '2025'));
    t.eq('Số năm 2025 không đẩy dãy 2026 lên', (await keTiep()).json.seq, N + 4,
      `đếm được ${(await keTiep()).json.contract_no}`);
    t.eq('Hỏi số cho năm 2025 thì đếm theo dãy 2025', (await keTiep('2025-03-01')).json.seq, N + 801);

    // ── BẪY CHỮ Đ/D: số cũ viết "HDKTX" (chữ D) phải được ĐẾM CHUNG ────────────────────────
    // Postgres so khớp chính xác: khuôn chữ Đ không thấy số chữ D. Đếm sót là cấp trùng số đã ký.
    const CU = N + 50;
    await mkStu('_chuD', 'So Viet Chu D', `${CU}/2026/HDKTX-${ent}`);
    t.eq('Gợi ý NHÌN THẤY số viết chữ D thường', (await keTiep()).json.seq, CU + 1,
      `gợi ý ${(await keTiep()).json.contract_no} trong khi đang có ${CU}/2026/HDKTX-${ent}`);

    const H = await mkStu('_H', 'Noi Tiep H');
    const rH = await checkin(H, { date: '2026-09-06', room_id: R });
    t.eq('Cấp số khi xác nhận cũng thấy số chữ D, không cấp trùng', rH.json && rH.json.contract_no, so(CU + 1),
      String(rH.json && rH.json.contract_no));
  },
};
