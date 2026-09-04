package billing

import "testing"

// Giảm % theo từng khoản: trừ bên trên kết quả công thức, ghi thành dòng giảm riêng.

func feesG() Fees {
	return Fees{
		"room_fee": "1200000", "room_price_B": "4800000",
		"water_fee": "100000", "service_fee": "50000", "electric_unit": "3000",
		"washing_fee": "70000", "parking_fee": "100000",
		"partial_half_min": "10", "partial_full_min": "15", "partial_half_factor": "0.5",
	}
}

// Ở trọn tháng 7/2026 -> hệ số phí cố định = 1, số tròn dễ đối chiếu.
// Gốc: phòng 1.200.000 · nước 100.000 · dịch vụ 50.000 · điện 300.000 · giặt 70.000 · xe 100.000.
func inG(s Student) ComputeInput {
	s.ID = 1
	s.CheckInDate = "2026-07-01"
	s.UsesWashing = true
	s.UsesParking = true
	veh := 1
	return ComputeInput{Student: s, Room: &Room{Hang: "B"}, Month: "2026-07",
		Fees: feesG(), Occupants: 1, Kwh: 100, VehicleCount: &veh}
}

func TestGiamPct_KhongDatGiThiKhongDoiGi(t *testing.T) {
	got := ComputeInvoice(inG(Student{}))
	if got.FeeDiscount != 0 || got.RoomDiscount != 0 {
		t.Fatalf("không đặt phần trăm nào mà vẫn có giảm: fee=%d room=%d", got.FeeDiscount, got.RoomDiscount)
	}
	if got.Total != 1820000 {
		t.Errorf("tổng = %d, phải = 1820000 (1.2tr+100k+50k+300k+70k+100k)", got.Total)
	}
}

func TestGiamPct_TungKhoanTruDungSo(t *testing.T) {
	// Miễn 100% tiền phòng nhưng vẫn thu hết phần còn lại — đúng ca phòng nhân viên.
	got := ComputeInvoice(inG(Student{RoomFeeDiscountPct: 100}))
	if got.RoomDiscount != 1200000 {
		t.Errorf("giảm tiền phòng = %d, phải = 1200000", got.RoomDiscount)
	}
	if got.RoomCharge != 1200000 {
		t.Errorf("phiếu phải VẪN ghi tiền phòng đủ (%d), giảm nằm ở dòng riêng", got.RoomCharge)
	}
	if got.Total != 620000 {
		t.Errorf("tổng = %d, phải = 620000 (100k+50k+300k+70k+100k)", got.Total)
	}

	// Giảm 50% nước + 100% điện: 50.000 + 300.000 = 350.000 vào dòng "giảm các khoản khác".
	got = ComputeInvoice(inG(Student{WaterDiscountPct: 50, ElectricDiscountPct: 100}))
	if got.FeeDiscount != 350000 {
		t.Errorf("giảm khoản khác = %d, phải = 350000", got.FeeDiscount)
	}
	if got.WaterCharge != 100000 || got.ElectricCharge != 300000 {
		t.Errorf("không được âm thầm hạ từng khoản: nước=%d điện=%d", got.WaterCharge, got.ElectricCharge)
	}
	if got.Total != 1470000 {
		t.Errorf("tổng = %d, phải = 1470000 (1.82tr − 350k)", got.Total)
	}

	// Giặt + xe cũng giảm được.
	got = ComputeInvoice(inG(Student{WashingDiscountPct: 100, ParkingDiscountPct: 100, ServiceDiscountPct: 100}))
	if got.FeeDiscount != 220000 {
		t.Errorf("giảm khoản khác = %d, phải = 220000 (70k+100k+50k)", got.FeeDiscount)
	}
}

func TestGiamPct_KepNgoaiKhoang(t *testing.T) {
	// Dữ liệu rác (âm / >100) không được biến thành ưu đãi hay phụ phí.
	if got := ComputeInvoice(inG(Student{WaterDiscountPct: -50})); got.FeeDiscount != 0 {
		t.Errorf("phần trăm ÂM phải kẹp về 0, đang giảm %d", got.FeeDiscount)
	}
	if got := ComputeInvoice(inG(Student{WaterDiscountPct: 500})); got.FeeDiscount != 100000 {
		t.Errorf("phần trăm quá 100 phải kẹp về 100 (giảm 100000), đang giảm %d", got.FeeDiscount)
	}
}

// Phòng trưởng đã được giảm % nước/dịch vụ -> phần giảm phòng trưởng tính trên số còn lại.
func TestGiamPct_KhongGiamHaiLanVoiPhongTruong(t *testing.T) {
	in := inG(Student{WaterDiscountPct: 100, ServiceDiscountPct: 100})
	in.LeaderDays = 31
	got := ComputeInvoice(in)
	if got.LeaderDiscount != 0 {
		t.Errorf("giảm phòng trưởng = %d, phải = 0 (nước+dịch vụ đã miễn hết)", got.LeaderDiscount)
	}
	if got.Total < 0 {
		t.Fatalf("tổng ÂM (%d) — giảm hai lần cùng một đồng", got.Total)
	}
	if got.Total != 1670000 {
		t.Errorf("tổng = %d, phải = 1670000 (1.82tr − 150k)", got.Total)
	}
}
