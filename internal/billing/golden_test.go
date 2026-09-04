package billing

import (
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"testing"
)

// Test parity: đọc golden fixtures do server/billing.js sinh (tests/golden/billing_golden.json),
// chạy billing.go trên CÙNG input, khẳng định KHỚP TUYỆT ĐỐI. Sinh lại fixtures:
//   ./.runtime/node/node.exe tests/golden/gen_billing_golden.js tests/golden/billing_golden.json

const goldenPath = "../../tests/golden/billing_golden.json"

type rosterDTO struct {
	StudentID int `json:"student_id"`
	Days      int `json:"days"`
}

func toRoster(in []rosterDTO) []RosterEntry {
	out := make([]RosterEntry, len(in))
	for i, r := range in {
		out[i] = RosterEntry{StudentID: r.StudentID, Days: r.Days}
	}
	return out
}

func strOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// jsNumberOr0 mô phỏng Number(x)||0 (nơi Go thật hiện coercion là tầng handler/DB scan).
func jsNumberOr0(raw json.RawMessage) float64 {
	if len(raw) == 0 || string(raw) == "null" {
		return 0
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		return f
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		if v, err := strconv.ParseFloat(s, 64); err == nil {
			return v
		}
	}
	return 0
}

type ciStudentDTO struct {
	ID                 int             `json:"id"`
	RentalType         string          `json:"rental_type"`
	CheckInDate        *string         `json:"check_in_date"`
	CheckOutDate       *string         `json:"check_out_date"`
	RoomFeeDiscountPct json.RawMessage `json:"room_fee_discount_pct"`
	UsesWashing        bool            `json:"uses_washing"`
	UsesParking        bool            `json:"uses_parking"`
}

type ciRoomDTO struct {
	Hang       string  `json:"hang"`
	MonthlyFee float64 `json:"monthly_fee"`
}

type ciInDTO struct {
	Student        ciStudentDTO      `json:"student"`
	Room           *ciRoomDTO        `json:"room"`
	Month          string            `json:"month"`
	Fees           map[string]string `json:"fees"`
	Occupants      int               `json:"occupants"`
	Roster         []rosterDTO       `json:"roster"`
	ElectricCharge *float64          `json:"electricCharge"`
	LeaderDays     int               `json:"leaderDays"`
	Kwh            float64           `json:"kwh"`
	VehicleCount   *int              `json:"vehicleCount"`
}

type readDTO struct {
	Date    string  `json:"date"`
	Reading float64 `json:"reading"`
}
type stayDTO struct {
	StudentID int     `json:"student_id"`
	From      string  `json:"from"`
	To        *string `json:"to"`
}
type bsInDTO struct {
	Month        string    `json:"month"`
	StartReading float64   `json:"startReading"`
	EndReading   float64   `json:"endReading"`
	Reads        []readDTO `json:"reads"`
	Stays        []stayDTO `json:"stays"`
}
type segOutDTO struct {
	From     string      `json:"from"`
	To       string      `json:"to"`
	Kwh      float64     `json:"kwh"`
	Roster   []rosterDTO `json:"roster"`
	Fellback bool        `json:"fellback"`
}

type segInDTO struct {
	Electric float64     `json:"electric"`
	Roster   []rosterDTO `json:"roster"`
}

type drArgDTO struct {
	NoticeDate   *string `json:"noticeDate"`
	CheckoutDate *string `json:"checkoutDate"`
	Reason       string  `json:"reason"`
}
type drOutDTO struct {
	Eligible bool   `json:"eligible"`
	Reason   string `json:"reason"`
}

type goldenFile struct {
	ComputeInvoice []struct {
		Name string  `json:"name"`
		In   ciInDTO `json:"in"`
		Out  Invoice `json:"out"`
	} `json:"computeInvoice"`
	BuildSegments []struct {
		Name string      `json:"name"`
		In   bsInDTO     `json:"in"`
		Out  []segOutDTO `json:"out"`
	} `json:"buildSegments"`
	SplitElectricExact []struct {
		Name string         `json:"name"`
		In   []segInDTO     `json:"in"`
		Out  map[string]int `json:"out"`
	} `json:"splitElectricExact"`
	SplitElectricByDays []struct {
		Name string `json:"name"`
		In   struct {
			RoomElectric float64     `json:"roomElectric"`
			Roster       []rosterDTO `json:"roster"`
		} `json:"in"`
		Out map[string]int `json:"out"`
	} `json:"splitElectricByDays"`
	PartialFactor []struct {
		Name string    `json:"name"`
		In   []float64 `json:"in"`
		Out  float64   `json:"out"`
	} `json:"partialFactor"`
	LeaderDiscount []struct {
		Name string `json:"name"`
		In   struct {
			LeaderDays    int `json:"leaderDays"`
			Days          int `json:"days"`
			WaterCharge   int `json:"water_charge"`
			ServiceCharge int `json:"service_charge"`
		} `json:"in"`
		Out int `json:"out"`
	} `json:"leaderDiscount"`
	DepositRefundEligible []struct {
		Name string `json:"name"`
		In   struct {
			Arg     drArgDTO `json:"arg"`
			MinDays *int     `json:"minDays"`
		} `json:"in"`
		Out drOutDTO `json:"out"`
	} `json:"depositRefundEligible"`
	DaysStayedInMonth []struct {
		Name string `json:"name"`
		In   struct {
			Ci    *string `json:"ci"`
			Co    *string `json:"co"`
			Month string  `json:"month"`
		} `json:"in"`
		Out int `json:"out"`
	} `json:"daysStayedInMonth"`
	DaysInMonth []struct {
		Name string `json:"name"`
		In   string `json:"in"`
		Out  int    `json:"out"`
	} `json:"daysInMonth"`
	InvoiceTotal []struct {
		Name string             `json:"name"`
		In   map[string]float64 `json:"in"`
		Out  int                `json:"out"`
	} `json:"invoiceTotal"`
}

func loadGolden(t *testing.T) *goldenFile {
	t.Helper()
	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("đọc golden fixtures (%s): %v — chạy generator trước: node tests/golden/gen_billing_golden.js tests/golden/billing_golden.json", goldenPath, err)
	}
	var g goldenFile
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatalf("parse golden fixtures: %v", err)
	}
	return &g
}

func TestGoldenComputeInvoice(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.ComputeInvoice {
		var room *Room
		if c.In.Room != nil {
			room = &Room{Hang: c.In.Room.Hang, MonthlyFee: c.In.Room.MonthlyFee}
		}
		got := ComputeInvoice(ComputeInput{
			Student: Student{
				ID: c.In.Student.ID, RentalType: c.In.Student.RentalType,
				CheckInDate: strOrEmpty(c.In.Student.CheckInDate), CheckOutDate: strOrEmpty(c.In.Student.CheckOutDate),
				RoomFeeDiscountPct: jsNumberOr0(c.In.Student.RoomFeeDiscountPct),
				UsesWashing:        c.In.Student.UsesWashing, UsesParking: c.In.Student.UsesParking,
			},
			Room: room, Month: c.In.Month, Fees: Fees(c.In.Fees), Occupants: c.In.Occupants,
			Roster: toRoster(c.In.Roster), ElectricCharge: c.In.ElectricCharge,
			LeaderDays: c.In.LeaderDays, Kwh: c.In.Kwh, VehicleCount: c.In.VehicleCount,
		})
		if !reflect.DeepEqual(got, c.Out) {
			t.Errorf("computeInvoice [%s]\n  Go   = %+v\n  Node = %+v", c.Name, got, c.Out)
		}
	}
}

func TestGoldenBuildSegments(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.BuildSegments {
		reads := make([]MeterRead, len(c.In.Reads))
		for i, r := range c.In.Reads {
			reads[i] = MeterRead{Date: r.Date, Reading: r.Reading}
		}
		stays := make([]Stay, len(c.In.Stays))
		for i, s := range c.In.Stays {
			stays[i] = Stay{StudentID: s.StudentID, From: s.From, To: strOrEmpty(s.To)}
		}
		got := BuildSegments(c.In.Month, c.In.StartReading, c.In.EndReading, reads, stays)
		if len(got) != len(c.Out) {
			t.Errorf("buildSegments [%s] số chặng Go=%d Node=%d", c.Name, len(got), len(c.Out))
			continue
		}
		for i := range got {
			w := c.Out[i]
			if got[i].From != w.From || got[i].To != w.To || got[i].Kwh != w.Kwh || got[i].Fellback != w.Fellback ||
				!reflect.DeepEqual(got[i].Roster, toRoster(w.Roster)) {
				t.Errorf("buildSegments [%s] chặng %d\n  Go   = %+v\n  Node = from=%s to=%s kwh=%v roster=%+v fellback=%v",
					c.Name, i, got[i], w.From, w.To, w.Kwh, w.Roster, w.Fellback)
			}
		}
	}
}

func mapIntToStr(m map[int]int) map[string]int {
	out := map[string]int{}
	for k, v := range m {
		out[strconv.Itoa(k)] = v
	}
	return out
}

func TestGoldenSplitElectricExact(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.SplitElectricExact {
		segs := make([]Segment, len(c.In))
		for i, s := range c.In {
			segs[i] = Segment{Electric: s.Electric, Roster: toRoster(s.Roster)}
		}
		got := mapIntToStr(SplitElectricExact(segs))
		if !reflect.DeepEqual(got, c.Out) {
			t.Errorf("splitElectricExact [%s]\n  Go   = %v\n  Node = %v", c.Name, got, c.Out)
		}
	}
}

func TestGoldenSplitElectricByDays(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.SplitElectricByDays {
		got := mapIntToStr(SplitElectricByDays(c.In.RoomElectric, toRoster(c.In.Roster)))
		if !reflect.DeepEqual(got, c.Out) {
			t.Errorf("splitElectricByDays [%s]\n  Go   = %v\n  Node = %v", c.Name, got, c.Out)
		}
	}
}

func TestGoldenPartialFactor(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.PartialFactor {
		in := c.In
		halfFactor := 0.5
		if len(in) >= 5 {
			halfFactor = in[4]
		}
		got := PartialFactor(int(in[0]), int(in[1]), int(in[2]), int(in[3]), halfFactor)
		if got != c.Out {
			t.Errorf("partialFactor [%s] Go=%v Node=%v", c.Name, got, c.Out)
		}
	}
}

func TestGoldenLeaderDiscount(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.LeaderDiscount {
		got := LeaderDiscount(c.In.LeaderDays, c.In.Days, c.In.WaterCharge, c.In.ServiceCharge)
		if got != c.Out {
			t.Errorf("leaderDiscount [%s] Go=%d Node=%d", c.Name, got, c.Out)
		}
	}
}

func TestGoldenDepositRefund(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.DepositRefundEligible {
		minDays := 0
		if c.In.MinDays != nil {
			minDays = *c.In.MinDays
		}
		got := DepositRefundEligible(strOrEmpty(c.In.Arg.NoticeDate), strOrEmpty(c.In.Arg.CheckoutDate), c.In.Arg.Reason, minDays)
		if got.Eligible != c.Out.Eligible || got.Reason != c.Out.Reason {
			t.Errorf("depositRefundEligible [%s]\n  Go   = %+v\n  Node = %+v", c.Name, got, c.Out)
		}
	}
}

func TestGoldenDaysStayedAndInMonth(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.DaysStayedInMonth {
		got := DaysStayedInMonth(strOrEmpty(c.In.Ci), strOrEmpty(c.In.Co), c.In.Month)
		if got != c.Out {
			t.Errorf("daysStayedInMonth [%s] Go=%d Node=%d", c.Name, got, c.Out)
		}
	}
	for _, c := range g.DaysInMonth {
		got := DaysInMonth(c.In)
		if got != c.Out {
			t.Errorf("daysInMonth [%s] Go=%d Node=%d", c.Name, got, c.Out)
		}
	}
}

func TestGoldenInvoiceTotal(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.InvoiceTotal {
		got := InvoiceTotal(c.In)
		if got != c.Out {
			t.Errorf("invoiceTotal [%s] Go=%d Node=%d", c.Name, got, c.Out)
		}
	}
}
