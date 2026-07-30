package billing

// GiamPct: 5 mức giảm % ngoài tiền phòng, đọc từ students.
// Dùng: thêm CotSQL vào SELECT, scan vào Ptr(), rồi GanVao(&student).
type GiamPct struct {
	Water, Electric, Service, Washing, Parking *float64
}

// CotSQL: đoạn cột thêm vào SELECT students. Thứ tự phải khớp Ptr().
const CotSQL = "water_discount_pct, electric_discount_pct, service_discount_pct, washing_discount_pct, parking_discount_pct"

// Ptr: đích để Scan, đúng thứ tự CotSQL.
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
