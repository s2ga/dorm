package handlers

import (
	"context"

	"ktx/internal/auth"
)

// An ninh KHÔNG sửa thẳng hồ sơ học viên: ngày nhận / trả phòng đi qua biên bản bàn giao
// (handover_reports.go), biển số đi qua đề nghị (vehicles_bien_so.go); quản trị duyệt mới đổi.
// Mọi lần sửa ghi vết CŨ -> MỚI: nhật ký chung chỉ giữ giá trị mới, không truy được đã đổi từ đâu.
func maintGhiVet(ctx context.Context, h *Handlers, u *auth.User, method, path, detail string) {
	var uid *int
	uname, urole := "(chưa đăng nhập)", ""
	if u != nil {
		uid, uname, urole = &u.ID, u.Username, u.Role
	}
	_, _ = h.pool().Exec(ctx,
		"INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)",
		uid, uname, urole, method, path, detail)
}
