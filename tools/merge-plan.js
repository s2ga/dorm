#!/usr/bin/env node
// Gộp hồ sơ trùng (một người bị tạo 2 hồ sơ khi chuyển phòng). Lịch sử ở phòng giữ ở room_stays.
//   node tools/merge-plan.js          -> chỉ in kế hoạch
//   node tools/merge-plan.js --apply  -> gộp thật (1 transaction, lỗi là hoàn tác hết)
//
// Hồ sơ giữ lại = bản phản ánh hiện trạng (đang ở & vào sau cùng). Nhóm không hợp quy tắc thì bỏ qua.

require('../server/load-env');
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
types.setTypeParser(1082, v => v);
types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));

const APPLY = process.argv.includes('--apply');
const URL = process.env.REPAIR_DB || process.env.DATABASE_URL;
if (!URL) { console.error('Thiếu DATABASE_URL (hoặc REPAIR_DB)'); process.exit(2); }
const pool = new Pool({ connectionString: URL, ssl: /supabase|render|amazonaws/.test(URL) ? { rejectUnauthorized: false } : false });

// ---- Quyết định thủ công của sếp cho nhóm mà app KHÔNG tự kết luận được ----
// ĐỂ Ở FILE RIÊNG, KHÔNG VIẾT VÀO ĐÂY: nội dung là mã học viên thật + hoàn cảnh của người thật.
// Repo này công khai — viết thẳng vào .js là đẩy dữ liệu cá nhân lên GitHub, trái Nghị định 13.
// Nhận diện bằng phòng + ngày, KHÔNG dùng id (id local và bản thật khác nhau).
const CFG_PATH = path.join(__dirname, 'don-du-lieu.json');
const CHOT_TAY = fs.existsSync(CFG_PATH) ? (JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')).chot_tay || []) : [];

const vnd = n => (Number(n) || 0).toLocaleString('vi-VN');
const d10 = v => (v ? String(v).slice(0, 10) : null);
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

(async () => {
  console.log(`\n  CSDL : ${URL.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`  Chế độ: ${APPLY ? '\x1b[31mGỘP THẬT\x1b[0m' : '\x1b[36mCHỈ IN KẾ HOẠCH (không ghi gì)\x1b[0m'}\n`);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const { rows: nhom } = await c.query(
      `SELECT code FROM students WHERE deleted_at IS NULL AND COALESCE(btrim(code),'')<>''
        GROUP BY code HAVING COUNT(*)>1 ORDER BY code`);

    let gopDuoc = 0, boQua = 0, tienDu = 0;
    for (const { code } of nhom) {
      const { rows: hs } = await c.query(
        `SELECT s.id, s.name, s.room_id, r.name AS phong, s.check_in_date, s.check_out_date, s.status,
                s.rental_type, s.contract_no, s.contract_date, s.id_card, s.phone,
                (SELECT COUNT(*) FROM vehicles v WHERE v.student_id=s.id AND v.deleted_at IS NULL)::int AS xe,
                (SELECT COUNT(*) FROM invoices i WHERE i.student_id=s.id AND i.deleted_at IS NULL AND i.status='paid')::int AS da_thu,
                (SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.student_id=s.id AND i.deleted_at IS NULL AND i.month='2026-07') AS t7
           FROM students s LEFT JOIN rooms r ON r.id=s.room_id
          WHERE s.deleted_at IS NULL AND s.code=$1
          ORDER BY s.check_in_date NULLS FIRST, s.id`, [code]);

      const ten = [...new Set(hs.map(h => h.name.trim()))];
      const daThu = hs.reduce((a, h) => a + h.da_thu, 0);
      const dangO = hs.filter(h => h.status === 'in');

      // ---- Chọn hồ sơ GIỮ LẠI ----
      // Mặc định = bản "đang ở" có ngày vào SAU CÙNG. Nhiều bản cùng "đang ở" ở các phòng khác nhau
      // KHÔNG phải lỗi lạ: đó chính là chuyển phòng bị nhập thành hồ sơ mới (sếp xác nhận 16/07/2026).
      // Bản vào sau cùng = phòng hiện tại.
      const tay = CHOT_TAY.find(x => x.code === code);
      const giu = tay
        ? hs.find(h => h.phong === tay.giu.phong && d10(h.check_in_date) === tay.giu.vao && d10(h.check_out_date) === tay.giu.ra)
        : (dangO.length ? dangO[dangO.length - 1] : null);
      if (tay && !giu) { console.log(`\x1b[33m── ${code}: chốt tay không khớp hồ sơ nào (phòng ${tay.giu.phong}, ${tay.giu.vao}→${tay.giu.ra}) — BỎ QUA\x1b[0m\n`); boQua++; continue; }
      const bo = hs.filter(h => giu && h.id !== giu.id);

      // Lịch sử ở phòng sau khi gộp: xâu chuỗi theo ngày vào; chặng trước kết thúc hôm trước chặng sau
      const chuoi = hs.filter(h => h.room_id && h.check_in_date)
        .sort((a, b) => d10(a.check_in_date).localeCompare(d10(b.check_in_date)) || (a.id - b.id));

      // ---- Các trường hợp KHÔNG tự gộp: thà không gộp còn hơn gộp sai
      let chan = null;
      if (ten.length > 1) chan = `hai người KHÁC TÊN (${ten.join(' / ')}) — không phải trùng hồ sơ`;
      else if (daThu) chan = `có ${daThu} phiếu ĐÃ THU tiền — gộp là đụng vào sổ đã chốt`;
      else if (!giu) chan = 'không hồ sơ nào đang ở — không biết bản nào là hiện trạng';
      // Sếp đã chỉ đích danh hồ sơ nào đúng -> bỏ qua các kiểm tra tự động bên dưới
      else if (tay) chan = null;
      // Hồ sơ giữ lại PHẢI là chặng cuối của chuỗi. Không khớp = dữ liệu tự mâu thuẫn:
      // hồ sơ nói đang ở phòng này, nhưng có bản ghi khác vào phòng khác MUỘN HƠN mà đã ra rồi.
      // Gộp kiểu đó sẽ ra hồ sơ ghi phòng A còn lịch sử ghi đang ở phòng B.
      else if (chuoi.length && chuoi[chuoi.length - 1].id !== giu.id) {
        const x = chuoi[chuoi.length - 1];
        chan = `hồ sơ đang ở (#${giu.id}, phòng ${giu.phong}, vào ${d10(giu.check_in_date)}) KHÔNG phải chặng cuối —`
             + ` #${x.id} vào phòng ${x.phong} muộn hơn (${d10(x.check_in_date)}) mà đã ra. Dữ liệu tự mâu thuẫn, cần người xem.`;
      }
      const du = hs.reduce((a, h) => a + Number(h.t7), 0) - (giu ? Number(giu.t7) : 0);

      console.log(`\x1b[1m── ${code} · ${ten.join(' / ')}\x1b[0m`);
      if (tay) console.log(`  \x1b[36m※ ${tay.vi_sao}\x1b[0m`);
      for (const h of hs) {
        const dau = giu && h.id === giu.id ? '\x1b[32m GIỮ \x1b[0m' : chan ? '  ?  ' : '\x1b[31m XOÁ \x1b[0m';
        console.log(`  ${dau} #${String(h.id).padEnd(5)} ${(h.phong || '—').padEnd(5)} ${d10(h.check_in_date) || '(không có ngày vào)'} → ${d10(h.check_out_date) || 'nay'}` +
          `  ${h.status === 'in' ? 'đang ở' : 'đã ra'}${h.rental_type === 'phong' ? ' · NGUYÊN PHÒNG' : ''}` +
          `${h.contract_no ? ' · HĐ ' + h.contract_no : ''}${h.xe ? ` · ${h.xe} xe` : ''}${Number(h.t7) ? ` · phiếu T7 ${vnd(h.t7)}` : ''}`);
      }

      if (chan) { console.log(`  \x1b[33m→ BỎ QUA: ${chan}\x1b[0m\n`); boQua++; continue; }

      const stays = chuoi.map((h, i) => ({
        room_id: h.room_id, phong: h.phong,
        from: d10(h.check_in_date),
        to: i < chuoi.length - 1 ? addDays(d10(chuoi[i + 1].check_in_date), -1) : d10(giu.check_out_date),
      })).filter(s => !s.to || s.to >= s.from);

      const vaoSom = d10(chuoi[0].check_in_date);
      const hd = giu.contract_no || (hs.find(h => h.contract_no) || {}).contract_no || '';
      const hdDate = giu.contract_date || (hs.find(h => h.contract_date) || {}).contract_date || null;

      console.log(`  \x1b[2m→ Sau khi gộp: 1 hồ sơ #${giu.id} · vào ${vaoSom} · phòng ${giu.phong}${hd ? ` · HĐ ${hd}` : ''}\x1b[0m`);
      stays.forEach(s => console.log(`  \x1b[2m     phòng ${String(s.phong).padEnd(4)} ${s.from} → ${s.to || 'nay'}\x1b[0m`));
      if (du > 0) console.log(`  \x1b[2m     bỏ phiếu T7 thừa: \x1b[0m\x1b[31m−${vnd(du)}\x1b[0m`);
      console.log('');
      gopDuoc++; tienDu += du;

      if (APPLY) {
        const ids = bo.map(h => h.id);
        // Xe + phiếu của hồ sơ bỏ -> chuyển/dọn TRƯỚC khi xoá hồ sơ
        await c.query(`UPDATE vehicles SET student_id=$1 WHERE student_id = ANY($2) AND deleted_at IS NULL`, [giu.id, ids]);
        await c.query(`UPDATE invoices SET deleted_at=now() WHERE student_id = ANY($1) AND deleted_at IS NULL`, [ids]);
        // Vá thông tin còn thiếu ở hồ sơ giữ lại (số HĐ, CCCD, SĐT nằm ở bản kia)
        await c.query(
          `UPDATE students SET check_in_date=$2, contract_no=$3, contract_date=$4,
             id_card = COALESCE(NULLIF(btrim(id_card),''), $5), phone = COALESCE(NULLIF(btrim(phone),''), $6),
             note = btrim(COALESCE(note,'') || E'\\n[Gộp hồ sơ 16/07/2026] Đã gộp ' || $7 || ' hồ sơ trùng (#' || $8 || '). Lịch sử ở phòng giữ nguyên.')
           WHERE id=$1`,
          [giu.id, vaoSom, hd, hdDate,
           (hs.find(h => (h.id_card || '').trim()) || {}).id_card || null,
           (hs.find(h => (h.phone || '').trim()) || {}).phone || null,
           hs.length, ids.join(',')]);
        // Dựng lại lịch sử ở phòng thành MỘT chuỗi liền mạch
        await c.query(`DELETE FROM room_stays WHERE student_id = ANY($1)`, [[giu.id, ...ids]]);
        for (const s of stays)
          await c.query(`INSERT INTO room_stays (student_id, room_id, from_date, to_date) VALUES ($1,$2,$3,$4)`, [giu.id, s.room_id, s.from, s.to]);
        await c.query(`UPDATE room_leaders SET student_id=$1 WHERE student_id = ANY($2)`, [giu.id, ids]);
        await c.query(`UPDATE students SET deleted_at=now() WHERE id = ANY($1)`, [ids]);
      }
    }

    console.log(`\x1b[1m  Gộp được ${gopDuoc} nhóm · bỏ qua ${boQua} nhóm · hết thu dư ${vnd(tienDu)}/tháng\x1b[0m`);
    // Ở chế độ chạy thử KHÔNG được hỏi lại CSDL: chưa gộp gì nên nó vẫn trả về con số cũ,
    // in ra là nói dối. Số nhóm còn lại = đúng số nhóm bị bỏ qua.
    if (boQua) console.log(`  Còn ${boQua} nhóm trùng mã cần người xem → ràng buộc uq_students_code VẪN chưa khoá được.`);
    else console.log('  Hết trùng mã → khởi động lại là ràng buộc uq_students_code TỰ KHOÁ.');

    if (APPLY) { await c.query('COMMIT'); console.log('  \x1b[32m✔ ĐÃ GỘP\x1b[0m — nhớ "Lập phiếu" lại kỳ 2026-07 để tính lại tiền.\n'); }
    else { await c.query('ROLLBACK'); console.log('  \x1b[36mChưa ghi gì. Thêm --apply để gộp thật.\x1b[0m\n'); }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('\n  ✗ LỖI — đã hoàn tác, không ghi gì:', e.message, '\n');
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
})();
