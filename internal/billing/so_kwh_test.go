package billing

import (
	"math"
	"testing"
)

// Số kWh giữ ĐÚNG 2 số lẻ. Đổi lại kWh × đơn giá không khít tới từng đồng — lệch tối đa nửa đơn
// vị cuối × đơn giá (đơn giá 3.000 -> ≤ 15đ).

func feesKwh(unit string) Fees {
	return Fees{
		"room_fee": "0", "water_fee": "0", "service_fee": "0", "washing_fee": "0", "parking_fee": "0",
		"electric_unit": unit, "deposit_fee": "0",
		"partial_half_min": "10", "partial_full_min": "15", "partial_half_factor": "0.5",
	}
}

func phieuDien(tien float64, unit string) Invoice {
	return ComputeInvoice(ComputeInput{
		Student:        Student{ID: 1, CheckInDate: "2026-07-01", DepositStatus: "held"},
		Month:          "2026-07",
		Fees:           feesKwh(unit),
		ElectricCharge: &tien,
		Occupants:      1,
	})
}

var tienDienMau = []float64{123730, 103774, 107765, 123731} // phòng 102 kỳ 08/2026, đơn giá 3.000

func TestSoKwh_DungHaiSoLe(t *testing.T) {
	for _, tien := range tienDienMau {
		got := phieuDien(tien, "3000")
		if got.ElectricCharge != int(tien) {
			t.Fatalf("tiền điện = %d, phải = %d", got.ElectricCharge, int(tien))
		}
		// Nhân 100 phải ra số nguyên: quá 2 số lẻ là hệ thống tài chính đối tác nhận không hết.
		x100 := got.ElectricKwh * 100
		if math.Abs(x100-math.Round(x100)) > 1e-9 {
			t.Errorf("%v kWh có quá 2 số lẻ", got.ElectricKwh)
		}
		if muon := math.Round(tien/3000*100) / 100; math.Abs(got.ElectricKwh-muon) > 1e-9 {
			t.Errorf("kWh = %v, phải = %v", got.ElectricKwh, muon)
		}
	}
}

func TestSoKwh_KhongLamTronVeSoNguyen(t *testing.T) {
	got := phieuDien(123730, "3000")
	// 123730/3000 = 41,243333... -> 41,24. Về 41 tròn trĩnh là lại làm tròn quá tay.
	if math.Abs(got.ElectricKwh-41.24) > 1e-9 {
		t.Errorf("kWh = %v, phải = 41.24", got.ElectricKwh)
	}
}

// Sai lệch khi nhân ngược phải nằm trong nửa đơn vị cuối × đơn giá. Vượt ngưỡng này là công thức
// hỏng chứ không còn là chuyện làm tròn.
func TestSoKwh_LechNhanNguocTrongNguong(t *testing.T) {
	const unit = 3000.0
	nguong := unit / 200 // nửa của 0,01 kWh
	for _, tien := range tienDienMau {
		got := phieuDien(tien, "3000")
		lech := math.Abs(math.Round(got.ElectricKwh*unit) - tien)
		if lech > nguong {
			t.Errorf("%v kWh × 3.000 lệch %v đồng so với %v — vượt ngưỡng %v", got.ElectricKwh, lech, tien, nguong)
		}
	}
}

func TestSoKwh_ChiaChanThiKhongDeoThemSoLe(t *testing.T) {
	// 120.000 / 3.000 = 40 chẵn — phải ra đúng 40, không phải 40,0001 hay 39,9999.
	got := phieuDien(120000, "3000")
	if got.ElectricKwh != 40 {
		t.Errorf("kWh = %v, phải = 40 chẵn", got.ElectricKwh)
	}
}

func TestSoKwh_DonGiaBangKhongThiKhongChiaChoKhong(t *testing.T) {
	got := phieuDien(0, "0")
	if got.ElectricKwh != 0 {
		t.Errorf("đơn giá 0: kWh = %v, phải = 0 (không chia cho 0)", got.ElectricKwh)
	}
}
