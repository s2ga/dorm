package handlers

import "testing"

func TestStudentsKhoaDuoiHoSo(t *testing.T) {
	ca := []struct {
		sid  int
		key  string
		muon bool
	}{
		{1, "students/1/cccd_front.png", true},
		{12, "students/12/cccd_back.jpg", true},
		{1, "students/12/cccd_front.png", false},
		{12, "students/1/cccd_front.png", false},
		{1, "students/1", false},
		{1, "students/1x/cccd_front.png", false},
		{1, "applications/1/cccd_front.png", false},
		{1, "", false},
		{0, "students/0/cccd_front.png", false},
		{1, "test/f.jpg", false},
	}
	for _, c := range ca {
		if got := studentsKhoaDuoiHoSo(c.sid, c.key); got != c.muon {
			t.Errorf("studentsKhoaDuoiHoSo(%d, %q) = %v, muốn %v", c.sid, c.key, got, c.muon)
		}
	}
}

func TestStudentsEtagKhop(t *testing.T) {
	ca := []struct {
		inm, etag string
		muon      bool
	}{
		{`"abc"`, `"abc"`, true},
		{`W/"abc"`, `"abc"`, true},
		{`"x", "abc"`, `"abc"`, true},
		{`*`, `"abc"`, true},
		{`"abd"`, `"abc"`, false},
		{``, `"abc"`, false},
		{`abc`, `"abc"`, false},
	}
	for _, c := range ca {
		if got := studentsEtagKhop(c.inm, c.etag); got != c.muon {
			t.Errorf("studentsEtagKhop(%q, %q) = %v, muốn %v", c.inm, c.etag, got, c.muon)
		}
	}
}
