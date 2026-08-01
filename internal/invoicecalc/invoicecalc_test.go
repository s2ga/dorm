package invoicecalc

import (
	"testing"

	"ktx/internal/billing"
)

// Luật điện thu lùi một kỳ: phiếu tháng M gánh tiền điện kỳ M-1. Sai một bước ở đây là cả app đọc
// nhầm kỳ điện — vắt qua năm là chỗ dễ sai nhất.
func TestPrevNextMonthVatQuaNam(t *testing.T) {
	cases := []struct{ month, truoc, sau string }{
		{"2026-01", "2025-12", "2026-02"},
		{"2026-12", "2026-11", "2027-01"},
		{"2026-03", "2026-02", "2026-04"}, // tháng 2 ngắn: không được nhảy nhầm
		{"2024-03", "2024-02", "2024-04"}, // năm nhuận
		{"2026-08", "2026-07", "2026-09"},
	}
	for _, c := range cases {
		if got := PrevMonthOf(c.month); got != c.truoc {
			t.Errorf("PrevMonthOf(%q) = %q, phải %q", c.month, got, c.truoc)
		}
		if got := NextMonthOf(c.month); got != c.sau {
			t.Errorf("NextMonthOf(%q) = %q, phải %q", c.month, got, c.sau)
		}
	}
}

// Chuỗi kỳ hỏng phải trả NGUYÊN chuỗi vào, không được tự bịa ra một kỳ khác — chỗ gọi so sánh kỳ,
// bịa ra kỳ hợp lệ là lẳng lặng tính tiền cho tháng không ai yêu cầu.
func TestPrevNextMonthGiuNguyenChuoiHong(t *testing.T) {
	for _, s := range []string{"", "2026", "2026-13", "tháng 8", "2026-08-02"} {
		if got := PrevMonthOf(s); got != s {
			t.Errorf("PrevMonthOf(%q) = %q, phải giữ nguyên", s, got)
		}
		if got := NextMonthOf(s); got != s {
			t.Errorf("NextMonthOf(%q) = %q, phải giữ nguyên", s, got)
		}
	}
}

// Đi tới rồi lùi lại phải về đúng chỗ cũ với mọi tháng trong năm.
func TestPrevNextMonthDoiXung(t *testing.T) {
	for _, m := range []string{
		"2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
		"2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
	} {
		if got := PrevMonthOf(NextMonthOf(m)); got != m {
			t.Errorf("%q: đi tới rồi lùi lại ra %q", m, got)
		}
	}
}

// Thuê nguyên phòng: CHỈ người ký hợp đồng đứng hoá đơn; thành viên khác về 0 (đã nằm trong phiếu
// kia rồi). Nhầm cờ này là thu tiền phòng hai lần — đúng lỗi BL-93 sếp báo "sai trầm trọng".
func TestNguyenPhongChiNguoiKyHopDongDungHoaDon(t *testing.T) {
	n := &NguyenPhongThang{
		PhongTruongID: 42,
		Suat:          billing.NguyenPhong{SuatNguoi: 4.5, SuatMayGiat: 2, SuatXe: 3},
	}
	truong := n.Cua(42)
	if truong == nil || !truong.DungHoaDon {
		t.Fatalf("người ký HĐ phải đứng hoá đơn: %+v", truong)
	}
	thanhVien := n.Cua(43)
	if thanhVien == nil || thanhVien.DungHoaDon {
		t.Fatalf("thành viên KHÔNG được đứng hoá đơn: %+v", thanhVien)
	}
	// Suất của cả phòng phải giữ nguyên cho cả hai (billing tự cho thành viên về 0), và Cua phải
	// trả BẢN SAO — sửa cái này không được đụng cái kia.
	if thanhVien.SuatNguoi != 4.5 || truong.SuatNguoi != 4.5 {
		t.Errorf("Σ suất-người phải giữ nguyên: trưởng=%v thành viên=%v", truong.SuatNguoi, thanhVien.SuatNguoi)
	}
	thanhVien.SuatNguoi = 0
	if truong.SuatNguoi != 4.5 || n.Suat.SuatNguoi != 4.5 {
		t.Error("Cua() phải trả bản sao, sửa một bản không được lây sang bản khác")
	}
}

// Phòng chưa cử người ký HĐ (PhongTruongID = 0): KHÔNG ai được đứng hoá đơn nhầm.
func TestNguyenPhongChuaCoNguoiKyThiKhongAiDungHoaDon(t *testing.T) {
	n := &NguyenPhongThang{Suat: billing.NguyenPhong{SuatNguoi: 3}}
	for _, id := range []int{1, 42, 999} {
		if got := n.Cua(id); got == nil || got.DungHoaDon {
			t.Errorf("chưa cử người ký mà HV %d lại đứng hoá đơn: %+v", id, got)
		}
	}
}

// Phòng thuê ghép: nil xuyên suốt, không được hoá thành struct rỗng "có nguyên phòng".
func TestNguyenPhongNilVanLaNil(t *testing.T) {
	var n *NguyenPhongThang
	if got := n.Cua(1); got != nil {
		t.Errorf("phòng thuê ghép phải trả nil, được %+v", got)
	}
}
