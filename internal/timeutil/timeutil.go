// Package timeutil ghim MỘT múi giờ Việt Nam cho toàn app (BLK-5). Cấm dùng time.Now() trần
// trong logic nghiệp vụ — luôn qua Today()/Now() ở đây để không lệch ngày khung 00:00–07:00 giờ VN.
package timeutil

import (
	"strings"
	"time"
	_ "time/tzdata" // nhúng CSDL múi giờ vào binary: LoadLocation chạy cả trên Windows / container tối giản
)

// Loc = Asia/Ho_Chi_Minh (UTC+7). Tương đương process.env.TZ ở server/index.js.
var Loc *time.Location

func init() {
	l, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		l = time.FixedZone("ICT", 7*3600) // dự phòng nếu tzdata lỗi (không nên xảy ra vì đã nhúng)
	}
	Loc = l
}

// Now trả thời điểm hiện tại theo giờ VN.
func Now() time.Time { return time.Now().In(Loc) }

// Today trả "YYYY-MM-DD" theo giờ VN — thay cho new Date().toISOString().slice(0,10) của Node.
func Today() string { return Now().Format("2006-01-02") }

// NgayVN: "YYYY-MM-DD…" -> "dd/mm/yyyy" cho câu hiển thị; chuỗi sai dạng trả nguyên.
func NgayVN(iso string) string {
	if len(iso) < 10 || iso[4] != '-' || iso[7] != '-' {
		return iso
	}
	return iso[8:10] + "/" + iso[5:7] + "/" + iso[0:4]
}

// ThangVN: "YYYY-MM" -> "tháng 6/2026" cho câu hiển thị; chuỗi sai dạng trả nguyên.
func ThangVN(ym string) string {
	if len(ym) < 7 || ym[4] != '-' {
		return ym
	}
	return "tháng " + strings.TrimPrefix(ym[5:7], "0") + "/" + ym[0:4]
}
