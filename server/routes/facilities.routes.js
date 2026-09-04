const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT f.*,
        (SELECT COUNT(*) FROM rooms r WHERE r.facility_id=f.id AND r.deleted_at IS NULL)::int AS room_count
      FROM facilities f WHERE f.deleted_at IS NULL ORDER BY f.id`);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, address } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nhập tên cơ sở' });
    if (address && String(address).length > 300) return res.status(400).json({ error: 'Địa chỉ quá dài (tối đa 300 ký tự)' });
    // Trùng tên cơ sở -> dropdown chọn cơ sở hiện nhiều dòng giống hệt, xếp người vào nhầm (V2-35).
    const dup = await query(`SELECT 1 FROM facilities WHERE deleted_at IS NULL AND lower(btrim(name))=lower(btrim($1))`, [name]);
    if (dup.rows.length) return res.status(400).json({ error: `Cơ sở "${name.trim()}" đã tồn tại` });
    const { rows } = await query('INSERT INTO facilities (name, address) VALUES ($1,$2) RETURNING *',
      [name.trim(), address || '']);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, address } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nhập tên cơ sở' });
    if (address && String(address).length > 300) return res.status(400).json({ error: 'Địa chỉ quá dài (tối đa 300 ký tự)' });
    const dup = await query(`SELECT 1 FROM facilities WHERE deleted_at IS NULL AND id<>$2 AND lower(btrim(name))=lower(btrim($1))`, [name, req.params.id]);
    if (dup.rows.length) return res.status(400).json({ error: `Cơ sở "${name.trim()}" đã tồn tại` });
    // deleted_at IS NULL: không sửa cơ sở đã xoá (V2-35).
    const { rows } = await query('UPDATE facilities SET name=$1, address=$2 WHERE id=$3 AND deleted_at IS NULL RETURNING *',
      [name.trim(), address || '', req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy cơ sở (hoặc đã bị xoá)' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const c = await query('SELECT COUNT(*)::int c FROM rooms WHERE facility_id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (c.rows[0].c > 0) return res.status(400).json({ error: 'Cơ sở đang có phòng, không thể xóa' });
    // Còn TÀI KHOẢN gắn cơ sở này -> xoá cơ sở sẽ biến họ thành "điều hành" âm thầm (thấy mọi cơ sở).
    // Chặn, buộc chuyển/đổi tài khoản trước. (schema cũng đặt FK users.facility_id ON DELETE RESTRICT.)
    const u = await query('SELECT COUNT(*)::int c FROM users WHERE facility_id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (u.rows[0].c > 0) return res.status(400).json({ error: 'Cơ sở đang có tài khoản quản lý/bảo trì, không thể xoá. Chuyển họ sang cơ sở khác (hoặc để "Tất cả cơ sở") trước.' });
    await query('UPDATE facilities SET deleted_at=now() WHERE id=$1', [req.params.id]); // xóa mềm
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
