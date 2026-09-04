const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Số nguyên >= 0. Trước đây "+quantity || 1" biến 0 -> 1, "abc" -> 1, -5 lưu được (V2-28/29).
function intGteZero(v, def, ten) {
  if (v === undefined || v === null || v === '') return { val: def };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return { err: `${ten} phải là số nguyên ≥ 0 (đang nhận: "${v}")` };
  return { val: n };
}

router.get('/', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY category DESC, sort, id');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, unit, category, note } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nhập tên tài sản' });
    const q = intGteZero(req.body.quantity, 1, 'Số lượng'); if (q.err) return res.status(400).json({ error: q.err });
    const f = intGteZero(req.body.fee, 0, 'Phí bồi hoàn'); if (f.err) return res.status(400).json({ error: f.err });
    // Trùng tên (trong các tài sản chưa xoá) -> chặn: màn hoàn cọc hiện nhiều dòng cùng tên khác
    // mức phí thì chọn nhầm là chuyện sớm muộn (V2-31).
    const dup = await query(`SELECT 1 FROM assets WHERE deleted_at IS NULL AND lower(btrim(name))=lower(btrim($1))`, [name]);
    if (dup.rows.length) return res.status(400).json({ error: `Tài sản "${name.trim()}" đã có trong danh mục` });
    const { rows } = await query(
      `INSERT INTO assets (name, unit, category, quantity, fee, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name.trim(), unit || 'Cái', category === 'person' ? 'person' : 'fixed', q.val, f.val, note || '']
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, unit, category, note } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nhập tên tài sản' });
    const q = intGteZero(req.body.quantity, 1, 'Số lượng'); if (q.err) return res.status(400).json({ error: q.err });
    const f = intGteZero(req.body.fee, 0, 'Phí bồi hoàn'); if (f.err) return res.status(400).json({ error: f.err });
    const dup = await query(`SELECT 1 FROM assets WHERE deleted_at IS NULL AND id<>$2 AND lower(btrim(name))=lower(btrim($1))`, [name, req.params.id]);
    if (dup.rows.length) return res.status(400).json({ error: `Tài sản "${name.trim()}" đã có trong danh mục` });
    // deleted_at IS NULL: không sửa được bản ĐÃ XOÁ (trước đây sửa được, id ma cũng 200) (V2-32).
    const { rows } = await query(
      `UPDATE assets SET name=$1, unit=$2, category=$3, quantity=$4, fee=$5, note=$6
       WHERE id=$7 AND deleted_at IS NULL RETURNING *`,
      [name.trim(), unit || 'Cái', category === 'person' ? 'person' : 'fixed', q.val, f.val, note || '', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy tài sản (hoặc đã bị xoá)' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Xóa mềm — chỉ xoá bản CÒN SỐNG; id ma / xoá lần 2 -> 404 (trước đây {ok:true} cho mọi thứ) (V2-32).
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE assets SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id, name', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy tài sản (hoặc đã bị xoá)' });
    res.json({ ok: true, deleted: rows[0].name });   // trả tên để nhật ký biết đã xoá tài sản gì (V2-33)
  } catch (e) { next(e); }
});

// Khôi phục tài sản đã xoá — trước đây không có, xoá nhầm chỉ sửa được bằng SQL tay (V2-32).
router.post('/:id/restore', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE assets SET deleted_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy tài sản đã xoá' });
    // Nếu trùng tên với một tài sản đang sống thì đừng khôi phục ra 2 dòng cùng tên
    const dup = await query(`SELECT 1 FROM assets WHERE deleted_at IS NULL AND id<>$2 AND lower(btrim(name))=lower(btrim($1))`, [rows[0].name, req.params.id]);
    if (dup.rows.length) { await query('UPDATE assets SET deleted_at=now() WHERE id=$1', [req.params.id]); return res.status(400).json({ error: `Đã có tài sản "${rows[0].name}" trong danh mục — không khôi phục để tránh trùng.` }); }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
