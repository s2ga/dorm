const express = require('express');
const bcrypt = require('bcryptjs');
const { query, withTransaction, getSettings } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { checkRoomAssignment, logOverload, blockOrConfirm } = require('../room-rules');
const { isValidYmd, checkPassword, INITIAL_PASSWORD_MIN } = require('../valid');
const roomStays = require('../room-stays');
const { applyFacilityFilter, isExecutive, assertFacility, canAccessFacility } = require('../scope');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'staff'));

// Đa cơ sở: mọi thao tác trên /:id của một đơn (duyệt/từ chối/xoá/ghi chú) phải thuộc cơ sở người dùng.
router.param('id', async (req, res, next, id) => {
  try {
    if (isExecutive(req)) return next();
    if (!/^\d+$/.test(String(id))) return next();
    const row = (await query('SELECT facility_id FROM applications WHERE id=$1', [id])).rows[0];
    if (!row) return next();
    const bad = assertFacility(req, row.facility_id);
    if (bad) return res.status(bad.status).json(bad);
    next();
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    // Đa cơ sở: đơn đăng ký chỉ hiện cho quản lý ĐÚNG cơ sở đó (a.facility_id); điều hành thấy hết
    // (lọc tuỳ chọn ?facility). Quản lý cơ sở bị ÉP theo cơ sở của mình.
    const cond = ['a.deleted_at IS NULL'];
    const params = [];
    if (isExecutive(req)) {
      if (req.query.facility) { params.push(+req.query.facility); cond.push(`a.facility_id = $${params.length}`); }
    } else {
      applyFacilityFilter(req, 'a.facility_id', cond, params);
    }
    const { rows } = await query(`SELECT a.*, f.name AS facility_name FROM applications a
      LEFT JOIN facilities f ON f.id = a.facility_id
      WHERE ${cond.join(' AND ')}
      ORDER BY (a.status='pending') DESC, a.created_at DESC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Ghi chú của quản lý cho đơn đăng ký
router.put('/:id/note', async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE applications SET admin_note=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id', [req.body.note || '', req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Duyệt đơn: tạo học viên từ đơn + xếp phòng + (tùy chọn) tạo tài khoản
router.post('/:id/approve', async (req, res, next) => {
  try {
    // ---- KIỂM TRA & ĐỌC trước, KHÔNG mở transaction khi còn khả năng trả lỗi sớm ----
    // deleted_at IS NULL: không duyệt đơn ĐÃ XOÁ thành học viên thật (V2-57a).
    const app = (await query('SELECT * FROM applications WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!app) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    // CHỈ duyệt đơn ĐANG CHỜ: đơn đã duyệt -> thôi; đơn đã TỪ CHỐI mà duyệt lại thì mất dấu lần từ
    // chối (reviewed_at bị ghi đè) (V2-57b).
    if (app.status !== 'pending')
      return res.status(400).json({ error: app.status === 'approved' ? 'Đơn đã được duyệt' : 'Đơn đã bị từ chối — không thể duyệt. Nếu muốn nhận, hãy để học viên nộp đơn mới.' });
    // Đa cơ sở: quản lý cơ sở chỉ duyệt đơn THUỘC cơ sở mình (đơn cơ sở khác -> 403).
    const badFac = assertFacility(req, app.facility_id);
    if (badFac) return res.status(badFac.status).json(badFac);

    const b = req.body; // room_id, check_in_date, create_login, deposit_paid, deposit_amount, contract_no/date/status, rental_type
    // Chỉ xếp phòng THUỘC cơ sở của đơn (không xếp HV cơ sở A vào phòng cơ sở B).
    if (b.room_id) {
      const rm = (await query('SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL', [b.room_id])).rows[0];
      if (!rm) return res.status(400).json({ error: 'Phòng không tồn tại' });
      if (app.facility_id != null && rm.facility_id !== app.facility_id)
        return res.status(400).json({ error: 'Phòng được chọn không thuộc cơ sở của đơn đăng ký — chọn phòng đúng cơ sở.' });
    }
    // V2-56: duyệt đơn KHÔNG được đi vòng qua validate của hồ sơ học viên (đường /students có kiểm,
    // đường này trước đây không import valid.js dòng nào).
    if (b.check_in_date != null && !isValidYmd(b.check_in_date))
      return res.status(400).json({ error: `Ngày nhận phòng không hợp lệ: "${b.check_in_date}"` });
    if (b.contract_date != null && b.contract_date !== '' && !isValidYmd(b.contract_date))
      return res.status(400).json({ error: `Ngày hợp đồng không hợp lệ: "${b.contract_date}"` });
    const checkIn = b.check_in_date || new Date().toISOString().slice(0, 10);
    const settings = await getSettings();
    const takeDeposit = !!b.deposit_paid;
    const depositAmt = b.deposit_amount != null ? Number(b.deposit_amount) : (+settings.deposit_fee || 0);
    if (!Number.isFinite(depositAmt) || depositAmt < 0 || depositAmt > 100000000)
      return res.status(400).json({ error: `Số tiền cọc không hợp lệ (đang nhận: "${b.deposit_amount}")` });
    const cStatus = ['done', 'scanned', 'unsigned', 'none'].includes(b.contract_status) ? b.contract_status : 'unsigned';

    // Trùng hồ sơ -> người này đã có hồ sơ. Duyệt đơn là đẻ thêm hồ sơ thứ hai -> thu tiền 2 lần.
    // Kiểm theo MÃ HV nếu có; mã HV để trống thì lùi về kiểm theo SĐT — chống trùng trước đây CHỈ
    // chạy khi có mã HV, mà /apply cho để trống mã (V2-55). Staff vẫn ghi đè được bằng confirm_duplicate
    // (SĐT có thể trùng thật giữa người nhà), nhưng phải CHỦ Ý.
    if (!b.confirm_duplicate) {
      let dup = null, lyDo = '';
      if (String(app.code || '').trim()) {
        dup = (await query(
          `SELECT s.id, s.name, s.status, r.name AS room_name FROM students s LEFT JOIN rooms r ON r.id=s.room_id
            WHERE s.deleted_at IS NULL AND lower(btrim(s.code)) = lower(btrim($1)) LIMIT 1`, [app.code])).rows[0];
        if (dup) lyDo = `trùng mã HV "${app.code}"`;
      }
      if (!dup && String(app.phone || '').trim()) {
        dup = (await query(
          `SELECT s.id, s.name, s.status, r.name AS room_name FROM students s LEFT JOIN rooms r ON r.id=s.room_id
            WHERE s.deleted_at IS NULL AND regexp_replace(s.phone,'\\D','','g') = regexp_replace($1,'\\D','','g')
              AND regexp_replace($1,'\\D','','g') <> '' LIMIT 1`, [app.phone])).rows[0];
        if (dup) lyDo = `trùng số điện thoại "${app.phone}"`;
      }
      if (dup) return res.status(409).json({
        duplicate: true, existing: dup,
        error: `${dup.name} đã có hồ sơ (${lyDo})` +
          (dup.status === 'in' ? ` — đang ở phòng ${dup.room_name || 'chưa xếp'}.` : ' — đã trả phòng.') +
          ' Duyệt đơn này sẽ tạo hồ sơ thứ hai và bạn ấy bị tính tiền 2 lần. Nếu đúng là người khác' +
          ' (vd trùng SĐT người nhà), gửi lại kèm xác nhận; nếu không, xử lý trên hồ sơ cũ rồi Từ chối đơn này.',
      });
    }
    // LUẬT XẾP PHÒNG — áp cả ở đường DUYỆT ĐƠN (trước đây duyệt thẳng vào phòng đầy/sai giới tính đều lọt)
    const chkA = await checkRoomAssignment({ studentId: null, gender: app.gender, rentalType: b.rental_type || app.rental_type, roomId: b.room_id });
    if (blockOrConfirm(res, chkA, b.confirm_overload === true)) return;

    let uname = null, pass = null;
    if (b.create_login) {
      uname = (b.login_username || app.phone || app.code || '').trim();
      pass = (b.login_password || '').trim();
      if (!uname) return res.status(400).json({ error: 'Cần tên đăng nhập' });
      // Mật khẩu tối thiểu 6 (trước là 4). Mật khẩu ban đầu thường là SĐT (toàn số) nên chưa ép
      // checkPassword mạnh ở đây, NHƯNG buộc đổi ngay lần đăng nhập đầu (V2-58) -> khi đổi thì
      // checkPassword (>=8, có chữ+số) mới áp. Không còn mật khẩu 4 số sống vĩnh viễn.
      if (pass.length < INITIAL_PASSWORD_MIN) return res.status(400).json({ error: `Mật khẩu tối thiểu ${INITIAL_PASSWORD_MIN} ký tự` });
      const dup = await query('SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL', [uname]);
      if (dup.rows.length) return res.status(400).json({ error: `Tên đăng nhập "${uname}" đã tồn tại` });
    }

    // ---- GHI trong 1 transaction (chỉ INSERT/UPDATE, không return sớm; withTransaction luôn ROLLBACK+release khi lỗi) ----
    let account = null;
    const student = await withTransaction(async (client) => {
      // V2-54: KHOÁ dòng đơn trong transaction rồi kiểm lại status. Hai staff bấm Duyệt cùng lúc
      // (hoặc double-click) trước đây LỌT cả hai vì chốt status ở trên đọc ngoài transaction, không
      // khoá -> 2 hồ sơ, thu tiền 2 lần. FOR UPDATE bắt request thứ hai chờ, rồi thấy 'approved' -> dừng.
      const locked = (await client.query('SELECT status FROM applications WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [app.id])).rows[0];
      if (!locked) { const e = new Error('Không tìm thấy đơn'); e.status = 404; throw e; }
      if (locked.status !== 'pending') { const e = new Error('Đơn đã được xử lý (có thể một người khác vừa duyệt).'); e.status = 409; throw e; }
      // M-6: FOR UPDATE ở trên chỉ khoá ĐÚNG đơn này. Cùng một người nộp 2 đơn pending KHÁC NHAU (mã HV
      // để trống, tên lệch 1 ký tự) rồi 2 staff duyệt ĐỒNG THỜI -> mỗi bên khoá đơn của mình, cả hai qua
      // dedup (chạy trước transaction, lúc chưa ai tạo student) -> 2 hồ sơ, thu tiền 2 lần. Khoá tư vấn
      // theo SĐT/mã để 2 approve cùng người xếp hàng, rồi KIỂM TRÙNG LẠI trong transaction: người sau
      // thấy hồ sơ người trước vừa tạo -> dừng. Chỉ khoá khi KHÔNG chủ ý ghi đè trùng (confirm_duplicate).
      if (!b.confirm_duplicate) {
        const key = String(app.code || '').trim() ? 'code:' + app.code.trim().toLowerCase()
          : String(app.phone || '').trim() ? 'phone:' + app.phone.replace(/\D/g, '') : '';
        if (key) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [key]);
          const dupIn = (await client.query(
            `SELECT s.name FROM students s WHERE s.deleted_at IS NULL AND (
                (btrim($1) <> '' AND lower(btrim(s.code)) = lower(btrim($1)))
                OR (regexp_replace($2,'\\D','','g') <> '' AND regexp_replace(s.phone,'\\D','','g') = regexp_replace($2,'\\D','','g'))
              ) LIMIT 1`, [app.code || '', app.phone || ''])).rows[0];
          if (dupIn) { const e = new Error(`${dupIn.name} vừa được tạo hồ sơ (trùng mã HV/SĐT) bởi thao tác khác — không tạo hồ sơ thứ hai.`); e.status = 409; throw e; }
        }
      }
      const { rows } = await client.query(
        `INSERT INTO students (code, name, gender, phone, birth_date, class_name, room_id, check_in_date, status, note,
           rental_type, residency_status, contract_no, contract_date, contract_status, uses_washing, deposit_amount, deposit_status, deposit_date,
           cccd_front, cccd_back, facility_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in',$9,$10,'unregistered',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
        [app.code || '', app.name, app.gender, app.phone, app.birth_date, app.class_name,
         b.room_id || null, checkIn, app.note || '', b.rental_type || app.rental_type || 'ghep',
         b.contract_no || '', b.contract_date || null, cStatus,
         !!app.wants_washing, takeDeposit ? depositAmt : 0, takeDeposit ? 'held' : 'none', takeDeposit ? checkIn : null,
         app.cccd_front || null, app.cccd_back || null,
         app.facility_id != null ? app.facility_id : null]  // đa cơ sở: HV thuộc cơ sở của đơn
      );
      const st = rows[0];
      // Mở lượt ở phòng ngay từ đầu -> về sau chuyển/trả phòng mới cắt chặng tính điện được
      if (b.room_id) await roomStays.openStay(client, st.id, b.room_id, checkIn);
      await client.query(`INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'in',$2,$3,'Duyệt đơn & vào ở','admin')`,
        [st.id, checkIn, b.room_id || null]);
      // CHỈ tạo xe khi có BIỂN SỐ thật. Trước đây tick "muốn gửi xe" mà không biển vẫn tạo một xe
      // biển rỗng -> bị tính phí gửi xe cho một chiếc xe không có biển (V2-24 nối V2-21). Phí gửi xe
      // tính theo xe THẬT có biển; ý định gửi xe mà chưa có biển thì để staff thêm sau.
      if (app.plate && app.plate.trim()) {
        await client.query(`INSERT INTO vehicles (student_id, plate, from_date) VALUES ($1,$2,$3)`, [st.id, app.plate.trim(), checkIn]);
      }
      if (b.create_login) {
        // must_change_password=true: buộc đổi ngay lần đầu (trước đây mặc định false -> mật khẩu
        // SĐT/4 số sống vĩnh viễn, token 30 ngày, dò được trong vài ngày) (V2-58).
        await client.query(`INSERT INTO users (username, password_hash, role, full_name, student_id, must_change_password) VALUES ($1,$2,'student',$3,$4,true)`,
          [uname, bcrypt.hashSync(pass, 10), app.name, st.id]);
        account = { username: uname, password: pass };
      }
      await client.query(`UPDATE applications SET status='approved', student_id=$1, reviewed_at=now() WHERE id=$2`, [st.id, app.id]);
      return st;
    });

    for (const w of chkA.warnings) await logOverload(req, { studentId: student.id, studentName: student.name, warning: w });
    res.json({ ok: true, student, account, warnings: chkA.warnings });
  } catch (e) { next(e); }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    // Không cho từ chối đơn ĐÃ DUYỆT: người ta đã vào ở rồi, đơn ghi "từ chối" là hồ sơ nói một đằng thực tế một nẻo.
    // deleted_at IS NULL: không từ chối đơn đã xoá mềm.
    const app = (await query('SELECT status FROM applications WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!app) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    if (app.status === 'approved')
      return res.status(400).json({ error: 'Đơn đã được duyệt và học viên đã vào ở — không thể từ chối. Nếu người này không ở nữa, dùng chức năng Check-out / Xoá học viên.' });
    if (app.status === 'rejected') return res.json({ ok: true, already: true });
    // BLK-4: cập nhật NGUYÊN TỬ — chỉ đổi khi VẪN 'pending'. Chống đua với /approve chạy song song:
    // trước đây reject đọc thấy 'pending' rồi vẫn ghi đè status SAU khi approve đã tạo học viên → HV đã
    // vào ở nhưng đơn ghi "rejected" (mâu thuẫn vĩnh viễn). WHERE status='pending' + kiểm rowCount chặn.
    const r = await query(`UPDATE applications SET status='rejected', reviewed_at=now() WHERE id=$1 AND status='pending' AND deleted_at IS NULL RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(409).json({ error: 'Đơn vừa được xử lý bởi thao tác khác (duyệt/từ chối) — tải lại để xem trạng thái mới nhất.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Xóa mềm — KHÔNG xoá đơn ĐÃ DUYỆT (học viên đang ở, students.id còn trỏ tới) và không {ok:true}
// cho id ma. Trước đây xoá được đơn đã duyệt -> hồ sơ gốc (CCCD, nguyện vọng, ngày nộp) biến mất
// khỏi mọi màn hình trong khi HV vẫn tồn tại, mâu thuẫn thẳng với việc CẤM từ chối đơn đã duyệt (V2-57c).
router.delete('/:id', async (req, res, next) => {
  try {
    const app = (await query('SELECT status FROM applications WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
    if (!app) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    if (app.status === 'approved')
      return res.status(400).json({ error: 'Đơn đã duyệt và học viên đã vào ở — không xoá đơn (hồ sơ gốc cần giữ). Nếu người này không ở nữa, dùng Check-out / Xoá học viên.' });
    // BLK-4: xoá mềm NGUYÊN TỬ — chỉ khi CHƯA duyệt. Chống đua với /approve: nếu approve vừa set 'approved'
    // sau khi ta đọc 'pending', WHERE status<>'approved' không khớp → không xoá nhầm hồ sơ HV đang ở.
    const r = await query(`UPDATE applications SET deleted_at=now() WHERE id=$1 AND status<>'approved' AND deleted_at IS NULL RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(409).json({ error: 'Đơn vừa được duyệt bởi thao tác khác — không xoá được (hồ sơ học viên đang ở cần giữ). Tải lại để xem.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
