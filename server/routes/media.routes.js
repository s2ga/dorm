const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const storage = require('../storage');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const MEDIA_KEYS = ['hero', 'khuon-vien-1', 'khuon-vien-2', 'khuon-vien-3', 'phong-1', 'phong-2', 'phong-3'];
// Tài liệu PDF (không phải ảnh) — dùng chung bảng media nhưng đi đường upload riêng.
const DOC_KEYS = ['noi-quy'];

// Danh sách khóa + đã có ảnh upload chưa
router.get('/', async (req, res, next) => {
  try {
    const rows = (await query('SELECT key, updated_at FROM media')).rows;
    const set = {}; rows.forEach(r => { set[r.key] = r.updated_at; });
    res.json([...MEDIA_KEYS, ...DOC_KEYS].map(key => ({ key, uploaded: !!set[key], updated_at: set[key] || null })));
  } catch (e) { next(e); }
});

// Upload / thay NỘI QUY (PDF). Đường riêng, không dùng chung với ảnh:
// gộp chung là mở cửa cho PDF lọt vào chỗ chỉ được nhận ảnh.
router.post('/doc/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!DOC_KEYS.includes(key)) return res.status(400).json({ error: 'Khóa tài liệu không hợp lệ' });
    const data = req.body.data || '';
    if (!/^data:application\/pdf;base64,/.test(data)) return res.status(400).json({ error: 'Chỉ nhận file PDF' });
    // Ngưỡng KHỚP với parser body 16MB ở index.js (base64 phình ~1/3 so với file gốc).
    // 14MB base64 ≈ 10MB PDF thật -> thông báo nói "~10MB" cho đúng thứ hệ thống thật sự thi hành.
    // Trước đây: giao diện nói 15MB, code kiểm 20MB, parser chặn 16MB — ba con số, dòng 20MB là code chết.
    if (data.length > 14 * 1024 * 1024) return res.status(400).json({ error: 'File PDF quá lớn (tối đa ~10MB). Vui lòng nén lại rồi tải lên.' });
    if (!storage.parsePdfDataUrl(data)) return res.status(400).json({ error: 'Tệp không phải PDF thật (sai chữ ký file)' });

    const objectKey = `${key}.pdf`;
    await storage.putPdfDataUrl(storage.INTRO_BUCKET, objectKey, data);
    await query(
      `INSERT INTO media (key, path, data, updated_at) VALUES ($1,$2,NULL,now())
       ON CONFLICT (key) DO UPDATE SET path=EXCLUDED.path, data=NULL, updated_at=now()`,
      [key, objectKey]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Upload / thay ảnh giới thiệu — luôn lưu lên S3 (bucket intro), lưu KEY vào DB
router.post('/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!MEDIA_KEYS.includes(key)) return res.status(400).json({ error: 'Khóa ảnh không hợp lệ' });
    const data = req.body.data || '';
    if (!/^data:image\/[\w.+-]+;base64,/.test(data)) return res.status(400).json({ error: 'Ảnh không hợp lệ' });
    if (data.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Ảnh quá lớn (tối đa ~6MB)' });

    const p = storage.parseDataUrl(data);
    if (!p) return res.status(400).json({ error: 'Tệp không phải ảnh thật (sai chữ ký file) — chỉ nhận JPG, PNG, WEBP, GIF.' });
    const objectKey = `${key}.${p.ext}`;
    // Đổi đuôi (png -> jpg) thì object mới có TÊN khác -> file cũ nằm lại kho vĩnh viễn (V2-60).
    // Xoá object cũ nếu tên khác object mới — giống luồng ảnh CCCD đã làm.
    const oldRow = (await query('SELECT path FROM media WHERE key=$1', [key])).rows[0];
    await storage.putDataUrl(storage.INTRO_BUCKET, objectKey, data);
    if (oldRow && oldRow.path && oldRow.path !== objectKey) {
      try { await storage.deleteObject(storage.INTRO_BUCKET, oldRow.path); } catch (e) { console.error('[media] không xoá được ảnh cũ', oldRow.path, e.message); }
    }
    await query(
      `INSERT INTO media (key, path, data, updated_at) VALUES ($1,$2,NULL,now())
       ON CONFLICT (key) DO UPDATE SET path=EXCLUDED.path, data=NULL, updated_at=now()`,
      [key, objectKey]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Xóa ảnh upload (dọn cả object trên S3)
router.delete('/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    // Chỉ nhận khoá trong danh sách (2 đường POST đều kiểm, đường xoá thì chưa — V2-62).
    if (![...MEDIA_KEYS, ...DOC_KEYS].includes(key)) return res.status(400).json({ error: 'Khóa không hợp lệ' });
    const row = (await query('SELECT path FROM media WHERE key=$1', [key])).rows[0];
    if (!row) return res.status(404).json({ error: 'Không có gì để xoá (ảnh này chưa được tải lên).' });
    if (row.path) { try { await storage.deleteObject(storage.INTRO_BUCKET, row.path); } catch (e) { console.error('[media] không xoá được object', row.path, e.message); } }
    await query('DELETE FROM media WHERE key=$1', [key]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
