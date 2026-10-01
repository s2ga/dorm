package timeutil

import "testing"

func TestNgayVN(t *testing.T) {
	cases := map[string]string{
		"2026-10-01":           "01/10/2026",
		"2026-10-01T07:00:00Z": "01/10/2026",
		"":                     "",
		"01/10/2026":           "01/10/2026",
		"2026-10":              "2026-10",
	}
	for in, want := range cases {
		if got := NgayVN(in); got != want {
			t.Errorf("NgayVN(%q) = %q, muốn %q", in, got, want)
		}
	}
}

func TestThangVN(t *testing.T) {
	cases := map[string]string{
		"2026-06":    "tháng 6/2026",
		"2026-10":    "tháng 10/2026",
		"2026-10-15": "tháng 10/2026",
		"":           "",
		"6/2026":     "6/2026",
	}
	for in, want := range cases {
		if got := ThangVN(in); got != want {
			t.Errorf("ThangVN(%q) = %q, muốn %q", in, got, want)
		}
	}
}
