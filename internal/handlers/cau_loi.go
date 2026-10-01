package handlers

// Câu lỗi dùng ở nhiều handler, và nhãn tiếng Việt (khớp chữ trên giao diện) cho các mã trạng thái nêu
// trong câu lỗi — không để mã tiếng Anh lộ ra màn hình.
const (
	loiKy     = "Kỳ không hợp lệ — chọn lại tháng."
	loiNgay   = "Ngày không hợp lệ — chọn lại từ lịch."
	loiMayChu = "Lỗi máy chủ — thử lại sau; nếu vẫn lỗi, báo quản trị."
)

var (
	nhanVai = map[string]string{
		"admin": "Quản trị viên", "staff": "Nhân viên", "maintenance": "An ninh / Bảo trì",
		"secretary": "Thư ký", "teacher": "Giáo viên ProSkills", "student": "Học viên", "pending": "Chờ duyệt",
	}
	nhanTTDonTra = map[string]string{
		"pending": "chờ duyệt", "approved": "đã duyệt", "handed_over": "đã bàn giao",
		"billed": "đã lập phiếu", "done": "đã hoàn tất", "rejected": "đã từ chối",
	}
	nhanTTDeNghi = map[string]string{"pending": "đang chờ duyệt", "approved": "đã được duyệt", "rejected": "đã bị từ chối"}
)

// nhanTT: nhãn của mã k trong bảng m; mã lạ trả nguyên.
func nhanTT(m map[string]string, k string) string {
	if v, ok := m[k]; ok {
		return v
	}
	return k
}
