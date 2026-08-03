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

// kWh và tiền chia trên HAI lưới khác nhau (0,01 kWh và 1 đồng) nên phần dư có thể rơi vào người
// khác nhau. Sai lệch từng dòng vì thế lên tới ~1,5 đơn vị 0,01 kWh, KHÔNG phải nửa đơn vị. Test
// canh ngưỡng đó: vượt là công thức hỏng, không còn là chuyện làm tròn.
func TestChiaKwh_LechSoVoiTienTrongNguong(t *testing.T) {
	const unit = 3000.0
	nguong := 2 * unit / 100 // 2 đơn vị 0,01 kWh
	roster := []RosterEntry{{1, 31}, {2, 26}, {3, 27}, {4, 31}}
	kwhPhong := 153.0
	kwh := SplitKwhExact([]Segment{{Electric: kwhPhong, Roster: roster}})
	tien := SplitElectricExact([]Segment{{Electric: kwhPhong * unit, Roster: roster}})
	for id, k := range kwh {
		if lech := math.Abs(k*unit - float64(tien[id])); lech > nguong {
			t.Errorf("HV #%d: %v kWh × %v = %v nhưng tiền chia ra %d — lệch %v, vượt ngưỡng %v",
				id, k, unit, k*unit, tien[id], lech, nguong)
		}
	}
	// Cả hai tổng đều phải khớp tuyệt đối với khối của phòng.
	if tong := tongKwh(kwh); tong != kwhPhong {
		t.Errorf("Σ kWh = %v, phải = %v", tong, kwhPhong)
	}
	tongTien := 0
	for _, v := range tien {
		tongTien += v
	}
	if float64(tongTien) != kwhPhong*unit {
		t.Errorf("Σ tiền = %d, phải = %v", tongTien, kwhPhong*unit)
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
