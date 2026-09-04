// SỐ HỢP ĐỒNG — hai luật chủ dự án chốt 04/08/2026:
// · Số đã cấp thì KHÔNG cấp lại. Khoá hồ sơ giữ số cao nhất cũng không làm dãy lùi.
// · Tham chiếu HĐ chỉ áp cho phòng THUÊ TRỌN; phòng ghép mỗi người ký riêng.
const P = '__test_sohd';

async function clean(db) {
  await db.query(`DELETE FROM room_leaders WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs         WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Số hợp đồng — không cấp lại số đã cấp · tham chiếu chỉ cho phòng thuê trọn',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    const mkRoom = async (n, loai) => (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,4,'male','B',1200000,$3) RETURNING id`, [P + n, fac, loai])).rows[0].id;
    const mkStu = async (n, room, soHD) => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,contract_no)
       VALUES ($1,$1,'male',$2,'2026-07-01','in','ghep','unregistered',$3) RETURNING id`,
      [P + n, room, soHD || ''])).rows[0].id;
    const keTiep = async sid => {
      const q = `/api/students/contract-no/next?gender=male${sid ? '&student_id=' + sid : ''}`;
      return t.api('GET', q, T);
    };
    const dsHV = async id => {
      const r = await t.api('GET', '/api/students', T);
      return (r.json.rows || r.json || []).find(x => x.id === id);
    };

    // ── Pháp nhân lấy từ chính máy chủ, không đoán theo hằng số ────────────────────────
    const goc = await keTiep(null);
    t.eq('Hỏi số kế tiếp (không kèm hồ sơ) → 200', goc.status, 200, `HTTP ${goc.status}`);
    const ent = goc.json && goc.json.entity;
    t.ok('Máy chủ trả pháp nhân', !!ent, JSON.stringify(goc.json));
    const nam = new Date().getFullYear();
    const so = n => `${n}/${nam}/HDKTX-${ent}`;

    // ── Khoá hồ sơ giữ số cao nhất KHÔNG được làm dãy lùi ──────────────────────────────
    const R = await mkRoom('_R', 'shared');
    const A = await mkStu('_A', R, so(900));
    const truoc = await keTiep(null);
    t.eq('Số kế tiếp nối tiếp số cao nhất đang có', truoc.json && truoc.json.seq, 901,
      JSON.stringify(truoc.json));

    const khoa = await t.api('DELETE', `/api/students/${A}`, T, { reason: 'Thử nghiệm' });
    t.eq('Khoá hồ sơ → 200', khoa.status, 200, `HTTP ${khoa.status}`);
    const sau = await keTiep(null);
    t.eq('Khoá hồ sơ KHÔNG làm dãy số lùi — số đã cấp không cấp lại', sau.json && sau.json.seq, 901,
      `sau khi khoá lại ra ${sau.json && sau.json.seq}`);

    // ── Hỏi số cho MỘT hồ sơ cụ thể phải chạy được (câu SQL từng vỡ, mọi lần gọi đều 500) ──
    const B = await mkStu('_B', R, '');
    const rieng = await keTiep(B);
    t.eq('Hỏi số kèm student_id → 200, không phải lỗi máy chủ', rieng.status, 200,
      `HTTP ${rieng.status} ${rieng.json && rieng.json.error || ''}`);
    t.ok('Trả về đúng khuôn NN/YYYY/HDKTX-XX', /^[0-9]+\/[0-9]{4}\/HDKTX-.+$/.test(rieng.json && rieng.json.contract_no || ''),
      JSON.stringify(rieng.json));

    // ── Mỗi hồ sơ chưa có HĐ nhận một số KHÁC nhau ─────────────────────────────────────
    const C = await mkStu('_C', R, '');
    const soB = (await keTiep(B)).json.contract_no;
    const soC = (await keTiep(C)).json.contract_no;
    t.ok('Hai hồ sơ chưa có HĐ nhận hai số khác nhau', soB !== soC, `B=${soB} C=${soC}`);

    // ── Tham chiếu HĐ: phòng THUÊ TRỌN thì thành viên trỏ về HĐ của phòng trưởng ───────
    const W = await mkRoom('_W', 'whole');
    const WL = await mkStu('_WL', W, so(910));
    const WM = await mkStu('_WM', W, '');
    await t.api('POST', `/api/rooms/${W}/leader`, T, { student_id: WL, date: '2026-07-01' });
    const wm = await dsHV(WM);
    t.eq('Phòng thuê trọn: thành viên trỏ về số HĐ của phòng trưởng', wm && wm.contract_ref_no, so(910),
      JSON.stringify(wm && wm.contract_ref_no));

    // ── Phòng GHÉP thì KHÔNG tham chiếu — mỗi người ký hợp đồng riêng ──────────────────
    const S = await mkRoom('_S', 'shared');
    const SL = await mkStu('_SL', S, so(920));
    const SM = await mkStu('_SM', S, '');
    await t.api('POST', `/api/rooms/${S}/leader`, T, { student_id: SL, date: '2026-07-01' });
    const sm = await dsHV(SM);
    t.ok('Phòng ghép: KHÔNG gán HĐ của phòng trưởng cho thành viên', !(sm && sm.contract_ref_no),
      `nhận được ${sm && sm.contract_ref_no}`);

    // ── "x" là di sản trước khi có hệ thống, không phải số HĐ để trỏ về ────────────────
    const X = await mkRoom('_X', 'whole');
    const XL = await mkStu('_XL', X, 'x');
    const XM = await mkStu('_XM', X, '');
    await t.api('POST', `/api/rooms/${X}/leader`, T, { student_id: XL, date: '2026-07-01' });
    const xm = await dsHV(XM);
    t.ok('Phòng trưởng mang "x" thì không có gì để tham chiếu', !(xm && xm.contract_ref_no),
      `nhận được ${xm && xm.contract_ref_no}`);
  },
};
