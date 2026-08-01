package valid

import (
	"strings"
	"testing"
)

// Ngày phải CÓ THẬT, không chỉ đúng khuôn. 31/02 lọt được là hồ sơ mang ngày ma, kéo theo mọi phép
// tính theo ngày ở (tiền phòng, chia điện) lệch mà không ai thấy sai ở đâu.
func TestIsValidYmdBatNgayKhongCoThat(t *testing.T) {
	hopLe := []string{"2026-08-02", "2024-02-29", "1900-01-01", "2200-12-31"}
	for _, s := range hopLe {
		if !IsValidYmd(s) {
			t.Errorf("%q phải hợp lệ", s)
		}
	}
	sai := []string{
		"2026-02-31", // tháng 2 không có ngày 31
		"2025-02-29", // 2025 không nhuận
		"2026-04-31", // tháng 4 có 30 ngày
		"2026-13-01", "2026-00-10", "2026-08-00", "2026-08-32",
		"1899-12-31", "2201-01-01",
		"2026-8-2", "26-08-02", "2026/08/02", "2026-08-02T00:00:00", "", "hôm nay",
	}
	for _, s := range sai {
		if IsValidYmd(s) {
			t.Errorf("%q phải bị từ chối", s)
		}
	}
}

func TestYmdOrNullTraNilKhiSai(t *testing.T) {
	if p := YmdOrNull("2026-02-31"); p != nil {
		t.Errorf("ngày không có thật phải thành NULL, được %q", *p)
	}
	if p := YmdOrNull("2026-08-02"); p == nil || *p != "2026-08-02" {
		t.Errorf("ngày hợp lệ phải giữ nguyên, được %v", p)
	}
}

func TestIsValidMonth(t *testing.T) {
	for _, s := range []string{"2026-01", "2026-12"} {
		if !IsValidMonth(s) {
			t.Errorf("%q phải hợp lệ", s)
		}
	}
	for _, s := range []string{"2026-00", "2026-13", "2026-1", "26-01", "2026-01-01", ""} {
		if IsValidMonth(s) {
			t.Errorf("%q phải bị từ chối", s)
		}
	}
}

func TestIsValidPhone(t *testing.T) {
	for _, s := range []string{"0901234567", "090 123 4567", "+84 90 123 4567", "12345678"} {
		if !IsValidPhone(s) {
			t.Errorf("%q phải hợp lệ (đếm CHỮ SỐ, bỏ ký tự trang trí)", s)
		}
	}
	for _, s := range []string{"1234567", "1234567890123456", "", "abc", "----"} {
		if IsValidPhone(s) {
			t.Errorf("%q phải bị từ chối", s)
		}
	}
}

// Ngưỡng nghiệp vụ nhập từ màn Cài đặt: lọt một giá trị vô lý là sai tiền hàng loạt về sau.
func TestCheckSettingChanBienVaGiaTriRac(t *testing.T) {
	if e := CheckSetting("due_day_from", "0"); e == "" {
		t.Error("ngày 0 phải bị chặn (min 1)")
	}
	if e := CheckSetting("due_day_to", "32"); e == "" {
		t.Error("ngày 32 phải bị chặn (max 31)")
	}
	if e := CheckSetting("electric_unit", "-1"); e == "" {
		t.Error("đơn giá điện âm phải bị chặn")
	}
	if e := CheckSetting("partial_half_factor", "1.5"); e == "" {
		t.Error("hệ số nửa suất > 1 phải bị chặn")
	}
	for _, raw := range []string{"", "  ", "abc", "1e5", "3,5", "0x10", "NaN", "Infinity"} {
		if e := CheckSetting("room_fee", raw); e == "" {
			t.Errorf("giá trị rác %q phải bị chặn", raw)
		}
	}
	for _, raw := range []string{"0", "1200000", " 1200000 ", "0.5"} {
		if e := CheckSetting("room_fee", raw); e != "" {
			t.Errorf("%q phải hợp lệ, lỗi: %s", raw, e)
		}
	}
	// Khoá không nằm trong bảng: không phải việc của hàm này, không được tự bịa lỗi.
	if e := CheckSetting("dorm_name", "Ký túc xá"); e != "" {
		t.Errorf("khoá không phải số không được báo lỗi: %s", e)
	}
}

// Chính sách mật khẩu owner chốt 23/07: chỉ tối thiểu 6, bỏ mọi rule khác. Trần 72 BYTE là giới hạn
// cứng của bcrypt — quá đó bcrypt CẮT ÂM THẦM, hai mật khẩu khác nhau lại vào được cùng tài khoản.
func TestCheckPassword(t *testing.T) {
	if e := CheckPassword("12345", nil); e == "" {
		t.Error("5 ký tự phải bị chặn")
	}
	if e := CheckPassword("123456", nil); e != "" {
		t.Errorf("6 ký tự phải qua, lỗi: %s", e)
	}
	if e := CheckPassword("matkhau123", []string{"matkhau"}); e != "" {
		t.Errorf("không còn danh sách đen theo ngữ cảnh, lỗi: %s", e)
	}
	if e := CheckPassword(string(make([]byte, 73)), nil); e == "" {
		t.Error("73 byte phải bị chặn (bcrypt cắt ở 72)")
	}
	// Tiếng Việt có dấu: 6 KÝ TỰ là qua, dù nhiều byte hơn 6.
	if e := CheckPassword("nhàđẹp", nil); e != "" {
		t.Errorf("6 ký tự tiếng Việt phải qua, lỗi: %s", e)
	}
	// …nhưng chuỗi tiếng Việt dài quá 72 BYTE thì vẫn phải chặn, dù đếm ký tự chưa tới.
	dai := strings.Repeat("đường", 9) // 45 ký tự, 81 byte
	if len(dai) <= 72 {
		t.Fatalf("chuỗi mẫu phải vượt 72 byte, đang %d byte", len(dai))
	}
	if e := CheckPassword(dai, nil); e == "" {
		t.Errorf("chuỗi %d ký tự / %d byte phải bị chặn", len([]rune(dai)), len(dai))
	}
}

// Chặn SSRF khi người dùng tự khai host SMTP: trỏ vào mạng nội bộ là biến máy chủ thành bàn đạp.
func TestIsPrivateHostChanMangNoiBo(t *testing.T) {
	chan_ := []string{
		"localhost", "LOCALHOST", "abc.localhost", "127.0.0.1", "127.1.2.3", "0.0.0.0",
		"10.0.0.1", "192.168.1.1", "172.16.0.1", "172.31.255.255",
		"169.254.169.254", // metadata endpoint của cloud
		"::1", "[::1]", "fd00::1", "fe80::1", "",
	}
	for _, h := range chan_ {
		if !IsPrivateHost(h) {
			t.Errorf("%q phải bị coi là nội bộ", h)
		}
	}
	cho := []string{"smtp.gmail.com", "8.8.8.8", "172.32.0.1", "192.169.1.1", "11.0.0.1"}
	for _, h := range cho {
		if IsPrivateHost(h) {
			t.Errorf("%q là host công cộng, không được chặn", h)
		}
	}
}

func TestIsValidPortVaEmail(t *testing.T) {
	for _, p := range []string{"1", "587", "65535", " 25 "} {
		if !IsValidPort(p) {
			t.Errorf("cổng %q phải hợp lệ", p)
		}
	}
	for _, p := range []string{"0", "65536", "-1", "", "abc", "58 7"} {
		if IsValidPort(p) {
			t.Errorf("cổng %q phải bị từ chối", p)
		}
	}
	if !IsValidEmail("a.b@esuhai.com") {
		t.Error("email thường phải hợp lệ")
	}
	for _, e := range []string{"a@", "@b.com", "a b@c.com", "a@b", ""} {
		if IsValidEmail(e) {
			t.Errorf("email %q phải bị từ chối", e)
		}
	}
}

func TestNormalizeBool(t *testing.T) {
	for _, v := range []string{"true", "TRUE", " 1 ", "yes", "on"} {
		if !NormalizeBool(v) {
			t.Errorf("%q phải là true", v)
		}
	}
	for _, v := range []string{"false", "0", "no", "off", "", "2", "có"} {
		if NormalizeBool(v) {
			t.Errorf("%q phải là false", v)
		}
	}
}
