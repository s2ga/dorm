const express = require('express');
const db = require('../db');
const { query, getSettings, withTransaction } = db;
const { requireAuth, requireRole } = require('../auth');
const { sendViolationMail, mailStatus } = require('../mailer');
const { isValidYmd, rejectUnknown } = require('../valid');
const { applyFacilityFilter, isExecutive, assertFacility } = require('../scope');

// Đa cơ sở: chặn thao tác lên HV / vi phạm NGOÀI cơ sở người dùng. Trả true (đã gửi response) nếu chặn.
async function blockByStudent(req, res, studentId) {
  if (isExecutive(req)) return false;
  const row = (await query('SELECT facility_id FROM students WHERE id=$1', [studentId])).rows[0];
  const bad = assertFacility(req, row ? row.facility_id : null);
  if (bad) { res.status(bad.status).json(bad); return true; }
  return false;
}
async function blockByViolation(req, res, vioId) {
  if (isExecutive(req)) return false;
  const row = (await query('SELECT s.facility_id FROM violations v JOIN students s ON s.id=v.student_id WHERE v.id=$1', [vioId])).rows[0];
  if (!row) return false; // không có -> để handler trả 404
  const bad = assertFacility(req, row.facility_id);
  if (bad) { res.status(bad.status).json(bad); return true; }
  return false;
}

// Đa cơ sở: điều kiện lọc theo cơ sở (qua HV). Trả { facWhere, params } để nối vào truy vấn có JOIN students s.
// Điều hành: lọc tuỳ chọn ?facility. Quản lý cơ sở: ÉP theo cơ sở của mình.
function facilityScope(req) {
  const cond = [], params = [];
  if (isExecutive(req)) {
    if (req.query.facility) { params.push(+req.query.facility); cond.push(`s.facility_id = $${params.length}`); }
  } else {
    applyFacilityFilter(req, 's.facility_id', cond, params);
  }
  return { facWhere: cond.length ? ' AND ' + cond.join(' AND ') : '', params };
}

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'staff'));

const SEV = v => (['minor', 'major', 'severe'].includes(v) ? v : 'minor');

// Gửi mail báo trường cho HV nếu ĐỦ ngưỡng và CHƯA từng báo. Trả kết quả mail (hoặc null).
// Gộp một chỗ để đường ghi vi phạm và đường "gửi lại" dùng chung, không lệch luật.
async function maybeNotifySchool(studentId, { force = false } = {}) {
  const student = (await query('SELECT id, name, code, class_name, phone FROM students WHERE id=$1 AND deleted_at IS NULL', [studentId])).rows[0];
  if (!student) return { skipped: 'student-missing' };
  const all = (await query('SELECT * FROM violations WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date, id', [studentId])).rows;
  const s = await getSettings();
  const threshold = +s.violation_mail_threshold || 3;
  if (all.length < threshold) return { skipped: 'under-threshold', count: all.length, threshold };
  // Đã báo trường rồi thì KHÔNG tự gửi lại (V2-01). force=true (nút "Gửi lại" thủ công) mới bỏ qua.
  const daBao = all.some(v => v.notified_school);
  if (daBao && !force) return { skipped: 'already-notified' };
  const mail = await sendViolationMail(student, all);
  if (mail.sent) {
    // Chỉ đánh dấu các dòng CHƯA XOÁ; giữ notified_at cũ (COALESCE) -> không mất mốc lần đầu báo (V2-01).
    await query(`UPDATE violations SET notified_school=true, notified_at=COALESCE(notified_at, now())
                 WHERE student_id=$1 AND deleted_at IS NULL`, [studentId]);
  }
  return { mail };
}

/* ---------- Danh mục loại vi phạm ---------- */
router.get('/types', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM violation_types ORDER BY sort, id');
    res.json(rows);
  } catch (e) { next(e); }
});
// Danh mục loại vi phạm là cấu hình -> CHỈ admin sửa (schema ghi rõ "sửa trong Cài đặt", mà Cài
// đặt là của admin). Trước đây cả staff cũng hạ severity / ẩn loại vi phạm được (V2-19).
router.post('/types', requireRole('admin'), async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nhập tên loại vi phạm' });
    const mx = await query('SELECT COALESCE(MAX(sort),0)+1 AS s FROM violation_types');
    const { rows } = await query('INSERT INTO violation_types (name, severity, sort) VALUES ($1,$2,$3) RETURNING *',
      [name, SEV(req.body.severity), mx.rows[0].s]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
router.put('/types/:id', requireRole('admin'), async (req, res, next) => {
  try {
    // V2-10: POST kiểm tên rỗng, PUT thì trước đây không -> tên loại thành chuỗi rỗng, danh mục hiện
    // dòng trắng, mail in "Vi phạm".
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nhập tên loại vi phạm' });
    const { rows } = await query('UPDATE violation_types SET name=$1, severity=$2, active=$3 WHERE id=$4 RETURNING *',
      [name, SEV(req.body.severity), req.body.active !== false, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});
// "Xóa" loại vi phạm = ẩn (deactivate), giữ lại để không mất dữ liệu tham chiếu
router.delete('/types/:id', requireRole('admin'), async (req, res, next) => {
  try { await query('UPDATE violation_types SET active=false WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { next(e); }
});

/* ---------- Trạng thái gửi mail (để cảnh báo trên UI) ---------- */
router.get('/mail-status', async (req, res, next) => {
  try { res.json(await mailStatus()); } catch (e) { next(e); }
});

/* ---------- Thống kê vi phạm ---------- */
router.get('/stats', async (req, res, next) => {
  try {
    const s = await getSettings();
    const threshold = +s.violation_mail_threshold || 3;
    const year = (req.query.year || new Date().toISOString().slice(0, 4));

    // Đa cơ sở: mọi thống kê JOIN students để LỌC theo cơ sở (điều hành thấy tổng; quản lý chỉ cơ sở mình).
    // Mỗi truy vấn dựng cond/params riêng (facility là tham số ĐẦU nên placeholder khớp).
    const facBase = () => { const c = ['v.deleted_at IS NULL', 's.deleted_at IS NULL'], p = []; applyFacilityFilter(req, 's.facility_id', c, p); return { c, p }; };
    const JV = 'FROM violations v JOIN students s ON s.id=v.student_id';

    const t = facBase();
    const total = (await query(`SELECT COUNT(*)::int c ${JV} WHERE ${t.c.join(' AND ')}`, t.p)).rows[0].c;
    const sv = facBase();
    const bySeverity = (await query(`SELECT v.severity, COUNT(*)::int c ${JV} WHERE ${sv.c.join(' AND ')} GROUP BY v.severity`, sv.p)).rows;
    const ty = facBase();
    const byType = (await query(`SELECT v.type_name, COUNT(*)::int c ${JV} WHERE ${ty.c.join(' AND ')} GROUP BY v.type_name ORDER BY c DESC`, ty.p)).rows;
    const mo = { c: [`to_char(v.date,'YYYY')=$1`, 'v.deleted_at IS NULL', 's.deleted_at IS NULL'], p: [String(year)] };
    applyFacilityFilter(req, 's.facility_id', mo.c, mo.p);
    const byMonth = (await query(
      `SELECT to_char(v.date,'YYYY-MM') AS month, COUNT(*)::int c ${JV}
       WHERE ${mo.c.join(' AND ')} GROUP BY month ORDER BY month`, mo.p)).rows;
    // Học viên theo số lần vi phạm (kèm cảnh báo ngưỡng gửi nhà trường)
    const bs = facBase();
    const byStudent = (await query(
      `SELECT s.id, s.name, s.code, s.class_name, r.name AS room_name,
        COUNT(v.id)::int AS cnt,
        MAX(v.date) AS last_date,
        BOOL_OR(v.notified_school) AS notified
       ${JV}
       LEFT JOIN rooms r ON r.id=s.room_id
       WHERE ${bs.c.join(' AND ')}
       GROUP BY s.id, s.name, s.code, s.class_name, r.name
       ORDER BY cnt DESC, last_date DESC`, bs.p)).rows;
    const needMail = byStudent.filter(x => x.cnt >= threshold && !x.notified).length;
    res.json({ threshold, total, bySeverity, byType, byMonth, byStudent, needMail });
  } catch (e) { next(e); }
});

/* ---------- Vi phạm theo học viên ---------- */
router.get('/student/:id', async (req, res, next) => {
  try {
    if (await blockByStudent(req, res, req.params.id)) return; // đa cơ sở
    const { rows } = await query('SELECT * FROM violations WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date DESC, id DESC', [req.params.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ---------- Danh sách tất cả vi phạm ---------- */
router.get('/', async (req, res, next) => {
  try {
    // Phân trang tuỳ chọn (như /students): có page/limit -> { rows, total, page, limit }, không thì cả list.
    const paged = req.query.page != null || req.query.limit != null;
    const { facWhere, params } = facilityScope(req);
    const baseFrom = `FROM violations v JOIN students s ON s.id=v.student_id
      LEFT JOIN rooms r ON r.id=s.room_id
      WHERE v.deleted_at IS NULL AND s.deleted_at IS NULL${facWhere}`;
    if (paged) {
      const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
      const page = Math.max(1, +req.query.page || 1);
      const total = (await query(`SELECT COUNT(*)::int c ${baseFrom}`, params)).rows[0].c;
      params.push(limit); const pL = params.length;
      params.push((page - 1) * limit); const pO = params.length;
      const { rows } = await query(
        `SELECT v.*, s.name AS student_name, s.code AS student_code, r.name AS room_name ${baseFrom}
         ORDER BY v.date DESC, v.id DESC LIMIT $${pL} OFFSET $${pO}`, params);
      return res.json({ rows, total, page, limit });
    }
    const { rows } = await query(
      `SELECT v.*, s.name AS student_name, s.code AS student_code, r.name AS room_name ${baseFrom}
       ORDER BY v.date DESC, v.id DESC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ---------- Ghi nhận vi phạm mới ---------- */
router.post('/', async (req, res, next) => {
  try {
    const b = req.body;
    // V2-09: gõ nhầm tên trường (violation_date thay vì date) trước đây bị nuốt im lặng + tự lấy hôm nay.
    const bad = rejectUnknown(b, ['student_id', 'type_id', 'date', 'note']);
    if (bad) return res.status(400).json({ error: bad });
    // V2-04: HV phải TỒN TẠI + chưa xoá (trước thiếu deleted_at -> ghi vi phạm cho HV đã xoá, mail vẫn bay).
    const student = (await query('SELECT id, name FROM students WHERE id=$1 AND deleted_at IS NULL', [b.student_id])).rows[0];
    if (!student) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    if (await blockByStudent(req, res, b.student_id)) return; // đa cơ sở: không ghi vi phạm cho HV cơ sở khác
    // V2-06: loại vi phạm BẮT BUỘC chọn từ danh mục (type_id), phải tồn tại + đang active. Không cho
    // gõ tay type_name/severity (V2-07: severity lấy từ loại, không nhận chuỗi tự do rồi âm thầm hạ 'minor').
    if (!b.type_id) return res.status(400).json({ error: 'Chọn loại vi phạm từ danh mục' });
    const ty = (await query('SELECT id, name, severity, active FROM violation_types WHERE id=$1', [b.type_id])).rows[0];
    if (!ty) return res.status(400).json({ error: 'Loại vi phạm không tồn tại' });
    if (ty.active === false) return res.status(400).json({ error: `Loại vi phạm "${ty.name}" đã ngừng sử dụng` });
    // V2-10: ngày phải HỢP LỆ trên lịch (chặn 2026-02-30 -> 500) và KHÔNG ở tương lai.
    const date = b.date || new Date().toISOString().slice(0, 10);
    if (!isValidYmd(date)) return res.status(400).json({ error: `Ngày vi phạm không hợp lệ: "${b.date}"` });
    if (date > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Ngày vi phạm không thể ở tương lai' });
    if (b.note && String(b.note).length > 1000) return res.status(400).json({ error: 'Ghi chú quá dài (tối đa 1000 ký tự)' });

    // GHI trong transaction, KHOÁ HV -> hai staff ghi cùng lúc không cùng thấy "đủ ngưỡng" rồi gửi 2 mail (V2-02).
    const out = await withTransaction(async (client) => {
      await client.query('SELECT id FROM students WHERE id=$1 FOR UPDATE', [b.student_id]);
      const ins = await client.query(
        `INSERT INTO violations (student_id, type_id, type_name, severity, date, note, created_by, level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1) RETURNING *`,
        [b.student_id, ty.id, ty.name, ty.severity, date, b.note || '', req.user.id]);
      // V2-05: đánh lại "lần thứ N" theo THỨ TỰ NGÀY cho toàn bộ (kể cả vừa chèn) -> backdate không
      // bị gán nhầm level cao. Một công thức level duy nhất (ROW_NUMBER by date) cho cả insert lẫn delete.
      await client.query(`UPDATE violations v SET level = sub.rn
        FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY date, id) AS rn FROM violations WHERE student_id=$1 AND deleted_at IS NULL) sub
        WHERE v.id = sub.id`, [b.student_id]);
      const cnt = (await client.query('SELECT COUNT(*)::int c FROM violations WHERE student_id=$1 AND deleted_at IS NULL', [b.student_id])).rows[0].c;
      const daBao = (await client.query('SELECT 1 FROM violations WHERE student_id=$1 AND deleted_at IS NULL AND notified_school=true LIMIT 1', [b.student_id])).rows.length > 0;
      const s = await getSettings();
      const threshold = +s.violation_mail_threshold || 3;
      // Quyết định gửi + đánh dấu NGAY trong transaction (chống 2 mail). Mail thật gửi SAU commit.
      const willSend = cnt >= threshold && !daBao;
      if (willSend) await client.query(`UPDATE violations SET notified_school=true, notified_at=COALESCE(notified_at, now()) WHERE student_id=$1 AND deleted_at IS NULL`, [b.student_id]);
      const v = (await client.query('SELECT * FROM violations WHERE id=$1', [ins.rows[0].id])).rows[0];
      return { violation: v, cnt, threshold, willSend };
    });
    // Trả response NGAY, gửi mail Ở NỀN (P-03): SMTP chậm/treo tới 12s trước đây giữ chân cả
    // request — staff bấm ghi vi phạm phải chờ 12s. Cờ notified_school đã set trong transaction nên
    // không lo gửi 2 mail; nếu gửi FAIL thì gỡ cờ ở nền để nút "Gửi lại" thủ công dùng được.
    res.status(201).json({
      violation: out.violation, level: out.violation.level, threshold: out.threshold,
      mail: out.willSend ? { queued: true } : null,
    });
    if (out.willSend) {
      (async () => {
        try {
          const st = (await query('SELECT id, name, code, class_name, phone FROM students WHERE id=$1', [b.student_id])).rows[0];
          const all = (await query('SELECT * FROM violations WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date, id', [b.student_id])).rows;
          const mail = await sendViolationMail(st, all);
          if (!mail.sent) {
            await query(`UPDATE violations SET notified_school=false, notified_at=NULL WHERE student_id=$1 AND deleted_at IS NULL`, [b.student_id]);
            console.error('[violations] gửi mail báo trường THẤT BẠI (đã gỡ cờ để gửi lại được):', mail.reason);
          }
        } catch (e) { console.error('[violations] lỗi gửi mail nền:', e.message); }
      })();
    }
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (await blockByViolation(req, res, req.params.id)) return; // đa cơ sở
    const b = req.body;
    const bad = rejectUnknown(b, ['note', 'admin_note', 'status']);
    if (bad) return res.status(400).json({ error: bad });
    // V2-07: status chỉ 'open'|'resolved'; gõ sai -> 400, đừng âm thầm ép 'open'.
    if (b.status != null && !['open', 'resolved'].includes(b.status))
      return res.status(400).json({ error: `Trạng thái không hợp lệ: "${b.status}" (chỉ 'open' hoặc 'resolved')` });
    // V2-08: chỉ đổi field CÓ gửi (COALESCE) — trước đây đổi mỗi status cũng xoá trắng note + admin_note.
    const { rows } = await query(
      `UPDATE violations SET
         note = CASE WHEN $1::text IS NULL THEN note ELSE $1 END,
         admin_note = CASE WHEN $2::text IS NULL THEN admin_note ELSE $2 END,
         status = COALESCE($3, status)
       WHERE id=$4 AND deleted_at IS NULL RETURNING *`,
      [b.note != null ? String(b.note) : null, b.admin_note != null ? String(b.admin_note) : null, b.status || null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Xóa mềm
router.delete('/:id', async (req, res, next) => {
  try {
    if (await blockByViolation(req, res, req.params.id)) return; // đa cơ sở
    const row = (await query('SELECT student_id FROM violations WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Không tìm thấy vi phạm' });
    await query('UPDATE violations SET deleted_at=now() WHERE id=$1', [req.params.id]);
    // Đánh lại "lần thứ N" cho các vi phạm còn lại theo thứ tự ngày (cùng công thức với lúc ghi)
    await query(`UPDATE violations v SET level = sub.rn
      FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY date, id) AS rn FROM violations WHERE student_id=$1 AND deleted_at IS NULL) sub
      WHERE v.id = sub.id`, [row.student_id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Gửi (lại) mail nhà trường thủ công cho 1 học viên
router.post('/student/:id/notify', async (req, res, next) => {
  try {
    if (await blockByStudent(req, res, req.params.id)) return; // đa cơ sở
    // V2-03: kiểm NGƯỠNG trước — bấm "Gửi mail" khi HV mới vi phạm 1 lần thì KHÔNG gửi.
    // force=true: đây là hành động thủ công của staff -> cho gửi lại kể cả đã báo (vd lần auto bị lỗi),
    // nhưng vẫn phải đủ ngưỡng.
    const r = await maybeNotifySchool(+req.params.id, { force: true });
    if (r.skipped === 'student-missing') return res.status(404).json({ error: 'Không tìm thấy học viên' });
    if (r.skipped === 'under-threshold')
      return res.status(400).json({ error: `Chưa đủ ngưỡng gửi mail (mới ${r.count}/${r.threshold} vi phạm)` });
    res.json({ mail: r.mail });
  } catch (e) { next(e); }
});

module.exports = router;
