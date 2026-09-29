package chores

import "testing"

func sau(ten ...string) []Member {
	// Ngày vào ở cách nhau để thứ tự xoay vòng là A, B, C… không phụ thuộc id.
	ngay := []string{"2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"}
	out := make([]Member, len(ten))
	for i, t := range ten {
		out[i] = Member{ID: i + 1, Name: t, CheckInDate: ngay[i]}
	}
	return out
}

func khongTrungHaiNgayLienTiep(t *testing.T, ten string, lich []Slot) {
	t.Helper()
	for i := 1; i < len(lich); i++ {
		if lich[i].StudentID == lich[i-1].StudentID {
			t.Errorf("%s: %s trực cả %s lẫn %s — không được hai ngày liên tiếp",
				ten, lich[i].Name, lich[i-1].Date, lich[i].Date)
		}
	}
}

func TestXoayVongTheoNgayDungThuTu(t *testing.T) {
	lich := Schedule(sau("A", "B", "C"), "2026-09-21", 7)
	if len(lich) != 7 {
		t.Fatalf("phải có đủ 7 ngày, được %d", len(lich))
	}
	for i := 1; i < len(lich); i++ {
		if lich[i].Date <= lich[i-1].Date {
			t.Fatalf("ngày phải tăng dần: %s rồi %s", lich[i-1].Date, lich[i].Date)
		}
	}
	// Ba người thì cứ 3 ngày quay lại đúng người đó.
	for i := 3; i < len(lich); i++ {
		if lich[i].Name != lich[i-3].Name {
			t.Errorf("ngày %s phải quay lại %s, được %s", lich[i].Date, lich[i-3].Name, lich[i].Name)
		}
	}
	khongTrungHaiNgayLienTiep(t, "3 người", lich)
}

// Đúng ca hỏng của bản cũ: có người trả phòng giữa chừng thì công thức chia lấy dư rơi trúng
// người vừa trực. Đi tuần tự thì dù ai rời phòng ngày nào cũng không đẻ ra hai ngày liền nhau.
func TestCoNguoiTraPhongVanKhongTrucHaiNgayLienTiep(t *testing.T) {
	goc := sau("A", "B", "C", "D", "E", "F")
	for roi := range goc {
		for _, ngayRoi := range []string{"2026-09-22", "2026-09-25", "2026-09-27", "2026-09-30"} {
			mem := make([]Member, len(goc))
			copy(mem, goc)
			mem[roi].CheckOutDate = ngayRoi
			lich := Schedule(mem, "2026-09-21", 21)
			khongTrungHaiNgayLienTiep(t, mem[roi].Name+" rời "+ngayRoi, lich)
			for _, s := range lich {
				if s.StudentID == mem[roi].ID && s.Date > ngayRoi {
					t.Errorf("%s đã rời phòng %s mà vẫn bị xếp trực %s", mem[roi].Name, ngayRoi, s.Date)
				}
			}
		}
	}
}

func TestNguoiMoiVaoChenDuocVaoVong(t *testing.T) {
	mem := sau("A", "B", "C")
	mem = append(mem, Member{ID: 99, Name: "Z", CheckInDate: "2026-09-25"})
	lich := Schedule(mem, "2026-09-21", 21)
	khongTrungHaiNgayLienTiep(t, "có người mới vào", lich)
	co := false
	for _, s := range lich {
		if s.StudentID == 99 {
			co = true
			if s.Date < "2026-09-25" {
				t.Errorf("Z vào ở 25/9 mà bị xếp trực %s", s.Date)
			}
		}
	}
	if !co {
		t.Error("người mới vào phải được xếp vào vòng trực, không thì phòng cũ gánh mãi")
	}
}

// Lịch phải ỔN ĐỊNH: hôm nay mở ra thấy thứ Sáu là ai, thì ngày mai mở lại vẫn đúng người đó.
func TestCungMotNgayHoiOCuaSoKhacNhauVanRaCungNguoi(t *testing.T) {
	mem := sau("A", "B", "C", "D")
	dai := Schedule(mem, "2026-09-21", 30)
	theoNgay := map[string]string{}
	for _, s := range dai {
		theoNgay[s.Date] = s.Name
	}
	for _, batDau := range []string{"2026-09-22", "2026-09-26", "2026-10-05", "2026-10-15"} {
		for _, s := range Schedule(mem, batDau, 7) {
			if muon, ok := theoNgay[s.Date]; ok && muon != s.Name {
				t.Errorf("ngày %s: hỏi từ 21/9 ra %s, hỏi từ %s lại ra %s", s.Date, muon, batDau, s.Name)
			}
		}
	}
}

func TestPhongMotNguoiThiTrucMoiNgay(t *testing.T) {
	lich := Schedule(sau("A"), "2026-09-21", 5)
	if len(lich) != 5 {
		t.Fatalf("phòng một người vẫn phải có lịch đủ 5 ngày, được %d", len(lich))
	}
	for _, s := range lich {
		if s.Name != "A" {
			t.Fatalf("chỉ có A ở phòng mà ngày %s lại là %s", s.Date, s.Name)
		}
	}
}

func TestPhongTrongThiLichRong(t *testing.T) {
	if got := Schedule(nil, "2026-09-21", 7); len(got) != 0 {
		t.Fatalf("phòng chưa có ai ở thì không xếp lịch, được %+v", got)
	}
	// Có hồ sơ nhưng chưa tới ngày vào ở: cũng không được xếp trực.
	chuaVao := []Member{{ID: 1, Name: "A", CheckInDate: "2026-12-01"}}
	if got := Schedule(chuaVao, "2026-09-21", 7); len(got) != 0 {
		t.Fatalf("chưa vào ở mà đã bị xếp trực: %+v", got)
	}
}

func TestChiaDeuLuotTrucKhiKhongAiRaVao(t *testing.T) {
	mem := sau("A", "B", "C", "D")
	dem := map[string]int{}
	for _, s := range Schedule(mem, "2026-09-21", 28) {
		dem[s.Name]++
	}
	for _, ten := range []string{"A", "B", "C", "D"} {
		if dem[ten] != 7 {
			t.Errorf("28 ngày chia cho 4 người thì mỗi người 7 lượt, %s được %d", ten, dem[ten])
		}
	}
}
