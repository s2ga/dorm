package invoicecalc

import (
	"context"
	"strconv"
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

// ThieuDienKyDenNgay: kỳ `month` của MỘT phòng còn thiếu gì để tính đúng phần điện của người rời
// (hoặc chuyển đi) ngày `denNgay`. denNgay rỗng = ở tới hết kỳ -> đòi đủ như ThieuDienKy.
// Chặng của họ khép ở denNgay nên chỉ cần: mốc đầu kỳ + mọi mốc chốt từ đầu kỳ tới denNgay.
func ThieuDienKyDenNgay(ctx context.Context, database *db.DB, roomID int, month, denNgay string) ([]string, error) {
	if phongThueNguyen(ctx, database, roomID) {
		return ThieuDienKy(ctx, database, roomID, month)
	}
	if denNgay == "" || denNgay >= billing.LastDay(month) {
		return ThieuDienKy(ctx, database, roomID, month)
	}
	var one int
	if database.Pool.QueryRow(ctx,
		"SELECT 1 FROM electric_readings WHERE room_id=$1 AND month=$2", roomID, month).Scan(&one) == nil {
		// Đã chốt cuối kỳ -> mốc đầu có sẵn, chỉ còn kiểm các mốc giữa kỳ.
		return thieuMocGiuaKy(ctx, database, roomID, month, denNgay)
	}
	// Chưa chốt: phải có chỉ số cuối kỳ TRƯỚC làm mốc đầu, không thì không trừ ra kWh được.
	ky := PrevMonthOf(month)
	var mocDau float64
	if database.Pool.QueryRow(ctx,
		"SELECT reading_end FROM electric_readings WHERE room_id=$1 AND month=$2", roomID, ky).Scan(&mocDau) != nil {
		return []string{"chưa chốt chỉ số cuối kỳ " + ky + " (mốc đầu để tính kỳ " + month + ")"}, nil
	}
	if t, e := thieuMocGiuaKy(ctx, database, roomID, month, denNgay); e != nil || len(t) > 0 {
		return t, e
	}
	return mocLuiNguoc(ctx, database, roomID, month, mocDau)
}

// mocLuiNguoc: công-tơ chỉ quay tới. Mốc nào nhỏ hơn mốc trước là dữ liệu mâu thuẫn — bộ dựng chặng
// bỏ cả phòng khi gặp, nên phải chặn ở cổng thay vì để ra phiếu 0 đồng.
func mocLuiNguoc(ctx context.Context, database *db.DB, roomID int, month string, mocDau float64) ([]string, error) {
	rows, err := database.Pool.Query(ctx,
		`SELECT to_char(read_date,'YYYY-MM-DD'), reading FROM meter_reads
		  WHERE room_id=$1 AND read_date >= $2 AND read_date <= $3 ORDER BY read_date, id`,
		roomID, billing.FirstDay(month), billing.LastDay(month))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	truoc, tenTruoc := mocDau, "đầu kỳ"
	for rows.Next() {
		var ngay string
		var so float64
		if err := rows.Scan(&ngay, &so); err != nil {
			return nil, err
		}
		if so < truoc {
			return []string{"chỉ số ngày " + ngay + " (" + fmtSo(so) + ") NHỎ HƠN chỉ số " + tenTruoc +
				" (" + fmtSo(truoc) + ") — công-tơ không quay lùi, sửa lại rồi mới lập phiếu"}, nil
		}
		truoc, tenTruoc = so, "ngày "+ngay
	}
	return nil, rows.Err()
}

func fmtSo(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// phongThueNguyen: phòng cho thuê trọn (room_type='whole'). Lỗi đọc coi như KHÔNG phải — thà đòi
// thừa mốc chốt còn hơn bỏ sót kiểm tra ở phòng ghép.
func phongThueNguyen(ctx context.Context, database *db.DB, roomID int) bool {
	var rt *string
	if database.Pool.QueryRow(ctx, "SELECT room_type FROM rooms WHERE id=$1", roomID).Scan(&rt) != nil {
		return false
	}
	return rt != nil && *rt == "whole"
}

// thieuMocGiuaKy: những lượt kết thúc trong [đầu kỳ, denNgay] mà chưa có chỉ số chốt.
func thieuMocGiuaKy(ctx context.Context, database *db.DB, roomID int, month, denNgay string) ([]string, error) {
	rows, err := database.Pool.Query(ctx,
		`SELECT s.name, to_char(rs.to_date,'YYYY-MM-DD')
		   FROM room_stays rs JOIN students s ON s.id = rs.student_id
		  WHERE rs.room_id=$1 AND rs.to_date >= $2 AND rs.to_date <= $3
		    AND rs.to_date <> rs.from_date AND s.deleted_at IS NULL
		    AND NOT EXISTS (SELECT 1 FROM meter_reads m WHERE m.room_id = rs.room_id
		                     AND m.read_date BETWEEN rs.to_date AND rs.to_date + 1)
		  ORDER BY rs.to_date`,
		roomID, billing.FirstDay(month), denNgay)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var thieu []string
	for rows.Next() {
		var ten, ngay string
		if err := rows.Scan(&ten, &ngay); err != nil {
			return nil, err
		}
		thieu = append(thieu, "thiếu chỉ số ngày "+ngay+" ("+ten+" rời phòng)")
	}
	return thieu, rows.Err()
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
	// Phòng thuê NGUYÊN: trọn công-tơ nằm trên phiếu người ký HĐ, không chia đầu người — không cần
	// mốc chốt giữa kỳ khi có người rời (owner 03/09: điện phòng nguyên chốt thẳng với trưởng phòng).
	if phongThueNguyen(ctx, database, roomID) {
		return thieu, nil
	}
	// Chỉ số hợp lệ nằm ở to_date (trả phòng ngày D -> lượt hết D, đọc ghi ngày D) HOẶC to_date+1
	// (chuyển phòng ngày D -> lượt cũ hết D-1, đọc ghi ngày D). Lượt vào-ra cùng ngày: bỏ, mốc vô nghĩa.
	rows, err := database.Pool.Query(ctx,
		`SELECT s.name, to_char(rs.to_date,'YYYY-MM-DD')
		   FROM room_stays rs JOIN students s ON s.id = rs.student_id
		  WHERE rs.room_id=$1 AND rs.to_date >= $2 AND rs.to_date < $3
		    AND rs.to_date <> rs.from_date AND s.deleted_at IS NULL
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
