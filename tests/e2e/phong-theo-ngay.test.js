// BL-107: GET /api/rooms?date= đếm chỗ theo MỐC NGÀY, không phải hôm nay.
// Dựng dữ liệu để cả hai chiều sai đều lộ: người rời trước mốc vẫn bị đếm, và người vào trước mốc chưa được đếm.
const P = '__test_p107';

const ngay = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function clean(db) {
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%' OR code LIKE '${P}%'`);
  await db.query(`DELETE FROM rooms WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Phòng theo ngày — sức chứa tính theo mốc nhận phòng (BL-107)',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);

    const rid = (await t.db.query(
      `INSERT INTO rooms (name, floor, gender, capacity, monthly_fee) VALUES ($1, 9, 'male', 2, 1000000) RETURNING id`,
      [P + '_A'])).rows[0].id;

    // BL-117: ngày THẬT chỉ có khi đã xác nhận; ngày tương lai là DỰ KIẾN (planned_*). Hàm này nhận
    // (ngày vào thật | null, dự kiến vào | null, dự kiến ra | null).
    const themHV = async (ten, vaoThat, duKienVao, duKienRa) => (await t.db.query(
      `INSERT INTO students (name, code, gender, room_id, check_in_date, planned_check_in, planned_check_out, rental_type)
       VALUES ($1, $2, 'male', $3, $4, $5, $6, 'ghep') RETURNING id`,
      [P + ' ' + ten, P + '_' + ten, rid, vaoThat, duKienVao, duKienRa])).rows[0].id;

    // Đọc số của ĐÚNG phòng test; trả null nếu máy chủ không trả phòng đó (rào cơ sở/lỗi)
    const dem = async (d) => {
      const r = await t.api('GET', '/api/rooms' + (d ? '?date=' + encodeURIComponent(d) : ''), T);
      if (r.status !== 200 || !Array.isArray(r.json)) return { loi: r.status };
      const p = r.json.find(x => x.id === rid);
      return p ? { occ: p.occupancy, up: p.upcoming, leave: p.leaving } : { loi: 'khong thay phong' };
    };

    // ── Chiều A: đầy hôm nay, một người rời ngày +5 ───────────────────────────────────
    await themHV('A1', ngay(-30), null, ngay(5));   // đang ở thật, lịch rời +5
    await themHV('A2', ngay(-30), null, null);

    const nay = await dem(null);
    t.ok('Hôm nay: phòng 2/2 đang đầy', nay.occ === 2, JSON.stringify(nay));

    const sau10 = await dem(ngay(10));
    t.ok('Mốc +10: còn 1 — người rời ngày +5 thôi được đếm', sau10.occ === 1, JSON.stringify(sau10));

    t.ok('Ranh giới: ĐÚNG ngày trả phòng thì không còn đếm (dùng > chứ không >=)',
      (await dem(ngay(5))).occ === 1, JSON.stringify(await dem(ngay(5))));
    t.ok('Ranh giới: trước ngày trả 1 hôm vẫn đếm đủ 2',
      (await dem(ngay(4))).occ === 2, JSON.stringify(await dem(ngay(4))));

    // ── Chiều B: người đã xếp vào ngày +8 ────────────────────────────────────────────
    await themHV('B1', null, ngay(8), null);   // đã đặt chỗ, dự kiến vào +8

    const nay2 = await dem(null);
    t.ok('Hôm nay: người vào ngày +8 CHƯA vào occupancy', nay2.occ === 2, JSON.stringify(nay2));
    t.ok('Hôm nay: người đó nằm ở cột upcoming', nay2.up === 1, JSON.stringify(nay2));

    const sau10b = await dem(ngay(10));
    t.ok('Mốc +10: A2 còn ở + B1 đã vào = 2/2 ĐẦY (không phải 1)', sau10b.occ === 2, JSON.stringify(sau10b));
    t.ok('Mốc +10: không còn ai sắp vào', sau10b.up === 0, JSON.stringify(sau10b));
    t.ok('Ranh giới: ĐÚNG ngày nhận phòng đã được đếm (dùng <= chứ không <)',
      (await dem(ngay(8))).occ === 2, JSON.stringify(await dem(ngay(8))));

    // ── Không truyền date phải GIỐNG Y truyền đúng hôm nay ───────────────────────────
    t.ok('Không truyền date == truyền hôm nay (tương thích ngược)',
      JSON.stringify(await dem(null)) === JSON.stringify(await dem(ngay(0))),
      JSON.stringify(await dem(null)) + ' vs ' + JSON.stringify(await dem(ngay(0))));

    // ── Ngày rác phải bị CHẶN, không lặng lẽ về hôm nay ──────────────────────────────
    for (const rac of ['hom-nay', '2026-13-45', "2026-01-01'; DROP TABLE rooms; --", '99999-1-1', '2026-02-30']) {
      const r = await t.api('GET', '/api/rooms?date=' + encodeURIComponent(rac), T);
      t.ok(`Ngày rác ${JSON.stringify(rac)} → 400`, r.status === 400, `HTTP ${r.status}`);
    }
    const conSong = await t.api('GET', '/api/rooms', T);
    t.ok('Bảng rooms còn nguyên sau phát tiêm SQL',
      conSong.status === 200 && Array.isArray(conSong.json) && conSong.json.length > 0, `HTTP ${conSong.status}`);
  },
};
