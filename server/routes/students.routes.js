const express = require('express');
const bcrypt = require('bcryptjs');
const { query, withTransaction, getSettings } = require('../db');
const { requireAuth, requireRole, revokeTokens } = require('../auth');
const { depositRefundEligible } = require('../billing');
const { recalcInvoice } = require('../invoice-calc');
const storage = require('../storage');
const { cccdUrls, SIDE_COL } = require('../cccd-url');
const { isValidYmd, isValidPhone, rejectUnknown, INITIAL_PASSWORD_MIN } = require('../valid');
const { checkRoomAssignment, logOverload, blockOrConfirm } = require('../room-rules');
const roomStays = require('../room-stays');
const roomLeaders = require('../room-leaders');
const { badCheckoutDate, finalizeCheckout } = require('../checkout');
const billing = require('../billing');
const meter = require('../meter');
const { applyFacilityFilter, isExecutive, assertFacility, resolveFacilityForCreate, userFacility } = require('../scope');
const DATE_FIELDS = ['birth_date', 'check_in_date', 'check_out_date', 'contract_date', 'deposit_date', 'class_start_date', 'expected_departure', 'checkout_notice_date'];

const router = express.Router();
router.use(requireAuth);

// Đa cơ sở: MỌI thao tác trên /:id của một học viên phải thuộc cơ sở người dùng được phép. Gom về đây
// (router.param) để không sót endpoint nào — đọc chi tiết, sửa, check-in/out, chuyển phòng, cọc, xoá...
// Điều hành (facility_id null): qua hết. Quản lý cơ sở: chỉ HV cơ sở mình, khác cơ sở -> 403.
router.param('id', async (req, res, next, id) => {
  try {
    if (isExecutive(req)) return next();
    if (!/^\d+$/.test(String(id))) return next();          // id không phải số -> để handler xử
    const row = (await query('SELECT facility_id FROM students WHERE id=$1', [id])).rows[0];
    if (!row) return next();                                // không tồn tại -> để handler trả 404 đúng ngữ cảnh
    const bad = assertFacility(req, row.facility_id);
    if (bad) return res.status(bad.status).json(bad);
    next();
  } catch (e) { next(e); }
});

const CCCD_FIELDS = ['cccd_front', 'cccd_back', 'cccd_image'];
const signCccd = row => cccdUrls(row); // trả URL proxy cho các cột CCCD

// Ảnh CCCD -> S3 (bucket riêng tư). Lưu KEY vào DB, KHÔNG lưu base64.
// value: data URL ảnh mới -> upload; '' hoặc null -> xóa object cũ; key cũ -> giữ; undefined -> không đổi.
const isCccdKey = k => typeof k === 'string' && /^(students|applications)\//.test(k);
async function resolveCccd(studentId, field, value, oldKey) {
  if (value === undefined) return undefined;
  if (!value) {
    if (isCccdKey(oldKey)) await storage.deleteObject(storage.CCCD_BUCKET, oldKey).catch(() => {});
    return null;
  }
  if (isCccdKey(value)) return value; // đã là key hợp lệ (giữ nguyên khi không đổi ảnh)
  if (!/^data:image\//.test(value)) return undefined; // giá trị lạ (không phải ảnh/không phải key) -> bỏ qua, không ghi rác
  const p = storage.parseDataUrl(value);
  if (!p) { const e = new Error('Ảnh CCCD không hợp lệ (chỉ nhận JPG/PNG/WEBP/GIF)'); e.status = 400; throw e; }
  const key = `students/${studentId}/${field}.${p.ext}`;
  await storage.putDataUrl(storage.CCCD_BUCKET, key, value);
  if (isCccdKey(oldKey) && oldKey !== key) await storage.deleteObject(storage.CCCD_BUCKET, oldKey).catch(() => {});
  return key;
}

// Proxy ảnh CCCD (bucket riêng tư): admin/staff hoặc chính học viên đó. Ảnh chảy S3 -> app -> client.
router.get('/:id/cccd/:side', async (req, res, next) => {
  try {
    const col = SIDE_COL[req.params.side];
    if (!col) return res.status(404).end();
    const isStaff = ['admin', 'staff'].includes(req.user.role);
    if (!isStaff && req.user.student_id !== +req.params.id) return res.status(403).end();
    // Không phục vụ ảnh của học viên đã xóa mềm (bảo vệ PII)
    const row = (await query(`SELECT ${col} AS k FROM students WHERE id=$1 AND deleted_at IS NULL`, [req.params.id])).rows[0];
    if (!row || !row.k) return res.status(404).end();
    const obj = await storage.getObject(storage.CCCD_BUCKET, row.k);
    res.set('Content-Type', obj.contentType || 'image/jpeg');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, max-age=300');
    obj.body.pipe(res);
  } catch (e) { res.status(404).end(); }
});

// Danh sách (không kèm ảnh CCCD cho nhẹ)
const LIST_SELECT = `
  SELECT s.id, s.code, s.name, s.gender, s.phone, s.id_card, s.room_id, s.check_in_date, s.check_out_date,
    s.status, s.note, s.uses_washing, s.deposit_amount, s.deposit_status, s.deposit_date, s.deposit_refund_date,
    s.checkout_notice_date, s.checkout_reason, s.birth_date, s.class_name, s.rental_type, s.residency_status,
    s.contract_no, s.contract_date, s.contract_status, s.deposit_bank, s.deposit_account,
    s.class_start_date, s.expected_departure, s.parent_phone, s.room_fee_discount_pct, s.facility_id,
    EXISTS (SELECT 1 FROM room_leaders rl WHERE rl.student_id=s.id AND rl.to_date IS NULL) AS is_leader,
    (s.cccd_front IS NOT NULL OR s.cccd_back IS NOT NULL OR s.cccd_image IS NOT NULL) AS has_cccd,
    (s.cccd_front IS NOT NULL) AS has_cccd_front,
    (s.cccd_back IS NOT NULL) AS has_cccd_back,
    r.name AS room_name, r.floor AS room_floor, r.gender AS room_gender, r.hang AS room_hang,
    u.username AS login_username,
    (SELECT COUNT(*) FROM vehicles v WHERE v.student_id=s.id AND v.deleted_at IS NULL)::int AS vehicle_count,
    (SELECT COUNT(*) FROM violations vi WHERE vi.student_id=s.id AND vi.deleted_at IS NULL)::int AS violation_count
  FROM students s
  LEFT JOIN rooms r ON r.id = s.room_id
  LEFT JOIN users u ON u.student_id = s.id`;

const CONTRACT = c => (['done', 'scanned', 'unsigned', 'none', 'handover'].includes(c) ? c : 'unsigned');
const RENTAL = t => (t === 'phong' ? 'phong' : 'ghep');
const RESIDENCY = r => (['registered', 'processing'].includes(r) ? r : 'unregistered');
const D = v => (v ? v : null);
// % giảm tiền phòng riêng (vd quản lý KTX ở phòng 104 = 50). Bỏ trống/nhập bậy -> 0 (không giảm).
// Chặn ở 0–100: nhập 500 thì app đi TRẢ TIỀN cho học viên, nhập âm thì thu thêm.
const PCT = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0; };

// ---- CHẶN TẠO TRÙNG HỒ SƠ ----
// Nhân viên hay tạo hồ sơ MỚI khi học viên CHUYỂN PHÒNG, vì app cũ không có chỗ giữ lịch sử
// nên đó là cách duy nhất để "giữ" phòng cũ. Hậu quả: người đó có 2 hồ sơ, 2 phiếu, bị thu tiền
// 2 lần — tháng 07/2026 thu dư 5.709.087đ trên 5 người.
// Giờ chức năng "Chuyển phòng" đã giữ đủ lịch sử (bảng room_stays) nên KHÔNG còn lý do tạo mới.
// Chặn ngay tại đây và CHỈ ĐƯỜNG sang Chuyển phòng — đừng bắt nhân viên nhớ quy trình.
async function findDuplicate({ code, id_card }, exceptId) {
  const c = String(code || '').trim(), ic = String(id_card || '').trim();
  const where = [], params = [];
  if (c) { params.push(c); where.push(`lower(btrim(s.code)) = lower(btrim($${params.length}))`); }
  if (ic) { params.push(ic); where.push(`btrim(s.id_card) = btrim($${params.length})`); }
  if (!where.length) return null;
  let sql = `SELECT s.id, s.name, s.code, s.id_card, s.status, s.check_out_date, r.name AS room_name
               FROM students s LEFT JOIN rooms r ON r.id = s.room_id
              WHERE s.deleted_at IS NULL AND (${where.join(' OR ')})`;
  if (exceptId) { params.push(exceptId); sql += ` AND s.id <> $${params.length}`; }
  const { rows } = await query(sql + ' LIMIT 1', params);
  const d = rows[0];
  if (!d) return null;

  const trungMa = c && String(d.code || '').trim().toLowerCase() === c.toLowerCase();
  const dangO = d.status === 'in';
  return {
    student: d,
    error: `${d.name} đã có hồ sơ trong hệ thống (${trungMa ? `trùng mã HV "${d.code}"` : `trùng CCCD "${d.id_card}"`})`
      + (dangO ? ` — đang ở phòng ${d.room_name || 'chưa xếp'}.` : ` — đã trả phòng${d.check_out_date ? ' ngày ' + String(d.check_out_date).slice(0, 10) : ''}.`)
      + (dangO
        ? ' Nếu bạn ấy ĐỔI PHÒNG, hãy dùng chức năng "Chuyển phòng" trên hồ sơ cũ — tạo hồ sơ mới sẽ khiến bạn ấy bị tính tiền 2 lần.'
        : ' Nếu bạn ấy quay lại ở, hãy dùng "Check-in" trên hồ sơ cũ thay vì tạo mới.'),
  };
}

router.get('/', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    // Phân trang / tìm / lọc cơ sở — TUỲ CHỌN. Không gửi page/limit -> trả CẢ danh sách như cũ
    // (frontend hiện tại dựa vào mảng đầy đủ để tính dashboard/chuông nên phải giữ tương thích).
    // Có page/limit -> trả { rows, total, page, limit } — nền cho frontend đa cơ sở sau này.
    const cond = [req.query.deleted === '1' ? 's.deleted_at IS NOT NULL' : 's.deleted_at IS NULL'];
    const params = [];
    // Đa cơ sở: ĐIỀU HÀNH được lọc tuỳ chọn theo ?facility; QUẢN LÝ CƠ SỞ bị ÉP theo cơ sở của mình
    // (bỏ qua ?facility client gửi, chống lách). Lọc theo s.facility_id (giữ đồng bộ theo phòng).
    if (isExecutive(req)) {
      if (req.query.facility) { params.push(+req.query.facility); cond.push(`s.facility_id = $${params.length}`); }
    } else {
      applyFacilityFilter(req, 's.facility_id', cond, params);
    }
    if (req.query.q && req.query.q.trim()) {
      params.push('%' + req.query.q.trim() + '%');
      cond.push(`(s.name ILIKE $${params.length} OR s.code ILIKE $${params.length} OR s.phone ILIKE $${params.length} OR r.name ILIKE $${params.length})`);
    }
    const where = 'WHERE ' + cond.join(' AND ');
    const paged = req.query.page != null || req.query.limit != null;
    if (paged) {
      const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
      const page = Math.max(1, +req.query.page || 1);
      const total = (await query(`SELECT COUNT(*)::int c FROM students s LEFT JOIN rooms r ON r.id = s.room_id ${where}`, params)).rows[0].c;
      params.push(limit); const pL = params.length;
      params.push((page - 1) * limit); const pO = params.length;
      const { rows } = await query(`${LIST_SELECT} ${where} ORDER BY s.name LIMIT $${pL} OFFSET $${pO}`, params);
      return res.json({ rows, total, page, limit });
    }
    const { rows } = await query(`${LIST_SELECT} ${where} ORDER BY s.name`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// ---- Số hợp đồng tự động theo pháp nhân + ngày ký (điểm 7 — ban thư ký quản lý HĐ) ----
const entityOf = (gender, st) => gender === 'female' ? (st.legal_female || 'E2') : (st.legal_male || 'S2');
const fmtContractNo = (seq, year, entity) => `${String(seq).padStart(2, '0')}/${year}/HDKTX-${entity}`;

// Gợi ý số HĐ kế tiếp cho 1 học viên (theo pháp nhân + ngày ký)
router.get('/contract-no/next', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const st = await getSettings();
    const gender = req.query.gender === 'female' ? 'female' : 'male';
    const entity = entityOf(gender, st);
    const date = (req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const year = date.slice(0, 4);
    // Số kế tiếp = MAX(số NN) trong các HĐ ĐÃ CÓ cùng năm + pháp nhân (parse TỪ CHÍNH số HĐ, kể cả HĐ
    // chưa có contract_date) + 1 -> nối tiếp số có sẵn, KHÔNG đánh lại từ đầu, KHÔNG trùng số đã cấp.
    const n = (await query(
      `SELECT COALESCE(MAX((split_part(contract_no,'/',1))::int), 0)::int c FROM students
       WHERE deleted_at IS NULL AND contract_no ~ ('^[0-9]+/' || $1 || '/HDKTX-' || $2 || '$')`,
      [year, entity])).rows[0].c;
    res.json({ contract_no: fmtContractNo(n + 1, year, entity), entity, seq: n + 1, year });
  } catch (e) { next(e); }
});

router.get('/:id', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT s.*, r.name AS room_name, r.floor AS room_floor, r.gender AS room_gender, r.hang AS room_hang,
        u.username AS login_username,
        -- Số hiệu phiên bản của dòng. xmin là cột hệ thống PostgreSQL tự đổi MỖI LẦN dòng bị sửa
        -- -> dùng làm mốc "tôi đọc hồ sơ ở trạng thái nào", không phải thêm cột hay trigger.
        -- Gửi lại lúc lưu để phát hiện người khác vừa sửa (xem PUT /:id).
        s.xmin::text AS _v
      FROM students s
      LEFT JOIN rooms r ON r.id = s.room_id
      LEFT JOIN users u ON u.student_id = s.id
      WHERE s.id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    // Lọc deleted_at: chi tiết HV từng hiện "Xe (2)" trong khi danh sách hiện "Xe (1)" vì đường
    // này không loại xe đã xoá, còn danh sách thì có (V2-26).
    const veh = await query('SELECT * FROM vehicles WHERE student_id=$1 AND deleted_at IS NULL ORDER BY id', [req.params.id]);
    rows[0].vehicles = veh.rows;
    const vio = await query('SELECT * FROM violations WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date DESC, id DESC', [req.params.id]);
    rows[0].violations = vio.rows;
    res.json(await signCccd(rows[0]));
  } catch (e) { next(e); }
});

function studentFields(b) {
  return [
    b.code || '', (b.name || '').trim(), b.gender === 'female' ? 'female' : 'male', b.phone || '', b.id_card || '',
    D(b.birth_date), b.class_name || '', b.room_id || null, D(b.check_in_date), b.note || '',
    !!b.uses_washing, RENTAL(b.rental_type), RESIDENCY(b.residency_status),
    b.contract_no || '', D(b.contract_date), CONTRACT(b.contract_status), b.cccd_image || null,
  ];
}

router.post('/', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const b = req.body;
    // ---- KIỂM TRA trước khi mở transaction (tránh rò transaction khi return sớm) ----
    if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Nhập họ tên học viên' });
    // SĐT: đơn đăng ký công khai đã kiểm 8–15 chữ số; form quản trị trước đây KHÔNG kiểm -> lưu được "abc", "123"
    if (b.phone != null && String(b.phone).trim() !== '' && !isValidPhone(b.phone))
      return res.status(400).json({ error: `Số điện thoại không hợp lệ: "${b.phone}" (cần 8–15 chữ số)` });
    if (b.parent_phone != null && String(b.parent_phone).trim() !== '' && !isValidPhone(b.parent_phone))
      return res.status(400).json({ error: `SĐT phụ huynh không hợp lệ: "${b.parent_phone}" (cần 8–15 chữ số)` });
    // Chặn ngày ảo (đúng format nhưng không có thật) → tránh sập 500
    for (const k of DATE_FIELDS) if (b[k] != null && b[k] !== '' && !isValidYmd(b[k])) return res.status(400).json({ error: `Ngày không hợp lệ (${k})` });
    if (isValidYmd(b.check_in_date) && isValidYmd(b.check_out_date) && b.check_out_date < b.check_in_date)
      return res.status(400).json({ error: 'Ngày trả phòng không thể trước ngày nhận phòng' });
    // Trùng mã HV / CCCD -> gần như chắc chắn đang tạo LẠI người đã có hồ sơ (thường là do chuyển phòng)
    const dup0 = await findDuplicate(b);
    if (dup0) return res.status(409).json({ error: dup0.error, existing: dup0.student, duplicate: true });
    // LUẬT XẾP PHÒNG (một nơi duy nhất): giới tính + thuê nguyên phòng -> chặn; quá tải -> cảnh báo + xác nhận + ghi vết
    const chk = await checkRoomAssignment({ studentId: null, gender: b.gender, rentalType: b.rental_type, roomId: b.room_id });
    if (blockOrConfirm(res, chk, b.confirm_overload === true)) return;
    // Đa cơ sở: HV thuộc cơ sở của PHÒNG được xếp; không xếp phòng thì theo cơ sở người tạo (quản lý
    // cơ sở -> ép cơ sở mình). Chặn quản lý tạo HV vào phòng cơ sở khác.
    let facId;
    if (b.room_id) {
      const rm = (await query('SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL', [b.room_id])).rows[0];
      if (!rm) return res.status(400).json({ error: 'Phòng không tồn tại' });
      const badF = assertFacility(req, rm.facility_id); if (badF) return res.status(badF.status).json(badF);
      facId = rm.facility_id != null ? rm.facility_id : null;
    } else {
      facId = resolveFacilityForCreate(req, req.body.facility_id);
    }
    let uname = null, pass = null;
    if (b.create_login) {
      uname = (b.login_username || b.code || '').trim();
      pass = (b.login_password || '').trim();
      if (!uname) return res.status(400).json({ error: 'Cần tên đăng nhập (hoặc mã HV) để tạo tài khoản' });
      if (pass.length < INITIAL_PASSWORD_MIN) return res.status(400).json({ error: `Mật khẩu tài khoản tối thiểu ${INITIAL_PASSWORD_MIN} ký tự` });
      const dup = await query('SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL', [uname]);
      if (dup.rows.length) return res.status(400).json({ error: `Tên đăng nhập "${uname}" đã tồn tại` });
    }

    const checkIn = b.check_in_date || new Date().toISOString().slice(0, 10);
    const checkOut = b.check_out_date || null;
    const todayStr = new Date().toISOString().slice(0, 10);
    const status = checkOut && checkOut <= todayStr ? 'out' : 'in';
    const settings = await getSettings();
    const takeDeposit = !!b.deposit_paid;
    const depositFee = +settings.deposit_fee || 0;
    const f = studentFields({ ...b, check_in_date: checkIn });
    f[16] = null; // cccd_image: upload sau khi có id (không lưu base64 vào DB)

    // ---- GHI trong 1 transaction (withTransaction đảm bảo ROLLBACK + release khi lỗi) ----
    const student = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO students
          (code, name, gender, phone, id_card, birth_date, class_name, room_id, check_in_date, note,
           uses_washing, rental_type, residency_status, contract_no, contract_date, contract_status, cccd_image,
           status, check_out_date, deposit_amount, deposit_status, deposit_date, cccd_front, cccd_back, checkout_reason,
           class_start_date, expected_departure, parent_phone, room_fee_discount_pct, facility_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) RETURNING *`,
        [...f, status, checkOut, takeDeposit ? depositFee : 0, takeDeposit ? 'held' : 'none', takeDeposit ? checkIn : null,
         null, null,
         (checkOut && ['departure', 'personal', 'facility', 'dropout', 'reserve', 'other'].includes(b.checkout_reason)) ? b.checkout_reason : (checkOut ? 'other' : null),
         D(b.class_start_date), D(b.expected_departure), b.parent_phone || '', PCT(b.room_fee_discount_pct), facId]
      );
      const st = rows[0];

      // Tải ảnh CCCD lên Storage rồi lưu key (id đã có)
      const cccdUpd = {};
      for (const field of CCCD_FIELDS) {
        const r = await resolveCccd(st.id, field, b[field]);
        if (r) cccdUpd[field] = r;
      }
      if (Object.keys(cccdUpd).length) {
        const keys = Object.keys(cccdUpd);
        const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
        await client.query(`UPDATE students SET ${sets} WHERE id=$${keys.length + 1}`, [...keys.map(k => cccdUpd[k]), st.id]);
        Object.assign(st, cccdUpd);
      }

      // Mở lượt ở phòng ngay từ đầu -> về sau chuyển phòng/trả phòng mới có cái để cắt chặng tính điện
      if (b.room_id) {
        await roomStays.openStay(client, st.id, b.room_id, checkIn);
        if (checkOut) await roomStays.closeStay(client, st.id, checkOut);
      }
      await client.query(
        `INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'in',$2,$3,'Đăng ký & vào ở','admin')`,
        [st.id, checkIn, b.room_id || null]
      );
      if (b.create_login) {
        await client.query(
          // must_change_password=true — xem BL-08: ngưỡng yếu INITIAL_PASSWORD_MIN chỉ hợp lệ khi kèm điều kiện bù này
          `INSERT INTO users (username, password_hash, role, full_name, student_id, must_change_password) VALUES ($1,$2,'student',$3,$4,true)`,
          [uname, bcrypt.hashSync(pass, 10), b.name.trim(), st.id]
        );
      }
      return st;
    });
    // Ghi vết: ai xếp · lúc nào · HV nào · phòng nào · vượt mấy người
    for (const w of chk.warnings) await logOverload(req, { studentId: student.id, studentName: student.name, warning: w });

    res.status(201).json({ ...(await signCccd(student)), warnings: chk.warnings });
  } catch (e) { next(e); }
});

router.put('/:id', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const raw = req.body || {};
    // MERGE với bản ghi hiện tại — chỉ ghi đè field được GỬI (undefined = giữ nguyên) → chống mất dữ liệu khi gọi API thiếu field
    const cur = (await query('SELECT * FROM students WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const b = { ...cur };
    for (const k of Object.keys(raw)) if (raw[k] !== undefined) b[k] = raw[k];
    // Chặn ngày ảo trong dữ liệu GỬI LÊN → tránh sập 500; và ngày trả < ngày vào
    for (const k of DATE_FIELDS) if (raw[k] != null && raw[k] !== '' && !isValidYmd(raw[k])) return res.status(400).json({ error: `Ngày không hợp lệ (${k})` });
    if (isValidYmd(b.check_in_date) && isValidYmd(b.check_out_date) && String(b.check_out_date).slice(0, 10) < String(b.check_in_date).slice(0, 10))
      return res.status(400).json({ error: 'Ngày trả phòng không thể trước ngày nhận phòng' });
    if (b.phone != null && String(b.phone).trim() !== '' && !isValidPhone(b.phone))
      return res.status(400).json({ error: `Số điện thoại không hợp lệ: "${b.phone}" (cần 8–15 chữ số)` });
    // Chặn trùng cả ở đường SỬA: tạo hồ sơ mã A rồi sửa thành mã B (đã có) là lách được tuyến trên
    const dupU = await findDuplicate(b, +req.params.id);
    if (dupU) return res.status(409).json({ error: dupU.error, existing: dupU.student, duplicate: true });
    // LUẬT XẾP PHÒNG — áp cả ở đường SỬA HỒ SƠ (trước đây chỉ chặn lúc tạo mới nên đi vòng là lách được)
    const chkU = await checkRoomAssignment({ studentId: +req.params.id, gender: b.gender, rentalType: b.rental_type, roomId: b.room_id });
    if (blockOrConfirm(res, chkU, raw.confirm_overload === true)) return;
    const f = studentFields(b);
    const cols = `code=$1, name=$2, gender=$3, phone=$4, id_card=$5, birth_date=$6, class_name=$7, room_id=$8,
      check_in_date=$9, note=$10, uses_washing=$11, rental_type=$12, residency_status=$13,
      contract_no=$14, contract_date=$15, contract_status=$16,
      class_start_date=$17, expected_departure=$18, parent_phone=$19, room_fee_discount_pct=$20`;
    const params = f.slice(0, 16);
    params.push(D(b.class_start_date), D(b.expected_departure), b.parent_phone || '', PCT(b.room_fee_discount_pct));
    let extra = '';
    // Ảnh CCCD: chỉ cập nhật nếu client GỬI kèm (dựa vào body gốc, không phải merged)
    const needCccd = CCCD_FIELDS.some(field => raw[field] !== undefined);
    const oldKeys = needCccd ? { cccd_front: cur.cccd_front, cccd_back: cur.cccd_back, cccd_image: cur.cccd_image } : {};
    for (const field of CCCD_FIELDS) {
      if (raw[field] === undefined) continue;
      const resolved = await resolveCccd(req.params.id, field, raw[field], oldKeys[field]);
      if (resolved === undefined) continue; // giá trị không hợp lệ -> giữ nguyên, không ghi rác
      extra += `, ${field}=$${params.length + 1}`;
      params.push(resolved);
    }
    params.push(req.params.id);
    // Hai người mở CÙNG một hồ sơ, người sau bấm Lưu sẽ ĐÈ MẤT thay đổi của người trước mà
    // không ai biết. Chặn bằng số hiệu phiên bản đọc lúc mở form (xem GET /:id): dòng đã bị
    // sửa từ lúc đó thì xmin đổi -> UPDATE không khớp -> 0 dòng -> báo cho người dùng biết.
    let doiPhienBan = '';
    if (raw._v) { params.push(String(raw._v)); doiPhienBan = ` AND xmin::text = $${params.length}`; }
    const { rows } = await query(
      `UPDATE students SET ${cols}${extra} WHERE id=$${params.length - (doiPhienBan ? 1 : 0)}${doiPhienBan} RETURNING *`, params);
    if (!rows[0]) {
      const con = await query('SELECT name FROM students WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
      if (!con.rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
      // Hồ sơ vẫn còn đó -> nghĩa là nó vừa bị người khác sửa sau khi mình mở form
      return res.status(409).json({
        conflict: true,
        error: `Hồ sơ "${con.rows[0].name}" vừa được người khác sửa sau khi bạn mở form.\n\n`
             + 'Lưu bây giờ sẽ đè mất thay đổi của họ. Hãy đóng form, mở lại để xem bản mới nhất rồi sửa tiếp.',
      });
    }
    // Sửa ô Phòng/Ngày trong hồ sơ = ĐÍNH CHÍNH (chuyển phòng thật phải qua chức năng Chuyển phòng)
    await roomStays.reconcile(null, rows[0].id, rows[0].room_id, rows[0].check_in_date && String(rows[0].check_in_date).slice(0, 10), rows[0].check_out_date && String(rows[0].check_out_date).slice(0, 10));
    for (const w of chkU.warnings) await logOverload(req, { studentId: rows[0].id, studentName: rows[0].name, warning: w });
    res.json({ ...(await signCccd(rows[0])), warnings: chkU.warnings });
  } catch (e) { next(e); }
});

// Xóa mềm (khôi phục được — không xóa dữ liệu thật)
router.delete('/:id', requireRole('admin', 'staff'), async (req, res, next) => {
  try { await query('UPDATE students SET deleted_at=now() WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { next(e); }
});

// Khôi phục học viên đã xóa
router.post('/:id/restore', requireRole('admin', 'staff'), async (req, res, next) => {
  try { await query('UPDATE students SET deleted_at=NULL WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { next(e); }
});

// Bật/tắt dịch vụ máy giặt cho học viên (tab Máy giặt)
router.post('/:id/washing', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const on = !!req.body.on;
    const { rows } = await query('UPDATE students SET uses_washing=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id', [on, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    res.json({ ok: true, on });
  } catch (e) { next(e); }
});

// Check-in
router.post('/:id/checkin', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const bad = rejectUnknown(req.body, ['date', 'room_id', 'note', 'confirm_overload']);
    if (bad) return res.status(400).json({ error: bad });
    const { date, room_id, note } = req.body;
    if (date != null && !isValidYmd(date)) return res.status(400).json({ error: 'Ngày nhận phòng không hợp lệ' });
    // LUẬT XẾP PHÒNG — áp cả ở đường CHECK-IN LẠI
    const me = (await query('SELECT gender, rental_type, name FROM students WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!me) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const chkI = await checkRoomAssignment({ studentId: +req.params.id, gender: me.gender, rentalType: me.rental_type, roomId: room_id });
    if (blockOrConfirm(res, chkI, req.body.confirm_overload === true)) return;
    for (const w of chkI.warnings) await logOverload(req, { studentId: +req.params.id, studentName: me.name, warning: w });
    const d = date || new Date().toISOString().slice(0, 10);
    const { rows } = await query(
      `UPDATE students SET status='in', room_id=$1, check_in_date=$2, check_out_date=NULL,
         checkout_notice_date=NULL, checkout_reason=NULL WHERE id=$3 RETURNING *`,
      [room_id || null, d, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    await roomStays.checkIn(null, +req.params.id, room_id || null, d); // giữ dấu vết ở phòng -> chia điện đúng
    await query(`INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'in',$2,$3,$4,'admin')`,
      [req.params.id, d, room_id || null, note || 'Check-in']);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Check-out (kèm ngày báo + lý do, tự xét hoàn cọc)
router.post('/:id/checkout', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    // Chặn field lạ: gửi "check_out_date" (đúng tên cột DB) từng bị NUỐT IM LẶNG rồi tự lấy ngày hôm nay
    const bad = rejectUnknown(req.body, ['date', 'notice_date', 'reason', 'note', 'meter_reading']);
    if (bad) return res.status(400).json({ error: bad });
    const { date, notice_date, reason, note } = req.body;
    if (date != null && !isValidYmd(date)) return res.status(400).json({ error: 'Ngày trả phòng không hợp lệ' });
    if (notice_date != null && notice_date !== '' && !isValidYmd(notice_date)) return res.status(400).json({ error: 'Ngày báo trả phòng không hợp lệ' });
    const d = date || new Date().toISOString().slice(0, 10);
    // Ngày rời đi KHÔNG được trước ngày nhận phòng / trước ngày bắt đầu lượt ở hiện tại (BLK-3)
    const ci = (await query('SELECT check_in_date, status, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!ci) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    // M-2: chặn check-out LẦN 2. Đã 'out' mà gọi lại sẽ ghi đè check_out_date sang ngày mới trong khi
    // room_stays đã đóng ở ngày CŨ (openStayOf trả null) -> tiền phòng (theo check_out_date) và tiền
    // điện (theo room_stays) lệch số ngày. Muốn đổi ngày trả thì nhận phòng lại (check-in) trước.
    if (ci.status === 'out')
      return res.status(409).json({ error: `Học viên đã trả phòng${ci.check_out_date ? ' ngày ' + String(ci.check_out_date).slice(0, 10) : ''}. Nếu cần đổi ngày trả, hãy nhận phòng lại (check-in) trước.` });
    const badDate = await badCheckoutDate(null, +req.params.id, d, ci.check_in_date);
    if (badDate) return res.status(400).json({ error: badDate });
    const rs = ['departure', 'personal', 'facility', 'dropout', 'reserve', 'other'].includes(reason) ? reason : 'other';
    const cur = await query('SELECT room_id FROM students WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const roomId = cur.rows[0].room_id || null;

    // CHỐT CHỈ SỐ ĐIỆN NGÀY TRẢ PHÒNG — kiểm tra TRƯỚC khi ghi bất cứ thứ gì,
    // để nhập nhầm chỉ số không làm học viên bị "out" nửa vời rồi phải sửa tay.
    const mr = req.body.meter_reading;
    const hasMeter = mr != null && String(mr).trim() !== '';
    if (hasMeter) {
      if (!roomId) return res.status(400).json({ error: 'Học viên không ở phòng nào — không có công-tơ để chốt chỉ số' });
      const err = await meter.checkRead(null, { roomId, date: d, reading: mr });
      if (err) return res.status(400).json({ error: err });
    }

    const elig = depositRefundEligible({ noticeDate: notice_date || null, checkoutDate: d, reason: rs }, +(await getSettings()).deposit_notice_min_days || 30);
    const { rows } = await query(
      `UPDATE students SET status='out', check_out_date=$1, checkout_notice_date=$2, checkout_reason=$3 WHERE id=$4 RETURNING *`,
      [d, notice_date || null, rs, req.params.id]
    );
    if (hasMeter) {
      await meter.recordRead(null, {
        roomId, date: d, reading: mr, reason: 'checkout', studentId: +req.params.id,
        note: `Chốt chỉ số lúc ${rows[0].name} trả phòng`, by: req.user && req.user.username,
      });
    }
    await query(`INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out',$2,$3,$4,'admin')`,
      [req.params.id, d, roomId, note || 'Check-out']);

    // BLK-1: phần CHUNG 3 đường — đóng lượt ở + đóng phòng trưởng + dọn phiếu kỳ sau + tính lại phiếu
    // tháng trả (chốt giữa kỳ làm đổi phần chia CẢ PHÒNG). Đường này vốn làm đủ; nay dùng hàm chung.
    const fin = await finalizeCheckout(null, { studentId: +req.params.id, date: d });
    let recalced_roommates = [];
    if (hasMeter) {
      for (const sid of await meter.affectedStudents(null, roomId, d)) {
        if (sid === +req.params.id) continue;
        try { const r = await recalcInvoice(sid, d.slice(0, 7)); if (r) recalced_roommates.push(sid); } catch (e) {}
      }
    }
    res.json({ student: rows[0], refund: elig, recalced: fin.recalced, recalced_roommates, dropped_future_invoices: fin.dropped });
  } catch (e) { next(e); }
});

// Chuyển phòng
router.post('/:id/transfer', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const bad = rejectUnknown(req.body, ['room_id', 'date', 'note', 'confirm_overload', 'meter_reading']);
    if (bad) return res.status(400).json({ error: bad });
    const { room_id, date, note } = req.body;
    if (!room_id) return res.status(400).json({ error: 'Chọn phòng mới' });
    if (date != null && !isValidYmd(date)) return res.status(400).json({ error: 'Ngày chuyển phòng không hợp lệ' });
    const d = date || new Date().toISOString().slice(0, 10);
    const cur = await query('SELECT room_id, gender, rental_type, name, facility_id FROM students WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    // Đa cơ sở: quản lý cơ sở chỉ chuyển HV của cơ sở mình, và chỉ vào phòng cơ sở mình.
    const badS = assertFacility(req, cur.rows[0].facility_id);
    if (badS) return res.status(badS.status).json(badS);
    const oldRoom = cur.rows[0].room_id;
    if (String(oldRoom) === String(room_id)) return res.status(400).json({ error: 'Học viên đang ở chính phòng này' });
    const newRoomRow = (await query('SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL', [room_id])).rows[0];
    if (!newRoomRow) return res.status(400).json({ error: 'Phòng mới không tồn tại' });
    const badR = assertFacility(req, newRoomRow.facility_id);
    if (badR) return res.status(badR.status).json(badR);
    // LUẬT XẾP PHÒNG — áp cả ở đường CHUYỂN PHÒNG
    const chkT = await checkRoomAssignment({ studentId: +req.params.id, gender: cur.rows[0].gender, rentalType: cur.rows[0].rental_type, roomId: room_id });
    if (blockOrConfirm(res, chkT, req.body.confirm_overload === true)) return;

    // CHỐT CHỈ SỐ ĐIỆN PHÒNG CŨ NGÀY CHUYỂN ĐI — kiểm tra trước khi ghi
    const mr = req.body.meter_reading;
    const hasMeter = mr != null && String(mr).trim() !== '';
    if (hasMeter) {
      if (!oldRoom) return res.status(400).json({ error: 'Học viên chưa ở phòng nào — không có công-tơ phòng cũ để chốt' });
      const err = await meter.checkRead(null, { roomId: oldRoom, date: d, reading: mr });
      if (err) return res.status(400).json({ error: err });
    }

    for (const w of chkT.warnings) await logOverload(req, { studentId: +req.params.id, studentName: cur.rows[0].name, warning: w });
    // Đa cơ sở: giữ students.facility_id ĐỒNG BỘ theo cơ sở của phòng MỚI (điều hành có thể chuyển
    // HV sang cơ sở khác; quản lý cơ sở đã bị chặn ở trên nên newRoom cùng cơ sở).
    const { rows } = await query(`UPDATE students SET room_id=$1, facility_id=$3 WHERE id=$2 RETURNING *`,
      [room_id, req.params.id, newRoomRow.facility_id != null ? newRoomRow.facility_id : null]);
    await roomStays.transfer(null, +req.params.id, room_id, d); // lượt cũ hết ngày D-1, lượt mới từ ngày D
    // Chuyển đi thì thôi làm phòng trưởng phòng cũ (phòng mới muốn thì phải cử lại)
    await roomLeaders.closeStudent(null, +req.params.id, billing.addDays(d, -1));
    const oldName = oldRoom ? (await query('SELECT name FROM rooms WHERE id=$1', [oldRoom])).rows[0]?.name : '—';
    const newName = (await query('SELECT name FROM rooms WHERE id=$1', [room_id])).rows[0]?.name;
    if (hasMeter) {
      await meter.recordRead(null, {
        roomId: oldRoom, date: d, reading: mr, reason: 'transfer', studentId: +req.params.id,
        note: `Chốt chỉ số phòng ${oldName} lúc ${cur.rows[0].name} chuyển đi`, by: req.user && req.user.username,
      });
    }
    await query(`INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'in',$2,$3,$4,'admin')`,
      [req.params.id, d, room_id, note || `Chuyển phòng ${oldName} → ${newName}`]);

    // Chốt giữa kỳ đổi phần chia của CẢ phòng cũ -> tính lại cho mọi người liên quan
    let recalced = [];
    if (hasMeter) {
      const month = d.slice(0, 7);
      const ids = new Set([...(await meter.affectedStudents(null, oldRoom, d)), +req.params.id]);
      for (const sid of ids) { try { const r = await recalcInvoice(sid, month); if (r) recalced.push(sid); } catch (e) {} }
    }
    res.json({ ...rows[0], recalced });
  } catch (e) { next(e); }
});

// Ghi nhận đóng cọc
router.post('/:id/deposit', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const bad = rejectUnknown(req.body, ['amount', 'date']);
    if (bad) return res.status(400).json({ error: bad });
    const settings = await getSettings();
    const amount = req.body.amount != null ? +req.body.amount : (+settings.deposit_fee || 0);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: `Tiền cọc phải là số không âm (đang nhận: ${req.body.amount})` });
    if (req.body.date != null && !isValidYmd(req.body.date)) return res.status(400).json({ error: 'Ngày đóng cọc không hợp lệ' });
    const date = req.body.date || new Date().toISOString().slice(0, 10);
    const { rows } = await query(
      `UPDATE students SET deposit_amount=$1, deposit_status='held', deposit_date=$2, deposit_refund_date=NULL WHERE id=$3 RETURNING *`,
      [amount, date, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Xử lý cọc khi trả phòng: hoàn (kèm STK/ngân hàng + khấu trừ hư hao) hoặc giữ cọc
router.post('/:id/deposit-settle', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const bad = rejectUnknown(req.body, ['action', 'date', 'deduction', 'deductions', 'bank', 'account', 'deduction_note', 'override_reason']);
    if (bad) return res.status(400).json({ error: bad });
    const action = req.body.action === 'refund' ? 'refunded' : 'forfeited';
    if (req.body.date != null && !isValidYmd(req.body.date)) return res.status(400).json({ error: 'Ngày hoàn cọc không hợp lệ' });
    const date = req.body.date || new Date().toISOString().slice(0, 10);

    // V2-30: khấu trừ hư hao tính Ở SERVER từ bảng assets, không tin con số client gửi lên.
    // Client gửi danh sách { asset_id, quantity }; server tra assets.fee THẬT, tự nhân, tự tổng,
    // tự dựng ghi chú từ tên + phí thật. Trước đây toàn bộ phép nhân chạy ở máy khách rồi gửi lên
    // một con số -> danh mục tài sản chỉ là trang trí, phí bồi hoàn không phải ràng buộc.
    let deduction, deductionNote;
    if (Array.isArray(req.body.deductions)) {
      let sum = 0; const parts = [];
      for (const line of req.body.deductions) {
        const qty = Number(line && line.quantity);
        if (!Number.isInteger(qty) || qty < 0) return res.status(400).json({ error: `Số lượng khấu trừ không hợp lệ: "${line && line.quantity}"` });
        if (qty === 0) continue;
        const a = (await query('SELECT name, fee FROM assets WHERE id=$1 AND deleted_at IS NULL', [line.asset_id])).rows[0];
        if (!a) return res.status(400).json({ error: `Tài sản không tồn tại (id=${line && line.asset_id})` });
        const lineTotal = qty * (Number(a.fee) || 0);
        sum += lineTotal;
        parts.push(`${a.name} x${qty} = ${lineTotal.toLocaleString('vi-VN')}`);
      }
      deduction = sum;
      deductionNote = parts.join('; ');
    } else {
      // Đường cũ (khấu trừ nhập tay không theo danh mục) — vẫn bị chặn 0..cọc như trước.
      deduction = +req.body.deduction || 0;
      deductionNote = req.body.deduction_note || '';
    }

    const stu = (await query('SELECT deposit_amount, deposit_status, checkout_notice_date, check_out_date, checkout_reason FROM students WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!stu) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const coc = Number(stu.deposit_amount) || 0;
    // M-1: MÁY TRẠNG THÁI cọc. Trước đây không kiểm deposit_status -> bấm lại đảo refunded<->forfeited
    // tuỳ ý (số cọc/khấu trừ nhảy không lưu vết); và forfeit không qua cổng đủ-điều-kiện -> giữ/xử cọc
    // của HV còn ĐANG Ở. Chỉ tất toán được cọc ĐANG GIỮ ('held') và khi HV ĐÃ TRẢ PHÒNG.
    if (stu.deposit_status === 'refunded' || stu.deposit_status === 'forfeited')
      return res.status(409).json({ error: `Cọc đã được tất toán (${stu.deposit_status === 'refunded' ? 'đã hoàn' : 'không hoàn'}) — không tất toán lại. Nếu cần điều chỉnh, liên hệ quản trị viên.` });
    if (coc <= 0 || stu.deposit_status === 'none')
      return res.status(400).json({ error: 'Học viên không có khoản cọc đang giữ để tất toán.' });
    if (!stu.check_out_date)
      return res.status(400).json({ error: 'Học viên chưa trả phòng — tất toán cọc sau khi check-out.' });
    // Khấu trừ hư hao: không âm (âm = TRẢ cho HV nhiều hơn số họ cọc) và không vượt số cọc
    if (!Number.isFinite(deduction) || deduction < 0)
      return res.status(400).json({ error: `Khấu trừ hư hao không được âm (đang nhận: ${req.body.deduction})` });
    if (deduction > coc)
      return res.status(400).json({ error: `Khấu trừ ${deduction.toLocaleString('vi-VN')} vượt quá số cọc đang giữ ${coc.toLocaleString('vi-VN')}. Nếu cần đòi thêm, lập khoản thu riêng.` });

    // Hoàn cọc: phải ĐỦ ĐIỀU KIỆN. Trước đây kết luận "không đủ điều kiện" chỉ là dòng chữ gợi ý,
    // khâu tất toán không hỏi lại -> bấm hoàn là hoàn.
    if (action === 'refunded') {
      const elig = depositRefundEligible({ noticeDate: stu.checkout_notice_date || null, checkoutDate: stu.check_out_date || null, reason: stu.checkout_reason || 'other' }, +settings.deposit_notice_min_days || 30);
      if (!elig.eligible) {
        const ov = String(req.body.override_reason || '').trim();
        if (ov.length < 10) {
          return res.status(400).json({
            error: `Không đủ điều kiện hoàn cọc: ${elig.reason}. Nếu vẫn quyết định hoàn, gửi kèm "override_reason" (lý do ghi đè, tối thiểu 10 ký tự) — lý do này sẽ được ghi vào hồ sơ và nhật ký.`,
            refund_check: elig,
          });
        }
        // Có lý do ghi đè -> cho phép nhưng GHI VẾT vào ghi chú khấu trừ để tra được về sau
        deductionNote = `[HOÀN NGOẠI LỆ — ${elig.reason}] ${ov}${deductionNote ? ' · ' + deductionNote : ''}`;
      }
    }
    const { rows } = await query(
      `UPDATE students SET deposit_status=$1, deposit_refund_date=$2, deposit_bank=$3, deposit_account=$4,
         deposit_deduction=$5, deposit_deduction_note=$6 WHERE id=$7 RETURNING *`,
      [action, date, req.body.bank || '', req.body.account || '', deduction, deductionNote, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Tài khoản đăng nhập
router.post('/:id/account', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!password || password.length < INITIAL_PASSWORD_MIN) return res.status(400).json({ error: `Mật khẩu tối thiểu ${INITIAL_PASSWORD_MIN} ký tự` });
    const st = await query('SELECT * FROM students WHERE id=$1', [req.params.id]);
    if (!st.rows[0]) return res.status(404).json({ error: 'Không tìm thấy học viên' });
    const existing = await query('SELECT * FROM users WHERE student_id=$1', [req.params.id]);
    const hash = bcrypt.hashSync(password, 10);
    if (existing.rows[0]) {
      // BL-08: khớp đường của NHÂN VIÊN (admin.routes.js) — hai chốt bắt buộc của "đặt lại mật khẩu":
      // must_change_password buộc đổi mật khẩu cấp nhanh ở lần đăng nhập kế;
      // revokeTokens giết vé cũ (JWT hạn 30 ngày) để kẻ xem trộm không dùng tiếp.
      await query('UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2', [hash, existing.rows[0].id]);
      await revokeTokens(existing.rows[0].id);   // đá mọi phiên đang mở của tài khoản đó
      res.json({ ok: true, username: existing.rows[0].username });
    } else {
      const uname = (username || st.rows[0].code || '').trim();
      if (!uname) return res.status(400).json({ error: 'Cần tên đăng nhập' });
      const dup = await query('SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL', [uname]);
      if (dup.rows.length) return res.status(400).json({ error: `Tên đăng nhập "${uname}" đã tồn tại` });
      // must_change_password=true: mật khẩu cấp nhanh yếu (≥6) chỉ chấp nhận được vì BẮT BUỘC đổi ngay
      await query(`INSERT INTO users (username, password_hash, role, full_name, student_id, must_change_password) VALUES ($1,$2,'student',$3,$4,true)`,
        [uname, hash, st.rows[0].name, req.params.id]);
      res.json({ ok: true, username: uname });
    }
  } catch (e) { next(e); }
});

module.exports = router;
