package invoicecalc

import (
	"context"
	"time"

	"ktx/internal/billing"
	"ktx/internal/db"
)

// Điện thu LÙI MỘT KỲ (owner chốt 31/07/2026): phiếu tháng M = tiền phòng/nước/dịch vụ tháng M
// (thu trước) + tiền điện kỳ M-1 (phải đợi số công-tơ cuối tháng mới tính được).
// Riêng HV RỜI trong tháng M: phiếu thu lúc trả phòng gánh thêm phần điện tháng M
// tính tới ngày rời (từ số công-tơ chốt hôm bàn giao) — vì họ không còn phiếu M+1 nữa.

// PrevMonthOf: 'YYYY-MM' của kỳ liền trước.
func PrevMonthOf(month string) string {
	t, err := time.ParseInLocation("2006-01", month, time.UTC)
	if err != nil {
		return month
	}
	return t.AddDate(0, -1, 0).Format("2006-01")
}

// ElectricLag: tiền điện cho phiếu kỳ `month` của một HV.
// = trọn phần kỳ month-1 + (nếu checkOut nằm trong `month`) phần kỳ `month` tới ngày rời.
// Luôn trả con số (0 nếu không có dữ liệu) — KHÔNG trả nil, để bên gọi không rơi về
// đường chia-theo-roster cũ (roster tháng M chia khối điện tháng M-1 là sai người).
func ElectricLag(ctx context.Context, database *db.DB, studentID int, month string, unit float64, checkOut string) (float64, error) {
	sum := 0.0
	prev, err := StudentElectric(ctx, database, studentID, PrevMonthOf(month), unit)
	if err != nil {
		return 0, err
	}
	if prev != nil {
		sum += *prev
	}
	if len(checkOut) >= 7 && checkOut[:7] == month {
		cur, err := StudentElectric(ctx, database, studentID, month, unit)
		if err != nil {
			return 0, err
		}
		if cur == nil {
			// Kỳ này chưa chốt cuối tháng -> tạm tính từ số công-tơ bàn giao (meter_reads).
			cur, err = StudentElectricProvisional(ctx, database, studentID, month, unit)
			if err != nil {
				return 0, err
			}
		}
		if cur != nil {
			sum += *cur
		}
	}
	return sum, nil
}

// ThieuDienKy: kiểm kỳ `month` của MỘT phòng còn thiếu gì để chia điện đúng.
// Trả danh sách câu thiếu (rỗng = đủ): chưa chốt cuối kỳ, hoặc có lượt rời giữa kỳ
// mà không có chỉ số công-tơ đúng ngày đó.
func ThieuDienKy(ctx context.Context, database *db.DB, roomID int, month string) ([]string, error) {
	var thieu []string
	var one int
	daChot := database.Pool.QueryRow(ctx,
		"SELECT 1 FROM electric_readings WHERE room_id=$1 AND month=$2", roomID, month).Scan(&one) == nil
	if !daChot {
		thieu = append(thieu, "chưa chốt chỉ số cuối kỳ "+month)
	}
	// Chỉ số hợp lệ nằm ở to_date (trả phòng ngày D -> lượt hết D, đọc ghi ngày D) HOẶC to_date+1
	// (chuyển phòng ngày D -> lượt cũ hết D-1, đọc ghi ngày D).
	rows, err := database.Pool.Query(ctx,
		`SELECT s.name, to_char(rs.to_date,'YYYY-MM-DD')
		   FROM room_stays rs JOIN students s ON s.id = rs.student_id AND s.deleted_at IS NULL
		  WHERE rs.room_id=$1 AND rs.to_date >= $2 AND rs.to_date < $3
		    AND NOT EXISTS (SELECT 1 FROM meter_reads m WHERE m.room_id = rs.room_id
		                     AND m.read_date BETWEEN rs.to_date AND rs.to_date + 1)
		  ORDER BY rs.to_date`,
		roomID, billing.FirstDay(month), billing.LastDay(month))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var ten, ngay string
		if err := rows.Scan(&ten, &ngay); err != nil {
			return nil, err
		}
		thieu = append(thieu, "thiếu chỉ số ngày "+ngay+" ("+ten+" rời phòng)")
	}
	return thieu, rows.Err()
}
