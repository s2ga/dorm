package billing

import (
	"math"
	"testing"
)

// Bất biến: Σ kWh của mọi người trong phòng = kWh của cả phòng, không lệch một phần trăm nào.
// Suy ngược kWh từ tiền đã làm tròn thì tổng lệch — đó là lý do phải chia CHÍNH số kWh.

func tongKwh(m map[int]float64) float64 {
	t := 0.0
	for _, v := range m {
		t += v
	}
	return math.Round(t*100) / 100
}

func TestChiaKwh_TongKhopKhoiPhong(t *testing.T) {
	cases := []struct {
		ten    string
		kwh    float64
		roster []RosterEntry
	}{
		{"chia chẵn 4 người", 153, []RosterEntry{{1, 31}, {2, 31}, {3, 31}, {4, 31}}},
		{"ngày ở lệch nhau", 153, []RosterEntry{{1, 31}, {2, 26}, {3, 27}, {4, 31}}},
		{"3 người chia 100 kWh", 100, []RosterEntry{{1, 30}, {2, 30}, {3, 30}}},
		{"7 người, số lẻ xấu", 1000, []RosterEntry{{1, 3}, {2, 5}, {3, 7}, {4, 11}, {5, 13}, {6, 17}, {7, 19}}},
		{"một người ở một ngày", 88.7, []RosterEntry{{1, 1}, {2, 30}, {3, 30}}},
		{"kWh có số lẻ", 77.3, []RosterEntry{{1, 10}, {2, 20}}},
	}
	for _, c := range cases {
		got := SplitKwhExact([]Segment{{Electric: c.kwh, Roster: c.roster}})
		muon := math.Round(c.kwh*100) / 100
		if tong := tongKwh(got); tong != muon {
			t.Errorf("%s: Σ kWh các phần = %v, phải = %v (lệch %v)", c.ten, tong, muon, tong-muon)
		}
		for id, v := range got {
			x100 := v * 100
			if math.Abs(x100-math.Round(x100)) > 1e-9 {
				t.Errorf("%s: HV #%d có %v kWh — quá 2 số lẻ", c.ten, id, v)
			}
			if v < 0 {
				t.Errorf("%s: HV #%d có %v kWh — âm", c.ten, id, v)
			}
		}
	}
}

// Cắt chặng giữa kỳ (có người rời phòng): tổng cộng qua MỌI chặng vẫn phải khớp.
func TestChiaKwh_NhieuChangVanKhop(t *testing.T) {
	segs := []Segment{
		{Electric: 60.5, Roster: []RosterEntry{{1, 10}, {2, 10}, {3, 10}}},
		{Electric: 92.5, Roster: []RosterEntry{{1, 21}, {3, 21}}},
	}
	got := SplitKwhExact(segs)
	if tong := tongKwh(got); tong != 153 {
		t.Errorf("Σ kWh qua 2 chặng = %v, phải = 153", tong)
	}
	if got[2] <= 0 {
		t.Errorf("HV #2 rời giữa kỳ vẫn phải có phần chặng đầu, đang = %v", got[2])
	}
}

// MỘT phép chia: tiền suy từ chính phần kWh, nên mọi dòng phải khít kWh × đơn giá = tiền, và cả
// hai tổng đều khớp khối phòng. Đơn giá bội của 100 thì 0,01 kWh ra số đồng chẵn nên khít tuyệt đối.
func TestChiaDien_KwhNhanDonGiaRaDungTien(t *testing.T) {
	// 3.333 KHÔNG chia hết cho 100: kWh × đơn giá ra số lẻ đồng, phần dư phải rải để Σ vẫn khớp.
	for _, unit := range []float64{3000, 3500, 2500, 3333} {
		for _, c := range []struct {
			kwh    float64
			roster []RosterEntry
		}{
			{153, []RosterEntry{{1, 31}, {2, 26}, {3, 27}, {4, 31}}},
			{100, []RosterEntry{{1, 30}, {2, 30}, {3, 30}}},
			{77.3, []RosterEntry{{1, 10}, {2, 20}}},
			{1000, []RosterEntry{{1, 3}, {2, 5}, {3, 7}, {4, 11}, {5, 13}, {6, 17}, {7, 19}}},
		} {
			got := ChiaDien([]Segment{{Electric: c.kwh, Roster: c.roster}}, unit)
			var tongK float64
			tongT := 0
			// Đơn giá bội của 100 -> 0,01 kWh ra số đồng chẵn -> KHÍT TUYỆT ĐỐI. Đơn giá lẻ thì tiền
			// là số nguyên gần nhất, lệch tối đa 1 đồng.
			nguong := 1.0
			if math.Mod(unit, 100) == 0 {
				nguong = 0
			}
			for id, p := range got {
				if lech := math.Abs(p.Kwh*unit - float64(p.Tien)); lech > nguong+1e-6 {
					t.Errorf("đơn giá %v, HV #%d: %v kWh × %v = %v nhưng tiền = %d (lệch %v > %v)",
						unit, id, p.Kwh, unit, p.Kwh*unit, p.Tien, lech, nguong)
				}
				tongK += p.Kwh
				tongT += p.Tien
			}
			if tk := math.Round(tongK*100) / 100; tk != c.kwh {
				t.Errorf("đơn giá %v, khối %v kWh: Σ kWh = %v", unit, c.kwh, tk)
			}
			if muon := r0(c.kwh * unit); tongT != muon {
				t.Errorf("đơn giá %v, khối %v kWh: Σ tiền = %d, phải = %d", unit, c.kwh, tongT, muon)
			}
		}
	}
}

func TestChiaKwh_KhongCoAiThiKhongVo(t *testing.T) {
	if got := SplitKwhExact([]Segment{{Electric: 100, Roster: nil}}); len(got) != 0 {
		t.Errorf("roster rỗng: phải trả map rỗng, đang = %v", got)
	}
	if got := SplitKwhExact(nil); len(got) != 0 {
		t.Errorf("không có chặng nào: phải trả map rỗng, đang = %v", got)
	}
}
