#!/usr/bin/env node
// Dọn dữ liệu một lần. Chạy lại nhiều lần được (mỗi bản sửa chỉ khớp khi dữ liệu còn trạng thái cũ).
//   node tools/repair-data.js          -> chạy thử, chỉ in ra
//   node tools/repair-data.js --apply  -> ghi thật
//
// Danh sách cần sửa đọc từ tools/don-du-lieu.json (gitignore — chứa họ tên và mã học viên thật,
// repo này công khai). Tìm theo tên + mã + ngày, KHÔNG theo id: id local khác id bản chạy thật.

require('../server/load-env'); // cùng cách nạp .env như máy chủ — không thêm thư viện mới
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
types.setTypeParser(1082, v => v);
types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));

const APPLY = process.argv.includes('--apply');
const URL = process.env.REPAIR_DB || process.env.DATABASE_URL;
if (!URL) { console.error('Thiếu DATABASE_URL (hoặc REPAIR_DB) trong .env'); process.exit(2); }
const pool = new Pool({ connectionString: URL, ssl: /supabase|render|amazonaws/.test(URL) ? { rejectUnauthorized: false } : false });

// ---- Quyết định dọn dữ liệu: đọc từ file, KHÔNG viết vào code (xem ghi chú đầu file) ----
const CFG_PATH = path.join(__dirname, 'don-du-lieu.json');
if (!fs.existsSync(CFG_PATH)) {
  console.error(`\n  Chưa có ${CFG_PATH}\n  Chép tools/don-du-lieu.example.json thành tools/don-du-lieu.json rồi điền.\n`);
  process.exit(2);
}
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const NHAN_VIEN = CFG.nhan_vien || [];  // [tên, mã mới] — ô mã đang là chữ "Nhân viên"
const XOA_MA = CFG.xoa_ma || [];        // [tên bị xoá mã, mã, tên người giữ]
const SAI_NAM = CFG.sai_nam || [];      // [tên, mã, cột, giá trị đang sai, giá trị đúng]

const log = [];
const ghi = (viec, chi_tiet, so) => log.push({ viec, chi_tiet, so });

(async () => {
  console.log(`\n  CSDL : ${URL.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`  Chế độ: ${APPLY ? '\x1b[31mGHI THẬT\x1b[0m' : '\x1b[36mCHẠY THỬ (không ghi gì)\x1b[0m'}\n`);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    console.log('── 1. Mã tạm cho nhân viên ──');
    for (const [ten, ma] of NHAN_VIEN) {
      const { rows } = await c.query(
        `UPDATE students SET code=$1 WHERE deleted_at IS NULL AND btrim(name)=$2 AND lower(btrim(code))='nhân viên' RETURNING id`,
        [ma, ten]);
      console.log(`   ${rows.length ? '✓' : '·'} ${ten.padEnd(22)} "Nhân viên" → ${ma}   ${rows.length ? `(#${rows.map(r => r.id).join(',')})` : '(không khớp — có thể đã sửa rồi)'}`);
      if (rows.length) ghi('Đặt mã nhân viên', `${ten} → ${ma}`, rows.length);
    }

    console.log('\n── 2. Hai người khác tên chung mã → xoá mã của người không giữ ──');
    for (const [ten, ma, nguoiGiu] of XOA_MA) {
      const { rows } = await c.query(
        `UPDATE students SET code='',
           note = btrim(COALESCE(note,'') || E'\\n[Dọn dữ liệu 16/07/2026] Mã HV cũ "${ma}" trùng với ${nguoiGiu} nên đã xoá. Cần bổ sung mã đúng.')
         WHERE deleted_at IS NULL AND btrim(name)=$1 AND btrim(code)=$2 RETURNING id`, [ten, ma]);
      console.log(`   ${rows.length ? '✓' : '·'} ${ten.padEnd(22)} xoá mã "${ma}" (${nguoiGiu} giữ)   ${rows.length ? `(#${rows.map(r => r.id).join(',')})` : '(không khớp)'}`);
      if (rows.length) ghi('Xoá mã trùng', `${ten} — mã "${ma}" để lại cho ${nguoiGiu}`, rows.length);
    }

    console.log('\n── 3. Gõ nhầm năm ──');
    for (const [ten, ma, cot, cu, moi] of SAI_NAM) {
      const { rows } = await c.query(
        `UPDATE students SET ${cot}=$1 WHERE deleted_at IS NULL AND btrim(name)=$2 AND btrim(code)=$3 AND ${cot}=$4 RETURNING id`,
        [moi, ten, ma, cu]);
      const nhan = cot === 'check_in_date' ? 'ngày vào' : 'ngày ra';
      console.log(`   ${rows.length ? '✓' : '·'} ${ten.padEnd(22)} ${nhan}: ${cu} → ${moi}   ${rows.length ? `(#${rows.map(r => r.id).join(',')})` : '(không khớp — có thể đã sửa rồi)'}`);
      if (rows.length) ghi('Sửa năm', `${ten} — ${nhan} ${cu} → ${moi}`, rows.length);
    }

    // Lượt ở phòng được nạp từ ngày vào/ra của hồ sơ -> sửa hồ sơ mà quên chỗ này là lệch.
    // Chỉ đồng bộ những HV có ĐÚNG 1 lượt ở (nhiều lượt = có chuyển phòng, ngày là ngày chuyển, không phải ngày nhận phòng).
    console.log('\n── 4. Đồng bộ lượt ở phòng theo ngày vừa sửa ──');
    const { rows: rs } = await c.query(`
      UPDATE room_stays rs SET from_date = s.check_in_date, to_date = s.check_out_date
        FROM students s
       WHERE rs.student_id = s.id AND s.deleted_at IS NULL
         AND (SELECT COUNT(*) FROM room_stays x WHERE x.student_id = s.id) = 1
         AND (rs.from_date IS DISTINCT FROM s.check_in_date OR rs.to_date IS DISTINCT FROM s.check_out_date)
      RETURNING rs.student_id`);
    console.log(`   ${rs.length ? '✓' : '·'} ${rs.length} lượt ở được đồng bộ lại`);
    if (rs.length) ghi('Đồng bộ lượt ở phòng', 'theo ngày vào/ra vừa sửa', rs.length);

    // Kiểm lại: còn chỗ nào ngày ra trước ngày vào không?
    const { rows: con } = await c.query(
      `SELECT name, check_in_date, check_out_date FROM students WHERE deleted_at IS NULL AND check_out_date < check_in_date`);
    console.log(`\n── Kiểm lại: ngày ra trước ngày vào còn ${con.length} chỗ ──`);
    con.forEach(r => console.log(`   ✗ ${r.name}: vào ${r.check_in_date} · ra ${r.check_out_date}`));

    const { rows: trung } = await c.query(
      `SELECT code, COUNT(*)::int n FROM students WHERE deleted_at IS NULL AND COALESCE(btrim(code),'')<>''
        GROUP BY code HAVING COUNT(*)>1 ORDER BY code`);
    console.log(`── Kiểm lại: mã HV trùng còn ${trung.length} nhóm ──`);
    trung.forEach(r => console.log(`   ✗ ${r.code} — ${r.n} hồ sơ`));
    if (trung.length) console.log('   (đây là các nhóm CÙNG MỘT NGƯỜI có 2 hồ sơ — cần gộp, không thuộc phạm vi script này)');

    console.log(`\n  Tổng: ${log.length} nhóm việc · ${log.reduce((a, x) => a + x.so, 0)} bản ghi`);
    if (APPLY) { await c.query('COMMIT'); console.log('  \x1b[32m✔ ĐÃ GHI\x1b[0m\n'); }
    else { await c.query('ROLLBACK'); console.log('  \x1b[36mĐã hoàn tác — chưa ghi gì. Thêm --apply để ghi thật.\x1b[0m\n'); }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('\n  ✗ LỖI — đã hoàn tác, không ghi gì:', e.message, '\n');
    process.exitCode = 1;
  } finally {
    c.release(); await pool.end();
  }
})();
