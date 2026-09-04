// PHÒNG TRƯỞNG + giảm tiền phòng theo % (sếp chốt 15/07/2026).
// Mỗi phòng 1 phòng trưởng, được MIỄN tiền nước + phí dịch vụ theo tỉ lệ số ngày làm.
// Quản lý KTX ở phòng 104 được giảm 50% tiền phòng.
const { fmt } = require('../lib/harness');

const M = '2026-07';
const P = '__test_pt';

async function clean(db) {
  await db.query(`DELETE FROM invoices     WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_leaders WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM room_stays   WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM logs         WHERE student_id IN (SELECT id FROM students WHERE code LIKE '${P}%')`);
  await db.query(`DELETE FROM students WHERE code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms    WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Phòng trưởng — miễn nước + dịch vụ · giảm tiền phòng theo %',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const fac = (await t.db.query('SELECT id FROM facilities LIMIT 1')).rows[0].id;

    const mkRoom = async n => (await t.db.query(
      `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'female','B',1200000) RETURNING id`,
      [P + n, fac])).rows[0].id;
    const mkStu = async (n, room, pct) => (await t.db.query(
      `INSERT INTO students (code,name,gender,room_id,check_in_date,status,rental_type,residency_status,room_fee_discount_pct)
       VALUES ($1,$1,'female',$2,'2026-07-01','in','ghep','unregistered',$3) RETURNING id`, [P + n, room, pct || 0])).rows[0].id;
    const stay = (id, room) => t.db.query(`INSERT INTO room_stays (student_id,room_id,from_date,to_date) VALUES ($1,$2,'2026-07-01',NULL)`, [id, room]);
    const inv = async id => (await t.db.query(
      `SELECT * FROM invoices WHERE month=$1 AND student_id=$2 AND deleted_at IS NULL`, [M, id])).rows[0];

    try {
      const R = await mkRoom('_R'), R2 = await mkRoom('_R2');
      const A = await mkStu('_A', R), B = await mkStu('_B', R);
      for (const id of [A, B]) await stay(id, R);

      // ===== Cử phòng trưởng
      const set = await t.api('POST', `/api/rooms/${R}/leader`, T, { student_id: A, date: '2026-07-01' });
      t.ok('Cử phòng trưởng → OK', set.status === 200, `HTTP ${set.status} — ${set.json && set.json.error || ''}`);

      const g = await t.api('POST', '/api/invoices/generate', T, { month: M });
      t.ok('Lập phiếu cả kỳ chạy được', g.status === 200, `HTTP ${g.status}`);

      const iA = await inv(A), iB = await inv(B);
      t.eq('Phòng trưởng · giảm đúng 150.000 (nước 100.000 + dịch vụ 50.000)', Number(iA.leader_discount), 150000, `giảm ${fmt(iA.leader_discount)}`);
      t.eq('Phòng trưởng · nước + dịch vụ thực trả = 0 (miễn hẳn)',
        Number(iA.water_charge) + Number(iA.service_charge) - Number(iA.leader_discount), 0);
      t.eq('Phòng trưởng · phiếu VẪN ghi tiền nước 100.000 để thấy được ưu đãi', Number(iA.water_charge), 100000);
      t.eq('Bạn cùng phòng · không được giảm', Number(iB.leader_discount), 0);
      t.eq('Phòng trưởng trả ít hơn bạn cùng phòng đúng 150.000', Number(iB.total) - Number(iA.total), 150000,
        `phòng trưởng ${fmt(iA.total)} · bạn cùng phòng ${fmt(iB.total)}`);

      // ===== Mỗi phòng CHỈ 1 phòng trưởng
      const set2 = await t.api('POST', `/api/rooms/${R}/leader`, T, { student_id: B, date: '2026-07-21' });
      t.ok('Cử người mới → OK và tự kết thúc nhiệm kỳ người cũ', set2.status === 200, `HTTP ${set2.status}`);
      const n = (await t.db.query(`SELECT COUNT(*)::int c FROM room_leaders WHERE room_id=$1 AND to_date IS NULL`, [R])).rows[0].c;
      t.eq('Sau khi đổi · phòng CHỈ còn ĐÚNG 1 phòng trưởng đương nhiệm', n, 1);
      const oldTerm = (await t.db.query(`SELECT to_date FROM room_leaders WHERE room_id=$1 AND student_id=$2`, [R, A])).rows[0];
      t.eq('Người cũ · nhiệm kỳ kết thúc hết ngày hôm trước (20/07)', oldTerm.to_date, '2026-07-20');

      t.ok('Đổi phòng trưởng → tự tính lại phiếu cho CẢ HAI người',
        set2.json && (set2.json.recalced || []).includes(A) && (set2.json.recalced || []).includes(B),
        'tính lại cho: ' + JSON.stringify(set2.json && set2.json.recalced));

      const iA2 = await inv(A), iB2 = await inv(B);
      // A làm 1→20 (20 ngày), B làm 21→31 (11 ngày), tháng 31 ngày
      t.eq('Đổi giữa tháng · A làm 20/31 ngày → giảm 96.774', Number(iA2.leader_discount), Math.round(150000 * 20 / 31), `giảm ${fmt(iA2.leader_discount)}`);
      t.eq('Đổi giữa tháng · B làm 11/31 ngày → giảm 53.226', Number(iB2.leader_discount), Math.round(150000 * 11 / 31), `giảm ${fmt(iB2.leader_discount)}`);
      t.ok('Đổi giữa tháng · tổng giảm ≈ ĐÚNG 1 suất, KHÔNG phát thành 2 suất',
        Math.abs(Number(iA2.leader_discount) + Number(iB2.leader_discount) - 150000) <= 1,
        `tổng ${fmt(Number(iA2.leader_discount) + Number(iB2.leader_discount))} · phải ≈ 150.000`);

      // ===== Cử bậy → phải chặn
      const out = await mkStu('_NGOAI', R2); await stay(out, R2);
      const bad1 = await t.api('POST', `/api/rooms/${R}/leader`, T, { student_id: out, date: '2026-07-01' });
      t.ok('Cử người KHÔNG ở phòng này làm phòng trưởng → phải CHẶN', bad1.status === 400, `HTTP ${bad1.status} — ${bad1.json && bad1.json.error}`);
      const bad2 = await t.api('POST', `/api/rooms/${R}/leader`, T, { student_id: 999999, date: '2026-07-01' });
      t.ok('Cử học viên không tồn tại → phải CHẶN', bad2.status === 400, `HTTP ${bad2.status} — ${bad2.json && bad2.json.error}`);
      const bad3 = await t.api('POST', `/api/rooms/${R}/leader`, T, { student_id: A, date: '2026-02-30' });
      t.ok('Ngày nhận nhiệm vụ không có thật (30/02) → phải CHẶN', bad3.status === 400, `HTTP ${bad3.status} — ${bad3.json && bad3.json.error}`);
      const bad4 = await t.api('POST', `/api/rooms/${R}/leader`, T, {});
      t.ok('Không chọn ai → phải CHẶN', bad4.status === 400, `HTTP ${bad4.status} — ${bad4.json && bad4.json.error}`);

      // ===== Phòng trưởng TRẢ PHÒNG → phải thôi làm, không được miễn tiền vĩnh viễn
      const co = await t.api('POST', `/api/students/${B}/checkout`, T, { date: '2026-07-25', reason: 'personal' });
      t.ok('Phòng trưởng trả phòng → OK', co.status === 200, `HTTP ${co.status}`);
      const still = (await t.db.query(`SELECT COUNT(*)::int c FROM room_leaders WHERE student_id=$1 AND to_date IS NULL`, [B])).rows[0].c;
      t.eq('Trả phòng → nhiệm kỳ phòng trưởng PHẢI đóng (nếu không: miễn tiền vĩnh viễn)', still, 0);
      const free = (await t.db.query(`SELECT COUNT(*)::int c FROM room_leaders WHERE room_id=$1 AND to_date IS NULL`, [R])).rows[0].c;
      t.eq('Trả phòng → phòng không còn phòng trưởng, cử được người mới', free, 0);

      const reset = await t.api('POST', `/api/rooms/${R}/leader`, T, { student_id: A, date: '2026-07-26' });
      t.eq('Cử lại phòng trưởng mới sau khi người cũ trả phòng → OK', reset.status, 200, `HTTP ${reset.status} — ${reset.json && reset.json.error || ''}`);

      // ===== Miễn nhiệm
      const del = await t.api('DELETE', `/api/rooms/${R}/leader?date=2026-07-28`, T);
      t.ok('Miễn nhiệm phòng trưởng → OK', del.status === 200, `HTTP ${del.status}`);
      const del2 = await t.api('DELETE', `/api/rooms/${R}/leader`, T);
      t.ok('Miễn nhiệm khi phòng CHƯA có phòng trưởng → báo lỗi rõ ràng', del2.status === 404, `HTTP ${del2.status} — ${del2.json && del2.json.error}`);

      // ===== GIẢM TIỀN PHÒNG THEO % (quản lý KTX ở phòng 104)
      await clean(t.db);
      const R3 = await mkRoom('_104');
      const mgr = await mkStu('_QL', R3, 50), reg = await mkStu('_THUONG', R3, 0);
      for (const id of [mgr, reg]) await stay(id, R3);
      await t.api('POST', '/api/invoices/generate', T, { month: M });

      const iM = await inv(mgr), iN = await inv(reg);
      t.eq('Giảm 50% tiền phòng · giảm đúng 600.000', Number(iM.room_discount), 600000, `giảm ${fmt(iM.room_discount)}`);
      t.eq('Giảm 50% · phiếu VẪN ghi tiền phòng đủ 1.200.000 (thấy được ưu đãi)', Number(iM.room_charge), 1200000);
      t.eq('Giảm 50% · tiền phòng thực trả 600.000', Number(iM.room_charge) - Number(iM.room_discount), 600000);
      t.eq('Người thường cùng phòng · không giảm đồng nào', Number(iN.room_discount), 0);
      t.eq('Chênh lệch giữa 2 người đúng 600.000', Number(iN.total) - Number(iM.total), 600000,
        `quản lý ${fmt(iM.total)} · người thường ${fmt(iN.total)}`);

      // ===== Nhập % bậy qua API → không được ra tiền âm
      for (const [nhan, v, muon] of [['500%', 500, 100], ['âm 50%', -50, 0], ['chữ "abc"', 'abc', 0]]) {
        const r = await t.api('PUT', `/api/students/${reg}`, T, { name: 'x', gender: 'female', room_fee_discount_pct: v });
        const got = (await t.db.query('SELECT room_fee_discount_pct p FROM students WHERE id=$1', [reg])).rows[0].p;
        t.eq(`Nhập % giảm = ${nhan} → phải kẹp về ${muon}%`, Number(got), muon, `HTTP ${r.status} · lưu vào CSDL = ${got}`);
      }
      await t.api('PUT', `/api/students/${reg}`, T, { name: 'x', gender: 'female', room_fee_discount_pct: 100 });
      await t.api('POST', '/api/invoices/generate', T, { month: M });
      const iFree = await inv(reg);
      t.ok('Giảm 100% tiền phòng · TỔNG không âm', Number(iFree.total) >= 0, `tổng = ${fmt(iFree.total)}`);
    } finally {
      await clean(t.db);
    }
  },
};
