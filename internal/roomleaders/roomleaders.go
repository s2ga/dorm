// Package roomleaders — nhiệm kỳ phòng trưởng (có from/to date). Port từ server/room-leaders.js.
package roomleaders

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/billing"
	"ktx/internal/db"
)

func intOf(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

// CurrentOf: phòng trưởng đương nhiệm (to_date NULL) của phòng — trả map để endpoint JSON khớp Node.
// server/room-leaders.js:16-22
func CurrentOf(ctx context.Context, q db.Querier, roomID int) (map[string]interface{}, error) {
	rows, err := q.Query(ctx,
		`SELECT rl.*, s.name AS student_name FROM room_leaders rl
		   JOIN students s ON s.id = rl.student_id
		  WHERE rl.room_id=$1 AND rl.to_date IS NULL LIMIT 1`, roomID)
	if err != nil {
		return nil, err
	}
	return db.RowToMap(rows)
}

// CloseRoom: kết thúc nhiệm kỳ đang mở của phòng, hết ngày toDate. server/room-leaders.js:25-35
// Trả về map phòng trưởng cũ (đã đóng) hoặc nil.
func CloseRoom(ctx context.Context, q db.Querier, roomID int, toDate string) (map[string]interface{}, error) {
	cur, err := CurrentOf(ctx, q, roomID)
	if err != nil || cur == nil {
		return nil, err
	}
	id := intOf(cur["id"])
	from, _ := cur["from_date"].(string)
	if toDate < from {
		_, err = q.Exec(ctx, "DELETE FROM room_leaders WHERE id=$1", id)
		return nil, err
	}
	_, err = q.Exec(ctx, "UPDATE room_leaders SET to_date=$1 WHERE id=$2", toDate, id)
	return cur, err
}

// CloseStudent: kết thúc mọi nhiệm kỳ đang mở của 1 HV (khi trả/chuyển phòng). server/room-leaders.js:38-45
func CloseStudent(ctx context.Context, q db.Querier, studentID int, toDate string) error {
	rows, err := q.Query(ctx, "SELECT id, from_date FROM room_leaders WHERE student_id=$1 AND to_date IS NULL", studentID)
	if err != nil {
		return err
	}
	type row struct {
		id   int
		from string
	}
	var list []row
	list2, err := db.RowsToMaps(rows)
	if err != nil {
		return err
	}
	for _, m := range list2 {
		f, _ := m["from_date"].(string)
		list = append(list, row{id: intOf(m["id"]), from: f})
	}
	for _, r := range list {
		if toDate < r.from {
			if _, err := q.Exec(ctx, "DELETE FROM room_leaders WHERE id=$1", r.id); err != nil {
				return err
			}
		} else {
			if _, err := q.Exec(ctx, "UPDATE room_leaders SET to_date=$1 WHERE id=$2", toDate, r.id); err != nil {
				return err
			}
		}
	}
	return nil
}

// SetResult: kết quả cử phòng trưởng.
type SetResult struct {
	Err               string                 // != "" -> 400
	Leader            map[string]interface{} // nhiệm kỳ hiện/mới
	Already           bool                   // đã là phòng trưởng rồi, ngày không đổi
	DoiNgay           bool                   // vẫn người đó, chỉ nắn lại ngày nhận nhiệm vụ
	NgayCu            string                 // ngày nhận nhiệm vụ trước khi nắn (để biết tính lại từ kỳ nào)
	Replaced          map[string]interface{} // nhiệm kỳ người bị thay (đầy đủ, để trả về response)
	ReplacedStudentID *int                   // id người bị thay (để recalc)
}

// nanNgayNhanNhiemVu: chặn hai ca làm số ngày làm phòng trưởng ra sai khi nắn lại ngày —
// lùi trước ngày HV vào ở, và đè lên nhiệm kỳ đã đóng của người trước (LeaderDaysInMonth cộng
// dồn mọi nhiệm kỳ nên chồng lấn là đếm hai lần).
func nanNgayNhanNhiemVu(ctx context.Context, q db.Querier, roomID, curID int, date, checkIn, sName string) (string, error) {
	if checkIn != "" && date < checkIn {
		return sName + " nhận phòng ngày " + checkIn + " — không thể làm phòng trưởng từ trước đó.", nil
	}
	rows, err := q.Query(ctx,
		`SELECT s.name, rl.from_date, rl.to_date FROM room_leaders rl
		   JOIN students s ON s.id = rl.student_id
		  WHERE rl.room_id=$1 AND rl.id <> $2 AND rl.to_date IS NOT NULL AND rl.to_date >= $3
		  ORDER BY rl.to_date DESC LIMIT 1`, roomID, curID, date)
	if err != nil {
		return "", err
	}
	m, err := db.RowToMap(rows)
	if err != nil || m == nil {
		return "", err
	}
	ten, _ := m["name"].(string)
	tu, _ := m["from_date"].(string)
	den, _ := m["to_date"].(string)
	return "Nhiệm kỳ của " + ten + " (" + tu + " → " + den + ") còn phủ ngày này. Chọn ngày sau " + den + ".", nil
}

// SetLeader: cử phòng trưởng mới từ ngày date; người cũ hết D-1. server/room-leaders.js:49-64
func SetLeader(ctx context.Context, q db.Querier, roomID, studentID int, date, note, by string) (*SetResult, error) {
	var sName string
	var sRoom *int
	var checkOut *string
	checkIn := ""
	{
		var ci, co pgtype.Date
		err := q.QueryRow(ctx, "SELECT name, room_id, check_in_date, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL", studentID).
			Scan(&sName, &sRoom, &ci, &co)
		if err != nil {
			return &SetResult{Err: "Không tìm thấy học viên"}, nil
		}
		if ci.Valid {
			checkIn = ci.Time.Format("2006-01-02")
		}
		if co.Valid {
			c := co.Time.Format("2006-01-02")
			checkOut = &c
		}
	}
	if sRoom == nil || *sRoom != roomID {
		return &SetResult{Err: sName + " không ở phòng này — chỉ cử phòng trưởng trong số người đang ở phòng"}, nil
	}
	if checkOut != nil && *checkOut < date {
		return &SetResult{Err: sName + " đã trả phòng ngày " + *checkOut + " — không thể cử làm phòng trưởng"}, nil
	}

	cur, err := CurrentOf(ctx, q, roomID)
	if err != nil {
		return nil, err
	}
	// Vẫn đúng người đang làm: cử lại không có nghĩa gì, nhưng ĐỔI NGÀY thì có — sửa lại ngày nhận
	// nhiệm vụ ghi nhầm. Không có nhánh này thì ngày sai nằm vĩnh viễn, giảm giá lệch theo.
	if cur != nil && intOf(cur["student_id"]) == studentID {
		curFrom, _ := cur["from_date"].(string)
		if curFrom == date {
			return &SetResult{Leader: cur, Already: true}, nil
		}
		if e, err := nanNgayNhanNhiemVu(ctx, q, roomID, intOf(cur["id"]), date, checkIn, sName); err != nil {
			return nil, err
		} else if e != "" {
			return &SetResult{Err: e}, nil
		}
		rows, err := q.Query(ctx,
			"UPDATE room_leaders SET from_date=$1 WHERE id=$2 RETURNING *", date, intOf(cur["id"]))
		if err != nil {
			return nil, err
		}
		moi, err := db.RowToMap(rows)
		if err != nil {
			return nil, err
		}
		moi["student_name"] = sName
		return &SetResult{Leader: moi, DoiNgay: true, NgayCu: curFrom}, nil
	}

	replaced, err := CloseRoom(ctx, q, roomID, billing.AddDays(date, -1))
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx,
		"INSERT INTO room_leaders (room_id, student_id, from_date, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
		roomID, studentID, date, note, by)
	if err != nil {
		return nil, err
	}
	leader, err := db.RowToMap(rows)
	if err != nil {
		return nil, err
	}
	res := &SetResult{Leader: leader}
	if replaced != nil {
		res.Replaced = replaced
		rid := intOf(replaced["student_id"])
		res.ReplacedStudentID = &rid
	}
	return res, nil
}

// LeaderDaysInMonth: số ngày làm phòng trưởng trong tháng (mọi nhiệm kỳ). server/room-leaders.js:68-76
func LeaderDaysInMonth(ctx context.Context, q db.Querier, studentID int, month string) (int, error) {
	rows, err := q.Query(ctx,
		`SELECT from_date, to_date FROM room_leaders
		  WHERE student_id=$1 AND from_date <= $2 AND (to_date IS NULL OR to_date >= $3)`,
		studentID, billing.LastDay(month), billing.FirstDay(month))
	if err != nil {
		return 0, err
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		return 0, err
	}
	sum := 0
	for _, m := range list {
		from, _ := m["from_date"].(string)
		to, _ := m["to_date"].(string) // "" nếu null
		sum += billing.DaysStayedInRange(from, to, billing.FirstDay(month), billing.LastDay(month))
	}
	return sum, nil
}
