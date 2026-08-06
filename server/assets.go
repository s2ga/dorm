// Package server nhúng schema.sql + migrations vào binary (~47 KB).
// Bản Vercel (framework preset go) chỉ đóng gói binary, không kèm file nguồn, nên đọc theo
// đường dẫn tương đối là trượt. Đặt SCHEMA_DIR để quay lại đọc từ đĩa.
package server

import "embed"

// SchemaSQL — toàn bộ DDL, áp mỗi lần khởi động (idempotent).
//
//go:embed schema.sql
var SchemaSQL string

// MigrationsFS — chứa thư mục migrations/, mỗi file .sql chạy đúng một lần.
//
//go:embed migrations/*.sql
var MigrationsFS embed.FS
