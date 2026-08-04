package invoicecalc

import (
	"context"
	"time"

	"ktx/internal/billing"
	"ktx/internal/db"
)

// Điện thu lùi một kỳ: phiếu tháng M = phòng/nước/dịch vụ tháng M + tiền điện kỳ M-1.

// PrevMonthOf: 'YYYY-MM' của kỳ liền trước.
func PrevMonthOf(month string) string {
	t, err := time.ParseInLocation("2006-01", month, time.UTC)
	if err != nil {
		return month
	}
	return t.AddDate(0, -1, 0).Format("2006-01")
}

// NextMonthOf: 'YYYY-MM' của kỳ liền sau.
func NextMonthOf(month string) string {
	t, err := time.ParseInLocation("2006-01", month, time.UTC)
	if err != nil {
		return month
	}
	return t.AddDate(0, 1, 0).Format("2006-01")
}

// RecalcQuanhKy: chỉ số kỳ M đổi -> tính lại phiếu kỳ M (người rời) và kỳ M+1 (người ở lại).
// Trả số phiếu thực sự được ghi lại.
func RecalcQuanhKy(ctx context.Context, database *db.DB, studentID int, month string) int {
	n := 0
	for _, m := range []string{month, NextMonthOf(month)} {
		if inv, err := RecalcInvoice(ctx, database, studentID, m); err == nil && inv != nil {
			n++
		}
	}
	return n
}

// ElectricLag: tiền điện phiếu kỳ `month` = phần của KỲ month-1, không hơn — điện thu sau MỘT KỲ cho
// mọi người. Kỳ điện chưa chốt cuối tháng thì tạm tính từ số công-tơ bàn giao.
// Luôn trả số (0 khi thiếu dữ liệu), không trả nil.
func ElectricLag(ctx context.Context, database *db.DB, studentID int, month string, unit float64, checkOut string) (PhanDien, error) {
	var sum PhanDien
	kyDien := PrevMonthOf(month)
	prev, err := StudentElectric(ctx, database, studentID, kyDien, unit)
	if err != nil {
		return sum, err
	}
	if prev == nil {
		if prev, err = StudentElectricProvisional(ctx, database, studentID, kyDien, unit); err != nil {
			return sum, err
		}
	}
	if prev != nil {
		sum.Tien += prev.Tien
		sum.Kwh += prev.Kwh
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
		   FROM room_stays rs JOIN students s ON s.id = rs.student_id
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
