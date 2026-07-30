// Dựng lược đồ từ CSDL RỖNG: tạo một CSDL trắng, áp schema.sql + migrations y như lúc boot,
// rồi xoá. schema.sql là file cộng dồn nên câu viết sai thứ tự chỉ lòi ra ở môi trường mới.
// Chạy schema.sql bằng MỘT câu query nhiều lệnh, đúng cách internal/db.execScript làm.
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '../../node_modules/pg'));
const { pool, DB_URL } = require(path.join(__dirname, '../lib/harness'));

const GOC = path.join(__dirname, '../..');
const THU_MUC_MIG = path.join(GOC, 'server/migrations');
const TEN_CSDL = 'ktx_kiem_schema';           // CSDL nháp, tạo rồi xoá trong chính bộ test này

// PHẢI khớp reMigrationName ở internal/db/db.go:152 — chặt hơn app là bỏ qua migration app CÓ chạy.
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
    // Sắp theo SỐ đầu tên rồi tới chuỗi — y hệt db.go:185-191.
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
  // File .sql sai quy ước tên bị app bỏ qua (chỉ in cảnh báo rồi chạy tiếp).
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

    // 2) schema_guard phải RỖNG: khối DO trong schema.sql bắt lỗi rồi chạy tiếp, nên ràng buộc bị bỏ
    //    qua vẫn để file "áp thành công". CSDL rỗng không có dữ liệu vi phạm -> có dòng nào là lỗi thứ tự.
    const guard = await client.query('SELECT ten, loi FROM schema_guard ORDER BY ten');
    t.ok('không ràng buộc nào bị bỏ qua trong im lặng (schema_guard rỗng)', guard.rowCount === 0,
      guard.rowCount === 0 ? 'rỗng ✔'
        : 'BỊ BỎ QUA: ' + guard.rows.map(r => `${r.ten} (${r.loi})`).join(' · '));

    // 3) Hai ràng buộc từng bị đánh rơi ở boot đầu (BLK-7).
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

    // 4) Áp lại lần hai trên chính CSDL đó: app áp schema.sql mỗi lần boot.
    let loi2 = null;
    try { await apDungLuocDo(client); } catch (e) { loi2 = e; }
    t.ok('áp lại lần hai vẫn sạch (mỗi lần boot đều áp lại)', !loi2,
      loi2 ? `VỠ: ${loi2.message}` : 'không đổi gì thêm');

    // 5) users.deleted_at + chỉ mục lọc theo nó.
    const cot = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='deleted_at'`);
    t.ok('users.deleted_at có mặt (chỉ mục ux_users_email lọc theo cột này)', cot.rowCount === 1,
      cot.rowCount === 1 ? 'có' : 'THIẾU');

    const idx = await client.query(
      `SELECT 1 FROM pg_indexes WHERE tablename='users' AND indexname='ux_users_email'`);
    t.ok('chỉ mục ux_users_email được tạo', idx.rowCount === 1,
      idx.rowCount === 1 ? 'có' : 'THIẾU');

    // 6) Đếm bảng dựng được.
    const bang = await client.query(
      `SELECT count(*)::int n FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`);
    t.ok('CSDL rỗng dựng ra đủ bảng', bang.rows[0].n >= 20, `${bang.rows[0].n} bảng`);
  } finally {
    await client.end().catch(() => {});
    await pool.query(`DROP DATABASE IF EXISTS ${TEN_CSDL} WITH (FORCE)`).catch(() => {});
  }
}

// needsServer=true: bộ này không gọi API nhưng cần Postgres; khung test chỉ có một cờ "cần hạ tầng".
module.exports = { name: 'Dựng lược đồ từ CSDL rỗng (môi trường mới)', needsServer: true, run };
