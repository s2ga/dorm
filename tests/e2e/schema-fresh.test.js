// ===== schema.sql phải dựng được CSDL TỪ CON SỐ KHÔNG =====
// Vì sao có bộ này: schema.sql là file CỘNG DỒN, ai thêm gì thì nối vào cuối. Mọi CSDL đang chạy
// (dev, staging) đều đã có sẵn cột từ đời trước, nên câu lệnh viết SAI THỨ TỰ vẫn chạy trót lọt —
// không ai thấy gì. Chỉ khi dựng MÔI TRƯỜNG MỚI (Kubernetes, máy mới, khôi phục sau sự cố) nó mới
// lòi ra, và lòi ra theo kiểu tệ nhất: app KHÔNG khởi động được.
//
// Đã dính thật: `CREATE UNIQUE INDEX ux_users_email ... WHERE deleted_at IS NULL` nằm ở dòng 142,
// còn `ALTER TABLE users ADD COLUMN deleted_at` mãi dòng 356 -> CSDL rỗng vỡ ngay
// (SQLSTATE 42703 "column deleted_at does not exist").
//
// Cách kiểm: tạo hẳn một CSDL RỖNG rồi áp schema.sql y như lúc boot, xong xoá đi.
// Chạy schema.sql bằng MỘT câu query nhiều lệnh — đúng cách internal/db.execScript làm (simple
// protocol): cả file là MỘT transaction ngầm, sai một câu là không tạo được gì hết.
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '../../node_modules/pg'));
const { pool, DB_URL } = require(path.join(__dirname, '../lib/harness'));

const GOC = path.join(__dirname, '../..');
const TEN_CSDL = 'ktx_kiem_schema';           // CSDL nháp, tạo rồi xoá trong chính bộ test này

const doiTenCsdl = (url, ten) => {
  const u = new URL(url);
  u.pathname = '/' + ten;
  return u.toString();
};

// Áp schema.sql + toàn bộ migrations vào một client đang mở. Ném lỗi nếu có câu nào hỏng.
async function apDungLuocDo(client) {
  await client.query(fs.readFileSync(path.join(GOC, 'server/schema.sql'), 'utf8'));
  const thuMuc = path.join(GOC, 'server/migrations');
  const files = fs.existsSync(thuMuc)
    ? fs.readdirSync(thuMuc).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort()
    : [];
  for (const f of files) {
    await client.query(fs.readFileSync(path.join(thuMuc, f), 'utf8'));
  }
  return files.length;
}

async function run(t) {
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

    // 2) Lượt hai trên CHÍNH CSDL đó — app áp schema.sql MỖI LẦN BOOT, không được phép hỏng
    //    lần thứ hai (thiếu IF NOT EXISTS / UPDATE backfill chạy lại sai...).
    let loi2 = null;
    try { await apDungLuocDo(client); } catch (e) { loi2 = e; }
    t.ok('áp lại lần hai vẫn sạch (mỗi lần boot đều áp lại)', !loi2,
      loi2 ? `VỠ: ${loi2.message}` : 'không đổi gì thêm');

    // 3) Neo đúng vào lỗi đã gặp: cột users.deleted_at và chỉ mục lọc theo nó phải có mặt.
    const cot = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='deleted_at'`);
    t.ok('users.deleted_at có mặt (chỉ mục ux_users_email lọc theo cột này)', cot.rowCount === 1,
      cot.rowCount === 1 ? 'có' : 'THIẾU');

    const idx = await client.query(
      `SELECT 1 FROM pg_indexes WHERE tablename='users' AND indexname='ux_users_email'`);
    t.ok('chỉ mục ux_users_email được tạo', idx.rowCount === 1,
      idx.rowCount === 1 ? 'có' : 'THIẾU');

    // 4) Không bảng nào bị bỏ sót: đếm cho biết CSDL rỗng dựng ra được bao nhiêu bảng.
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
