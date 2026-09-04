package billing

import (
	"fmt"
	"strconv"
	"strings"
)

// numStr = Number(v) của JS cho chuỗi cài đặt: "" -> 0, số hợp lệ -> giá trị, còn lại -> 0.
// (Dữ liệu settings luôn là chuỗi số hoặc rỗng; không lo trường hợp NaN của JS.)
func numStr(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}

func sprintfNotice(noticeDays, minD int) string {
	return fmt.Sprintf("Báo trước %d ngày (≥ %d ngày)", noticeDays, minD)
}

func sprintfNoticeShort(noticeDays, minD int) string {
	return fmt.Sprintf("Chỉ báo trước %d ngày (< %d ngày)", noticeDays, minD)
}
