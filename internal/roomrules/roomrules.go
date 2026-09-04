// Package roomrules — LUẬT XẾP PHÒNG, một nơi duy nhất. Port từ server/room-rules.js.
// Lỗi CHẶN -> 400; CẢNH BÁO (quá tải) -> 409 cần xác nhận + ghi vết. Quá tải KHÔNG chặn (chốt 15/07/2026).
package roomrules

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"ktx/internal/db"
)

type Warning struct {
	Code           string `json:"code"`
	Message        string `json:"message"`
	RoomName       string `json:"room_name"`
	OccupancyAfter int    `json:"occupancy_after"`
	Capacity       int    `json:"capacity"`
	OverBy         int    `json:"over_by"`
}

type RoomInfo struct {
	ID       int
	Name     string
	Gender   string
	Capacity int
	RoomType string
}

type Result struct {
	Errors   []string
	Warnings []Warning
	Room     *RoomInfo
}

// CheckRoomAssignment: kiểm luật xếp phòng. server/room-rules.js:11-51
func CheckRoomAssignment(ctx context.Context, q db.Querier, studentID *int, gender, rentalType string, roomID *int) (*Result, error) {
	res := &Result{Errors: []string{}, Warnings: []Warning{}}
	if roomID == nil {
		return res, nil
	}

	var room RoomInfo
	err := q.QueryRow(ctx,
		"SELECT id, name, gender, capacity, COALESCE(room_type,'shared') AS room_type FROM rooms WHERE id=$1 AND deleted_at IS NULL", *roomID).
		Scan(&room.ID, &room.Name, &room.Gender, &room.Capacity, &room.RoomType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			res.Errors = append(res.Errors, "Phòng không tồn tại hoặc đã bị xoá")
			return res, nil
		}
		return nil, err
	}
	res.Room = &room

	// 1) Giới tính
	if gender != "" && room.Gender != "" && gender != room.Gender {
		g1 := "NAM"
		if room.Gender == "female" {
			g1 = "NỮ"
		}
		g2 := "nam"
		if gender == "female" {
			g2 = "nữ"
		}
		res.Errors = append(res.Errors, fmt.Sprintf("Phòng %s là phòng %s, không xếp được học viên %s", room.Name, g1, g2))
	}

	// Người đang ở (loại chính HV này khi sửa hồ sơ)
	rows, err := q.Query(ctx,
		`SELECT id, name, rental_type FROM students
		  WHERE room_id=$1 AND deleted_at IS NULL AND status='in' AND ($2::int IS NULL OR id <> $2)`,
		*roomID, studentID)
	if err != nil {
		return nil, err
	}
	type other struct {
		name   string
		rental string
	}
	var others []other
	for rows.Next() {
		var oid int
		var o other
		if err := rows.Scan(&oid, &o.name, &o.rental); err != nil {
			rows.Close()
			return nil, err
		}
		others = append(others, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 2) Thuê nguyên phòng
	var nguyenPhong *other
	for i := range others {
		if others[i].rental == "phong" {
			nguyenPhong = &others[i]
			break
		}
	}
	if rentalType == "phong" && len(others) > 0 {
		res.Errors = append(res.Errors, fmt.Sprintf("Phòng %s đang có %d người ở — không thể cho thuê NGUYÊN PHÒNG. (Thuê nguyên phòng = thu trọn giá phòng; để 2 người cùng thuê nguyên phòng là thu 2 lần tiền cho 1 phòng.)", room.Name, len(others)))
	} else if rentalType != "phong" && nguyenPhong != nil {
		// CẢNH BÁO chứ không chặn (owner chốt 28/08): BQL vẫn quản người ra vào phòng thuê nguyên.
		// Tiền đã đúng sẵn: người vào là "thành viên" (phiếu 0đ), nước/dịch vụ cộng theo đầu người
		// vào phiếu của người ký HĐ; tiền phòng trọn giá không đổi.
		res.Warnings = append(res.Warnings, Warning{
			Code:     "VAO_PHONG_NGUYEN",
			Message:  fmt.Sprintf("Phòng %s đang cho %s thuê NGUYÊN PHÒNG — xếp thêm là Ở CHUNG theo hợp đồng của bạn ấy: người vào không có phiếu riêng, nước/dịch vụ tính thêm theo đầu người vào phiếu của %s.", room.Name, nguyenPhong.name, nguyenPhong.name),
			RoomName: room.Name,
		})
	}

	// 3) Quá tải — CẢNH BÁO
	if room.RoomType == "shared" && room.Capacity > 0 {
		sau := len(others) + 1
		if sau > room.Capacity {
			res.Warnings = append(res.Warnings, Warning{
				Code:           "OVER_CAPACITY",
				Message:        fmt.Sprintf("Phòng %s đã đủ %d/%d chỗ — xếp thêm sẽ thành QUÁ TẢI %d/%d (vượt %d người).", room.Name, len(others), room.Capacity, sau, room.Capacity, sau-room.Capacity),
				RoomName:       room.Name,
				OccupancyAfter: sau,
				Capacity:       room.Capacity,
				OverBy:         sau - room.Capacity,
			})
		}
	}
	return res, nil
}

// LogOverload: ghi vết việc xếp phòng cần xác nhận (quá tải / vào phòng thuê nguyên) vào audit_log.
func LogOverload(ctx context.Context, q db.Querier, userID *int, username, role, method, path string, studentID int, studentName string, w Warning) {
	who := studentName
	if who == "" {
		who = fmt.Sprintf("#%d", studentID)
	}
	var detail string
	switch w.Code {
	case "OVER_CAPACITY":
		detail = fmt.Sprintf("[QUÁ TẢI] Xếp học viên %s vào phòng %s — %d/%d, vượt %d người",
			who, w.RoomName, w.OccupancyAfter, w.Capacity, w.OverBy)
	case "VAO_PHONG_NGUYEN":
		detail = fmt.Sprintf("[VÀO PHÒNG THUÊ NGUYÊN] Xếp học viên %s vào phòng %s đang cho thuê nguyên phòng (ở chung theo HĐ người thuê)",
			who, w.RoomName)
	default:
		return
	}
	_, _ = q.Exec(ctx,
		"INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)",
		userID, username, role, method, path, detail)
}
