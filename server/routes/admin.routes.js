const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth, requireRole, revokeTokens } = require('../auth');
const { checkPassword } = require('../valid');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

/* ---------- Nhật ký thao tác (audit) ---------- */
// ---- TÌNH TRẠNG DỮ LIỆU ----
// Ràng buộc ở CSDL chỉ áp được khi dữ liệu sạch. Cái nào chưa áp được thì nằm trong schema_guard —
// nhưng chị quản lý không đọc nhật ký máy chủ, nên phải bày ra đây kèm ĐÍCH DANH bản ghi cần sửa.
// Không có màn này thì ràng buộc trượt trong im lặng: ai cũng tưởng được bảo vệ, thật ra không.
const KIEM_TRA = [
  {
    ma: 'ma_hv_trung', ten: 'Học viên trùng mã',
    vi_sao: 'Một người có 2 hồ sơ → nhận 2 phiếu → bị thu tiền 2 lần.',
    cach_sua: 'Giữ 1 hồ sơ, xoá hồ sơ thừa. Nếu bạn ấy chuyển phòng, dùng nút "Chuyển phòng" trên hồ sơ giữ lại.',
    sql: `SELECT s.code AS khoa, string_agg(s.name || ' (#' || s.id || COALESCE(' · ' || r.name, '') || ')', ' + ' ORDER BY s.id) AS chi_tiet
            FROM students s LEFT JOIN rooms r ON r.id = s.room_id
           WHERE s.deleted_at IS NULL AND COALESCE(btrim(s.code),'') <> ''
           GROUP BY s.code HAVING COUNT(*) > 1 ORDER BY s.code`,
  },
  {
    ma: 'ngay_ra_truoc_ngay_vao', ten: 'Ngày trả phòng trước ngày nhận phòng',
    vi_sao: 'Thường là gõ nhầm NĂM. Số ngày ở tính ra 0 → phiếu sai.',
    cach_sua: 'Mở hồ sơ, sửa lại năm cho đúng.',
    sql: `SELECT name AS khoa, 'vào ' || check_in_date || ' · ra ' || check_out_date || ' (#' || id || ')' AS chi_tiet
            FROM students WHERE deleted_at IS NULL AND check_out_date < check_in_date ORDER BY check_out_date - check_in_date`,
  },
  {
    ma: 'cccd_trung', ten: 'Học viên trùng CCCD',
    vi_sao: 'Hai người không thể chung một CCCD → chắc chắn có hồ sơ thừa.',
    cach_sua: 'Giữ 1 hồ sơ, xoá hồ sơ thừa.',
    sql: `SELECT id_card AS khoa, string_agg(name || ' (#' || id || ')', ' + ' ORDER BY id) AS chi_tiet
            FROM students WHERE deleted_at IS NULL AND COALESCE(btrim(id_card),'') <> ''
            GROUP BY id_card HAVING COUNT(*) > 1`,
  },
  {
    ma: 'so_hd_trung', ten: 'Trùng số hợp đồng',
    vi_sao: 'Hai người cầm cùng một số hợp đồng.',
    cach_sua: 'Đối chiếu hợp đồng giấy, sửa lại số cho đúng người.',
    sql: `SELECT contract_no AS khoa, string_agg(name || ' (#' || id || ')', ' + ' ORDER BY id) AS chi_tiet
            FROM students WHERE deleted_at IS NULL AND COALESCE(btrim(contract_no),'') <> ''
            GROUP BY contract_no HAVING COUNT(*) > 1 ORDER BY contract_no`,
  },
];

router.get('/data-health', async (req, res, next) => {
  try {
    const guards = (await query('SELECT ten, loi FROM schema_guard ORDER BY ten')).rows;
    const out = [];
    for (const k of KIEM_TRA) {
      const { rows } = await query(k.sql);
      out.push({ ma: k.ma, ten: k.ten, vi_sao: k.vi_sao, cach_sua: k.cach_sua, so_luong: rows.length, rows: rows.slice(0, 30) });
    }
    res.json({ guards, checks: out, sach: guards.length === 0 && out.every(c => c.so_luong === 0) });
  } catch (e) { next(e); }
});

// Nhật ký có LỌC ĐƯỢC thì mới điều tra được. Trước đây chỉ nhận limit (trần 500) -> sau vài tuần
// 500 dòng mới nhất chỉ còn vài ngày, sự cố 3 tháng trước nằm trong CSDL mà lấy không ra (V2-66).
router.get('/audit', async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, +req.query.limit || 200));
    const offset = Math.max(0, +req.query.offset || 0);   // lật trang -> với tới dòng cũ
    const where = [], params = [];
    if (req.query.user) { params.push('%' + req.query.user + '%'); where.push(`username ILIKE $${params.length}`); }
    if (req.query.method) { params.push(req.query.method.toUpperCase()); where.push(`method = $${params.length}`); }
    // Lọc theo khoảng ngày (from/to là YYYY-MM-DD). to là trọn ngày -> so < to + 1 ngày.
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { params.push(req.query.from); where.push(`at >= $${params.length}::date`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { params.push(req.query.to); where.push(`at < ($${params.length}::date + 1)`); }
    if (req.query.path) { params.push('%' + req.query.path + '%'); where.push(`path ILIKE $${params.length}`); }
    const sqlWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await query(`SELECT COUNT(*)::int c FROM audit_log ${sqlWhere}`, params)).rows[0].c;
    params.push(limit); const pLimit = params.length;
    params.push(offset); const pOffset = params.length;
    const { rows } = await query(
      `SELECT * FROM audit_log ${sqlWhere} ORDER BY at DESC LIMIT $${pLimit} OFFSET $${pOffset}`, params);
    res.json({ total, limit, offset, rows });
  } catch (e) { next(e); }
});

/* ---------- Quản lý tài khoản nhân viên ---------- */
// Chỉ 3 vai này được tạo/sửa qua trang quản trị (tài khoản học viên do luồng khác cấp).
// KHÔNG ép thầm lặng vai lạ thành 'staff' như trước: gõ nhầm "admn" hay xin "student" mà ra
// "staff" thì người tạo không hề biết mình vừa tạo sai loại tài khoản.
const VALID_ROLES = ['admin', 'staff', 'maintenance'];
// Fragment SQL cho IN (...) — dựng TỪ VALID_ROLES (hằng nội bộ, không phải input người dùng) để không
// lặp chuỗi 'admin','staff','maintenance' nhiều nơi; thêm/bớt vai chỉ sửa một chỗ.
// 'pending' = tài khoản do đăng nhập Microsoft TỰ TẠO, chưa được duyệt. KHÔNG nằm trong VALID_ROLES
// (admin không gán tay vai này) nhưng PHẢI nằm trong nhóm quản lý được — nếu không thì tài khoản
// chờ duyệt vô hình với admin, không ai duyệt được, người dùng kẹt vĩnh viễn.
const MANAGEABLE_ROLES = [...VALID_ROLES, 'pending'];
const MANAGED_ROLES_SQL = MANAGEABLE_ROLES.map(r => `'${r}'`).join(',');

router.get('/users', async (req, res, next) => {
  try {
    // facility_id NULL = ĐIỀU HÀNH (thấy mọi cơ sở); có giá trị = quản lý đúng cơ sở đó.
    const { rows } = await query(
      `SELECT u.id, u.username, u.role, u.full_name, u.facility_id, f.name AS facility_name, u.created_at,
              u.email, u.auth_provider, u.approved
         FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
        WHERE u.role IN (${MANAGED_ROLES_SQL}) AND u.deleted_at IS NULL
        ORDER BY u.role, u.username`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Chuẩn hoá + kiểm tra facility_id gửi lên. Trả { ok, value } hoặc { ok:false, error }.
//   '' / null / bỏ trống -> NULL (điều hành). Có giá trị -> phải là cơ sở tồn tại, chưa xoá.
async function parseFacilityId(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Cơ sở không hợp lệ' };
  const f = await query('SELECT 1 FROM facilities WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!f.rows.length) return { ok: false, error: 'Cơ sở không tồn tại (hoặc đã bị xoá)' };
  return { ok: true, value: id };
}

router.post('/users', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();
    if (!username) return res.status(400).json({ error: 'Nhập tên đăng nhập' });
    const role = req.body.role == null || req.body.role === '' ? 'staff' : req.body.role;
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Vai trò không hợp lệ: "${req.body.role}". Chỉ nhận: nhân viên, bảo trì, quản trị.` });
    const loiMk = checkPassword(password, [username, req.body.full_name]);
    if (loiMk) return res.status(400).json({ error: loiMk });
    // Đa cơ sở: NULL = điều hành (thấy tất cả); có id = quản lý đúng cơ sở đó.
    const fac = await parseFacilityId(req.body.facility_id);
    if (!fac.ok) return res.status(400).json({ error: fac.error });
    // ADMIN LUÔN là điều hành: bỏ qua facility_id gửi lên, không gán cơ sở cho admin (chốt 18/07).
    const facValue = role === 'admin' ? null : fac.value;
    // Trùng tên: chỉ tính tài khoản CÒN HIỆU LỰC (chưa xoá). Tài khoản đã xoá được đổi tên để nhả
    // tên gốc ra (xem route DELETE) nên đường này chủ yếu chặn trùng với tài khoản đang dùng.
    const dup = await query('SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL', [username]);
    if (dup.rows.length) return res.status(400).json({ error: `Tên đăng nhập "${username}" đã tồn tại` });
    // Tài khoản do quản trị tạo -> buộc nhân viên đổi mật khẩu ở lần đăng nhập đầu
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, role, full_name, facility_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id, username, role, full_name, facility_id`,
      [username, bcrypt.hashSync(password, 10), role, (req.body.full_name || '').trim(), facValue]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const id = +req.params.id;
    const hasRole = req.body.role != null && req.body.role !== '';
    if (hasRole && !VALID_ROLES.includes(req.body.role))
      return res.status(400).json({ error: `Vai trò không hợp lệ: "${req.body.role}".` });
    const cur = (await query(`SELECT role FROM users WHERE id=$1 AND role IN (${MANAGED_ROLES_SQL}) AND deleted_at IS NULL`, [id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    // Vai MỚI = vai gửi lên (nếu có) hoặc GIỮ NGUYÊN vai cũ. Trước đây thiếu trường role thì
    // ROLE(undefined) trả 'staff' -> admin sửa mỗi họ tên mà TỰ TỤT XUỐNG nhân viên, mất quyền
    // vĩnh viễn, không một lời cảnh báo (V2-71). Và chốt chặn cũ chỉ chạy khi role CÓ giá trị.
    const newRole = hasRole ? req.body.role : cur.role;
    if (id === req.user.id && newRole !== 'admin')
      return res.status(400).json({ error: 'Không thể tự hạ quyền chính mình.' });
    // Giữ ít nhất 1 quản trị: hạ quyền admin cuối cùng thì cả hệ thống mất người cấp quyền.
    if (cur.role === 'admin' && newRole !== 'admin') {
      const admins = (await query("SELECT COUNT(*)::int c FROM users WHERE role='admin' AND deleted_at IS NULL")).rows[0].c;
      if (admins <= 1) return res.status(400).json({ error: 'Phải còn ít nhất 1 quản trị viên — không thể hạ quyền người cuối cùng.' });
    }
    // full_name: chỉ đổi khi CÓ gửi (COALESCE), đừng xoá trắng khi caller chỉ đổi vai.
    const hasName = req.body.full_name != null;
    // Đa cơ sở: chỉ đổi facility_id khi CÓ gửi field (giống full_name). '' / null -> NULL (điều hành).
    // requireAuth đọc lại facility_id từ DB mỗi request nên đổi xong có hiệu lực ngay, không cần thu hồi vé.
    let hasFac = req.body.facility_id !== undefined;
    let facVal = null;
    if (hasFac) {
      const fac = await parseFacilityId(req.body.facility_id);
      if (!fac.ok) return res.status(400).json({ error: fac.error });
      facVal = fac.value;
    }
    // ADMIN LUÔN là điều hành: nếu vai (mới) là admin thì ÉP facility_id=null, kể cả khi caller không
    // gửi facility_id (vd nâng staff-có-cơ-sở lên admin mà quên bỏ cơ sở) (chốt 18/07).
    if (newRole === 'admin') { hasFac = true; facVal = null; }
    // Gán cho tài khoản chờ duyệt một vai THẬT = chính là hành động DUYỆT nó. Không tách nút riêng:
    // admin phải chọn vai + cơ sở rồi mới duyệt được, tránh duyệt xong mà tài khoản chưa có quyền gì.
    const duyet = cur.role === 'pending' && newRole !== 'pending';
    await query(
      `UPDATE users SET full_name = CASE WHEN $1 THEN $2 ELSE full_name END, role=$3,
         facility_id = CASE WHEN $5 THEN $6 ELSE facility_id END,
         approved = CASE WHEN $7 THEN true ELSE approved END
       WHERE id=$4 AND role IN (${MANAGED_ROLES_SQL}) AND deleted_at IS NULL`,
      [hasName, (req.body.full_name || '').trim(), newRole, id, hasFac, facVal, duyet]);
    // Đổi vai trò -> THU HỒI vé cũ ngay (người vừa bị giáng chức không giữ quyền admin 30 ngày).
    if (newRole !== cur.role) await revokeTokens(id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/users/:id/password', async (req, res, next) => {
  try {
    const password = (req.body.password || '').trim();
    const uNow = (await query('SELECT username, full_name FROM users WHERE id=$1', [req.params.id])).rows[0] || {};
    const loiMk = checkPassword(password, [uNow.username, uNow.full_name]);
    if (loiMk) return res.status(400).json({ error: loiMk });
    // Đặt lại mật khẩu -> buộc người dùng đổi lại ở lần đăng nhập kế tiếp
    await query('UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2', [bcrypt.hashSync(password, 10), req.params.id]);
    await revokeTokens(+req.params.id); // đá mọi phiên đang mở của tài khoản đó
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    const id = +req.params.id;
    if (id === req.user.id) return res.status(400).json({ error: 'Không thể xóa chính mình' });
    const admins = (await query("SELECT COUNT(*)::int c FROM users WHERE role='admin' AND deleted_at IS NULL")).rows[0].c;
    const target = (await query('SELECT role FROM users WHERE id=$1', [id])).rows[0];
    if (target && target.role === 'admin' && admins <= 1) return res.status(400).json({ error: 'Phải còn ít nhất 1 quản trị viên' });
    // Vô hiệu hóa (xóa mềm) — giữ lại lịch sử thao tác của tài khoản.
    // ĐỔI TÊN tài khoản đã xoá để NHẢ tên gốc ra: có ràng buộc UNIQUE trên username nên nếu giữ
    // nguyên tên thì tên đó không bao giờ dùng lại được, kể cả khi tài khoản đã xoá (V2-76).
    // Nhân viên nghỉ rồi vào lại, hay gõ nhầm tên lúc tạo, không phải bịa tên khác mãi.
    // Lịch sử thao tác trong audit_log lưu snapshot username riêng nên không mất dấu.
    await query(
      `UPDATE users SET deleted_at=now(), username = username || '#da-xoa-' || id
       WHERE id=$1 AND role IN (${MANAGED_ROLES_SQL})`, [id]);
    await revokeTokens(id); // đá ngay mọi phiên đang mở của tài khoản vừa bị vô hiệu hoá
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
