package valid

import (
	"strings"
	"testing"
)

// Mọi khoá cài đặt số/giờ đều phải có nhãn: câu lỗi của CheckSetting không được lộ tên khoá.
func TestNhanPhuDuKhoaCaiDat(t *testing.T) {
	for k := range SettingNum {
		if _, ok := NhanTruong[k]; !ok {
			t.Errorf("thiếu nhãn cho khoá cài đặt %q", k)
		}
	}
	for k := range SettingTime {
		if _, ok := NhanTruong[k]; !ok {
			t.Errorf("thiếu nhãn cho khoá giờ %q", k)
		}
	}
}

func TestCauLoiDungNhan(t *testing.T) {
	if e := CheckSetting("parking_fee", "abc"); !strings.Contains(e, "Gửi xe") || strings.Contains(e, "parking_fee") {
		t.Errorf("CheckSetting lộ tên khoá: %q", e)
	}
	if e := CheckSetting("security_day_from", "25h"); !strings.Contains(e, "Ca ngày bắt đầu") || strings.Contains(e, "security_day_from") {
		t.Errorf("CheckSetting (giờ) lộ tên khoá: %q", e)
	}
	get := func(v string) func(string) (string, bool) { return func(string) (string, bool) { return v, true } }
	if e := KhongChoHTML(get("<b>x</b>"), []string{"class_name"}); !strings.Contains(e, "Lớp") || strings.Contains(e, "class_name") || !strings.Contains(e, "HTML") {
		t.Errorf("KhongChoHTML: %q", e)
	}
	if e := TooLong(get("abcdef"), []TooLongField{{Key: "note", Max: 3}}); !strings.Contains(e, "Ghi chú") || strings.Contains(e, `"note"`) {
		t.Errorf("TooLong lộ tên khoá: %q", e)
	}
	if Nhan("khoa_la") != "khoa_la" {
		t.Error("khoá lạ phải trả nguyên khoá")
	}
}
