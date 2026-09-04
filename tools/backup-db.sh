#!/usr/bin/env bash
# Sao lưu Postgres/Supabase, đẩy ra S3. Cần pg_dump; đẩy S3 thì cần aws CLI.
#   0 2 * * *  DATABASE_URL="postgres://..." BACKUP_S3_BUCKET="db-backup" bash tools/backup-db.sh
#
#   DATABASE_URL       bắt buộc
#   BACKUP_DIR         thư mục lưu tạm, mặc định ./backups
#   BACKUP_S3_BUCKET   bucket S3; bỏ trống = chỉ lưu local
#   BACKUP_KEEP_DAYS   số ngày giữ bản local, mặc định 14
#   S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION
set -euo pipefail

: "${DATABASE_URL:?Thiếu DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/ktx-$STAMP.sql.gz"

echo "[backup] pg_dump -> $FILE"
# --no-owner --no-privileges: khôi phục sang DB khác dễ hơn; nén gzip cho nhẹ.
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "$FILE"
SIZE="$(du -h "$FILE" | cut -f1)"
echo "[backup] xong: $FILE ($SIZE)"

# Kiểm bản dump không rỗng (pg_dump có header cơ bản ~vài KB)
if [ "$(gzip -dc "$FILE" | head -c 100 | wc -c)" -lt 20 ]; then
  echo "[backup] LỖI: bản dump rỗng/hỏng — huỷ" >&2
  rm -f "$FILE"; exit 1
fi

# Đẩy lên S3 (nếu cấu hình). Supabase Storage nói giao thức S3 -> dùng aws CLI với --endpoint-url.
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    echo "[backup] upload s3://$BACKUP_S3_BUCKET/$(basename "$FILE")"
    AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}" AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}" \
      aws s3 cp "$FILE" "s3://$BACKUP_S3_BUCKET/$(basename "$FILE")" \
      ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"} ${S3_REGION:+--region "$S3_REGION"}
    echo "[backup] đã đẩy S3"
  else
    echo "[backup] CẢNH BÁO: chưa cài aws CLI — bỏ qua đẩy S3, chỉ lưu local" >&2
  fi
fi

# Dọn bản local cũ hơn KEEP_DAYS ngày
find "$BACKUP_DIR" -name 'ktx-*.sql.gz' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
echo "[backup] hoàn tất. Giữ bản local $KEEP_DAYS ngày gần nhất."

# KHÔI PHỤC (thủ công):  gzip -dc ktx-YYYYMMDD-HHMMSS.sql.gz | psql "$DATABASE_URL_DICH"
# ⚠️ NÊN TEST KHÔI PHỤC 1 LẦN vào DB trống trước 6/8 để chắc bản backup dùng được.
