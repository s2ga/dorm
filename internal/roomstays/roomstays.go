// Package roomstays — lịch sử ở phòng (nền tảng chia điện đúng). Port từ server/room-stays.js.
// Quy ước ngày: trả phòng ngày D -> lượt kết thúc ngày D; chuyển phòng ngày D -> lượt cũ hết D-1, mới từ D.
package roomstays

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/billing"
	"ktx/internal/db"
)

type Stay struct {
	ID       int
	RoomID   *int
	FromDate string
	ToDate   *string
}

// OpenStayOf: lượt ở đang mở (to_date NULL) của HV. server/room-stays.js:17-20
func OpenStayOf(ctx context.Context, q db.Querier, studentID int) (*Stay, error) {
	var s Stay
	var roomID *int
	var from, to pgtype.Date
	err := q.QueryRow(ctx, "SELECT id, room_id, from_date, to_date FROM room_stays WHERE student_id=$1 AND to_date IS NULL ORDER BY from_date DESC LIMIT 1", studentID).
		Scan(&s.ID, &roomID, &from, &to)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	s.RoomID = roomID
	if from.Valid {
		s.FromDate = from.Time.Format("2006-01-02")
	}
	if to.Valid {
		t := to.Time.Format("2006-01-02")
		s.ToDate = &t
	}
	return &s, nil
}

// LastStayOf: lượt ở gần nhất của HV, kể cả đã đóng.
func LastStayOf(ctx context.Context, q db.Querier, studentID int) (*Stay, error) {
	var s Stay
	var roomID *int
	var from, to pgtype.Date
	err := q.QueryRow(ctx, "SELECT id, room_id, from_date, to_date FROM room_stays WHERE student_id=$1 ORDER BY from_date DESC, id DESC LIMIT 1", studentID).
		Scan(&s.ID, &roomID, &from, &to)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	s.RoomID = roomID
	if from.Valid {
		s.FromDate = from.Time.Format("2006-01-02")
	}
	if to.Valid {
		t := to.Time.Format("2006-01-02")
		s.ToDate = &t
	}
	return &s, nil
}

// MoveLastToDate: dời ngày kết thúc của lượt ở gần nhất — dùng khi SỬA ngày trả của hồ sơ đã rời.
// CloseStay không làm được việc này: nó chỉ chạm lượt đang MỞ, mà hồ sơ đã trả phòng thì lượt đã đóng.
// Ngày mới trước ngày bắt đầu lượt = lượt chưa từng xảy ra -> xoá, giống CloseStay.
func MoveLastToDate(ctx context.Context, q db.Querier, studentID int, toDate string) error {
	last, err := LastStayOf(ctx, q, studentID)
	if err != nil || last == nil {
		return err
	}
	if toDate < last.FromDate {
		_, err = q.Exec(ctx, "DELETE FROM room_stays WHERE id=$1", last.ID)
		return err
	}
	_, err = q.Exec(ctx, "UPDATE room_stays SET to_date=$1 WHERE id=$2", toDate, last.ID)
	return err
}

// CloseStay: đóng lượt đang mở tại ngày toDate (tính trọn ngày đó). server/room-stays.js:23-33
func CloseStay(ctx context.Context, q db.Querier, studentID int, toDate string) error {
	cur, err := OpenStayOf(ctx, q, studentID)
	if err != nil || cur == nil {
		return err
	}
	// Kết thúc trước ngày bắt đầu = lượt chưa từng xảy ra -> xoá hẳn.
	if toDate < cur.FromDate {
		_, err = q.Exec(ctx, "DELETE FROM room_stays WHERE id=$1", cur.ID)
		return err
	}
	_, err = q.Exec(ctx, "UPDATE room_stays SET to_date=$1 WHERE id=$2", toDate, cur.ID)
	return err
}

// OpenStay: mở lượt ở mới. server/room-stays.js:36-40
func OpenStay(ctx context.Context, q db.Querier, studentID int, roomID *int, fromDate string) error {
	if roomID == nil || fromDate == "" {
		return nil
	}
	_, err := q.Exec(ctx, "INSERT INTO room_stays (student_id, room_id, from_date, to_date) VALUES ($1,$2,$3,NULL)", studentID, *roomID, fromDate)
	return err
}

// CheckIn: vào ở / nhận phòng ngày date. server/room-stays.js:43-46
func CheckIn(ctx context.Context, q db.Querier, studentID int, roomID *int, date string) error {
	if err := CloseStay(ctx, q, studentID, billing.AddDays(date, -1)); err != nil {
		return err
	}
	return OpenStay(ctx, q, studentID, roomID, date)
}

// Transfer: chuyển phòng ngày date (cũ hết D-1, mới từ D). server/room-stays.js:49-52
func Transfer(ctx context.Context, q db.Querier, studentID int, newRoomID *int, date string) error {
	if err := CloseStay(ctx, q, studentID, billing.AddDays(date, -1)); err != nil {
		return err
	}
	return OpenStay(ctx, q, studentID, newRoomID, date)
}

// CheckOut: trả phòng hẳn ngày date. server/room-stays.js:55-57
func CheckOut(ctx context.Context, q db.Querier, studentID int, date string) error {
	return CloseStay(ctx, q, studentID, date)
}

// Reconcile: đồng bộ lượt đang mở với hồ sơ (đường SỬA HỒ SƠ). server/room-stays.js:63-85
func Reconcile(ctx context.Context, q db.Querier, studentID int, roomID *int, checkInDate, checkOutDate string) error {
	cur, err := OpenStayOf(ctx, q, studentID)
	if err != nil {
		return err
	}
	if roomID == nil || checkInDate == "" {
		if cur != nil {
			_, err = q.Exec(ctx, "DELETE FROM room_stays WHERE id=$1", cur.ID)
		}
		return err
	}
	var n int
	if err := q.QueryRow(ctx, "SELECT COUNT(*)::int FROM room_stays WHERE student_id=$1", studentID).Scan(&n); err != nil {
		return err
	}
	// Không còn lượt ĐANG MỞ = HV đã trả phòng. Phải sửa lượt CUỐI, mở lượt mới là nhân bản lượt ở
	// -> roster() cộng dồn ngày của cùng một người hai lần -> chia tiền điện sai cho cả phòng.
	if cur == nil && n > 0 {
		last, err := LastStayOf(ctx, q, studentID)
		if err != nil || last == nil {
			return err
		}
		var toArg interface{}
		if checkOutDate != "" {
			toArg = checkOutDate
		}
		if n == 1 {
			_, err = q.Exec(ctx, "UPDATE room_stays SET room_id=$1, from_date=$2, to_date=$3 WHERE id=$4", *roomID, checkInDate, toArg, last.ID)
		} else {
			_, err = q.Exec(ctx, "UPDATE room_stays SET room_id=$1, to_date=$2 WHERE id=$3", *roomID, toArg, last.ID)
		}
		return err
	}
	if cur == nil {
		if err := OpenStay(ctx, q, studentID, roomID, checkInDate); err != nil {
			return err
		}
		if checkOutDate != "" {
			return CloseStay(ctx, q, studentID, checkOutDate)
		}
		return nil
	}
	if n > 1 {
		_, err = q.Exec(ctx, "UPDATE room_stays SET room_id=$1 WHERE id=$2", *roomID, cur.ID)
	} else {
		_, err = q.Exec(ctx, "UPDATE room_stays SET room_id=$1, from_date=$2 WHERE id=$3", *roomID, checkInDate, cur.ID)
	}
	if err != nil {
		return err
	}
	if checkOutDate != "" {
		return CloseStay(ctx, q, studentID, checkOutDate)
	}
	return nil
}
