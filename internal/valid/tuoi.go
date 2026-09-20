package valid

import "strconv"

// Khoảng tuổi mặc định khi cài đặt để trống (owner chốt 15/09/2026).
const (
	TuoiToiThieuMacDinh = 17
	TuoiToiDaMacDinh    = 39
)

// SoTuoi: tuổi tròn tại mốc, so theo bộ ba năm/tháng/ngày. Chuỗi sai khuôn -> -1.
func SoTuoi(ngaySinh, moc string) int {
	if !IsValidYmd(ngaySinh) || !IsValidYmd(moc) {
		return -1
	}
	ns, _ := strconv.Atoi(ngaySinh[0:4])
	mm, _ := strconv.Atoi(moc[0:4])
	tuoi := mm - ns
	if moc[5:] < ngaySinh[5:] { // chưa tới sinh nhật trong năm
		tuoi--
	}
	return tuoi
}

// KhoangTuoi: đọc cài đặt tuổi tối thiểu/tối đa, giá trị rỗng hoặc hỏng thì dùng mặc định.
func KhoangTuoi(minRaw, maxRaw string) (int, int) {
	doc := func(s string, macDinh int) int {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 {
			return macDinh
		}
		return n
	}
	min, max := doc(minRaw, TuoiToiThieuMacDinh), doc(maxRaw, TuoiToiDaMacDinh)
	if min > max {
		return TuoiToiThieuMacDinh, TuoiToiDaMacDinh
	}
	return min, max
}

// LoiNgaySinh: trả lời chặn (tiếng Việt) hoặc "" nếu ngày sinh dùng được ở mốc đó.
func LoiNgaySinh(ngaySinh, moc string, min, max int) string {
	if !IsValidYmd(ngaySinh) {
		return "Ngày sinh không hợp lệ — nhập theo dạng ngày/tháng/năm."
	}
	if ngaySinh > moc {
		return "Ngày sinh không thể ở tương lai."
	}
	tuoi := SoTuoi(ngaySinh, moc)
	if tuoi < min || tuoi > max {
		return "Ký túc xá chỉ nhận học viên từ " + strconv.Itoa(min) + " đến " + strconv.Itoa(max) +
			" tuổi. Ngày sinh này ra " + strconv.Itoa(tuoi) + " tuổi — kiểm lại giúp em."
	}
	return ""
}
