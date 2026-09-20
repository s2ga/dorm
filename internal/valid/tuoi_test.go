package valid

import "testing"

func TestSoTuoi(t *testing.T) {
	ca := []struct {
		ngaySinh, moc string
		muon          int
	}{
		{"2009-09-19", "2026-09-19", 17}, // đúng sinh nhật
		{"2009-09-20", "2026-09-19", 16}, // thiếu 1 ngày
		{"1986-09-20", "2026-09-19", 39},
		{"1986-09-19", "2026-09-19", 40},
		{"2004-02-29", "2026-02-28", 21}, // năm nhuận, chưa tới 29/02
		{"khong-phai-ngay", "2026-09-19", -1},
	}
	for _, c := range ca {
		if got := SoTuoi(c.ngaySinh, c.moc); got != c.muon {
			t.Errorf("SoTuoi(%q, %q) = %d, muốn %d", c.ngaySinh, c.moc, got, c.muon)
		}
	}
}

func TestKhoangTuoi(t *testing.T) {
	ca := []struct {
		minRaw, maxRaw string
		min, max       int
	}{
		{"", "", 17, 39},
		{"18", "35", 18, 35},
		{"abc", "35", 17, 35},
		{"40", "20", 17, 39}, // min > max -> về mặc định
		{"0", "0", 17, 39},
	}
	for _, c := range ca {
		min, max := KhoangTuoi(c.minRaw, c.maxRaw)
		if min != c.min || max != c.max {
			t.Errorf("KhoangTuoi(%q, %q) = %d/%d, muốn %d/%d", c.minRaw, c.maxRaw, min, max, c.min, c.max)
		}
	}
}

func TestLoiNgaySinh(t *testing.T) {
	moc := "2026-09-19"
	if e := LoiNgaySinh("2004-05-06", moc, 17, 39); e != "" {
		t.Errorf("22 tuổi phải qua, lỗi: %s", e)
	}
	if e := LoiNgaySinh("2009-09-19", moc, 17, 39); e != "" {
		t.Errorf("đúng 17 tuổi phải qua, lỗi: %s", e)
	}
	if e := LoiNgaySinh("2009-09-20", moc, 17, 39); e == "" {
		t.Error("thiếu 1 ngày so với 17 tuổi phải bị chặn")
	}
	if e := LoiNgaySinh("1986-09-19", moc, 17, 39); e == "" {
		t.Error("tròn 40 tuổi phải bị chặn")
	}
	if e := LoiNgaySinh("2027-01-01", moc, 17, 39); e == "" {
		t.Error("ngày sinh tương lai phải bị chặn")
	}
	if e := LoiNgaySinh("2004-13-40", moc, 17, 39); e == "" {
		t.Error("ngày sai khuôn phải bị chặn")
	}
}
