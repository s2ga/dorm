// ===== schema.sql phải dựng được CSDL TỪ CON SỐ KHÔNG =====
// Vì sao có bộ này: schema.sql là file CỘNG DỒN, ai thêm gì thì nối vào cuối. Mọi CSDL đang chạy
// (dev, staging) đều đã có sẵn cột từ đời trước, nên câu lệnh viết SAI THỨ TỰ vẫn chạy trót lọt —
// không ai thấy gì. Chỉ khi dựng MÔI TRƯỜNG MỚI (Kubernetes, máy mới, khôi phục sau sự cố) nó mới
// lòi ra, và lòi ra theo kiểu tệ nhất: app KHÔNG khởi động được.
//
// Lớp lỗi này đã dính HAI lần:
//   1. BLK-7 — bảng room_leaders + cột leader_discount nằm SAU khối DO $ktx$ -> CSDL mới boot lần
//      đầu áp THIẾU 2 ràng buộc mà KHÔNG báo lỗi (khối DO nuốt lỗi vào schema_guard), chỉ tự lành
//      ở boot thứ hai. Suốt boot đầu, hoá đơn không có chốt chặn tiền âm.
//   2. ux_users_email lọc `deleted_at IS NULL` ở dòng 146 trong khi cột đó mãi dòng 360 mới thêm
//      -> CSDL rỗng vỡ ngay (SQLSTATE 42703), app không lên nổi.
// Hai kiểu hỏng khác hẳn nhau: cái vỡ to tiếng, cái hỏng trong im lặng. Bộ này canh CẢ HAI.
//
// Cách kiểm: tạo hẳn một CSDL RỖNG rồi áp schema.sql y như lúc boot, xong xoá đi.
// Chạy schema.sql bằng MỘT câu query nhiều lệnh — đúng cách internal/db.execScript làm (simple
// protocol): cả file là MỘT transaction ngầm, sai một câu là không tạo được gì hết.
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '../../node_modules/pg'));
const { pool, DB_URL } = require(path.join(__dirname, '../lib/harness'));

const GOC = path.join(__dirname, '../..');
const THU_MUC_MIG = path.join(GOC, 'server/migrations');
const TEN_CSDL = 'ktx_kiem_schema';           // CSDL nháp, tạo rồi xoá trong chính bộ test này

// PHẢI khớp internal/db/db.go:152 (reMigrationName). Chép chặt hơn app là tự lừa mình: file
// "1_abc.sql" app CÓ chạy mà test lại bỏ qua -> test xanh trong khi migration đó chưa từng được kiểm.
const RE_MIGRATION = /^\d+_.*\.sql$/i;
const soDau = s => parseInt((s.match(/^\d+/) || ['0'])[0], 10);

const doiTenCsdl = (url, ten) => {
  const u = new URL(url);
  u.pathname = '/' + ten;
  return u.toString();
};

const dsMigration = () => {
  if (!fs.existsSync(THU_MUC_MIG)) return { chay: [], saiTen: [] };
  const sql = fs.readdirSync(THU_MUC_MIG).filter(f => f.toLowerCase().endsWith('.sql'));
  return {
    // Sắp xếp theo SỐ đầu tên rồi mới theo chuỗi — y hệt db.go:185-191, không phải sort() mặc định.
    chay: sql.filter(f => RE_MIGRATION.test(f)).sort((a, b) => soDau(a) - soDau(b) || a.localeCompare(b)),
    saiTen: sql.filter(f => !RE_MIGRATION.test(f)),
  };
};

// Áp schema.sql + toàn bộ migrations vào một client đang mở. Ném lỗi nếu có câu nào hỏng.
async function apDungLuocDo(client) {
  await client.query(fs.readFileSync(path.join(GOC, 'server/schema.sql'), 'utf8'));
  const { chay } = dsMigration();
  for (const f of chay) {
    await client.query(fs.readFileSync(path.join(THU_MUC_MIG, f), 'utf8'));
  }
  return chay.length;
}

async function run(t) {
  // File .sql đặt sai tên bị app BỎ QUA trong im lặng (chỉ in một dòng cảnh báo lúc boot rồi chạy
  // tiếp) — nghĩa là thay đổi lược đồ tưởng đã áp mà thật ra chưa bao giờ chạy. Bắt ngay ở đây.
  const { saiTen } = dsMigration();
  t.ok('không có file migration nào sai quy ước tên (app sẽ bỏ qua trong im lặng)',
    saiTen.length === 0, saiTen.length ? `SAI TÊN: ${saiTen.join(', ')}` : 'không có');

  // Dọn tàn dư của lần chạy trước (nếu bộ test từng vỡ giữa chừng) rồi tạo mới.
  await pool.query(`DROP DATABASE IF EXISTS ${TEN_CSDL} WITH (FORCE)`);
  await pool.query(`CREATE DATABASE ${TEN_CSDL}`);

  const client = new Client({ connectionString: doiTenCsdl(DB_URL, TEN_CSDL), ssl: false });
  try {
    await client.connect();

    // 1) Lượt đầu trên CSDL RỖNG — đây là lượt đã từng vỡ.
    let loi = null, soMigration = 0;
    try { soMigration = await apDungLuocDo(client); } catch (e) { loi = e; }
    t.ok('schema.sql + migrations dựng được CSDL rỗng từ đầu', !loi,
      loi ? `VỠ: ${loi.message}` : `sạch (${soMigration} migration)`);
    if (loi) return;  // hỏng ở đây thì các kiểm tra sau vô nghĩa

    // 2) schema_guard PHẢI RỖNG — đây là chốt cho lỗi kiểu BLK-7.
    //    Khối DO $ktx$ trong schema.sql bắt mọi lỗi rồi ghi vào bảng này và CHẠY TIẾP, nên một ràng
    //    buộc tham chiếu cột/bảng chưa tồn tại sẽ bị bỏ qua mà file vẫn áp "thành công". Trên CSDL
    //    RỖNG không có dữ liệu nào để vi phạm ràng buộc -> có dòng nào ở đây cũng là lỗi thứ tự.
    const guard = await client.query('SELECT ten, loi FROM schema_guard ORDER BY ten');
    t.ok('không ràng buộc nào bị bỏ qua trong im lặng (schema_guard rỗng)', guard.rowCount === 0,
      guard.rowCount === 0 ? 'rỗng ✔'
        : 'BỊ BỎ QUA: ' + guard.rows.map(r => `${r.ten} (${r.loi})`).join(' · '));

    // 3) Neo đúng vào hai ràng buộc BLK-7 từng đánh rơi: một chốt tiền, một chốt chống trùng hồ sơ.
    for (const [ten, sql] of [
      ['ck_invoices_no_negative',
       `SELECT 1 FROM pg_constraint WHERE conname='ck_invoices_no_negative'`],
      ['uq_students_id_card',
       `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_students_id_card'`],
    ]) {
      const r = await client.query(sql);
      t.ok(`ràng buộc ${ten} có mặt ngay ở boot ĐẦU TIÊN`, r.rowCount === 1,
        r.rowCount === 1 ? 'có' : 'THIẾU');
    }

    // 4) Lượt hai trên CHÍNH CSDL đó — app áp schema.sql MỖI LẦN BOOT, không được phép hỏng
    //    lần thứ hai (thiếu IF NOT EXISTS / UPDATE backfill chạy lại sai...).
    let loi2 = null;
    try { await apDungLuocDo(client); } catch (e) { loi2 = e; }
    t.ok('áp lại lần hai vẫn sạch (mỗi lần boot đều áp lại)', !loi2,
      loi2 ? `VỠ: ${loi2.message}` : 'không đổi gì thêm');

    // 5) Neo đúng vào lỗi đã gặp: cột users.deleted_at và chỉ mục lọc theo nó phải có mặt.
    const cot = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='deleted_at'`);
    t.ok('users.deleted_at có mặt (chỉ mục ux_users_email lọc theo cột này)', cot.rowCount === 1,
      cot.rowCount === 1 ? 'có' : 'THIẾU');

    const idx = await client.query(
      `SELECT 1 FROM pg_indexes WHERE tablename='users' AND indexname='ux_users_email'`);
    t.ok('chỉ mục ux_users_email được tạo', idx.rowCount === 1,
      idx.rowCount === 1 ? 'có' : 'THIẾU');

    // 6) Không bảng nào bị bỏ sót: đếm cho biết CSDL rỗng dựng ra được bao nhiêu bảng.
    const bang = await client.query(
      `SELECT count(*)::int n FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`);
    t.ok('CSDL rỗng dựng ra đủ bảng', bang.rows[0].n >= 20, `${bang.rows[0].n} bảng`);
  } finally {
    await client.end().catch(() => {});
    await pool.query(`DROP DATABASE IF EXISTS ${TEN_CSDL} WITH (FORCE)`).catch(() => {});
  }
}

// needsServer: bộ này KHÔNG gọi API, nhưng cần Postgres đang chạy — mà khung test chỉ có đúng
// một cờ "cần hạ tầng". Xếp vào e2e để `npm run test:unit` (hứa không đụng CSDL) không kéo nó vào.
module.exports = { name: 'Dựng lược đồ từ CSDL rỗng (môi trường mới)', needsServer: true, run };
