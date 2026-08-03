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
	ID                 int
	CheckInDate        string // "" = chưa có
	CheckOutDate       string // "" = chưa có
	RentalType         string // "phong" = thuê nguyên phòng; còn lại = ghép
	DepositStatus      string // "none" = chưa đóng cọc; "held" = đang giữ; "refunded" = đã trả
	RoomFeeDiscountPct float64
	UsesWashing        bool
	UsesParking        bool
	// Giảm % từng khoản, [0..100].
	WaterDiscountPct    float64
	ElectricDiscountPct float64
	ServiceDiscountPct  float64
	WashingDiscountPct  float64
	ParkingDiscountPct  float64
}

// kepPct: kẹp % giảm vào [0..100].
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
	// RoomType: 'shared' | 'whole' | 'security' | 'staff'. Rỗng = coi như 'shared'.
	RoomType string
}

// MienTienPhong: phòng an ninh / phòng nhân viên không thu tiền phòng (các khoản khác vẫn thu).
func MienTienPhong(roomType string) bool {
	return roomType == "security" || roomType == "staff"
}

// NguyenPhong: phòng cho thuê TRỌN. Mọi khoản chung dồn về một hoá đơn đứng tên phòng trưởng —
// tiền phòng theo hạng thu MỘT lần cho cả phòng, trọn tiền điện công-tơ, nước và dịch vụ nhân theo
// tổng suất-người. Thành viên còn lại chỉ còn phí cá nhân (máy giặt, gửi xe).
type NguyenPhong struct {
	DungHoaDon  bool    // người này là người ký hợp đồng — phòng trưởng, người đứng phiếu
	SuatNguoi   float64 // Σ hệ số ngày ở của MỌI người trong phòng tháng đó (nước, dịch vụ)
	SuatMayGiat float64 // Σ hệ số ngày của những người dùng máy giặt
	SuatXe      float64 // Σ (số xe × hệ số ngày) của cả phòng
}

// ComputeInput gói tham số cho ComputeInvoice (opts của server/billing.js:158).
type ComputeInput struct {
	NguyenPhong    *NguyenPhong // nil = thuê ghép (mỗi người một hoá đơn như cũ)
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
	ElectricKwh    float64 `json:"electric_kwh"`
	ElectricCharge int `json:"electric_charge"`
	WaterCharge    int `json:"water_charge"`
	ServiceCharge  int `json:"service_charge"`
	WashingCharge  int `json:"washing_charge"`
	ParkingCharge  int `json:"parking_charge"`
	LeaderDiscount int `json:"leader_discount"`
	RoomDiscount   int `json:"room_discount"`
	// FeeDiscount: tổng giảm % của các khoản ngoài tiền phòng (nước/điện/dịch vụ/máy giặt/xe).
	FeeDiscount int `json:"fee_discount"`
	OtherCharge int `json:"other_charge"`
	// DepositCharge: tiền cọc thu kèm phiếu kỳ nhận phòng. Khoản một lần, không chia theo ngày ở.
	DepositCharge int `json:"deposit_charge"`
	Total         int `json:"total"`
}

// TienCoc: cọc chỉ lên phiếu của KỲ NHẬN PHÒNG và chỉ khi hồ sơ còn ghi chưa đóng (chốt 02/08/2026).
// Mức cọc bám theo thứ người ta thuê: thuê ghép cọc một suất người; thuê nguyên phòng thì người ký
// hợp đồng cọc TRỌN GIÁ PHÒNG, thành viên ở cùng không cọc riêng vì họ không đứng hợp đồng nào.
func TienCoc(st Student, month string, fees Fees, room *Room, np *NguyenPhong) int {
	if st.DepositStatus != "none" || len(st.CheckInDate) < 7 || st.CheckInDate[:7] != month {
		return 0
	}
	if np != nil && !np.DungHoaDon {
		return 0
	}
	if np != nil || st.RentalType == "phong" {
		// Phòng an ninh / nhân viên không thu tiền phòng thì cũng không có gì để cọc trọn giá phòng.
		if room != nil && MienTienPhong(room.RoomType) {
			return 0
		}
		hang := ""
		if room != nil {
			hang = room.Hang
		}
		return r0(RoomPriceByHang(hang, fees))
	}
	return r0(fees.num("deposit_fee"))
}

// ComputeInvoice: server/billing.js:158-229
func ComputeInvoice(in ComputeInput) Invoice {
	dim := DaysInMonth(in.Month)
	days := DaysStayedInMonth(in.Student.CheckInDate, in.Student.CheckOutDate, in.Month)
	fees := in.Fees

	// Thuê nguyên phòng: chỉ người đứng hoá đơn mới gánh khoản chung, người khác về 0.
	nguyenPhong := in.NguyenPhong != nil
	thanhVien := nguyenPhong && !in.NguyenPhong.DungHoaDon

	// Tiền phòng
	var roomFee float64
	if thanhVien {
		roomFee = 0
	} else if in.Room != nil && MienTienPhong(in.Room.RoomType) {
		roomFee = 0
	} else if nguyenPhong || in.Student.RentalType == "phong" {
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
	// Nguyên phòng: người đứng hoá đơn trả nước+dịch vụ cho CẢ phòng (Σ suất-người theo ngày ở);
	// thành viên về 0 vì đã nằm trong hoá đơn đó rồi.
	suat := fFactor
	if nguyenPhong {
		suat = in.NguyenPhong.SuatNguoi
		if thanhVien {
			suat = 0
		}
	}
	waterCharge := r0(fees.num("water_fee") * suat)
	serviceCharge := r0(fees.num("service_fee") * suat)
	// Nguyên phòng: máy giặt và gửi xe của MỌI người cũng dồn vào phiếu của phòng trưởng.
	washingCharge := 0
	parkingCharge := 0
	if thanhVien {
		// để 0 — đã nằm trong phiếu phòng trưởng
	} else if nguyenPhong {
		washingCharge = r0(fees.num("washing_fee") * in.NguyenPhong.SuatMayGiat)
		parkingCharge = r0(fees.num("parking_fee") * in.NguyenPhong.SuatXe)
	} else {
		if in.Student.UsesWashing {
			washingCharge = r0(fees.num("washing_fee") * fFactor)
		}
		nVehicles := 0
		if in.VehicleCount != nil {
			nVehicles = *in.VehicleCount
		} else if in.Student.UsesParking {
			nVehicles = 1
		}
		parkingCharge = r0(fees.num("parking_fee") * float64(nVehicles) * fFactor)
	}

	// Điện
	unit := fees.num("electric_unit")
	roomElectric := float64(r0(in.Kwh * unit))
	var electricCharge int
	if thanhVien {
		electricCharge = 0
	} else if nguyenPhong {
		electricCharge = r0(roomElectric) // trọn công-tơ của phòng, không chia đầu người
	} else if in.ElectricCharge != nil {
		electricCharge = r0(*in.ElectricCharge)
	} else if len(in.Roster) > 0 {
		share := SplitElectricByDays(roomElectric, in.Roster)
		electricCharge = share[in.Student.ID]
	} else if in.Occupants > 0 {
		electricCharge = r0(roomElectric / float64(in.Occupants))
	} else {
		electricCharge = 0
	}

	st := in.Student
	feeDiscount := giamTheoPct(waterCharge, st.WaterDiscountPct) +
		giamTheoPct(electricCharge, st.ElectricDiscountPct) +
		giamTheoPct(serviceCharge, st.ServiceDiscountPct) +
		giamTheoPct(washingCharge, st.WashingDiscountPct) +
		giamTheoPct(parkingCharge, st.ParkingDiscountPct)

	// Giảm phòng trưởng tính trên nước+dịch vụ CÒN LẠI sau khi đã trừ giảm % (tránh trừ hai lần).
	waterConLai := waterCharge - giamTheoPct(waterCharge, st.WaterDiscountPct)
	serviceConLai := serviceCharge - giamTheoPct(serviceCharge, st.ServiceDiscountPct)
	if nguyenPhong {
		// Hoá đơn này gánh nước+dịch vụ của CẢ phòng. Miễn theo tổng là xoá sạch phần của mọi
		// người — chỉ miễn ĐÚNG MỘT SUẤT của bản thân phòng trưởng.
		motSuat := func(tong int, heSo float64) int {
			if suat <= 0 {
				return 0
			}
			return r0((float64(tong) * heSo) / suat)
		}
		waterConLai = motSuat(waterConLai, fFactor)
		serviceConLai = motSuat(serviceConLai, fFactor)
	}
	leaderDiscount := LeaderDiscount(in.LeaderDays, days, waterConLai, serviceConLai)

	depositCharge := TienCoc(st, in.Month, fees, in.Room, in.NguyenPhong)
	total := InvoiceTotal(map[string]float64{
		"room_charge": float64(roomCharge), "electric_charge": float64(electricCharge),
		"water_charge": float64(waterCharge), "service_charge": float64(serviceCharge),
		"washing_charge": float64(washingCharge), "parking_charge": float64(parkingCharge),
		"deposit_charge":  float64(depositCharge),
		"leader_discount": float64(leaderDiscount), "room_discount": float64(roomDiscount),
		"fee_discount": float64(feeDiscount),
	})

	// Số kWh suy từ chính số tiền phải trả, giữ ĐÚNG 2 SỐ LẺ — hệ thống tài chính bên đối tác chỉ
	// nhận tới 2 số lẻ, ghi nhiều hơn là hai bên lệch nhau ở con số kWh.
	electricKwh := 0.0
	if unit > 0 {
		electricKwh = math.Round(float64(electricCharge)/unit*100) / 100
	}

	return Invoice{
		DaysStayed: days, RoomCharge: roomCharge, ElectricKwh: electricKwh,
		ElectricCharge: electricCharge, WaterCharge: waterCharge, ServiceCharge: serviceCharge,
		WashingCharge: washingCharge, ParkingCharge: parkingCharge,
		LeaderDiscount: leaderDiscount, RoomDiscount: roomDiscount, FeeDiscount: feeDiscount,
		OtherCharge: 0, DepositCharge: depositCharge, Total: total,
	}
}

// InvoiceTotal: Σ các khoản thu − các khoản giảm. server/billing.js:7-11
var invoiceFeeFields = []string{"room_charge", "electric_charge", "water_charge", "service_charge", "washing_charge", "parking_charge", "other_charge", "deposit_charge"}

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
