package billing

import (
	"math"
	"testing"
)

// Số kWh trên phiếu phải nhân ngược ra ĐÚNG số tiền đang thu. Làm tròn về số nguyên như bản cũ là
// phiếu tự mâu thuẫn: 41 kWh × 3.000 = 123.000 trong khi dòng tiền ghi 123.730.

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

func TestSoKwh_NhanNguocRaDungSoTien(t *testing.T) {
	// Đúng các con số trên ảnh chụp phòng 102 kỳ 08/2026, đơn giá 3.000.
	for _, tien := range []float64{123730, 103774, 107765, 123731} {
		got := phieuDien(tien, "3000")
		if got.ElectricCharge != int(tien) {
			t.Fatalf("tiền điện = %d, phải = %d", got.ElectricCharge, int(tien))
		}
		nhanNguoc := math.Round(got.ElectricKwh * 3000)
		if nhanNguoc != tien {
			t.Errorf("%v kWh × 3.000 = %v, phải = %v (lệch %v đồng)",
				got.ElectricKwh, nhanNguoc, tien, nhanNguoc-tien)
		}
	}
}

func TestSoKwh_KhongLamTronVeSoNguyen(t *testing.T) {
	got := phieuDien(123730, "3000")
	if got.ElectricKwh == math.Trunc(got.ElectricKwh) {
		t.Errorf("kWh = %v — số nguyên tròn trĩnh nghĩa là vẫn đang bị làm tròn", got.ElectricKwh)
	}
	// 123730/3000 = 41,243333... -> giữ 4 số lẻ.
	if math.Abs(got.ElectricKwh-41.2433) > 1e-9 {
		t.Errorf("kWh = %v, phải = 41.2433", got.ElectricKwh)
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
