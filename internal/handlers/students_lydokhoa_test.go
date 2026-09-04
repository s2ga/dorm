package handlers

import (
	"strings"
	"testing"
)

// Lý do khoá hồ sơ: bỏ trống thì máy chủ điền lý do mặc định, không để trống trơn —
// màn "Học viên đã khoá" mà cột lý do rỗng thì khoá xong không ai biết vì sao.
func TestStudentsLyDoKhoa(t *testing.T) {
	zw := string(rune(0x200B))  // zero-width space
	bom := string(rune(0xFEFF)) // byte order mark
	ca := []struct{ ten, vao, ra string }{
		{"để trống -> mặc định", "", studentsLyDoKhoaMacDinh},
		{"toàn khoảng trắng -> mặc định", "   \t\n ", studentsLyDoKhoaMacDinh},
		{"giữ nguyên lý do đã nhập", "Vi phạm nội quy", "Vi phạm nội quy"},
		{"cắt khoảng trắng thừa hai đầu", "  Hết hợp đồng  ", "Hết hợp đồng"},
		{"giữ dấu tiếng Việt", "Chuyển sang cơ sở khác", "Chuyển sang cơ sở khác"},
		{"chỉ ký tự vô hình -> mặc định", zw + zw, studentsLyDoKhoaMacDinh},
		{"chỉ BOM -> mặc định", bom, studentsLyDoKhoaMacDinh},
		{"BOM lẫn khoảng trắng -> mặc định", " " + bom + " ", studentsLyDoKhoaMacDinh},
		{"lẫn ký tự vô hình -> giữ phần đọc được", "Hết" + zw + "hợp đồng", "Hếthợp đồng"},
	}
	for _, c := range ca {
		if got := studentsLyDoKhoa(c.vao); got != c.ra {
			t.Errorf("%s: nhận %q, mong %q", c.ten, got, c.ra)
		}
	}
}

// Cắt theo KÝ TỰ chứ không theo byte — cắt byte giữa chừng một chữ tiếng Việt là ra ký tự hỏng.
func TestStudentsLyDoKhoaCatTheoKyTu(t *testing.T) {
	dai := strings.Repeat("ế", 400)
	got := studentsLyDoKhoa(dai)
	if n := len([]rune(got)); n != 300 {
		t.Errorf("cắt ra %d ký tự, mong 300", n)
	}
	if !strings.HasSuffix(got, "ế") || strings.ContainsRune(got, '�') {
		t.Error("cắt giữa chừng làm hỏng ký tự tiếng Việt")
	}
}
