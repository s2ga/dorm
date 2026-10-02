package mail

import (
	"context"
	"fmt"
	"strings"

	"gopkg.in/gomail.v2"
	"ktx/internal/db"
)

// Báo cáo giám sát do cmd/giam-sat gửi lên. NoiDung là bản văn bản công cụ đã dựng sẵn (đã có
// môi trường, bản đang chạy, giờ quét) — máy chủ không dựng lại để hai nơi không trôi khác nhau.
type GiamSatBaoCao struct {
	Muc, NoiDung string
	P1, P2, P3   int
}

var giamSatTenLuot = map[string]string{
	"p1": "sống còn", "p2": "trong ngày", "p3": "toàn vẹn dữ liệu", "tuan": "tổng kết tuần",
}

// giamSatTinhTrang: một câu cho dòng tiêu đề. Mức nặng nhất thắng.
func giamSatTinhTrang(bc GiamSatBaoCao) string {
	switch {
	case bc.P1 > 0:
		return fmt.Sprintf("CÓ SỰ CỐ (P1=%d · P2=%d · P3=%d)", bc.P1, bc.P2, bc.P3)
	case bc.P2 > 0:
		return fmt.Sprintf("cần xử lý (P2=%d · P3=%d)", bc.P2, bc.P3)
	case bc.P3 > 0:
		return fmt.Sprintf("sai lệch dữ liệu (P3=%d)", bc.P3)
	}
	return "không có bất thường"
}

func giamSatTieuDe(dorm string, bc GiamSatBaoCao) string {
	luot := giamSatTenLuot[bc.Muc]
	if luot == "" {
		luot = bc.Muc
	}
	return fmt.Sprintf("[%s] Giám sát %s — %s", dorm, luot, giamSatTinhTrang(bc))
}

func giamSatThan(dorm, hotline string, bc GiamSatBaoCao) string {
	var b strings.Builder
	b.WriteString("BÁO CÁO GIÁM SÁT HỆ THỐNG VÀ DỮ LIỆU\n")
	b.WriteString("Tình trạng: " + giamSatTinhTrang(bc) + "\n\n")
	b.WriteString(strings.TrimRight(bc.NoiDung, "\n"))
	b.WriteString("\n\nMức độ: P1 xử lý ngay · P2 trong ngày · P3 dọn dần.\n\n--\n" + dorm)
	if hotline != "" {
		b.WriteString("\nHotline: " + hotline)
	}
	return b.String()
}

// SendGiamSat: gửi báo cáo giám sát cho quản trị. Người nhận do máy chủ quyết, KHÔNG lấy từ
// yêu cầu gọi vào — endpoint này không được thành đường gửi mail tới địa chỉ bất kỳ.
func SendGiamSat(ctx context.Context, database *db.DB, to []string, bc GiamSatBaoCao) (bool, string) {
	s, err := database.GetSettings(ctx)
	if err != nil {
		return false, "Lỗi đọc cấu hình"
	}
	if !SmtpConfigured(s) {
		return false, "Chưa cấu hình SMTP trong Cài đặt"
	}
	if len(to) == 0 {
		return false, "Chưa có email nhận báo cáo giám sát (Cài đặt giam_sat_email, hoặc email của tài khoản quản trị)"
	}
	dorm := s["dorm_name"]
	if dorm == "" {
		dorm = "Ký túc xá"
	}
	text := giamSatThan(dorm, s["hotline"], bc)
	from := s["smtp_from"]
	if from == "" {
		from = s["smtp_user"]
	}
	m := gomail.NewMessage()
	m.SetHeader("From", from)
	m.SetHeader("To", to...)
	m.SetHeader("Subject", giamSatTieuDe(dorm, bc))
	m.SetBody("text/plain", text)
	m.AddAlternative("text/html", "<pre style=\"font-family:ui-monospace,Consolas,monospace\">"+escHTML(text)+"</pre>")
	if err := dialer(s).DialAndSend(m); err != nil {
		return false, "Lỗi gửi mail: " + err.Error()
	}
	return true, ""
}
