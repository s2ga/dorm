const express = require('express');
const roomLeaders = require('../room-leaders');
const { isValidYmd } = require('../valid');
const { recalcInvoice } = require('../invoice-calc');
const { query, getSettings } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { applyFacilityFilter, isExecutive, assertFacility, resolveFacilityForCreate } = require('../scope');

const router = express.Router();
router.use(requireAuth);

// Sức chứa & giá phòng phải hợp lý. Trước đây lưu được capacity=-5 (làm mọi phép tính giường trống sai)
// và monthly_fee=-9.000.000 (hoá đơn âm). "Hạng D = 3 giường" chỉ là quy ước trên giao diện.
const CAP_MAX = { A: 8, B: 8, C: 8, D: 8 };  // fallback khi settings rỗng
// Trần giường theo hạng LẤY TỪ Cài đặt (room_cap_A..D), không hard-code — chỉnh không cần sửa code.
function capsFromSettings(s) {
  const n = (k, d) => { const v = +((s && s[k])); return Number.isFinite(v) && v > 0 ? v : d; };
  return { A: n('room_cap_A', 8), B: n('room_cap_B', 8), C: n('room_cap_C', 8), D: n('room_cap_D', 8) };
}
function badRoom(b, cur = {}, caps = CAP_MAX) {
  const g = (k) => (b[k] !== undefined ? b[k] : cur[k]);
  const cap = Number(g('capacity'));
  if (g('capacity') !== undefined && g('capacity') !== null && g('capacity') !== '') {
    if (!Number.isFinite(cap)) return `Sức chứa phải là số (đang nhận: "${g('capacity')}")`;
    if (cap < 0) return `Sức chứa không được âm (đang nhận: ${cap})`;
    const max = caps[String(g('hang') || 'B').toUpperCase()] || 8;
    if (cap > max) return `Sức chứa ${cap} vượt mức hợp lý cho phòng hạng ${g('hang') || 'B'} (tối đa ${max} giường)`;
  }
  const fee = Number(g('monthly_fee'));
  if (g('monthly_fee') !== undefined && g('monthly_fee') !== null && g('monthly_fee') !== '') {
    if (!Number.isFinite(fee)) return `Giá phòng phải là số (đang nhận: "${g('monthly_fee')}")`;
    if (fee < 0) return `Giá phòng không được âm (đang nhận: ${fee})`;
  }
  return null;
}

// Danh sách phòng kèm số người đang ở + tên cơ sở. ?deleted=1 -> chỉ phòng đã xóa
router.get('/', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const cond = [req.query.deleted === '1' ? 'r.deleted_at IS NOT NULL' : 'r.deleted_at IS NULL'];
    const params = [];
    // Đa cơ sở: điều hành lọc tuỳ chọn ?facility; quản lý cơ sở bị ÉP theo cơ sở của mình.
    if (isExecutive(req)) {
      if (req.query.facility) { params.push(+req.query.facility); cond.push(`r.facility_id = $${params.length}`); }
    } else {
      applyFacilityFilter(req, 'r.facility_id', cond, params);
    }
    const { rows } = await query(`
      SELECT r.*, f.name AS facility_name,
        (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.deleted_at IS NULL
           AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE))::int AS occupancy,
        (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.deleted_at IS NULL AND s.check_in_date > CURRENT_DATE)::int AS upcoming,
        (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.deleted_at IS NULL
           AND s.check_out_date IS NOT NULL AND s.check_out_date > CURRENT_DATE)::int AS leaving
      FROM rooms r
      LEFT JOIN facilities f ON f.id = r.facility_id
      WHERE ${cond.join(' AND ')}
      ORDER BY r.floor, r.name`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

const HANG = h => (['A', 'B', 'C', 'D'].includes(h) ? h : 'B');
const RTYPE = t => (['shared', 'whole', 'security', 'staff'].includes(t) ? t : 'shared');
// Tầng suy ra từ chữ số đầu tiên của tên phòng (VD 104 -> 1, A203 -> 2)
const floorOf = name => { const m = String(name || '').match(/\d/); return m ? +m[0] : 1; };

// Cơ sở phải TỒN TẠI + chưa xoá thì mới gán phòng vào (V2-34: trước đây nhận facility_id tuỳ ý,
// gán phòng mới / khôi phục phòng vào một "cơ sở ma" đã bị xoá).
async function facilityOk(facilityId) {
  if (facilityId == null) return true;   // phòng không thuộc cơ sở nào -> chấp nhận
  const f = (await query('SELECT 1 FROM facilities WHERE id=$1 AND deleted_at IS NULL', [facilityId])).rows[0];
  return !!f;
}

router.post('/', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { name, gender, hang, capacity, monthly_fee, note, room_type } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nhập tên phòng' });
    // Đa cơ sở: quản lý cơ sở LUÔN tạo phòng thuộc cơ sở mình (bỏ qua facility_id client gửi, chống lách).
    const facility_id = resolveFacilityForCreate(req, req.body.facility_id);
    if (!(await facilityOk(facility_id || null))) return res.status(400).json({ error: 'Cơ sở không tồn tại hoặc đã bị xoá' });
    const badR = badRoom(req.body, {}, capsFromSettings(await getSettings()));
    if (badR) return res.status(400).json({ error: badR });
    // Trùng tên phòng trong cùng cơ sở -> nhân viên xếp nhầm người
    const dupR = await query(
      `SELECT 1 FROM rooms WHERE lower(trim(name))=lower(trim($1)) AND COALESCE(facility_id,0)=COALESCE($2,0) AND deleted_at IS NULL`,
      [name, facility_id || null]);
    if (dupR.rows[0]) return res.status(400).json({ error: `Phòng "${name.trim()}" đã tồn tại trong cơ sở này` });
    const { rows } = await query(
      `INSERT INTO rooms (facility_id, name, floor, gender, hang, capacity, monthly_fee, note, room_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [facility_id || null, name.trim(), floorOf(name), gender === 'female' ? 'female' : 'male',
       HANG(hang), +capacity || 0, +monthly_fee || 0, note || '', RTYPE(room_type)]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/:id', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    // MERGE với bản ghi hiện tại — field không gửi thì giữ nguyên (chống mất dữ liệu / reset room_type, capacity)
    const cur = (await query('SELECT * FROM rooms WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy phòng' });
    const badF = assertFacility(req, cur.facility_id); if (badF) return res.status(badF.status).json(badF); // đa cơ sở
    const raw = req.body || {};
    const g = (k, def) => (raw[k] !== undefined ? raw[k] : def);
    const name = g('name', cur.name);
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nhập tên phòng' });
    if (raw.facility_id !== undefined && !(await facilityOk(raw.facility_id || null)))
      return res.status(400).json({ error: 'Cơ sở không tồn tại hoặc đã bị xoá' });
    const badR = badRoom(raw, cur, capsFromSettings(await getSettings()));
    if (badR) return res.status(400).json({ error: badR });
    const dupR = await query(
      `SELECT 1 FROM rooms WHERE lower(trim(name))=lower(trim($1)) AND COALESCE(facility_id,0)=COALESCE($2,0) AND id<>$3 AND deleted_at IS NULL`,
      [name, g('facility_id', cur.facility_id) || null, req.params.id]);
    if (dupR.rows[0]) return res.status(400).json({ error: `Phòng "${String(name).trim()}" đã tồn tại trong cơ sở này` });
    // BLK-2: đổi giới tính phòng KHÔNG được để lại người khác giới đang ở. checkRoomAssignment chỉ gác
    // chiều "xếp người vào phòng", không gác chiều "đổi phòng dưới chân người đang ở" — nếu không kiểm,
    // đổi phòng nam (đang có 3 nam) thành "nữ" sẽ tạo phòng nữ chứa nam, rồi hệ thống cho xếp thêm nữ
    // vào ở chung với nam, phá bất biến "nam không ở phòng nữ".
    const newGender = g('gender', cur.gender) === 'female' ? 'female' : 'male';
    if (newGender !== cur.gender) {
      const conflict = (await query(
        `SELECT COUNT(*)::int c FROM students WHERE room_id=$1 AND deleted_at IS NULL AND status='in' AND gender<>$2`,
        [req.params.id, newGender])).rows[0].c;
      if (conflict > 0) return res.status(400).json({ error: `Phòng đang có ${conflict} người ${newGender === 'female' ? 'nam' : 'nữ'} đang ở — chuyển họ sang phòng khác trước khi đổi thành phòng ${newGender === 'female' ? 'nữ' : 'nam'}.` });
    }
    const { rows } = await query(
      `UPDATE rooms SET facility_id=$1, name=$2, floor=$3, gender=$4, hang=$5, capacity=$6, monthly_fee=$7, note=$8, room_type=$9
       WHERE id=$10 RETURNING *`,
      [resolveFacilityForCreate(req, g('facility_id', cur.facility_id)) || null, String(name).trim(), floorOf(name),
       g('gender', cur.gender) === 'female' ? 'female' : 'male', HANG(g('hang', cur.hang)),
       +g('capacity', cur.capacity) || 0, +g('monthly_fee', cur.monthly_fee) || 0,
       g('note', cur.note) || '', RTYPE(g('room_type', cur.room_type)), req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Xóa mềm: đánh dấu deleted_at (khôi phục được), không xóa hẳn
router.delete('/:id', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    // Đa cơ sở: quản lý cơ sở chỉ xoá phòng của cơ sở mình.
    const rm = (await query('SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!rm) return res.status(404).json({ error: 'Không tìm thấy phòng' });
    const badF = assertFacility(req, rm.facility_id); if (badF) return res.status(badF.status).json(badF);
    // CHỈ đếm học viên CHƯA BỊ XOÁ. Trước đây đếm cả HV đã xoá -> xoá hết người rồi mà phòng vẫn
    // báo "đang có học viên ở" -> phòng kẹt vĩnh viễn không xoá được.
    const { rows } = await query(
      `SELECT COUNT(*)::int c, COUNT(*) FILTER (WHERE check_in_date > CURRENT_DATE)::int sap_vao
       FROM students WHERE room_id=$1 AND deleted_at IS NULL AND status='in'`, [req.params.id]);
    if (rows[0].c > 0) {
      const sv = rows[0].sap_vao;
      return res.status(400).json({
        error: `Phòng đang gán cho ${rows[0].c} học viên${sv ? ` (trong đó ${sv} người chưa đến ngày nhận phòng)` : ''}, không thể xóa. Chuyển họ sang phòng khác trước.`,
      });
    }
    await query('UPDATE rooms SET deleted_at=now() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Khôi phục phòng đã xóa
router.post('/:id/restore', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const r = (await query('SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NOT NULL', [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Không tìm thấy phòng đã xoá' });
    // Không khôi phục phòng vào cơ sở ĐÃ XOÁ -> phòng "ma" trỏ về cơ sở không còn tồn tại (V2-34).
    if (!(await facilityOk(r.facility_id))) return res.status(400).json({ error: 'Cơ sở của phòng này đã bị xoá — khôi phục cơ sở trước, hoặc chuyển phòng sang cơ sở khác.' });
    await query('UPDATE rooms SET deleted_at=NULL WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---- Phòng trưởng ---- */
// Ai đang làm phòng trưởng của phòng này + lịch sử các nhiệm kỳ
router.get('/:id/leader', async (req, res, next) => {
  try {
    const current = await roomLeaders.currentOf(null, req.params.id);
    const { rows } = await query(
      `SELECT rl.*, s.name AS student_name FROM room_leaders rl
         JOIN students s ON s.id = rl.student_id
        WHERE rl.room_id=$1 ORDER BY rl.from_date DESC`, [req.params.id]);
    res.json({ current, history: rows });
  } catch (e) { next(e); }
});

// Cử phòng trưởng. Người cũ (nếu có) tự động kết thúc nhiệm kỳ hết ngày hôm trước.
router.post('/:id/leader', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { student_id, date, note } = req.body;
    if (!student_id) return res.status(400).json({ error: 'Chọn học viên làm phòng trưởng' });
    if (date != null && !isValidYmd(date)) return res.status(400).json({ error: 'Ngày nhận nhiệm vụ không hợp lệ' });
    const d = date || new Date().toISOString().slice(0, 10);

    const r = await roomLeaders.setLeader(null, { roomId: +req.params.id, studentId: +student_id, date: d, note, by: req.user && req.user.username });
    if (r.error) return res.status(400).json({ error: r.error });
    if (r.already) return res.json({ ok: true, already: true, leader: r.leader });

    // Đổi phòng trưởng = đổi tiền: người mới được miễn nước+dịch vụ, người cũ mất phần từ ngày này.
    // Tính lại phiếu cho CẢ HAI ngay, đừng để sổ sách nói một đằng thực tế một nẻo.
    const month = d.slice(0, 7);
    const ids = new Set([+student_id]);
    if (r.replaced) ids.add(r.replaced.student_id);
    const recalced = [];
    for (const sid of ids) { try { if (await recalcInvoice(sid, month)) recalced.push(sid); } catch (e) {} }
    res.json({ ok: true, leader: r.leader, replaced: r.replaced || null, recalced });
  } catch (e) { next(e); }
});

// Miễn nhiệm phòng trưởng (phòng không còn phòng trưởng nữa)
router.delete('/:id/leader', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const d = req.query.date && isValidYmd(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const closed = await roomLeaders.closeRoom(null, req.params.id, d);
    if (!closed) return res.status(404).json({ error: 'Phòng này chưa có phòng trưởng' });
    let recalced = null;
    try { recalced = await recalcInvoice(closed.student_id, d.slice(0, 7)); } catch (e) {}
    res.json({ ok: true, closed, recalced: recalced ? closed.student_id : null });
  } catch (e) { next(e); }
});

module.exports = router;
