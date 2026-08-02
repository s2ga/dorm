package billing

import "testing"

// Tiền cọc lên phiếu KỲ NHẬN PHÒNG, chỉ khi hồ sơ còn ghi chưa đóng (chốt 02/08/2026).
// Bộ này soi đúng hai chỗ dễ mất tiền: thu lặp lại tháng sau, và cọc bị chia theo ngày ở.

func feesCoc() Fees {
	return Fees{
		"room_fee": "1200000", "room_price_A": "5500000",
		"water_fee": "100000", "service_fee": "50000", "electric_unit": "3000",
		"washing_fee": "70000", "parking_fee": "100000", "deposit_fee": "1200000",
		"partial_half_min": "10", "partial_full_min": "15", "partial_half_factor": "0.5",
	}
}

func TestTienCoc_ChiThuOKyNhanPhong(t *testing.T) {
	hv := Student{ID: 1, CheckInDate: "2026-08-20", DepositStatus: "none"}
	if got := TienCoc(hv, "2026-08", feesCoc()); got != 1200000 {
		t.Errorf("kỳ nhận phòng: cọc = %d, phải = 1200000", got)
	}
	// Kỳ sau KHÔNG được thu lại — chưa đóng cọc không phải lý do đòi thêm mỗi tháng.
	for _, ky := range []string{"2026-09", "2026-10", "2026-07"} {
		if got := TienCoc(hv, ky, feesCoc()); got != 0 {
			t.Errorf("kỳ %s: cọc = %d, phải = 0 (chỉ thu ở kỳ nhận phòng 2026-08)", ky, got)
		}
	}
}

func TestTienCoc_DaDongThiThoiThu(t *testing.T) {
	for _, tt := range []string{"held", "refunded", "forfeited", ""} {
		hv := Student{ID: 1, CheckInDate: "2026-08-20", DepositStatus: tt}
		if got := TienCoc(hv, "2026-08", feesCoc()); got != 0 {
			t.Errorf("deposit_status=%q: cọc = %d, phải = 0 (chỉ 'none' mới thu)", tt, got)
		}
	}
}

func TestTienCoc_ThieuNgayNhanPhongThiKhongDoan(t *testing.T) {
	// Không có ngày nhận phòng thì không biết kỳ nào là kỳ đầu -> KHÔNG thu, thà sót còn hơn thu oan.
	for _, ci := range []string{"", "2026", "20"} {
		hv := Student{ID: 1, CheckInDate: ci, DepositStatus: "none"}
		if got := TienCoc(hv, "2026-08", feesCoc()); got != 0 {
			t.Errorf("check_in_date=%q: cọc = %d, phải = 0", ci, got)
		}
	}
}

func TestTienCoc_MucCocBangKhongThiKhongCoDong(t *testing.T) {
	f := feesCoc()
	f["deposit_fee"] = "0"
	hv := Student{ID: 1, CheckInDate: "2026-08-20", DepositStatus: "none"}
	if got := TienCoc(hv, "2026-08", f); got != 0 {
		t.Errorf("deposit_fee=0: cọc = %d, phải = 0", got)
	}
}

// Cọc là khoản MỘT LẦN: ở 3 ngày cũng thu trọn, không nhân theo ngày ở như tiền phòng.
func TestTienCoc_KhongChiaTheoNgayO(t *testing.T) {
	in := ComputeInput{
		Student:   Student{ID: 1, CheckInDate: "2026-08-29", DepositStatus: "none", RentalType: "ghep"},
		Room:      &Room{Hang: "A", RoomType: "shared"},
		Month:     "2026-08",
		Fees:      feesCoc(),
		Occupants: 1,
	}
	got := ComputeInvoice(in)
	if got.DaysStayed != 3 {
		t.Fatalf("số ngày ở = %d, phải = 3 (29→31/08)", got.DaysStayed)
	}
	if got.DepositCharge != 1200000 {
		t.Errorf("cọc = %d, phải = 1200000 trọn vẹn dù chỉ ở 3 ngày", got.DepositCharge)
	}
	// Tiền phòng thì VẪN phải chia theo ngày — nếu chỗ này cũng trọn là đã sửa nhầm công thức.
	if got.RoomCharge != 116129 {
		t.Errorf("tiền phòng = %d, phải = 116129 (1.200.000/31×3)", got.RoomCharge)
	}
	if got.Total != got.RoomCharge+got.DepositCharge {
		t.Errorf("tổng = %d, phải = %d (tiền phòng + cọc; ở 3 ngày nên nước/dịch vụ = 0 suất)",
			got.Total, got.RoomCharge+got.DepositCharge)
	}
}

// Giảm % là ưu đãi trên PHÍ. Cọc là tiền giữ hộ, giảm vào đó là trả lại thiếu lúc học viên ra.
func TestTienCoc_KhongAnGiamPhanTram(t *testing.T) {
	in := ComputeInput{
		Student: Student{
			ID: 1, CheckInDate: "2026-08-01", DepositStatus: "none", RentalType: "ghep",
			RoomFeeDiscountPct: 100, WaterDiscountPct: 100, ServiceDiscountPct: 100,
			ElectricDiscountPct: 100, WashingDiscountPct: 100, ParkingDiscountPct: 100,
		},
		Room:      &Room{Hang: "A", RoomType: "shared"},
		Month:     "2026-08",
		Fees:      feesCoc(),
		Occupants: 1,
	}
	got := ComputeInvoice(in)
	if got.DepositCharge != 1200000 {
		t.Errorf("cọc = %d, phải = 1200000 (giảm 100%% mọi khoản vẫn không đụng tới cọc)", got.DepositCharge)
	}
	if got.Total != 1200000 {
		t.Errorf("tổng = %d, phải = 1200000 (mọi phí về 0, còn đúng tiền cọc)", got.Total)
	}
}

// Phòng thuê trọn: nước/điện/dịch vụ của thành viên dồn về phiếu người ký HĐ, nhưng cọc thì KHÔNG —
// cọc là tiền của từng người, hoàn cho chính người đó khi rời.
func TestTienCoc_ThanhVienPhongTronVanCoCocRieng(t *testing.T) {
	in := ComputeInput{
		Student:     Student{ID: 7, CheckInDate: "2026-08-01", DepositStatus: "none"},
		NguyenPhong: &NguyenPhong{DungHoaDon: false, SuatNguoi: 4},
		Room:        &Room{Hang: "A", RoomType: "whole"},
		Month:       "2026-08",
		Fees:        feesCoc(),
	}
	got := ComputeInvoice(in)
	if got.RoomCharge != 0 || got.WaterCharge != 0 || got.ServiceCharge != 0 {
		t.Errorf("thành viên phòng trọn: phòng=%d nước=%d dvụ=%d, cả ba phải = 0",
			got.RoomCharge, got.WaterCharge, got.ServiceCharge)
	}
	if got.DepositCharge != 1200000 {
		t.Errorf("cọc của thành viên = %d, phải = 1200000 (cọc theo người, không gộp về phòng trưởng)", got.DepositCharge)
	}
	if got.Total != 1200000 {
		t.Errorf("tổng = %d, phải = 1200000 (chỉ còn tiền cọc)", got.Total)
	}
}
