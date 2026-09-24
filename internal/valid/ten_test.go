package valid

import "testing"

func TestTenChuan(t *testing.T) {
	ca := [][2]string{
		{"NGUYỄN HOÀI THỦY TIÊN", "Nguyễn Hoài Thủy Tiên"},
		{"nguyễn hữu đạt", "Nguyễn Hữu Đạt"},
		{"VÕ ĐÔNG TRIỀU", "Võ Đông Triều"},
		{"Nguyễn Thanh Bình Phương", "Nguyễn Thanh Bình Phương"},
		{"  nguyễn   thị   hoà  ", "Nguyễn Thị Hoà"},
		{"ĐẶNG THỊ ÁNH", "Đặng Thị Ánh"},
		{"lê huỳnh yến nhi", "Lê Huỳnh Yến Nhi"},
		{"", ""},
		{"   ", ""},
		{"A", "A"},
	}
	for _, c := range ca {
		if got := TenChuan(c[0]); got != c[1] {
			t.Errorf("TenChuan(%q) = %q, muốn %q", c[0], got, c[1])
		}
	}
}
