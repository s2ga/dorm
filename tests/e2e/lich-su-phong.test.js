// BL-102: chi tiết PHÒNG phải có lịch sử ra/vào — ai đã rời thì trước nay biến mất khỏi màn hình.
// Hai điều kiện sống còn: hồ sơ ĐÃ KHOÁ vẫn phải nằm trong lịch sử (036b939 — bỏ họ là lệch tiền
// điện chia theo ngày ở), và chuyển phòng phải phân biệt được với trả phòng hẳn.
const P = '__test_lsp';

async function clean(db) {
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Lịch sử ra/vào theo PHÒNG (BL-102)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;
    const mkRoom = async n => (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type)
       VALUES ($1,$2,4,'male','B',1200000,'shared') RETURNING id`, [P + n, fac])).rows[0].id;
    const mkStu = async n => (await t.db.query(
      `INSERT INTO students (code,name,gender,check_in_date,status,rental_type,residency_status)
       VALUES ($1,$1,'male','2026-05-01','in','ghep','unregistered') RETURNING id`, [P + n])).rows[0].id;
    const stay = (sid, rid, f, tt) => t.db.query(
      `INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,$3,$4)`, [sid, rid, f, tt]);
    const lichSu = async rid => {
      const r = await t.api('GET', `/api/rooms/${rid}/stays`, T);
      return { status: r.status, rows: (r.json || {}).stays || [] };
    };

    const A = await mkRoom('_A'), B = await mkRoom('_B');
    const dangO = await mkStu('_dangO');      // còn ở phòng A
    const daRoi = await mkStu('_daRoi');      // đã rời hẳn phòng A
    const chuyen = await mkStu('_chuyen');    // rời A sang B
    const khoa = await mkStu('_khoa');        // đã ở A, hồ sơ bị khoá

    await stay(dangO, A, '2026-05-01', null);
    await stay(daRoi, A, '2026-05-01', '2026-06-15');
    await stay(chuyen, A, '2026-05-01', '2026-06-30');
    await stay(chuyen, B, '2026-07-01', null);
    await stay(khoa, A, '2026-04-01', '2026-05-20');
    await t.db.query('UPDATE students SET deleted_at=now() WHERE id=$1', [khoa]);

    const ls = await lichSu(A);
    t.eq('GET /api/rooms/:id/stays → 200', ls.status, 200, `HTTP ${ls.status}`);
    t.eq('Phòng A có đủ 4 lượt ở, kể cả người đã rời', ls.rows.length, 4, `đếm được ${ls.rows.length}`);

    const cua = sid => ls.rows.find(x => x.student_id === sid);
    t.ok('Người ĐÃ RỜI vẫn còn trong lịch sử', !!cua(daRoi), 'không thấy');
    t.eq('Ngày rời đúng', cua(daRoi) && cua(daRoi).to_date, '2026-06-15');
    t.eq('Người đang ở để trống ngày rời', cua(dangO) && cua(dangO).to_date, null);

    // ── Hồ sơ đã KHOÁ vẫn phải có mặt (036b939) ──────────────────────────────────────
    t.ok('Hồ sơ đã KHOÁ vẫn nằm trong lịch sử phòng', !!cua(khoa), 'bị lọc mất — sẽ lệch tiền điện');
    t.eq('Có cờ đánh dấu hồ sơ đã khoá để người xem biết', cua(khoa) && cua(khoa).da_khoa, true);
    t.ok('Vẫn trả tên học viên đã khoá', !!(cua(khoa) || {}).student_name, 'tên rỗng');

    // ── Chuyển phòng khác trả phòng hẳn ──────────────────────────────────────────────
    t.eq('Rời A rồi vào B ngay hôm sau → đánh dấu CHUYỂN PHÒNG', cua(chuyen) && cua(chuyen).chuyen_phong, true);
    t.eq('Nói rõ chuyển sang phòng nào', cua(chuyen) && cua(chuyen).phong_ke, P + '_B');
    t.eq('Rời hẳn thì KHÔNG phải chuyển phòng', cua(daRoi) && cua(daRoi).chuyen_phong, false,
      'trả phòng hẳn mà bị gắn nhãn chuyển phòng');
    t.eq('Người đang ở cũng không phải chuyển phòng', cua(dangO) && cua(dangO).chuyen_phong, false);

    // ── TRẢ PHÒNG HẲN rồi hôm sau vào phòng khác: KHÔNG phải chuyển phòng ────────────
    // Chỉ nhìn ngày thì hai ca giống hệt nhau; phân biệt bằng nhật ký 'out'.
    const C = await mkRoom('_C');
    const quayLai = await mkStu('_quayLai');
    await stay(quayLai, A, '2026-05-01', '2026-06-30');
    await stay(quayLai, C, '2026-07-01', null);
    await t.db.query(
      `INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out','2026-06-30',$2,'Check-out','admin')`,
      [quayLai, A]);
    const ls2 = await lichSu(A);
    const dongQuayLai = ls2.rows.find(x => x.student_id === quayLai);
    t.eq('Có nhật ký trả phòng → KHÔNG gắn nhãn chuyển phòng', dongQuayLai && dongQuayLai.chuyen_phong, false,
      'trả phòng hẳn rồi quay lại mà bị coi là chuyển phòng');
    t.ok('Và không nêu phòng kế tiếp', !(dongQuayLai || {}).phong_ke, String((dongQuayLai || {}).phong_ke));

    // ── Lượt CHỒNG NGÀY (dữ liệu hỏng) không được khoác áo chuyển phòng ─────────────
    const chongNgay = await mkStu('_chongNgay');
    await stay(chongNgay, A, '2026-06-01', '2026-06-30');
    await stay(chongNgay, C, '2026-06-30', null);   // trùng ngày 30/06 ở hai phòng
    const ls3 = await lichSu(A);
    const dongChong = ls3.rows.find(x => x.student_id === chongNgay);
    t.eq('Lượt chồng ngày KHÔNG được dán nhãn chuyển phòng để trông bình thường',
      dongChong && dongChong.chuyen_phong, false, 'dữ liệu hỏng bị che bằng nhãn hợp lệ');

    // ── Mới nhất TRƯỚC ─────────────────────────────────────────────────────────────
    const ngay = ls.rows.map(x => x.from_date);
    t.ok('Sắp xếp mới nhất trước', ngay.join() === [...ngay].sort().reverse().join(), ngay.join(' · '));

    // ── Phòng B chỉ có lượt của người chuyển sang ────────────────────────────────────
    const lsB = await lichSu(B);
    t.eq('Phòng B có đúng 1 lượt', lsB.rows.length, 1, `đếm được ${lsB.rows.length}`);
    t.eq('Đúng người đã chuyển sang', lsB.rows[0] && lsB.rows[0].student_id, chuyen);

    // ── Màn HỌC VIÊN cũng phải biết đâu là chuyển phòng ─────────────────────────────
    const hv = await t.api('GET', `/api/students/${chuyen}/stays`, T);
    t.eq('GET /api/students/:id/stays → 200', hv.status, 200, `HTTP ${hv.status}`);
    const luotA = ((hv.json || {}).stays || []).find(x => x.room_id === A);
    t.eq('Lượt ở phòng A của học viên được đánh dấu chuyển phòng', luotA && luotA.chuyen_phong, true);
    t.eq('Và nói rõ chuyển sang phòng nào', luotA && luotA.phong_ke, P + '_B');

    // ── Phòng không tồn tại ─────────────────────────────────────────────────────────
    const ma = await t.api('GET', '/api/rooms/99999999/stays', T);
    t.ok('Phòng không có thật → không phải lỗi máy chủ', ma.status < 500, `HTTP ${ma.status}`);
  },
};
