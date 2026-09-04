// Package meter — chốt chỉ số công-tơ giữa kỳ. Port từ server/meter.js.
package meter

import (
	"context"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/billing"
	"ktx/internal/db"
)

func numStr(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// CheckRead: chỉ số hợp lệ? Trả câu lỗi tiếng Việt, "" nếu ổn. Công-tơ chỉ QUAY TỚI. server/meter.js:12-32
func CheckRead(ctx context.Context, q db.Querier, roomID int, date string, reading float64) (string, error) {
	if reading < 0 {
		return "Chỉ số công-tơ phải là số không âm", nil
	}
	month := date[:7]

	var rs, re float64
	err := q.QueryRow(ctx, "SELECT reading_start, reading_end FROM electric_readings WHERE room_id=$1 AND month=$2", roomID, month).Scan(&rs, &re)
	hasER := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if hasER && reading < rs {
		return "Chỉ số " + numStr(reading) + " nhỏ hơn chỉ số đầu tháng (" + numStr(rs) + ") — công-tơ không quay ngược được", nil
	}
	if hasER && re > 0 && reading > re {
		return "Chỉ số " + numStr(reading) + " lớn hơn chỉ số cuối tháng đã ghi (" + numStr(re) + ")", nil
	}

	prevDate, prevReading, hasPrev, err := oneRead(ctx, q, roomID, date, "<", "DESC")
	if err != nil {
		return "", err
	}
	if hasPrev && reading < prevReading {
		return "Chỉ số " + numStr(reading) + " nhỏ hơn lần chốt ngày " + prevDate + " (" + numStr(prevReading) + ")", nil
	}
	nextDate, nextReading, hasNext, err := oneRead(ctx, q, roomID, date, ">", "ASC")
	if err != nil {
		return "", err
	}
	if hasNext && reading > nextReading {
		return "Chỉ số " + numStr(reading) + " lớn hơn lần chốt ngày " + nextDate + " (" + numStr(nextReading) + ")", nil
	}
	return "", nil
}

func oneRead(ctx context.Context, q db.Querier, roomID int, date, cmp, dir string) (string, float64, bool, error) {
	var rd pgtype.Date
	var reading float64
	err := q.QueryRow(ctx,
		"SELECT read_date, reading FROM meter_reads WHERE room_id=$1 AND read_date "+cmp+" $2 ORDER BY read_date "+dir+" LIMIT 1",
		roomID, date).Scan(&rd, &reading)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", 0, false, nil
		}
		return "", 0, false, err
	}
	d := ""
	if rd.Valid {
		d = rd.Time.Format("2006-01-02")
	}
	return d, reading, true, nil
}

// RecordRead: ghi/đè chỉ số (ON CONFLICT room_id,read_date). server/meter.js:35-45
func RecordRead(ctx context.Context, q db.Querier, roomID int, date string, reading float64, reason string, studentID *int, note, by string) (map[string]interface{}, error) {
	if reason == "" {
		reason = "manual"
	}
	rows, err := q.Query(ctx,
		`INSERT INTO meter_reads (room_id, read_date, reading, reason, student_id, note, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (room_id, read_date) DO UPDATE
		   SET reading=EXCLUDED.reading, reason=EXCLUDED.reason, student_id=EXCLUDED.student_id,
		       note=EXCLUDED.note, created_by=EXCLUDED.created_by, created_at=now()
		 RETURNING *`,
		roomID, date, reading, reason, studentID, note, by)
	if err != nil {
		return nil, err
	}
	return db.RowToMap(rows)
}

// AffectedStudents: HV cùng phòng/tháng bị TÍNH LẠI vì lần chốt này. server/meter.js:49-58
func AffectedStudents(ctx context.Context, q db.Querier, roomID int, date string) ([]int, error) {
	month := date[:7]
	rows, err := q.Query(ctx,
		`SELECT DISTINCT rs.student_id
		   FROM room_stays rs JOIN students s ON s.id = rs.student_id
		  WHERE rs.room_id=$1 AND s.deleted_at IS NULL
		    AND rs.from_date <= $2 AND (rs.to_date IS NULL OR rs.to_date >= $3)`,
		roomID, billing.LastDay(month), billing.FirstDay(month))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
