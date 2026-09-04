// ===== Object storage (S3) — MỘT client duy nhất cho mọi môi trường =====
// local dev -> MinIO;  staging/UAT/prod -> Supabase Storage / AWS S3.
// Chỉ khác endpoint + credentials qua ENV; KHÔNG rẽ nhánh framework theo môi trường.
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Fail-fast: bắt buộc cấu hình S3 ở MỌI môi trường (không có fallback base64/đĩa)
const NEED = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_CCCD_BUCKET', 'S3_INTRO_BUCKET'];
const missing = NEED.filter(k => !process.env[k]);
if (missing.length) {
  throw new Error('Thiếu cấu hình object storage (S3): ' + missing.join(', ') +
    '. Local: chạy "docker compose up -d" (MinIO) rồi điền S3_* trong .env.');
}

const CCCD_BUCKET = process.env.S3_CCCD_BUCKET;
const INTRO_BUCKET = process.env.S3_INTRO_BUCKET;

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
  forcePathStyle: true, // MinIO & Supabase Storage đều dùng path-style
});

// CHỈ chấp nhận ảnh raster an toàn. KHÔNG nhận SVG (có thể chứa <script> -> XSS khi proxy).
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Chữ ký file (magic bytes) của từng loại ảnh — để KHÔNG tin cái nhãn "data:image/..." do client
// tự khai. Trước đây chỉ đọc nhãn: dán nhãn image/png cho một chuỗi chữ thường là lưu được byte
// tuỳ ý dưới tên miền KTX, phục vụ công khai (V2-59). PDF ngay dưới đã kiểm magic bytes — ảnh thì chưa.
function khopMagic(ext, buf) {
  if (buf.length < 4) return false;
  const b = buf;
  switch (ext) {
    case 'jpg':  return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    case 'png':  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
    case 'gif':  return b.slice(0, 3).toString('latin1') === 'GIF';
    case 'webp': return b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP';
    default:     return false;
  }
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  const ext = EXT[m[1]];
  if (!ext) return null; // loại type ngoài whitelist (vd svg) -> caller sẽ báo "Ảnh không hợp lệ"
  const buffer = Buffer.from(m[2], 'base64');
  if (!khopMagic(ext, buffer)) return null; // nhãn nói là ảnh nhưng nội dung không phải -> loại
  return { contentType: m[1], ext, buffer };
}

async function putBuffer(bucket, key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: buffer, ContentType: contentType, CacheControl: 'public, max-age=3600',
  }));
  return key;
}

async function putDataUrl(bucket, key, dataUrl) {
  const p = parseDataUrl(dataUrl);
  if (!p) { const e = new Error('Ảnh không hợp lệ (chỉ nhận JPG/PNG/WEBP/GIF)'); e.status = 400; throw e; }
  return putBuffer(bucket, key, p.buffer, p.contentType);
}

// Tài liệu PDF (nội quy ký túc xá). Tách riêng khỏi parseDataUrl để KHÔNG vô tình cho phép
// upload PDF vào những chỗ chỉ được nhận ảnh (ảnh CCCD, ảnh trang giới thiệu).
function parsePdfDataUrl(dataUrl) {
  const m = /^data:application\/pdf;base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  const buffer = Buffer.from(m[1], 'base64');
  // Kiểm chữ ký file thật, không tin mỗi cái nhãn data: — đổi nhãn là qua mặt được.
  if (buffer.slice(0, 5).toString('latin1') !== '%PDF-') return null;
  return { contentType: 'application/pdf', ext: 'pdf', buffer };
}
async function putPdfDataUrl(bucket, key, dataUrl) {
  const p = parsePdfDataUrl(dataUrl);
  if (!p) { const e = new Error('Tệp không hợp lệ — chỉ nhận file PDF'); e.status = 400; throw e; }
  return putBuffer(bucket, key, p.buffer, p.contentType);
}

// Lấy object để stream ra client (proxy). Trả stream + metadata; ném lỗi nếu không có.
async function getObject(bucket, key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return { body: r.Body, contentType: r.ContentType, contentLength: r.ContentLength, etag: r.ETag };
}

async function deleteObject(bucket, key) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// Link ký hạn (không dùng cho luồng hiển thị mặc định — app proxy — nhưng để sẵn tiện ích)
async function signedGetUrl(bucket, key, expiresIn = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

module.exports = {
  s3, CCCD_BUCKET, INTRO_BUCKET,
  parseDataUrl, parsePdfDataUrl, putBuffer, putDataUrl, putPdfDataUrl, getObject, deleteObject, signedGetUrl,
};
