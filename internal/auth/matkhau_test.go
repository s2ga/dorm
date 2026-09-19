package auth

import (
	"strings"
	"testing"
)

func TestMatKhauNgauNhien(t *testing.T) {
	thay := map[string]bool{}
	for i := 0; i < 200; i++ {
		mk, err := MatKhauNgauNhien()
		if err != nil {
			t.Fatalf("sinh mật khẩu lỗi: %v", err)
		}
		if len([]rune(mk)) != MatKhauKhoiTaoDai {
			t.Fatalf("độ dài %d, muốn %d (%q)", len([]rune(mk)), MatKhauKhoiTaoDai, mk)
		}
		for _, ch := range mk {
			if !strings.ContainsRune(matKhauBangChu, ch) {
				t.Fatalf("ký tự lạ %q trong %q", ch, mk)
			}
		}
		if strings.ContainsAny(mk, "0OoIl1") {
			t.Fatalf("còn ký tự dễ đọc nhầm trong %q", mk)
		}
		thay[mk] = true
	}
	if len(thay) < 195 {
		t.Fatalf("200 lần sinh chỉ ra %d mật khẩu khác nhau — nghi ngờ không ngẫu nhiên", len(thay))
	}
}
