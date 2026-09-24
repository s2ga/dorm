package valid

import (
	"strings"
	"unicode"
)

// TenChuan: chuẩn hoá tên người — hoa chữ cái đầu mỗi từ, phần còn lại viết thường, bỏ khoảng trắng
// thừa. "NGUYỄN HOÀI THỦY TIÊN" và "nguyễn  hoài thủy tiên" đều ra "Nguyễn Hoài Thủy Tiên".
func TenChuan(s string) string {
	tu := strings.FieldsFunc(s, func(r rune) bool { return unicode.IsSpace(r) })
	for i, t := range tu {
		r := []rune(t)
		r[0] = unicode.ToUpper(r[0])
		for j := 1; j < len(r); j++ {
			r[j] = unicode.ToLower(r[j])
		}
		tu[i] = string(r)
	}
	return strings.Join(tu, " ")
}
