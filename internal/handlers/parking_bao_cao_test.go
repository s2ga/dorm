package handlers

import (
	"reflect"
	"testing"
	"time"
)

// Mốc "chưa chốt bãi xe": so phút trong ngày, giờ cài đặt rác thì KHÔNG nhắc (đừng nhắc sai còn tệ hơn không nhắc).
func TestParkingQuaGio(t *testing.T) {
	luc := func(hh, mm int) time.Time { return time.Date(2026, 9, 10, hh, mm, 0, 0, time.UTC) }
	cases := []struct {
		ten  string
		now  time.Time
		gio  string
		muon bool
	}{
		{"trước mốc", luc(22, 59), "23:00", false},
		{"đúng mốc", luc(23, 0), "23:00", true},
		{"sau mốc", luc(23, 30), "23:00", true},
		{"mốc sáng sớm", luc(7, 5), "07:00", true},
		{"giờ có khoảng trắng", luc(23, 30), " 23:00 ", true},
		{"giờ rác", luc(23, 30), "23h", false},
		{"giờ vượt 24", luc(23, 30), "25:00", false},
		{"phút vượt 60", luc(23, 30), "23:75", false},
		{"rỗng", luc(23, 30), "", false},
	}
	for _, c := range cases {
		if got := parkingQuaGio(c.now, c.gio); got != c.muon {
			t.Errorf("%s: parkingQuaGio(%s, %q) = %v, muốn %v", c.ten, c.now.Format("15:04"), c.gio, got, c.muon)
		}
	}
}

// Danh sách email nhận báo cáo: người dùng gõ tuỳ tiện (phẩy, chấm phẩy, xuống dòng, hoa/thường, trùng).
func TestParkingTachEmail(t *testing.T) {
	cases := []struct {
		raw  string
		muon []string
	}{
		{"", []string{}},
		{"a@x.vn", []string{"a@x.vn"}},
		{"A@x.vn, b@y.vn; c@z.vn\n d@w.vn", []string{"a@x.vn", "b@y.vn", "c@z.vn", "d@w.vn"}},
		{"a@x.vn, a@X.vn", []string{"a@x.vn"}},
		{"khong-phai-email, a@x.vn, @b.vn", []string{"a@x.vn"}},
	}
	for _, c := range cases {
		if got := parkingTachEmail(c.raw); !reflect.DeepEqual(got, c.muon) {
			t.Errorf("parkingTachEmail(%q) = %v, muốn %v", c.raw, got, c.muon)
		}
	}
}
