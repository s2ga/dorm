package handlers

import (
	"context"

	"ktx/internal/roomstays"
)

// BL-117 — hai bước XÁC NHẬN dùng chung cho mọi đường (Check-in/Check-out của BQL, an ninh bàn giao).
// Chỉ ở đây ngày THẬT mới được ghi; trước đó hồ sơ chỉ có ngày dự kiến (planned_*).

// xacNhanNhanPhong ghi ngày vào thật, mở lượt ở, ghi nhật ký. roomID nil = giữ phòng đang gán.
func (h *Handlers) xacNhanNhanPhong(ctx context.Context, id int, roomID *int, date, note, source string) error {
	q := h.pool()
	if roomID == nil {
		var cur *int
		if err := q.QueryRow(ctx, "SELECT room_id FROM students WHERE id=$1", id).Scan(&cur); err != nil {
			return err
		}
		roomID = cur
	}
	if _, err := q.Exec(ctx,
		`UPDATE students SET status='in', room_id=$1, check_in_date=$2, planned_check_in=NULL,
		   check_out_date=NULL, planned_check_out=NULL, checkout_notice_date=NULL, checkout_reason=NULL,
		   checkin_confirmed_at=COALESCE(checkin_confirmed_at, now()), checkout_confirmed_at=NULL, checkout_actual_date=NULL
		 WHERE id=$3`, studentsPtrArg(roomID), date, id); err != nil {
		return err
	}
	if err := roomstays.CheckIn(ctx, q, id, roomID, date); err != nil {
		return err
	}
	if note == "" {
		note = "Xác nhận nhận phòng"
	}
	_, err := q.Exec(ctx, `INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'in',$2,$3,$4,$5)`,
		id, date, studentsPtrArg(roomID), note, source)
	return err
}

// khoaTaiKhoanHocVien: owner chốt 25/08 — xác nhận trả phòng thì tài khoản đăng nhập của học viên tự
// khoá (deleted_at, cùng cơ chế nút Khoá ở Cài đặt) và đá mọi phiên đang mở. Hồ sơ + phiếu cuối GIỮ.
func (h *Handlers) khoaTaiKhoanHocVien(ctx context.Context, studentID int) {
	rows, err := h.pool().Query(ctx,
		`UPDATE users SET deleted_at=now() WHERE student_id=$1 AND role='student' AND deleted_at IS NULL RETURNING id`, studentID)
	if err != nil {
		return
	}
	var ids []int
	for rows.Next() {
		var uid int
		if rows.Scan(&uid) == nil {
			ids = append(ids, uid)
		}
	}
	rows.Close()
	for _, uid := range ids {
		_ = h.Auth.RevokeTokens(ctx, uid)
	}
}
