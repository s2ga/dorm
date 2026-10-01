// Màn "Xem trước — lập hoá đơn": mọi dòng tổng kết phải kèm DANH SÁCH TÊN để bấm vào xem được, và các dòng
// cộng lại phải bằng đúng số "học viên có phát sinh" — trước đây người ra tổng 0 đồng bị bỏ qua mà không dòng
// nào đếm, nên 124 người phát sinh mà các dòng chỉ cộng ra 121.
const P = '__test_gends';

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
  name: 'Xem trước lập hoá đơn: dòng nào cũng có danh sách tên, các dòng cộng đủ tổng',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const ky = congNgay(0).slice(0, 7);
    const [ny, nm] = ky.split('-').map(Number);
    const kyDien = nm === 1 ? `${ny - 1}-12` : `${ny}-${String(nm - 1).padStart(2, '0')}`;
    try {
      const fac = (await t.db.query('SELECT id FROM facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1')).rows[0].id;
      const phong = async (ten, kwh) => {
        const rid = (await t.db.query(
          `INSERT INTO rooms (name, facility_id, capacity, gender, hang, monthly_fee) VALUES ($1,$2,4,'male','B',1200000) RETURNING id`,
          [P + ten, fac])).rows[0].id;
        await t.db.query(`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,10,$3,$4)`,
          [rid, kyDien, 10 + kwh, kwh]);
        return rid;
      };
      const r1 = await phong('_R1', 50);
      const hv = async (ma, ten, rid, vao, tra) => {
        const id = (await t.db.query(
          `INSERT INTO students (code, name, gender, room_id, check_in_date, check_out_date, status, rental_type)
           VALUES ($1,$2,'male',$3,$4,$5,$6,'ghep') RETURNING id`,
          [P + ma, `${P} ${ten}`, rid, vao, tra, tra ? 'out' : 'in'])).rows[0].id;
        if (rid) await t.db.query(`INSERT INTO room_stays (student_id, room_id, from_date, to_date) VALUES ($1,$2,$3,$4)`, [id, rid, vao, tra]);
        return id;
      };
      const A = await hv('_A', 'Đang Ở A', r1, congNgay(-40), null);
      const B = await hv('_B', 'Đang Ở B', r1, congNgay(-40), null);
      // Trả phòng trong kỳ điện nhưng không còn lượt ở phòng nào (không có tiền điện), đã có phiếu kỳ trước
      // (không thu cọc lại) -> kỳ này 0 đồng.
      const D = await hv('_D', 'Đã Trả D', null, congNgay(-90), `${kyDien}-04`);
      await t.db.query(`INSERT INTO invoices (student_id, month, total, status) VALUES ($1,$2,0,'paid')`, [D, kyDien]);

      const xemTruoc = async () => (await t.api('POST', '/api/invoices/generate', T, { month: ky, preview: true }));
      const coTrong = (ds, id) => (ds || []).some(x => x.student_id === id);
      const kiemDinhDang = (ten, r) => {
        for (const k of ['created_list', 'unchanged_list', 'skipped_list', 'zero_list']) {
          t.ok(`${ten} · có danh sách ${k}`, Array.isArray(r[k]), `thiếu ${k}`);
        }
        t.eq(`${ten} · số "Tạo mới" khớp độ dài danh sách`, (r.created_list || []).length, r.created);
        t.eq(`${ten} · số "Không đổi" khớp độ dài danh sách`, (r.unchanged_list || []).length, r.unchanged);
        t.eq(`${ten} · số "Bỏ qua — đã thu" khớp độ dài danh sách`, (r.skipped_list || []).length, r.skipped);
        t.eq(`${ten} · số "0 đồng" khớp độ dài danh sách`, (r.zero_list || []).length, r.zero);
        const cong = r.created + r.updated + r.unchanged + r.skipped + (r.zero || 0) + r.skipped_missing + r.cleaned;
        t.eq(`${ten} · các dòng cộng lại ĐÚNG BẰNG số học viên phát sinh (không ai biến mất)`, cong, r.total,
          `tạo ${r.created} + đổi ${r.updated} + giữ ${r.unchanged} + thu ${r.skipped} + 0đ ${r.zero} + thiếu ${r.skipped_missing} + dọn ${r.cleaned}`);
      };

      // ── Lần 1: chưa có phiếu nào ───────────────────────────────────────────────────
      const p1 = await xemTruoc();
      t.eq('Xem trước lần 1 → 200', p1.status, 200, `HTTP ${p1.status} ${p1.json && p1.json.error || ''}`);
      kiemDinhDang('Lần 1', p1.json);
      t.ok('Hai người đang ở nằm trong danh sách "Tạo mới"', coTrong(p1.json.created_list, A) && coTrong(p1.json.created_list, B));
      const dongA = (p1.json.created_list || []).find(x => x.student_id === A) || {};
      t.ok('… mỗi dòng có tên và phòng để hiện lên màn hình', !!dongA.name && !!dongA.room, JSON.stringify(dongA));
      t.ok('Người đã trả phòng ra 0 đồng nằm ở dòng "Không lập phiếu — 0 đồng"', coTrong(p1.json.zero_list, D),
        JSON.stringify((p1.json.zero_list || []).filter(x => String(x.name).startsWith(P))));
      t.ok('… và KHÔNG lẫn vào "Tạo mới"', !coTrong(p1.json.created_list, D));

      // ── Lập thật, cho B đã thu, xem trước lần 2 ────────────────────────────────────
      const lap = await t.api('POST', '/api/invoices/generate', T, { month: ky });
      t.eq('Lập hoá đơn thật → 200', lap.status, 200, `HTTP ${lap.status}`);
      t.ok('Kết quả lập thật cũng kèm danh sách', Array.isArray(lap.json && lap.json.created_list));
      await t.db.query(`UPDATE invoices SET status='paid' WHERE student_id=$1 AND month=$2`, [B, ky]);
      const p2 = await xemTruoc();
      t.eq('Xem trước lần 2 → 200', p2.status, 200, `HTTP ${p2.status}`);
      kiemDinhDang('Lần 2', p2.json);
      t.ok('Phiếu đã có, tính lại y hệt → nằm trong danh sách "Không đổi"', coTrong(p2.json.unchanged_list, A),
        JSON.stringify((p2.json.unchanged_list || []).filter(x => String(x.name).startsWith(P))));
      t.ok('Phiếu đã thu → nằm trong danh sách "Bỏ qua — đã thu"', coTrong(p2.json.skipped_list, B));
    } finally {
      await clean(t.db);
    }
  },
};
