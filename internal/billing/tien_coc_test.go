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
	if got := TienCoc(hv, "2026-08", feesCoc(), nil, nil); got != 1200000 {
		t.Errorf("kỳ nhận phòng: cọc = %d, phải = 1200000", got)
	}
	// Kỳ sau KHÔNG được thu lại — chưa đóng cọc không phải lý do đòi thêm mỗi tháng.
	for _, ky := range []string{"2026-09", "2026-10", "2026-07"} {
		if got := TienCoc(hv, ky, feesCoc(), nil, nil); got != 0 {
			t.Errorf("kỳ %s: cọc = %d, phải = 0 (chỉ thu ở kỳ nhận phòng 2026-08)", ky, got)
		}
	}
}

func TestTienCoc_DaDongThiThoiThu(t *testing.T) {
	for _, tt := range []string{"held", "refunded", "forfeited", ""} {
		hv := Student{ID: 1, CheckInDate: "2026-08-20", DepositStatus: tt}
		if got := TienCoc(hv, "2026-08", feesCoc(), nil, nil); got != 0 {
			t.Errorf("deposit_status=%q: cọc = %d, phải = 0 (chỉ 'none' mới thu)", tt, got)
		}
	}
}

func TestTienCoc_ThieuNgayNhanPhongThiKhongDoan(t *testing.T) {
	// Không có ngày nhận phòng thì không biết kỳ nào là kỳ đầu -> KHÔNG thu, thà sót còn hơn thu oan.
	for _, ci := range []string{"", "2026", "20"} {
		hv := Student{ID: 1, CheckInDate: ci, DepositStatus: "none"}
		if got := TienCoc(hv, "2026-08", feesCoc(), nil, nil); got != 0 {
			t.Errorf("check_in_date=%q: cọc = %d, phải = 0", ci, got)
		}
	}
}

func TestTienCoc_MucCocBangKhongThiKhongCoDong(t *testing.T) {
	f := feesCoc()
	f["deposit_fee"] = "0"
	hv := Student{ID: 1, CheckInDate: "2026-08-20", DepositStatus: "none"}
	if got := TienCoc(hv, "2026-08", f, nil, nil); got != 0 {
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

// Phòng thuê trọn có MỘT hợp đồng. Người ký cọc trọn giá phòng; thành viên ở cùng không đứng hợp
// đồng nào nên không cọc riêng (chốt 02/08/2026).
func cocPhongTron(dungHoaDon bool) Invoice {
	return ComputeInvoice(ComputeInput{
		Student:     Student{ID: 7, CheckInDate: "2026-08-01", DepositStatus: "none"},
		NguyenPhong: &NguyenPhong{DungHoaDon: dungHoaDon, SuatNguoi: 4},
		Room:        &Room{Hang: "A", RoomType: "whole"},
		Month:       "2026-08",
		Fees:        feesCoc(),
	})
}

func TestTienCoc_PhongTronNguoiKyCocTronGiaPhong(t *testing.T) {
	got := cocPhongTron(true)
	// Cọc = giá phòng hạng A (5.500.000), KHÔNG phải mức cọc một suất người (1.200.000).
	if got.DepositCharge != 5500000 {
		t.Errorf("cọc người ký HĐ phòng trọn = %d, phải = 5500000 (giá phòng hạng A)", got.DepositCharge)
	}
	if got.RoomCharge != 5500000 {
		t.Errorf("tiền phòng = %d, phải = 5500000 — cọc phải bằng đúng giá phòng đang thu", got.RoomCharge)
	}
}

func TestTienCoc_ThanhVienPhongTronKhongCoCoc(t *testing.T) {
	got := cocPhongTron(false)
	if got.DepositCharge != 0 {
		t.Errorf("cọc của thành viên = %d, phải = 0 (cọc nằm ở phiếu người ký hợp đồng)", got.DepositCharge)
	}
	if got.RoomCharge != 0 || got.WaterCharge != 0 || got.ServiceCharge != 0 {
		t.Errorf("thành viên phòng trọn: phòng=%d nước=%d dvụ=%d, cả ba phải = 0",
			got.RoomCharge, got.WaterCharge, got.ServiceCharge)
	}
	if got.Total != 0 {
		t.Errorf("tổng phiếu thành viên = %d, phải = 0", got.Total)
	}
}

// Phòng an ninh / nhân viên được miễn tiền phòng. Cọc "bằng giá phòng" cho một phòng không thu tiền
// phòng là tự phá bất biến cọc = tiền phòng đang thu.
func TestTienCoc_PhongMienTienPhongThiKhongCoCoc(t *testing.T) {
	for _, loai := range []string{"security", "staff"} {
		got := ComputeInvoice(ComputeInput{
			Student:   Student{ID: 5, CheckInDate: "2026-08-01", DepositStatus: "none", RentalType: "phong"},
			Room:      &Room{Hang: "A", RoomType: loai},
			Month:     "2026-08",
			Fees:      feesCoc(),
			Occupants: 1,
		})
		if got.RoomCharge != 0 {
			t.Fatalf("phòng %q: tiền phòng = %d, phải = 0", loai, got.RoomCharge)
		}
		if got.DepositCharge != 0 {
			t.Errorf("phòng %q: cọc = %d, phải = 0 — không thu tiền phòng thì cọc theo giá phòng là vô lý",
				loai, got.DepositCharge)
		}
	}
}

// Dữ liệu cũ: phòng để 'shared' nhưng hồ sơ ghi rental_type='phong' -> vẫn thu giá phòng, nên cọc
// cũng phải theo giá phòng. Lệch hai chỗ này là cọc thu một đằng, tiền phòng một nẻo.
func TestTienCoc_RentalTypePhongCungCocTheoGiaPhong(t *testing.T) {
	got := ComputeInvoice(ComputeInput{
		Student:   Student{ID: 3, CheckInDate: "2026-08-01", DepositStatus: "none", RentalType: "phong"},
		Room:      &Room{Hang: "A", RoomType: "shared"},
		Month:     "2026-08",
		Fees:      feesCoc(),
		Occupants: 1,
	})
	if got.DepositCharge != got.RoomCharge {
		t.Errorf("cọc = %d nhưng tiền phòng = %d — hai số phải bằng nhau", got.DepositCharge, got.RoomCharge)
	}
	if got.DepositCharge != 5500000 {
		t.Errorf("cọc = %d, phải = 5500000 (giá phòng hạng A)", got.DepositCharge)
	}
}
