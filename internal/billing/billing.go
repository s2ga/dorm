// Package billing — bộ tính tiền THUẦN, port 1:1 từ server/billing.js.
// Nguyên tắc parity: mọi phép tiền dùng float64 rồi làm tròn bằng r0 = Floor(x+0.5) để KHỚP JS Math.round
// (Go math.Round làm tròn .5 ra xa 0 -> lệch ở số âm). Chia điện dùng "phần dư lớn nhất" giữ tổng khớp tuyệt đối.
package billing

import (
	"math"
	"sort"
	"time"
)

// r0 = Math.round của JS (làm tròn .5 LÊN, về phía +∞). server/billing.js:59
func r0(n float64) int { return int(math.Floor(n + 0.5)) }

// ----- Ngày tháng (khớp new Date(...) của Node cho input 'YYYY-MM-DD') -----

func parseYMD(s string) (time.Time, bool) {
	t, err := time.ParseInLocation("2006-01-02", s, time.UTC)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// DaysInMonth: số ngày trong tháng "YYYY-MM". server/billing.js:13-16
func DaysInMonth(month string) int {
	y, m, ok := splitMonth(month)
	if !ok {
		return 0
	}
	// day 0 của (m+1) = ngày cuối tháng m
	return time.Date(y, time.Month(m)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func splitMonth(month string) (year, mon int, ok bool) {
	t, err := time.ParseInLocation("2006-01", month, time.UTC)
	if err != nil {
		return 0, 0, false
	}
	return t.Year(), int(t.Month()), true
}

func FirstDay(month string) string { return month + "-01" }

// LastDay: "YYYY-MM-DD" ngày cuối tháng. server/billing.js:18-22
func LastDay(month string) string {
	d := DaysInMonth(month)
	return month + "-" + pad2(d)
}

func pad2(n int) string {
	if n < 10 {
		return "0" + string(rune('0'+n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

// diffDaysInclusive: số ngày [a..b] tính cả 2 đầu. server/billing.js:23-25
func diffDaysInclusive(a, b string) int {
	ta, oka := parseYMD(a)
	tb, okb := parseYMD(b)
	if !oka || !okb {
		return 0
	}
	days := int(math.Round(tb.Sub(ta).Hours()/24)) + 1
	if days < 0 {
		return 0
	}
	return days
}

// AddDays: "YYYY-MM-DD" cộng n ngày. server/billing.js:26-30
func AddDays(ymd string, n int) string {
	t, ok := parseYMD(ymd)
	if !ok {
		return ymd
	}
	return t.AddDate(0, 0, n).Format("2006-01-02")
}

// ----- Học viên & số ngày ở -----

type Student struct {
	ID                int
	CheckInDate       string // "" = chưa có
	CheckOutDate      string // "" = chưa có
	RentalType        string // "phong" = thuê nguyên phòng; còn lại = ghép
	RoomFeeDiscountPct float64
	UsesWashing       bool
	UsesParking       bool
	// Giảm % cho TỪNG khoản (owner chốt 30/07/2026). Công thức tính tiền không đổi — mấy ô này chỉ
	// điều chỉnh BÊN TRÊN kết quả công thức, và ghi thành dòng giảm riêng trên phiếu.
	// Mở ô thay vì viết luật cứng: các ca miễn/giảm là số ít và hay đổi (phòng nhân viên miễn tiền
	// phòng, ai đó được miễn tiền nước...), sửa dữ liệu nhanh hơn sửa app rồi deploy lại.
	WaterDiscountPct    float64
	ElectricDiscountPct float64
	ServiceDiscountPct  float64
	WashingDiscountPct  float64
	ParkingDiscountPct  float64
}

// kepPct: kẹp % giảm vào [0..100]. Dữ liệu ngoài khoảng đó là rác, không phải ý đồ.
func kepPct(p float64) float64 {
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}

// giamTheoPct: số tiền giảm của một khoản.
func giamTheoPct(charge int, pct float64) int { return r0((float64(charge) * kepPct(pct)) / 100) }

// DaysStayedInRange: số ngày ở thực tế trong [from..to] (cả 2 đầu). server/billing.js:33-40
func DaysStayedInRange(ci, co, from, to string) int {
	if ci != "" && ci > to {
		return 0
	}
	if co != "" && co < from {
		return 0
	}
	inD := from
	if ci != "" && ci > from {
		inD = ci
	}
	outD := to
	if co != "" && co < to {
		outD = co
	}
	return diffDaysInclusive(inD, outD)
}

// DaysStayedInMonth. server/billing.js:43-45
func DaysStayedInMonth(ci, co, month string) int {
	return DaysStayedInRange(ci, co, FirstDay(month), LastDay(month))
}

// PartialFactor: hệ số phí cố định khi ở tháng lẻ (0 / half / 1). server/billing.js:52-57
func PartialFactor(days, dim int, halfMin, fullMin int, halfFactor float64) float64 {
	if days >= dim {
		return 1
	}
	if days > fullMin {
		return 1
	}
	if days > halfMin {
		if !math.IsInf(halfFactor, 0) && !math.IsNaN(halfFactor) {
			return halfFactor
		}
		return 0.5
	}
	return 0
}

// ----- Chia tiền điện (phần dư lớn nhất) -----

type RosterEntry struct {
	StudentID int
	Days      int
}

type Segment struct {
	Electric float64 // tiền điện CHÍNH XÁC (chưa làm tròn) của chặng
	Roster   []RosterEntry
}

// SplitElectricExact: chia tiền điện theo từng chặng, làm tròn 1 lần cuối theo phần dư lớn nhất
// -> tổng các phần khớp TUYỆT ĐỐI. server/billing.js:83-102
func SplitElectricExact(segments []Segment) map[int]int {
	exact := map[int]float64{}
	order := []int{} // giữ thứ tự xuất hiện để cộng float đúng thứ tự như JS
	var totalExact float64
	for _, seg := range segments {
		list := make([]RosterEntry, 0, len(seg.Roster))
		totalDays := 0
		for _, r := range seg.Roster {
			if r.Days > 0 {
				list = append(list, r)
				totalDays += r.Days
			}
		}
		if !(seg.Electric > 0) || totalDays <= 0 {
			continue
		}
		totalExact += seg.Electric
		for _, r := range list {
			if _, seen := exact[r.StudentID]; !seen {
				order = append(order, r.StudentID)
			}
			exact[r.StudentID] += (seg.Electric * float64(r.Days)) / float64(totalDays)
		}
	}
	type part struct {
		id   int
		base int
		frac float64
	}
	// JS Object.keys với key số -> thứ tự TĂNG DẦN theo id; tái lập bằng cách sort ids tăng dần.
	ids := make([]int, len(order))
	copy(ids, order)
	sort.Ints(ids)
	parts := make([]part, 0, len(ids))
	sumBase := 0
	for _, id := range ids {
		base := int(math.Floor(exact[id]))
		parts = append(parts, part{id: id, base: base, frac: exact[id] - float64(base)})
		sumBase += base
	}
	rem := r0(totalExact) - sumBase
	// tie-break: frac giảm dần, rồi id tăng dần
	sorted := make([]part, len(parts))
	copy(sorted, parts)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].frac != sorted[j].frac {
			return sorted[i].frac > sorted[j].frac
		}
		return sorted[i].id < sorted[j].id
	})
	add := map[int]int{}
	for i := range sorted {
		if rem > 0 {
			add[sorted[i].id] = 1
			rem--
		}
	}
	out := map[int]int{}
	for _, p := range parts {
		out[p.id] = p.base + add[p.id]
	}
	return out
}

// SplitElectricByDays: cả tháng là 1 chặng, bảo đảm mọi id trong roster đều có mặt (0 nếu thiếu).
// server/billing.js:68-72
func SplitElectricByDays(roomElectric float64, roster []RosterEntry) map[int]int {
	out := SplitElectricExact([]Segment{{Electric: roomElectric, Roster: roster}})
	for _, r := range roster {
		if _, ok := out[r.StudentID]; !ok {
			out[r.StudentID] = 0
		}
	}
	return out
}

// ----- Cắt chặng theo lần chốt công-tơ -----

type MeterRead struct {
	Date    string
	Reading float64
}

type Stay struct {
	StudentID int
	From      string
	To        string // "" = còn ở
}

type BuiltSegment struct {
	From     string
	To       string
	Kwh      float64
	Roster   []RosterEntry
	Fellback bool
}

// BuildSegments: cắt tháng thành các chặng theo lần chốt giữa kỳ. server/billing.js:110-144
func BuildSegments(month string, startReading, endReading float64, reads []MeterRead, stays []Stay) []BuiltSegment {
	mStart, mEnd := FirstDay(month), LastDay(month)
	start, end := startReading, endReading

	// lần chốt NẰM TRONG tháng và TRƯỚC ngày cuối; trùng ngày -> lấy lần sau cùng
	type mid struct {
		date    string
		reading float64
	}
	var mids []mid
	for _, r := range reads {
		date := r.Date
		if len(date) > 10 {
			date = date[:10]
		}
		if date < mStart || date >= mEnd {
			continue
		}
		idx := -1
		for i := range mids {
			if mids[i].date == date {
				idx = i
				break
			}
		}
		if idx >= 0 {
			mids[idx] = mid{date, r.Reading}
		} else {
			mids = append(mids, mid{date, r.Reading})
		}
	}
	sort.SliceStable(mids, func(i, j int) bool { return mids[i].date < mids[j].date })

	roster := func(from, to string) []RosterEntry {
		acc := []RosterEntry{}
		idxOf := map[int]int{}
		for _, s := range stays {
			d := DaysStayedInRange(s.From, s.To, from, to)
			if d <= 0 {
				continue
			}
			if i, ok := idxOf[s.StudentID]; ok {
				acc[i].Days += d
			} else {
				idxOf[s.StudentID] = len(acc)
				acc = append(acc, RosterEntry{StudentID: s.StudentID, Days: d})
			}
		}
		return acc
	}

	points := append(append([]mid{}, mids...), mid{date: mEnd, reading: end})
	var segs []BuiltSegment
	prev := start
	from := mStart
	for _, p := range points {
		segs = append(segs, BuiltSegment{From: from, To: p.date, Kwh: p.reading - prev, Roster: roster(from, p.date)})
		prev = p.reading
		from = AddDays(p.date, 1)
	}

	// chỉ số phải tăng dần; mâu thuẫn -> quay về chia cả tháng 1 chặng
	var sumKwh float64
	bad := false
	for _, s := range segs {
		if s.Kwh < 0 {
			bad = true
		}
		sumKwh += s.Kwh
	}
	if math.Abs(sumKwh-(end-start)) > 0.05 {
		bad = true
	}
	if bad {
		return []BuiltSegment{{From: mStart, To: mEnd, Kwh: end - start, Roster: roster(mStart, mEnd), Fellback: true}}
	}
	out := segs[:0]
	for _, s := range segs {
		if s.From <= s.To {
			out = append(out, s)
		}
	}
	return out
}

// ----- Tính 1 hóa đơn -----

// Fees: bảng cài đặt dạng chuỗi -> số, giống Node dùng Number(fees[...]).
type Fees map[string]string

func (f Fees) num(key string) float64 { return numStr(f[key]) }

// Num: đọc giá trị số của một khoá cài đặt (public, cho các package khác dùng).
func (f Fees) Num(key string) float64 { return numStr(f[key]) }

// RoomPriceByHang. server/billing.js:147-149
func RoomPriceByHang(hang string, fees Fees) float64 {
	if hang == "" {
		hang = "B"
	}
	if v, ok := fees["room_price_"+hang]; ok && v != "" {
		return numStr(v)
	}
	return fees.num("room_fee")
}

type Room struct {
	Hang       string
	MonthlyFee float64
}

// ComputeInput gói tham số cho ComputeInvoice (opts của server/billing.js:158).
type ComputeInput struct {
	Student        Student
	Room           *Room
	Month          string
	Fees           Fees
	Occupants      int
	Roster         []RosterEntry
	ElectricCharge *float64 // nil = chưa tính sẵn
	LeaderDays     int
	Kwh            float64
	VehicleCount   *int // nil = suy theo uses_parking
}

// Invoice: kết quả tính, tên field khớp cột hoá đơn (JSON number).
type Invoice struct {
	DaysStayed     int `json:"days_stayed"`
	RoomCharge     int `json:"room_charge"`
	ElectricKwh    int `json:"electric_kwh"`
	ElectricCharge int `json:"electric_charge"`
	WaterCharge    int `json:"water_charge"`
	ServiceCharge  int `json:"service_charge"`
	WashingCharge  int `json:"washing_charge"`
	ParkingCharge  int `json:"parking_charge"`
	LeaderDiscount int `json:"leader_discount"`
	RoomDiscount   int `json:"room_discount"`
	// FeeDiscount: tổng phần giảm % của các khoản NGOÀI tiền phòng (nước/điện/dịch vụ/máy giặt/xe).
	// Ghi thành một dòng riêng, không âm thầm hạ từng khoản xuống — cùng nguyên tắc với room_discount.
	FeeDiscount int `json:"fee_discount"`
	OtherCharge    int `json:"other_charge"`
	Total          int `json:"total"`
}

// ComputeInvoice: server/billing.js:158-229
func ComputeInvoice(in ComputeInput) Invoice {
	dim := DaysInMonth(in.Month)
	days := DaysStayedInMonth(in.Student.CheckInDate, in.Student.CheckOutDate, in.Month)
	fees := in.Fees

	// Tiền phòng
	var roomFee float64
	if in.Student.RentalType == "phong" {
		hang := ""
		if in.Room != nil {
			hang = in.Room.Hang
		}
		roomFee = RoomPriceByHang(hang, fees)
	} else {
		if in.Room != nil && in.Room.MonthlyFee > 0 {
			roomFee = in.Room.MonthlyFee
		} else {
			roomFee = fees.num("room_fee")
		}
	}
	roomCharge := r0((roomFee / float64(dim)) * float64(days))

	// Giảm tiền phòng theo % của HV
	pct := in.Student.RoomFeeDiscountPct
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	roomDiscount := r0((float64(roomCharge) * pct) / 100)

	// Hệ số phí cố định
	halfFactor := 0.5
	if v, ok := fees["partial_half_factor"]; ok && v != "" {
		halfFactor = numStr(v)
	}
	fFactor := PartialFactor(days, dim, int(fees.num("partial_half_min")), int(fees.num("partial_full_min")), halfFactor)
	waterCharge := r0(fees.num("water_fee") * fFactor)
	serviceCharge := r0(fees.num("service_fee") * fFactor)
	washingCharge := 0
	if in.Student.UsesWashing {
		washingCharge = r0(fees.num("washing_fee") * fFactor)
	}
	nVehicles := 0
	if in.VehicleCount != nil {
		nVehicles = *in.VehicleCount
	} else if in.Student.UsesParking {
		nVehicles = 1
	}
	parkingCharge := r0(fees.num("parking_fee") * float64(nVehicles) * fFactor)

	// Điện
	unit := fees.num("electric_unit")
	roomElectric := float64(r0(in.Kwh * unit))
	var electricCharge int
	if in.ElectricCharge != nil {
		electricCharge = r0(*in.ElectricCharge)
	} else if len(in.Roster) > 0 {
		share := SplitElectricByDays(roomElectric, in.Roster)
		electricCharge = share[in.Student.ID]
	} else if in.Occupants > 0 {
		electricCharge = r0(roomElectric / float64(in.Occupants))
	} else {
		electricCharge = 0
	}

	// Giảm % từng khoản (ngoài tiền phòng — tiền phòng đã có room_discount ở trên).
	st := in.Student
	feeDiscount := giamTheoPct(waterCharge, st.WaterDiscountPct) +
		giamTheoPct(electricCharge, st.ElectricDiscountPct) +
		giamTheoPct(serviceCharge, st.ServiceDiscountPct) +
		giamTheoPct(washingCharge, st.WashingDiscountPct) +
		giamTheoPct(parkingCharge, st.ParkingDiscountPct)

	// Giảm cho phòng trưởng tính trên phần nước+dịch vụ CÒN LẠI sau khi đã giảm %. Nếu tính trên số
	// gốc thì người vừa được miễn 100% tiền nước lại được giảm thêm lần nữa cho đúng số tiền đó —
	// tổng phiếu âm, và ck_invoices_no_negative sẽ chặn ngay lúc lưu.
	waterConLai := waterCharge - giamTheoPct(waterCharge, st.WaterDiscountPct)
	serviceConLai := serviceCharge - giamTheoPct(serviceCharge, st.ServiceDiscountPct)
	leaderDiscount := LeaderDiscount(in.LeaderDays, days, waterConLai, serviceConLai)

	total := InvoiceTotal(map[string]float64{
		"room_charge": float64(roomCharge), "electric_charge": float64(electricCharge),
		"water_charge": float64(waterCharge), "service_charge": float64(serviceCharge),
		"washing_charge": float64(washingCharge), "parking_charge": float64(parkingCharge),
		"leader_discount": float64(leaderDiscount), "room_discount": float64(roomDiscount),
		"fee_discount": float64(feeDiscount),
	})

	electricKwh := 0
	if unit > 0 {
		electricKwh = r0(float64(electricCharge) / unit)
	}

	return Invoice{
		DaysStayed: days, RoomCharge: roomCharge, ElectricKwh: electricKwh,
		ElectricCharge: electricCharge, WaterCharge: waterCharge, ServiceCharge: serviceCharge,
		WashingCharge: washingCharge, ParkingCharge: parkingCharge,
		LeaderDiscount: leaderDiscount, RoomDiscount: roomDiscount, FeeDiscount: feeDiscount,
		OtherCharge: 0, Total: total,
	}
}

// InvoiceTotal: Σ 7 phí − các khoản giảm. server/billing.js:7-11
var invoiceFeeFields = []string{"room_charge", "electric_charge", "water_charge", "service_charge", "washing_charge", "parking_charge", "other_charge"}

func InvoiceTotal(f map[string]float64) int {
	var fee float64
	for _, k := range invoiceFeeFields {
		fee += f[k]
	}
	return r0(fee - f["leader_discount"] - f["room_discount"] - f["fee_discount"])
}

// LeaderDiscount: (nước+dịch vụ) × ngàyLàmTrưởng/ngàyỞ, kẹp leaderDays ≤ days. server/billing.js:240-244
func LeaderDiscount(leaderDays, days, waterCharge, serviceCharge int) int {
	ld := leaderDays
	if ld > days {
		ld = days
	}
	if ld <= 0 || days <= 0 {
		return 0
	}
	return r0((float64(waterCharge+serviceCharge) * float64(ld)) / float64(days))
}

// DepositRefund: điều kiện hoàn cọc. server/billing.js:251-258
type DepositRefund struct {
	Eligible bool
	Reason   string
}

func DepositRefundEligible(noticeDate, checkoutDate, reason string, minDays int) DepositRefund {
	minD := 30
	if minDays > 0 {
		minD = minDays
	}
	if reason == "departure" {
		return DepositRefund{true, "Xuất cảnh đi Nhật — hoàn cọc"}
	}
	if noticeDate == "" || checkoutDate == "" {
		return DepositRefund{false, "Chưa có ngày báo trả phòng"}
	}
	tc, okc := parseYMD(checkoutDate)
	tn, okn := parseYMD(noticeDate)
	if !okc || !okn {
		return DepositRefund{false, "Chưa có ngày báo trả phòng"}
	}
	noticeDays := int(math.Round(tc.Sub(tn).Hours() / 24))
	if noticeDays >= minD {
		return DepositRefund{true, sprintfNotice(noticeDays, minD)}
	}
	return DepositRefund{false, sprintfNoticeShort(noticeDays, minD)}
}

// LiveStatus: trạng thái theo ngày. server/billing.js:261-267
func LiveStatus(ci, co, today string) string {
	if co != "" && co <= today {
		return "left"
	}
	if ci != "" && ci > today {
		return "upcoming"
	}
	if co != "" && co > today {
		return "leaving"
	}
	return "staying"
}

// IsOccupying: đang chiếm giường. server/billing.js:269
func IsOccupying(ci, co, today string) bool {
	st := LiveStatus(ci, co, today)
	return st == "staying" || st == "leaving"
}
