package billing

import "testing"

// Phòng an ninh / phòng nhân viên: không thu tiền phòng, các khoản khác vẫn thu.

func feesThu() Fees {
	return Fees{
		"room_fee": "1200000", "room_price_B": "4800000",
		"water_fee": "100000", "service_fee": "50000", "electric_unit": "3000",
		"washing_fee": "70000", "parking_fee": "100000",
		"partial_half_min": "10", "partial_full_min": "15", "partial_half_factor": "0.5",
	}
}

// Ở trọn tháng 7/2026 để hệ số phí cố định = 1, số tiền dễ đối chiếu.
func inputThu(roomType, rentalType string) ComputeInput {
	return ComputeInput{
		Student:   Student{ID: 1, CheckInDate: "2026-07-01", RentalType: rentalType},
		Room:      &Room{Hang: "B", RoomType: roomType},
		Month:     "2026-07",
		Fees:      feesThu(),
		Occupants: 1,
		Kwh:       100, // 100 kWh x 3.000 = 300.000 tiền điện
	}
}

func TestMienTienPhong_CoMienChoAnNinhVaNhanVien(t *testing.T) {
	for _, loai := range []string{"security", "staff"} {
		got := ComputeInvoice(inputThu(loai, "ghep"))
		if got.RoomCharge != 0 {
			t.Errorf("phòng %q: tiền phòng = %d, phải = 0 (miễn tiền phòng)", loai, got.RoomCharge)
		}
		// Miễn ĐÚNG tiền phòng. Ba khoản dưới đây vẫn phải thu — miễn lan sang là thất thu thật.
		if got.WaterCharge != 100000 {
			t.Errorf("phòng %q: tiền nước = %d, phải = 100000 (vẫn thu)", loai, got.WaterCharge)
		}
		if got.ServiceCharge != 50000 {
			t.Errorf("phòng %q: phí dịch vụ = %d, phải = 50000 (vẫn thu)", loai, got.ServiceCharge)
		}
		if got.ElectricCharge != 300000 {
			t.Errorf("phòng %q: tiền điện = %d, phải = 300000 (vẫn thu)", loai, got.ElectricCharge)
		}
		if got.Total != 450000 {
			t.Errorf("phòng %q: tổng = %d, phải = 450000 (nước+dịch vụ+điện, không có tiền phòng)", loai, got.Total)
		}
	}
}

func TestMienTienPhong_KhongMienChoPhongChoThue(t *testing.T) {
	// Thuê ghép: thu theo room_fee.
	ghep := ComputeInvoice(inputThu("shared", "ghep"))
	if ghep.RoomCharge != 1200000 {
		t.Errorf("phòng ghép: tiền phòng = %d, phải = 1200000", ghep.RoomCharge)
	}
	// Thuê nguyên phòng: thu theo giá phòng của hạng, KHÔNG được lẫn sang nhóm miễn.
	tron := ComputeInvoice(inputThu("whole", "phong"))
	if tron.RoomCharge != 4800000 {
		t.Errorf("thuê nguyên phòng hạng B: tiền phòng = %d, phải = 4800000", tron.RoomCharge)
	}
	// Chuỗi rỗng (dữ liệu cũ chưa có room_type) phải coi như phòng cho thuê — không tự nhiên miễn.
	rong := ComputeInvoice(inputThu("", "ghep"))
	if rong.RoomCharge != 1200000 {
		t.Errorf("room_type rỗng: tiền phòng = %d, phải = 1200000 (mặc định vẫn thu)", rong.RoomCharge)
	}
}

func TestMienTienPhong_NhanDungLoai(t *testing.T) {
	for loai, muon := range map[string]bool{
		"security": true, "staff": true, "shared": false, "whole": false, "": false, "SECURITY": false,
	} {
		if got := MienTienPhong(loai); got != muon {
			t.Errorf("MienTienPhong(%q) = %v, muốn %v", loai, got, muon)
		}
	}
}
