// Package vehiclecount — đếm xe hiệu lực trong THÁNG của học viên. Port từ server/vehicle-count.js.
// Xe tính cho tháng M nếu đăng ký trước/khi trong M (from_date <= cuối M) và chưa gỡ trước M
// (to_date rỗng hoặc >= đầu M). KHÔNG lọc deleted_at — to_date lo ranh giới (V2-23).
package vehiclecount

import (
	"context"

	"ktx/internal/db"
)

const whereMonth = ` COALESCE(from_date, created_at::date) <= (date_trunc('month',$MONTH::date) + interval '1 month - 1 day')::date
  AND (to_date IS NULL OR to_date >= $MONTH::date)`

func replaceMonth(s, ph string) string {
	out := ""
	for i := 0; i < len(s); {
		if i+6 <= len(s) && s[i:i+6] == "$MONTH" {
			out += ph
			i += 6
		} else {
			out += string(s[i])
			i++
		}
	}
	return out
}

// CountForMonth: số xe của 1 HV trong tháng. server/vehicle-count.js:12-15
func CountForMonth(ctx context.Context, q db.Querier, studentID int, month string) (int, error) {
	sql := `SELECT COUNT(*)::int FROM vehicles WHERE student_id=$1 AND` + replaceMonth(whereMonth, "$2")
	var c int
	err := q.QueryRow(ctx, sql, studentID, month+"-01").Scan(&c)
	return c, err
}

// CountByStudentForMonth: map student_id -> số xe (cho lập hoá đơn hàng loạt). server/vehicle-count.js:18-23
func CountByStudentForMonth(ctx context.Context, q db.Querier, month string) (map[int]int, error) {
	sql := `SELECT student_id, COUNT(*)::int FROM vehicles WHERE` + replaceMonth(whereMonth, "$1") + ` GROUP BY student_id`
	rows, err := q.Query(ctx, sql, month+"-01")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[int]int{}
	for rows.Next() {
		var sid, c int
		if err := rows.Scan(&sid, &c); err != nil {
			return nil, err
		}
		m[sid] = c
	}
	return m, rows.Err()
}
