package billing

import "testing"

// Thuê nguyên phòng: MỘT hoá đơn đứng tên phòng trưởng gồm tiền phòng theo hạng (thu một lần cho cả
// phòng) + trọn tiền điện công-tơ + nước và dịch vụ nhân theo số suất-người. Trước đây MỖI người
// thuê nguyên phòng đều nhận trọn giá phòng trên hoá đơn riêng -> phòng 5 người bị thu 5 lần tiền phòng.
func feesNP() Fees {
	return Fees{
		"room_fee": "1200000", "room_price_A": "5500000", "room_price_B": "4800000",
		"water_fee": "100000", "service_fee": "50000", "electric_unit": "3000",
		"washing_fee": "70000", "parking_fee": "100000",
		"partial_half_min": "10", "partial_full_min": "15", "partial_half_factor": "0.5",
	}
}

func hvNP(id int) Student {
	return Student{ID: id, RentalType: "phong", CheckInDate: "2026-01-01"}
}

func TestNguyenPhongGopVeMotHoaDon(t *testing.T) {
	phong := &Room{Hang: "A"}
	const kwh = 400.0 // 400 × 3.000 = 1.200.000 tiền điện cả phòng

	// Phòng 5 người, ai cũng ở trọn tháng -> 5 suất.
	truong := ComputeInvoice(ComputeInput{
		Student: hvNP(1), Room: phong, Month: "2026-01", Fees: feesNP(), Kwh: kwh,
		NguyenPhong: &NguyenPhong{DungHoaDon: true, SuatNguoi: 5},
	})

	if truong.RoomCharge != 5500000 {
		t.Errorf("tiền phòng hạng A phải thu MỘT lần 5.500.000, được %d", truong.RoomCharge)
	}
	if truong.ElectricCharge != 1200000 {
		t.Errorf("điện phải là trọn công-tơ 1.200.000 (không chia đầu người), được %d", truong.ElectricCharge)
	}
	if truong.WaterCharge != 500000 {
		t.Errorf("nước phải là 100.000 × 5 suất = 500.000, được %d", truong.WaterCharge)
	}
	if truong.ServiceCharge != 250000 {
		t.Errorf("dịch vụ phải là 50.000 × 5 suất = 250.000, được %d", truong.ServiceCharge)
	}
	if truong.Total != 7450000 {
		t.Errorf("tổng hoá đơn phòng trưởng phải 7.450.000, được %d", truong.Total)
	}

	// Thành viên: KHÔNG có phiếu — kể cả máy giặt và xe cũng nằm ở phiếu phòng trưởng.
	tv := hvNP(2)
	tv.UsesWashing = true
	tv.UsesParking = true
	thanhVien := ComputeInvoice(ComputeInput{
		Student: tv, Room: phong, Month: "2026-01", Fees: feesNP(), Kwh: kwh,
		NguyenPhong: &NguyenPhong{DungHoaDon: false, SuatNguoi: 5, SuatMayGiat: 2, SuatXe: 3},
	})
	for _, c := range []struct {
		ten string
		got int
	}{{"tiền phòng", thanhVien.RoomCharge}, {"điện", thanhVien.ElectricCharge},
		{"nước", thanhVien.WaterCharge}, {"dịch vụ", thanhVien.ServiceCharge},
		{"máy giặt", thanhVien.WashingCharge}, {"gửi xe", thanhVien.ParkingCharge}} {
		if c.got != 0 {
			t.Errorf("thành viên không được tính %s (đã nằm ở phiếu phòng trưởng), được %d", c.ten, c.got)
		}
	}
	if thanhVien.Total != 0 {
		t.Errorf("thành viên phòng thuê nguyên KHÔNG có phiếu — tổng phải 0, được %d", thanhVien.Total)
	}
}

// Máy giặt + gửi xe của cả phòng dồn vào phiếu phòng trưởng.
func TestNguyenPhongGomCaMayGiatVaXe(t *testing.T) {
	inv := ComputeInvoice(ComputeInput{
		Student: hvNP(1), Room: &Room{Hang: "A"}, Month: "2026-01", Fees: feesNP(), Kwh: 400,
		NguyenPhong: &NguyenPhong{DungHoaDon: true, SuatNguoi: 5, SuatMayGiat: 2, SuatXe: 3},
	})
	if inv.WashingCharge != 140000 {
		t.Errorf("2 người dùng máy giặt = 70.000 × 2 = 140.000, được %d", inv.WashingCharge)
	}
	if inv.ParkingCharge != 300000 {
		t.Errorf("3 xe cả phòng = 100.000 × 3 = 300.000, được %d", inv.ParkingCharge)
	}
	if inv.Total != 7890000 {
		t.Errorf("tổng phiếu gộp phải 7.890.000, được %d", inv.Total)
	}
}

// Thuê nguyên phòng KHÔNG ở đủ tháng thì tiền phòng chia theo ngày, y như thuê ghép.
func TestNguyenPhongKhongDuThangThiChiaTheoNgay(t *testing.T) {
	st := hvNP(1)
	st.CheckOutDate = "2026-01-15" // ở 15/31 ngày
	inv := ComputeInvoice(ComputeInput{
		Student: st, Room: &Room{Hang: "A"}, Month: "2026-01", Fees: feesNP(),
		NguyenPhong: &NguyenPhong{DungHoaDon: true, SuatNguoi: 5},
	})
	if muon := r0((5500000.0 / 31) * 15); inv.RoomCharge != muon {
		t.Errorf("ở 15/31 ngày → tiền phòng phải %d, được %d", muon, inv.RoomCharge)
	}
	if inv.RoomCharge >= 5500000 {
		t.Errorf("không được thu trọn tháng khi chỉ ở nửa tháng: %d", inv.RoomCharge)
	}
}

// Phòng trưởng được miễn nước + dịch vụ theo ngày làm. Áp lên hoá đơn GỘP mà miễn theo tổng thì
// xoá sạch phần của cả 5 người — chỉ được miễn đúng một suất của bản thân.
func TestNguyenPhongMienPhongTruongChiMotSuat(t *testing.T) {
	inv := ComputeInvoice(ComputeInput{
		Student: hvNP(1), Room: &Room{Hang: "A"}, Month: "2026-01", Fees: feesNP(), Kwh: 400,
		LeaderDays:  31, // làm phòng trưởng trọn tháng
		NguyenPhong: &NguyenPhong{DungHoaDon: true, SuatNguoi: 5},
	})
	// Một suất = 100.000 nước + 50.000 dịch vụ.
	if inv.LeaderDiscount != 150000 {
		t.Errorf("chỉ miễn MỘT suất nước+dịch vụ = 150.000, được %d", inv.LeaderDiscount)
	}
	if inv.Total != 7300000 {
		t.Errorf("tổng sau miễn phải 7.300.000, được %d", inv.Total)
	}
}

// Thuê ghép không được đổi: 1.200.000/người + các khoản khác như cũ.
func TestThueGhepGiuNguyen(t *testing.T) {
	st := Student{ID: 9, RentalType: "ghep", CheckInDate: "2026-01-01"}
	inv := ComputeInvoice(ComputeInput{
		Student: st, Room: &Room{Hang: "A"}, Month: "2026-01", Fees: feesNP(),
		Kwh: 400, Occupants: 5,
	})
	if inv.RoomCharge != 1200000 {
		t.Errorf("thuê ghép phải 1.200.000/người, được %d", inv.RoomCharge)
	}
	if inv.WaterCharge != 100000 || inv.ServiceCharge != 50000 {
		t.Errorf("thuê ghép: nước/dịch vụ vẫn một suất — nước=%d dịch vụ=%d", inv.WaterCharge, inv.ServiceCharge)
	}
	if inv.ElectricCharge != 240000 {
		t.Errorf("thuê ghép: điện chia 5 = 240.000, được %d", inv.ElectricCharge)
	}
}
