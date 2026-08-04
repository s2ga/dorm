// Package valid — kiểm tra hợp lệ input, port từ server/valid.js. Thuần, không phụ thuộc.
package valid

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	reYmd     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	reMonth   = regexp.MustCompile(`^\d{4}-\d{2}$`)
	reNum     = regexp.MustCompile(`^-?\d+(\.\d+)?$`)
	reHourMin = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
	reEmail   = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	reNonDig  = regexp.MustCompile(`\D`)
	rePrivA   = regexp.MustCompile(`^127\.`)
	rePrivLL  = regexp.MustCompile(`^169\.254\.`)
	rePriv10  = regexp.MustCompile(`^10\.`)
	rePriv192 = regexp.MustCompile(`^192\.168\.`)
	rePriv172 = regexp.MustCompile(`^172\.(1[6-9]|2\d|3[01])\.`)
	rePrivV6U = regexp.MustCompile(`^(fc|fd)[0-9a-f]{2}:`)
	rePrivV6L = regexp.MustCompile(`^fe80:`)
	// Thẻ HTML phải là "<" DÍNH LIỀN chữ cái — "a < b" trình duyệt hiện thành chữ, không phải thẻ,
	// nên không được chặn (chặn nhầm là người dùng không lưu nổi ghi chú bình thường).
	reTagHTML = regexp.MustCompile(`(?i)<[a-z!/?]|&#?[a-z0-9]{2,8};`)
)

// IsValidYmd: 'YYYY-MM-DD' phải là ngày có thật. server/valid.js:4-11
func IsValidYmd(s string) bool {
	if !reYmd.MatchString(s) {
		return false
	}
	y, _ := strconv.Atoi(s[0:4])
	m, _ := strconv.Atoi(s[5:7])
	d, _ := strconv.Atoi(s[8:10])
	if y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31 {
		return false
	}
	dt := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
	return dt.Year() == y && int(dt.Month()) == m && dt.Day() == d
}

// YmdOrNull: hợp lệ -> con trỏ chuỗi; không -> nil (lưu NULL). server/valid.js:13
func YmdOrNull(s string) *string {
	if IsValidYmd(s) {
		return &s
	}
	return nil
}

func Digits(s string) string { return reNonDig.ReplaceAllString(s, "") }

// IsValidPhone: 8–15 chữ số. server/valid.js:16
func IsValidPhone(s string) bool {
	d := Digits(s)
	return len(d) >= 8 && len(d) <= 15
}

// IsValidGender: chỉ 'male'|'female'. server/valid.js:23
func IsValidGender(s string) bool { return s == "male" || s == "female" }

// IsValidMonth: 'YYYY-MM', tháng 01..12. server/valid.js:26-31
func IsValidMonth(s string) bool {
	if !reMonth.MatchString(s) {
		return false
	}
	y, _ := strconv.Atoi(s[0:4])
	m, _ := strconv.Atoi(s[5:7])
	return y >= 1900 && y <= 2200 && m >= 1 && m <= 12
}

type settingRange struct{ min, max float64 }

// SettingNum: bảng min/max cho khoá settings số. server/valid.js:36-52
var SettingNum = map[string]settingRange{
	"room_fee": {0, 100000000}, "water_fee": {0, 100000000},
	"electric_unit": {0, 1000000}, "service_fee": {0, 100000000},
	"washing_fee": {0, 100000000}, "parking_fee": {0, 100000000}, "deposit_fee": {0, 100000000},
	"room_price_A": {0, 100000000}, "room_price_B": {0, 100000000},
	"room_price_C": {0, 100000000}, "room_price_D": {0, 100000000},
	"partial_half_min": {0, 31}, "partial_full_min": {0, 31},
	"due_day_from": {1, 31}, "due_day_to": {1, 31},
	"violation_mail_threshold": {1, 100}, "smtp_port": {1, 65535},
	"overdue_remind_days": {1, 365}, "shortterm_max_days": {1, 365},
	"deposit_notice_min_days": {0, 365}, "partial_half_factor": {0, 1},
	"room_cap_A": {1, 20}, "room_cap_B": {1, 20}, "room_cap_C": {1, 20}, "room_cap_D": {1, 20},
	"checkout_max_future_days": {1, 3650}, "max_cccd_mb": {1, 15},
}

// SettingTime: khoá settings phải là giờ 'HH:MM'. Giờ rác thì khung ca trực hiện sai trên cổng học
// viên — người ta gọi đúng số nhưng nhầm ca, không ai bắt máy.
var SettingTime = map[string]bool{"security_day_from": true, "security_day_to": true}

// CheckSetting trả chuỗi lỗi nếu sai, "" nếu hợp lệ. server/valid.js:54-64
func CheckSetting(key, raw string) string {
	if SettingTime[key] {
		if !reHourMin.MatchString(strings.TrimSpace(raw)) {
			return `"` + key + `" phải là giờ dạng HH:MM (đang nhận: "` + raw + `")`
		}
		return ""
	}
	spec, ok := SettingNum[key]
	if !ok {
		return ""
	}
	s := strings.TrimSpace(raw)
	if s == "" || !reNum.MatchString(s) {
		return `"` + key + `" phải là số (đang nhận: "` + raw + `")`
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return `"` + key + `" phải là số`
	}
	if n < spec.min {
		return `"` + key + `" không được nhỏ hơn ` + trimFloat(spec.min) + ` (đang nhận: ` + trimFloat(n) + `)`
	}
	if n > spec.max {
		return `"` + key + `" không được lớn hơn ` + trimFloat(spec.max) + ` (đang nhận: ` + trimFloat(n) + `)`
	}
	return ""
}

func trimFloat(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// CheckPassword: chỉ 2 ràng buộc kỹ thuật — tối thiểu 6 ký tự, tối đa 72 BYTE (trần cứng của bcrypt).
// Không bắt cả-chữ-và-số / danh sách đen. Tham số context giữ cho tương thích, hiện không dùng.
func CheckPassword(pw string, context []string) string {
	if len([]rune(pw)) < 6 {
		return "Mật khẩu tối thiểu 6 ký tự"
	}
	if len(pw) > 72 {
		return "Mật khẩu tối đa 72 ký tự"
	}
	return ""
}

// IsValidEmail. server/valid.js:99-102
func IsValidEmail(s string) bool {
	s = strings.TrimSpace(s)
	return reEmail.MatchString(s) && len(s) <= 254
}

// IsPrivateHost: chặn SSRF. server/valid.js:107-119
func IsPrivateHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	h = strings.TrimPrefix(strings.TrimSuffix(h, "]"), "[")
	if h == "" {
		return true
	}
	if h == "localhost" || strings.HasSuffix(h, ".localhost") || h == "0.0.0.0" || h == "::" || h == "::1" {
		return true
	}
	return rePrivA.MatchString(h) || rePrivLL.MatchString(h) || rePriv10.MatchString(h) ||
		rePriv192.MatchString(h) || rePriv172.MatchString(h) || rePrivV6U.MatchString(h) || rePrivV6L.MatchString(h)
}

// IsValidPort: 1..65535. server/valid.js:122-125
func IsValidPort(p string) bool {
	n, err := strconv.Atoi(strings.TrimSpace(p))
	return err == nil && n >= 1 && n <= 65535
}

// NormalizeBool: "true"/"1"/"yes"/"on" -> true. server/valid.js:128-131
func NormalizeBool(v string) bool {
	s := strings.ToLower(strings.TrimSpace(v))
	return s == "true" || s == "1" || s == "yes" || s == "on"
}

// InitialPasswordMin: mật khẩu cấp nhanh cho HV (>=6, luôn kèm must_change_password). server/valid.js:147
const InitialPasswordMin = 6

// TooLongField: một cặp (khoá, trần độ dài) — giữ THỨ TỰ để báo lỗi giống Node (Object.entries).
type TooLongField struct {
	Key string
	Max int
}

// CoTheLaHTML: chuỗi có dấu hiệu thẻ/entity HTML. Lớp chặn THỨ HAI cho XSS — lớp thứ nhất là esc()
// ở frontend, nằm rải trong hàng trăm template viết tay nên sót một chỗ là thủng.
// Tên người, lớp, ghi chú tiếng Việt không bao giờ chứa các dạng này.
func CoTheLaHTML(s string) bool { return reTagHTML.MatchString(s) }

// KhongChoHTML: chặn HTML ở tầng GHI cho các trường văn bản tự do. Trả chuỗi lỗi hoặc "".
func KhongChoHTML(get func(string) (string, bool), keys []string) string {
	for _, k := range keys {
		v, ok := get(k)
		if ok && CoTheLaHTML(v) {
			return `Trường "` + k + `" chứa mã HTML — nhập lại bằng chữ thường, bỏ các dấu < > và &...;`
		}
	}
	return ""
}

// TooLong: chặn độ dài trường TEXT tự do. Trả chuỗi lỗi hoặc "". server/valid.js:135-142
// Dùng đếm rune (xấp xỉ .length UTF-16 của JS cho ký tự BMP tiếng Việt).
func TooLong(get func(string) (string, bool), limits []TooLongField) string {
	for _, f := range limits {
		v, ok := get(f.Key)
		if !ok {
			continue
		}
		n := len([]rune(v))
		if n > f.Max {
			return `Trường "` + f.Key + `" quá dài (tối đa ` + strconv.Itoa(f.Max) + ` ký tự, đang nhận ` + strconv.Itoa(n) + `)`
		}
	}
	return ""
}
