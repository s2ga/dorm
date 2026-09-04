const express = require('express');
const { query, getSettings } = require('../db');
const storage = require('../storage');
const { isValidYmd, isValidPhone, isValidGender, tooLong } = require('../valid');

const router = express.Router(); // KHÔNG yêu cầu đăng nhập

// Danh sách khóa ảnh hợp lệ của trang giới thiệu
const MEDIA_KEYS = ['hero', 'khuon-vien-1', 'khuon-vien-2', 'khuon-vien-3', 'phong-1', 'phong-2', 'phong-3'];

// MỘT định nghĩa "đang ở" cho MỌI số liệu công khai. Trước đây /info và /stats mỗi đường
// đếm một kiểu -> hai trang cạnh nhau nói hai con số (206 vs 111). Ai sửa cũng chỉ sửa một chỗ.
async function demNguoiDangO() {
  return (await query(
    `SELECT COUNT(*)::int c FROM students s
     JOIN rooms r ON r.id = s.room_id AND COALESCE(r.room_type,'shared')='shared' AND r.deleted_at IS NULL
     WHERE s.deleted_at IS NULL
       AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE)`)).rows[0].c;
}

// Phục vụ ảnh giới thiệu: proxy từ S3 (bucket intro) — cùng 1 cơ chế ở mọi môi trường.
// Chưa upload -> 404 (frontend tự hiện ảnh mẫu placeholder).
router.get('/image/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!MEDIA_KEYS.includes(key)) return res.status(404).end();
    const row = (await query('SELECT path FROM media WHERE key=$1', [key])).rows[0];
    if (!row || !row.path) return res.status(404).end();
    const obj = await storage.getObject(storage.INTRO_BUCKET, row.path);
    res.set('Content-Type', obj.contentType || 'image/jpeg');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=300');
    obj.body.pipe(res);
  } catch (e) { res.status(404).end(); }
});

// Nội quy ký túc xá (PDF). Không cần đăng nhập: đây là bản ai cũng được phát khi vào ở,
// và người sắp đăng ký cũng nên đọc được trước khi quyết định.
router.get('/doc/noi-quy', async (req, res, next) => {
  try {
    const row = (await query(`SELECT path FROM media WHERE key='noi-quy'`)).rows[0];
    if (!row || !row.path) return res.status(404).end();
    const obj = await storage.getObject(storage.INTRO_BUCKET, row.path);
    res.set('Content-Type', 'application/pdf');
    res.set('X-Content-Type-Options', 'nosniff');
    // inline = mở thẳng trong trình duyệt, không bắt tải về rồi mới đọc
    res.set('Content-Disposition', 'inline; filename="noi-quy-ky-tuc-xa.pdf"');
    res.set('Cache-Control', 'public, max-age=300');
    obj.body.pipe(res);
  } catch (e) { res.status(404).end(); }
});

// Thông tin KTX + đơn giá (để hiển thị trên trang đăng ký)
router.get('/info', async (req, res, next) => {
  try {
    const s = await getSettings();
    // Cơ sở ĐÃ ĐÓNG thì đừng khoe địa chỉ ra ngoài, và đừng để nó nằm trong ô chọn lúc đăng ký.
    // Các truy vấn phòng ngay dưới đều lọc deleted_at — riêng dòng này thì quên.
    const facilities = (await query('SELECT id, name, address FROM facilities WHERE deleted_at IS NULL ORDER BY id')).rows;
    const fac = facilities[0] || {};
    // Chỉ tính phòng CHO THUÊ GHÉP (bỏ nguyên phòng / an ninh / nhân viên) cho số liệu công khai
    const rooms = (await query("SELECT COUNT(*)::int c FROM rooms WHERE COALESCE(room_type,'shared')='shared' AND deleted_at IS NULL")).rows[0].c;
    const beds = (await query("SELECT COALESCE(SUM(capacity),0)::int c FROM rooms WHERE COALESCE(room_type,'shared')='shared' AND deleted_at IS NULL")).rows[0].c;
    // Giường trống: kẹp ở 0 theo TỪNG phòng — phòng đang ở vượt sức chứa không "cho mượn" chỗ
    // trống sang phòng khác. Đây là con số dùng để nói "còn nhận được bao nhiêu người".
    const bedFree = (await query(
      `SELECT COALESCE(SUM(GREATEST(0, r.capacity -
          (SELECT COUNT(*) FROM students s WHERE s.room_id=r.id AND s.deleted_at IS NULL
             AND s.check_in_date<=CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date>CURRENT_DATE)))),0)::int c
       FROM rooms r WHERE COALESCE(r.room_type,'shared')='shared' AND r.deleted_at IS NULL`)).rows[0].c;
    // Số người đang ở: đếm NGƯỜI THẬT, không suy ra từ (giường - giường trống).
    // Cách suy ra kia kẹp theo sức chứa nên GIẤU MẤT người ở vượt sức chứa (đo được: 107 thay vì 113),
    // và làm /info với /stats nói hai con số khác nhau. Ở vượt sức chứa là CỐ Ý — phải thấy được.
    const occupancy = await demNguoiDangO();
    res.json({
      dorm_name: s.dorm_name, hotline: s.hotline,
      address: fac.address || '', facility_name: fac.name || '',
      facilities: facilities.map(f => ({ id: f.id, name: f.name, address: f.address })),
      room_count: rooms, bed_count: beds, occupancy, bed_free: bedFree,
      room_fee: s.room_fee, deposit_fee: s.deposit_fee,
      electric_unit: s.electric_unit, water_fee: s.water_fee, service_fee: s.service_fee,
      washing_fee: s.washing_fee, parking_fee: s.parking_fee,
      intro_hero_title: s.intro_hero_title, intro_hero_desc: s.intro_hero_desc,
      intro_about_eyebrow: s.intro_about_eyebrow, intro_about_title: s.intro_about_title, intro_about_desc: s.intro_about_desc,
      intro_rooms_eyebrow: s.intro_rooms_eyebrow, intro_rooms_title: s.intro_rooms_title, intro_rooms_desc: s.intro_rooms_desc,
      intro_amenities_title: s.intro_amenities_title,
      intro_price_title: s.intro_price_title, intro_price_desc: s.intro_price_desc,
      intro_contact_title: s.intro_contact_title, intro_contact_desc: s.intro_contact_desc,
      'imgcap_khuon-vien-1': s['imgcap_khuon-vien-1'], 'imgcap_khuon-vien-2': s['imgcap_khuon-vien-2'], 'imgcap_khuon-vien-3': s['imgcap_khuon-vien-3'],
      'imgcap_phong-1': s['imgcap_phong-1'], 'imgcap_phong-2': s['imgcap_phong-2'], 'imgcap_phong-3': s['imgcap_phong-3'],
    });
  } catch (e) { next(e); }
});

// Thống kê nhanh cho màn hình đăng nhập
router.get('/stats', async (req, res, next) => {
  try {
    // Đếm ĐÚNG cái mà /info ngay trên đang đếm, nếu không hai trang công khai cạnh nhau
    // nói hai con số khác nhau: /stats từng khoe 206 học viên trong khi thực tế đang ở 111
    // (đếm cả người đã trả phòng + cả phòng an ninh/nhân viên).
    const rooms = (await query(
      "SELECT COUNT(*)::int c FROM rooms WHERE COALESCE(room_type,'shared')='shared' AND deleted_at IS NULL")).rows[0].c;
    const students = await demNguoiDangO();
    const zones = (await query('SELECT COUNT(*)::int c FROM facilities WHERE deleted_at IS NULL')).rows[0].c;
    res.json({ rooms, students, zones });
  } catch (e) { next(e); }
});

// Phòng còn trống (số slot trống > 0) để học viên tham khảo
router.get('/available-rooms', async (req, res, next) => {
  try {
    // s.deleted_at IS NULL: thiếu điều kiện này thì HỌC VIÊN ĐÃ XOÁ VẪN CHIẾM GIƯỜNG,
    // phòng còn trống thật bị ẩn khỏi trang đăng ký, và số này lệch với bed_free của /info.
    const { rows } = await query(`
      SELECT r.name, r.floor, r.gender, r.hang, r.capacity,
        (SELECT COUNT(*) FROM students s WHERE s.room_id=r.id AND s.deleted_at IS NULL
           AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE))::int AS occupancy
      FROM rooms r WHERE COALESCE(r.room_type,'shared')='shared' AND r.deleted_at IS NULL ORDER BY r.floor, r.name`);
    // Người ngoài chỉ cần biết CÒN CHỖ hay không và phòng dành cho giới nào.
    // Khoe số người đang ở + tầng + sức chứa từng phòng = cho biết chính xác phòng nào có mấy nữ.
    const avail = rows
      .map(r => ({ name: r.name, gender: r.gender, hang: r.hang, free: Math.max(0, (r.capacity || 0) - r.occupancy) }))
      .filter(r => r.free > 0);
    res.json(avail);
  } catch (e) { next(e); }
});

// Gửi đơn đăng ký
router.post('/apply', async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Vui lòng nhập họ tên' });
    if (!b.phone || !b.phone.trim()) return res.status(400).json({ error: 'Vui lòng nhập số điện thoại' });
    if (!isValidPhone(b.phone)) return res.status(400).json({ error: 'Số điện thoại không hợp lệ (chỉ chữ số, 8–15 số)' });
    // Giới tính SAI thì chặn, đừng đoán. Đây là trường quyết định phòng nam hay phòng nữ:
    // đoán sai một lần là xếp nam vào phòng nữ, và luật chặn giới tính lúc duyệt đơn
    // không cứu được vì nó chỉ so đơn với phòng, không biết đơn đã sai từ đầu.
    if (!isValidGender(b.gender))
      return res.status(400).json({ error: 'Vui lòng chọn giới tính (nam hoặc nữ)' });
    // Đa cơ sở: BẮT BUỘC chọn cơ sở — đơn về đúng quản lý cơ sở đó. Phải là cơ sở có thật, chưa xoá.
    const facId = Number(b.facility_id);
    if (!Number.isInteger(facId) || facId <= 0)
      return res.status(400).json({ error: 'Vui lòng chọn cơ sở ký túc xá bạn muốn đăng ký' });
    const facOk = await query('SELECT 1 FROM facilities WHERE id=$1 AND deleted_at IS NULL', [facId]);
    if (!facOk.rows.length)
      return res.status(400).json({ error: 'Cơ sở đã chọn không hợp lệ (có thể vừa bị gỡ) — vui lòng chọn lại' });
    const qua = tooLong(b, { name: 120, phone: 20, code: 40, class_name: 80, pref: 500, note: 2000, plate: 20 });
    if (qua) return res.status(400).json({ error: qua });
    // Ngày sinh: phải là ngày CÓ THẬT và không ở tương lai; sai -> bỏ qua (null) thay vì lỗi 500
    const todayStr = new Date().toISOString().slice(0, 10);
    // Ngày sinh sai thì BÁO, đừng lặng lẽ đổi thành trống: người ta bấm "Gửi" xong thấy
    // "Đã gửi đăng ký!" và yên tâm là đã khai — đến lúc quản lý mở đơn ra mới thấy thiếu,
    // phải gọi điện hỏi lại từng người. Ô trống (không khai) thì vẫn cho qua, đó là quyền của họ.
    const coNgaySinh = b.birth_date != null && String(b.birth_date).trim() !== '';
    if (coNgaySinh && !isValidYmd(b.birth_date))
      return res.status(400).json({ error: `Ngày sinh không hợp lệ: "${b.birth_date}"` });
    if (coNgaySinh && b.birth_date > todayStr)
      return res.status(400).json({ error: 'Ngày sinh không thể ở tương lai — vui lòng chọn lại.' });
    const birthDate = coNgaySinh ? b.birth_date : null;
    // Chống trùng: cùng tên + cùng SĐT mà đã có đơn ĐANG CHỜ DUYỆT thì thôi. Người thật bấm
    // Gửi hai lần (mạng chậm, tưởng chưa gửi) không tạo ra hai đơn; và người lạ không bơm được
    // hàng trăm đơn giống hệt nhau vào bảng cho nhân viên ngồi lọc tay.
    const trung = await query(
      `SELECT id FROM applications WHERE status='pending' AND lower(trim(name))=lower($1) AND $2 = regexp_replace(phone,'\\D','','g')`,
      [b.name.trim(), b.phone.replace(/\D/g, '')]);
    if (trung.rows.length)
      return res.status(409).json({ error: 'Bạn đã có một đơn đăng ký đang chờ duyệt. Ký túc xá sẽ liên hệ sớm — không cần gửi lại.' });
    // Ảnh CCCD: kiểm TRƯỚC khi chèn đơn. Trước đây ảnh hỏng bị `catch` rỗng nuốt sạch rồi
    // vẫn trả 201 "đã gửi" — học viên tin là đã nộp, nhân viên mở đơn thấy trống, không log nào.
    for (const field of ['cccd_front', 'cccd_back']) {
      const v = b[field];
      if (v == null || v === '') continue;
      const ten = field === 'cccd_front' ? 'mặt trước' : 'mặt sau';
      if (!/^data:image\//.test(String(v)))
        return res.status(400).json({ error: `Ảnh CCCD ${ten} không phải file ảnh. Vui lòng chụp lại và tải lên.` });
      if (String(v).length > 8 * 1024 * 1024)
        return res.status(400).json({ error: `Ảnh CCCD ${ten} quá lớn (tối đa ~6MB). Vui lòng chụp lại ảnh nhẹ hơn.` });
      if (!storage.parseDataUrl(v))
        return res.status(400).json({ error: `Ảnh CCCD ${ten} sai định dạng — chỉ nhận JPG, PNG hoặc WEBP.` });
    }
    // Chèn đơn trước (chưa có ảnh) để lấy id
    const { rows } = await query(
      `INSERT INTO applications (name, phone, gender, birth_date, code, class_name, rental_type, pref, note, wants_washing, wants_parking, plate, facility_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [b.name.trim(), b.phone.trim(), b.gender, birthDate,
       b.code || '', b.class_name || '', b.rental_type === 'phong' ? 'phong' : 'ghep', b.pref || '', b.note || '',
       !!b.wants_washing, !!b.wants_parking, b.plate || '', facId]
    );
    const appId = rows[0].id;

    // Ảnh CCCD -> S3 (bucket riêng tư), lưu key. Định dạng đã kiểm ở trên; ở đây chỉ còn lỗi KHO
    // (S3 sập, hết quota). Lỗi đó KHÔNG được nuốt: đơn đã lưu rồi nên vẫn trả 201, nhưng phải
    // NÓI RA là ảnh chưa lên, kèm cảnh báo để người ta biết đường bổ sung.
    const upd = {};
    const loiAnh = [];
    for (const field of ['cccd_front', 'cccd_back']) {
      const v = b[field];
      if (!v) continue;
      const p = storage.parseDataUrl(v);
      const objKey = `applications/${appId}/${field}.${p.ext}`;
      try {
        await storage.putDataUrl(storage.CCCD_BUCKET, objKey, v);
        upd[field] = objKey;
      } catch (e) {
        loiAnh.push(field === 'cccd_front' ? 'mặt trước' : 'mặt sau');
        console.error(`[apply] đơn #${appId}: không lưu được ảnh ${field}:`, e.message);
      }
    }
    if (Object.keys(upd).length) {
      const keys = Object.keys(upd);
      await query(`UPDATE applications SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(', ')} WHERE id=$${keys.length + 1}`,
        [...keys.map(k => upd[k]), appId]);
    }
    if (loiAnh.length) {
      // Ghi vào ghi chú của đơn để nhân viên mở ra là thấy ngay, khỏi phải đoán vì sao trống
      await query(`UPDATE applications SET note = TRIM(COALESCE(note,'') || $1) WHERE id=$2`,
        [`\n[HỆ THỐNG] Chưa lưu được ảnh CCCD ${loiAnh.join(' và ')} — cần liên hệ học viên bổ sung.`, appId]);
      return res.status(201).json({
        ok: true, id: appId, warning: true,
        error: `Đã nhận đơn đăng ký, NHƯNG chưa tải lên được ảnh CCCD ${loiAnh.join(' và ')}. Ký túc xá sẽ liên hệ để bổ sung.`,
      });
    }
    res.status(201).json({ ok: true, id: appId });
  } catch (e) { next(e); }
});

module.exports = router;
