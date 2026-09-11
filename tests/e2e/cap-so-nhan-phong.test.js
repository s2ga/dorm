// Cấp số HĐ lúc xác nhận nhận phòng (owner chốt 10/09/2026): MAX+1 của dãy NN.HDTP-XX, ngày ký =
// ngày nhận phòng, kèm tên file scan chuẩn. Không cấp: ở ngắn dưới ngưỡng / phòng an ninh / đã có số.
const P = '__test_capso';

async function clean(db) {
  await db.query(`DELETE FROM room_leaders WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs         WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Cấp số HĐ khi xác nhận nhận phòng — chuẩn giấy NN.HDTP-XX',
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

    const goc = (await t.api('GET', '/api/students/contract-no/next?gender=male', T)).json;
    const ent = goc.entity;
    t.ok('Máy chủ trả pháp nhân nam', !!ent, JSON.stringify(goc));
    const R = await mkRoom('_R', 'shared');
    // Chiếm số CAO HƠN MAX hiện có của CSDL thử (kể cả rác của bộ test khác) để phép đếm là của mình.
    const N = (goc.seq || 1) + 99;
    const so = n => `${n}.HDTP-${ent}`;
    await mkStu('_moi', 'Moi day so', so(N));

    // ── Xác nhận là cấp số nối tiếp + ngày ký + tên file chuẩn (tên bỏ dấu, Đ -> D) ────────
    const A = await mkStu('_A', 'Đặng Văn Ú');
    const rA = await checkin(A, { date: '2026-09-05', room_id: R });
    t.eq('Xác nhận nhận phòng → 200', rA.status, 200, `HTTP ${rA.status} ${rA.json && rA.json.error || ''}`);
    t.eq('Cấp số nối tiếp MAX của dãy', rA.json && rA.json.contract_no, so(N + 1), JSON.stringify(rA.json && rA.json.contract_no));
    t.eq('Trả so_hd_moi cho frontend hiện', rA.json && rA.json.so_hd_moi, so(N + 1));
    t.eq('Tên file chuẩn: SỐ_NGÀY-NHẬN-PHÒNG_TÊN-KHÔNG-DẤU', rA.json && rA.json.ten_file_hd,
      `${so(N + 1)}_20260905_DANG VAN U`);
    t.ok('Ngày ký = ngày nhận phòng', String(rA.json && rA.json.contract_date || '').slice(0, 10) === '2026-09-05',
      String(rA.json && rA.json.contract_date));

    // ── Người xác nhận sau lấy số sau (cùng ngày hay khác ngày đều nối tiếp thứ tự bấm) ────
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
    const E = await mkStu('_E', 'Co So E', '77.HDTP-TEST');
    const rE = await checkin(E, { date: '2026-09-03', room_id: R });
    t.eq('Hồ sơ đã có số giữ nguyên số cũ', rE.json && rE.json.contract_no, '77.HDTP-TEST');
    t.ok('Không trả so_hd_moi khi không cấp', !(rE.json && rE.json.so_hd_moi));

    // ── Ngày dự kiến trả sai (trước ngày vào) bị chặn ──────────────────────────────────────
    const G = await mkStu('_G', 'Sai Ngay G');
    const rG = await checkin(G, { date: '2026-09-05', room_id: R, planned_check_out: '2026-09-01' });
    t.eq('Dự kiến trả trước ngày vào → 400', rG.status, 400, `HTTP ${rG.status}`);

    // ── Số lưu dạng CŨ "NN/YYYY/HDKTX-XX" phải được ĐẾM CHUNG một dãy ─────────────────────
    // Dữ liệu thật toàn dạng cũ; bỏ sót là cấp lại từ 01, trùng số hợp đồng giấy đã ký.
    const CU = N + 50;
    await mkStu('_cu', 'So Dang Cu', `${CU}/2026/HDKTX-${ent}`);
    const hoi = await t.api('GET', '/api/students/contract-no/next?gender=male', T);
    t.eq('Gợi ý số kế tiếp NHÌN THẤY số dạng cũ', hoi.json && hoi.json.seq, CU + 1,
      `gợi ý ${hoi.json && hoi.json.contract_no} trong khi dạng cũ đang có ${CU}`);

    const H = await mkStu('_H', 'Noi Tiep H');
    const rH = await checkin(H, { date: '2026-09-06', room_id: R });
    t.eq('Cấp số khi xác nhận cũng nối tiếp dãy cũ, không quay về 01', rH.json && rH.json.contract_no, so(CU + 1),
      String(rH.json && rH.json.contract_no));
  },
};
