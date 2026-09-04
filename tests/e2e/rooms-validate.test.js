// Luật xếp phòng + kiểm dữ liệu đầu vào.
// Lưu ý nghiệp vụ đã CHỐT 15/07/2026: XẾP QUÁ TẢI LÀ ĐƯỢC PHÉP (HV vào ở chờ bạn xuất cảnh).
// App phải CẢNH BÁO + bắt xác nhận + ghi vết, TUYỆT ĐỐI KHÔNG chặn.
const P = '__test_room';

async function clean(db) {
  await db.query(`DELETE FROM invoices   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs       WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM audit_log  WHERE detail LIKE '%${P}%'`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Luật xếp phòng & kiểm dữ liệu đầu vào',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    try {
      // Phòng NỮ, sức chứa 2
      const rNu = (await t.db.query(
        `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,2,'female','B',1000000) RETURNING id`,
        [P + '_nu', fac])).rows[0].id;

      // ===== TC-21: nam vào phòng nữ -> phải CHẶN (đây là chặn thật, không phải cảnh báo)
      const nam = await t.api('POST', '/api/students', T, { code: P + '_nam', name: 'Test Nam', gender: 'male', room_id: rNu, check_in_date: '2026-07-01', rental_type: 'ghep' });
      t.ok('TC-21 · xếp NAM vào phòng NỮ → phải CHẶN', nam.status === 400, `HTTP ${nam.status} — ${nam.json && nam.json.error}`);

      // ===== Xếp đủ 2 người nữ
      const ids = [];
      for (const n of ['_n1', '_n2']) {
        const r = await t.api('POST', '/api/students', T, { code: P + n, name: 'Test ' + n, gender: 'female', room_id: rNu, check_in_date: '2026-07-01', rental_type: 'ghep' });
        t.eq(`Xếp người ${n} vào phòng còn chỗ → OK`, r.status, 201, `HTTP ${r.status} ${r.json && r.json.error || ''}`);
        if (r.json && r.json.id) ids.push(r.json.id);
      }

      // ===== TC-22: người thứ 3 vào phòng 2 chỗ -> CẢNH BÁO + hỏi xác nhận (KHÔNG chặn — nghiệp vụ cho phép)
      const over = await t.api('POST', '/api/students', T, { code: P + '_n3', name: 'Test n3', gender: 'female', room_id: rNu, check_in_date: '2026-07-01', rental_type: 'ghep' });
      t.ok('TC-22 · người thứ 3 vào phòng 2 chỗ → phải hỏi XÁC NHẬN (409), KHÔNG được chặn thẳng',
        over.status === 409 && over.json && over.json.needs_confirm === true,
        `HTTP ${over.status} — ${over.json && over.json.error}`);
      t.ok('TC-22 · lời cảnh báo phải nói rõ vượt bao nhiêu người',
        !!(over.json && over.json.warnings && over.json.warnings[0] && over.json.warnings[0].over_by === 1),
        JSON.stringify(over.json && over.json.warnings));

      const okOver = await t.api('POST', '/api/students', T, { code: P + '_n3', name: 'Test n3', gender: 'female', room_id: rNu, check_in_date: '2026-07-01', rental_type: 'ghep', confirm_overload: true });
      t.eq('TC-22 · xác nhận rồi → PHẢI cho xếp (HV vào ở chờ bạn xuất cảnh)', okOver.status, 201, `HTTP ${okOver.status} ${okOver.json && okOver.json.error || ''}`);
      if (okOver.json && okOver.json.id) ids.push(okOver.json.id);

      const vet = (await t.db.query(`SELECT detail, username FROM audit_log WHERE detail LIKE '%QUÁ TẢI%' AND detail LIKE '%${P}%' ORDER BY id DESC LIMIT 1`)).rows[0];
      t.ok('TC-23 · xếp quá tải PHẢI ghi vết: ai xếp, HV nào, phòng nào, vượt mấy người',
        !!vet && /vượt 1 người/.test(vet.detail), vet ? `[${vet.username}] ${vet.detail}` : 'KHÔNG ghi vết gì');

      // ===== Thuê nguyên phòng vào phòng đã có người -> CHẶN
      const rP = (await t.api('POST', '/api/students', T, { code: P + '_np', name: 'Test np', gender: 'female', room_id: rNu, check_in_date: '2026-07-01', rental_type: 'phong' }));
      t.ok('Thuê NGUYÊN PHÒNG vào phòng đang có người → phải CHẶN', rP.status === 400, `HTTP ${rP.status} — ${rP.json && rP.json.error}`);

      // ===== Người ghép vào phòng ĐANG cho thuê nguyên: CẢNH BÁO + xác nhận, KHÔNG chặn (owner 28/08 —
      // BQL vẫn quản người ra vào phòng thuê nguyên; người vào là thành viên theo HĐ, phiếu 0đ).
      const rWhole = (await t.db.query(
        `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee, room_type) VALUES ($1,$2,4,'female','B',1000000,'whole') RETURNING id`,
        [P + '_whole', fac])).rows[0].id;
      const chuHD = await t.api('POST', '/api/students', T, { code: P + '_chuhd', name: 'Test chủ HĐ', gender: 'female', room_id: rWhole, check_in_date: '2026-07-01', rental_type: 'phong' });
      t.eq('Thuê NGUYÊN PHÒNG vào phòng trống → OK', chuHD.status, 201, `HTTP ${chuHD.status} ${chuHD.json && chuHD.json.error || ''}`);
      const oChung = await t.api('POST', '/api/students', T, { code: P + '_ochung', name: 'Test ở chung', gender: 'female', room_id: rWhole, check_in_date: '2026-07-01', rental_type: 'ghep' });
      t.ok('Người ghép vào phòng thuê nguyên → hỏi XÁC NHẬN (409), KHÔNG chặn thẳng',
        oChung.status === 409 && oChung.json && oChung.json.needs_confirm === true,
        `HTTP ${oChung.status} — ${oChung.json && oChung.json.error}`);
      t.eq('Cảnh báo mang mã VAO_PHONG_NGUYEN', oChung.json && oChung.json.warnings && oChung.json.warnings[0] && oChung.json.warnings[0].code, 'VAO_PHONG_NGUYEN');
      t.ok('Lời cảnh báo nói rõ ở chung theo hợp đồng của ai', /HĐ|hợp đồng/.test((oChung.json && oChung.json.error) || ''), oChung.json && oChung.json.error);
      const okChung = await t.api('POST', '/api/students', T, { code: P + '_ochung', name: 'Test ở chung', gender: 'female', room_id: rWhole, check_in_date: '2026-07-01', rental_type: 'ghep', confirm_overload: true });
      t.eq('Xác nhận rồi → PHẢI cho xếp vào phòng thuê nguyên', okChung.status, 201, `HTTP ${okChung.status} ${okChung.json && okChung.json.error || ''}`);
      const vetNP = (await t.db.query(`SELECT detail FROM audit_log WHERE detail LIKE '%VÀO PHÒNG THUÊ NGUYÊN%' AND detail LIKE '%${P}%' ORDER BY id DESC LIMIT 1`)).rows[0];
      t.ok('Xếp vào phòng thuê nguyên PHẢI ghi vết vào nhật ký', !!vetNP, vetNP ? vetNP.detail : 'KHÔNG ghi vết gì');
      // Chuyển phòng sang phòng thuê nguyên cũng đi cùng luật: 409 rồi xác nhận mới 200
      const tr1 = await t.api('POST', `/api/students/${ids[1]}/transfer`, T, { room_id: rWhole, date: '2026-07-10' });
      t.eq('Chuyển phòng sang phòng thuê nguyên → 409 chờ xác nhận', tr1.status, 409, `HTTP ${tr1.status} ${tr1.json && tr1.json.error || ''}`);
      const tr2 = await t.api('POST', `/api/students/${ids[1]}/transfer`, T, { room_id: rWhole, date: '2026-07-10', confirm_overload: true });
      t.eq('Xác nhận → chuyển được', tr2.status, 200, `HTTP ${tr2.status} ${tr2.json && tr2.json.error || ''}`);

      // ===== N-01: gửi SAI TÊN TRƯỜNG khi trả phòng -> phải báo lỗi, KHÔNG được nuốt im lặng
      const bad = await t.api('POST', `/api/students/${ids[0]}/checkout`, T, { check_out_date: '2026-07-20', reason: 'personal' });
      t.ok('N-01 · gửi "check_out_date" (sai tên) → phải BÁO LỖI, không được âm thầm lấy ngày hôm nay',
        bad.status === 400, `HTTP ${bad.status} — ${bad.json && bad.json.error}`);

      // ===== Ngày trả phòng trước ngày nhận phòng
      const truoc = await t.api('POST', `/api/students/${ids[0]}/checkout`, T, { date: '2026-06-01', reason: 'personal' });
      t.ok('Ngày trả phòng TRƯỚC ngày nhận phòng → phải CHẶN', truoc.status === 400, `HTTP ${truoc.status} — ${truoc.json && truoc.json.error}`);

      // ===== Ngày không có thật / sai định dạng
      for (const d of ['2026-02-30', '2026-13-01', 'hôm qua', '01/07/2026']) {
        const r = await t.api('POST', `/api/students/${ids[0]}/checkout`, T, { date: d, reason: 'personal' });
        t.ok(`Ngày trả phòng "${d}" không hợp lệ → phải CHẶN`, r.status === 400, `HTTP ${r.status} — ${r.json && r.json.error}`);
      }

      // ===== Số điện thoại rác
      for (const p of ['abc', '123', '0'.repeat(20)]) {
        const r = await t.api('POST', '/api/students', T, { code: P + '_sdt', name: 'Test sdt', gender: 'female', phone: p, check_in_date: '2026-07-01', rental_type: 'ghep' });
        t.ok(`Số điện thoại "${p.slice(0, 12)}" → phải CHẶN`, r.status === 400, `HTTP ${r.status} — ${r.json && r.json.error}`);
      }

      // ===== TC-06: HV rời đi thì phiếu các KỲ SAU phải bị dọn, không đòi tiền người không còn ở
      await t.db.query(`INSERT INTO invoices (student_id, month, total, status) VALUES ($1,'2026-09',999000,'unpaid')`, [ids[0]]);
      const co = await t.api('POST', `/api/students/${ids[0]}/checkout`, T, { date: '2026-07-20', reason: 'personal' });
      t.ok('TC-06 · trả phòng 07/2026 → phiếu tháng 09/2026 phải bị dọn',
        co.status === 200 && (co.json.dropped_future_invoices || []).includes('2026-09'),
        'đã dọn: ' + JSON.stringify(co.json && co.json.dropped_future_invoices));

      // ===== TC-03: tiền âm
      const am = await t.api('POST', '/api/invoices', T, { student_id: ids[1], month: '2026-07', room_charge: -500000 });
      t.ok('TC-03 · lập phiếu với tiền phòng ÂM → phải CHẶN', am.status === 400, `HTTP ${am.status} — ${am.json && am.json.error}`);

      // ===== TC-30: xoá phòng còn người ở
      const del = await t.api('DELETE', `/api/rooms/${rNu}`, T);
      t.ok('TC-30 · xoá phòng còn người đang ở → phải CHẶN', del.status === 400, `HTTP ${del.status} — ${del.json && del.json.error}`);

      // ===== Sức chứa vô lý
      for (const c of [-1, 999]) {
        const r = await t.api('POST', '/api/rooms', T, { name: P + '_sc', facility_id: fac, capacity: c, gender: 'female' });
        t.ok(`Sức chứa phòng = ${c} → phải CHẶN`, r.status === 400, `HTTP ${r.status} — ${r.json && r.json.error}`);
      }
    } finally {
      await clean(t.db);
    }
  },
};
