# Migrations — thay đổi schema có ĐÁNH SỐ (từ 18/07/2026)

`server/schema.sql` là **BASELINE idempotent** (áp lại mỗi lần boot, an toàn) — GIỮ NGUYÊN cho DB tạo mới.
Từ nay, MỌI thay đổi schema **có tính một chiều / cần thứ tự** (đổi kiểu cột, chuyển dữ liệu, thêm ràng buộc
lên bảng đã có data...) viết thành **một file migration đánh số** trong thư mục này.

## Quy ước
- Tên file: `NNNN_ten_ngan_gon.sql` — `NNNN` là 4 chữ số tăng dần, zero-pad (vd `0001_them_cot_x.sql`, `0002_...`).
- Mỗi file là SQL thuần, chạy **một lần duy nhất** theo thứ tự tên file (`0001` → `0002` → ...).
- Đã áp file nào ghi vào bảng `schema_migrations(version)` — boot sau bỏ qua file đó.
- Mỗi file chạy trong **một transaction**: lỗi → ROLLBACK cả file + báo lỗi rõ + **DỪNG** (không áp file sau
  lên trạng thái nửa vời), boot fail-fast để buộc sửa. Vì vậy: **test file migration ở local trước khi commit.**

## Nên / không nên
- ✅ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, backfill có `WHERE ... IS NULL`, tạo index `IF NOT EXISTS`.
- ⚠️ Thêm ràng buộc (CHECK/FK/UNIQUE) lên bảng **đã có data**: nếu data cũ có thể vi phạm, ĐỪNG bỏ vào
  migration (sẽ fail-fast boot). Dùng cơ chế `schema_guard` trong `schema.sql` (log + tiếp tục) như hiện tại.
- ❌ **KHÔNG tự viết `BEGIN`/`COMMIT`/`ROLLBACK`/`END`/`SAVEPOINT`/`START TRANSACTION`** trong file —
  runner đã tự bọc mỗi file trong MỘT transaction. Tự COMMIT giữa file sẽ đóng sớm transaction đó →
  half-apply → boot-loop. Runner sẽ **từ chối** (fail-fast) file chứa các lệnh này. (BEGIN/END bên trong
  khối `DO $$ ... $$` / plpgsql thì KHÔNG sao — đó là cấu trúc, không phải transaction control.)
- ❌ Lệnh **phải chạy NGOÀI transaction** (vd `CREATE INDEX CONCURRENTLY`, `ALTER TYPE ... ADD VALUE` ở
  Postgres cũ): KHÔNG đưa vào migration — tách ra chạy tay khi bảo trì.
- ❌ KHÔNG sửa lại file migration đã áp trên môi trường thật — viết file mới để đắp lên.
- ℹ️ Migration chạy trên **client riêng, không giới hạn thời gian** (khác pool 15s) nên backfill lớn không
  bị cắt. Vẫn nên test trên bản sao data thật trước khi deploy.
- ℹ️ Tên file **sai quy ước** (không dạng `NNNN_ten.sql`) sẽ bị **CẢNH BÁO ra log rồi bỏ qua** — không
  chạy âm thầm. Đặt đúng tên để migration thực sự áp.

## Không có migration nào?
Thư mục rỗng (chỉ README) là bình thường — `runMigrations()` chỉ tạo bảng `schema_migrations` rồi thoát,
không đổi gì. `schema.sql` vẫn lo toàn bộ baseline.
