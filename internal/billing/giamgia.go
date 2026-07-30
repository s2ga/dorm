package billing

// Giảm giá % theo TỪNG khoản — owner chốt 30/07/2026.
//
// Vì sao gom vào một kiểu riêng: có BỐN đường khác nhau cùng tính tiền cho một học viên (lập phiếu
// hàng loạt · lập một phiếu · tính lại/xem trước · lập phiếu lúc trả phòng). Mỗi đường tự đọc từng
// cột rồi tự gán là kiểu gì cũng có ngày sót một chỗ, và sót thì CÙNG MỘT NGƯỜI ra hai số tiền khác
// nhau tuỳ bấm nút nào — loại lỗi tiền tệ nhất vì không ai biết số nào đúng.
//
// Cách dùng: thêm CotSQL vào câu SELECT, scan vào 5 con trỏ của Ptr(), rồi gọi GanVao(&student).

// GiamPct: 5 mức giảm % ngoài tiền phòng (tiền phòng đã có room_fee_discount_pct riêng từ trước).
type GiamPct struct {
	Water, Electric, Service, Washing, Parking *float64
}

// CotSQL: đoạn cột thêm vào SELECT students. Giữ ĐÚNG thứ tự với Ptr().
const CotSQL = "water_discount_pct, electric_discount_pct, service_discount_pct, washing_discount_pct, parking_discount_pct"

// Ptr: danh sách đích để Scan, đúng thứ tự CotSQL.
func (g *GiamPct) Ptr() []interface{} {
	return []interface{}{&g.Water, &g.Electric, &g.Service, &g.Washing, &g.Parking}
}

func val(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// GanVao: nhồi 5 mức giảm vào Student trước khi gọi ComputeInvoice.
func (g GiamPct) GanVao(s *Student) {
	s.WaterDiscountPct = val(g.Water)
	s.ElectricDiscountPct = val(g.Electric)
	s.ServiceDiscountPct = val(g.Service)
	s.WashingDiscountPct = val(g.Washing)
	s.ParkingDiscountPct = val(g.Parking)
}
