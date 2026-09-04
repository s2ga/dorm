// Package checkout — phần dùng CHUNG cho cả 3 đường trả phòng (admin/đơn HV/bảo trì). Port từ server/checkout.js.
// Gom về một nơi để 3 đường luôn làm ĐỦ và GIỐNG nhau: đóng lượt ở + đóng phòng trưởng + dọn phiếu kỳ sau
// + tính lại phiếu tháng trả (BLK-1).
package checkout

import (
	"context"

	"ktx/internal/db"
	"ktx/internal/invoicecalc"
	"ktx/internal/roomleaders"
	"ktx/internal/roomstays"
)

func slice10(s string) string {
	if len(s) > 10 {
		return s[:10]
	}
	return s
}

// BadCheckoutDate: chặn ngày trả phi lý. "" nếu hợp lệ. server/checkout.js:21-28
func BadCheckoutDate(ctx context.Context, q db.Querier, studentID int, date, checkInDate string) (string, error) {
	if checkInDate != "" && date < slice10(checkInDate) {
		return "Ngày trả phòng (" + date + ") không thể trước ngày nhận phòng (" + slice10(checkInDate) + ").", nil
	}
	open, err := roomstays.OpenStayOf(ctx, q, studentID)
	if err != nil {
		return "", err
	}
	if open != nil && date < open.FromDate {
		return "Ngày trả phòng (" + date + ") không thể trước ngày bắt đầu lượt ở hiện tại (" + open.FromDate + ") — học viên đã chuyển phòng ngày đó, chọn ngày ≥ ngày chuyển.", nil
	}
	return "", nil
}

// FinalizeCheckout: hoàn tất trả phòng (gọi SAU khi route đã cập nhật status/check_out_date/log/công-tơ).
// server/checkout.js:34-44. Trả danh sách tháng phiếu bị dọn.
func FinalizeCheckout(ctx context.Context, q db.Querier, database *db.DB, studentID int, date string) ([]string, error) {
	cur, err := roomstays.OpenStayOf(ctx, q, studentID)
	if err != nil {
		return nil, err
	}
	if cur != nil {
		if err := roomstays.CheckOut(ctx, q, studentID, date); err != nil {
			return nil, err
		}
	} else if err := roomstays.MoveLastToDate(ctx, q, studentID, date); err != nil {
		// Trả phòng LẠI (đổi ngày rời khi lịch cũ chưa tới): lượt cuối đã đóng ở ngày cũ — dời về
		// ngày mới, không được bỏ qua im lặng kẻo room_stays lệch hồ sơ và tiền điện chia sai ngày.
		return nil, err
	}
	if err := roomleaders.CloseStudent(ctx, q, studentID, date); err != nil {
		return nil, err
	}
	mo := date[:7]
	rows, err := q.Query(ctx,
		"UPDATE invoices SET deleted_at=now() WHERE student_id=$1 AND month > $2 AND deleted_at IS NULL RETURNING month",
		studentID, mo)
	if err != nil {
		return nil, err
	}
	var dropped []string
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			rows.Close()
			return nil, err
		}
		dropped = append(dropped, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// recalc phiếu tháng trả — luôn trên pool (giống Node); lỗi thì bỏ qua (try/catch).
	_, _ = invoicecalc.RecalcInvoice(ctx, database, studentID, mo)
	return dropped, nil
}
