package handlers

import (
	"encoding/json"
	"testing"
	"time"
)

// Ô ngày hiệu lực của xe cần BA trạng thái: vắng khoá = giữ nguyên, null/"" = xoá, ngày = đặt.
// Lẫn "vắng" với "null" là gỡ xe xong vẫn bị thu phí, hoặc sửa mã dán lại xoá mất ngày.
func TestVehicleNgayBaTrangThai(t *testing.T) {
	ca := []struct {
		ten   string
		body  string
		co    bool
		gia   string
		coLoi bool
	}{
		{"vắng khoá -> không đổi", `{}`, false, "", false},
		{"null -> xoá ngày", `{"to_date":null}`, true, "", false},
		{"chuỗi rỗng -> xoá ngày", `{"to_date":""}`, true, "", false},
		{"chỉ khoảng trắng -> xoá ngày", `{"to_date":"   "}`, true, "", false},
		{"ngày hợp lệ", `{"to_date":"2026-07-31"}`, true, "2026-07-31", false},
		{"cắt phần giờ", `{"to_date":"2026-07-31T00:00:00Z"}`, true, "2026-07-31", false},
		{"ngày sai định dạng", `{"to_date":"31/07/2026"}`, true, "", true},
		{"tháng 13", `{"to_date":"2026-13-01"}`, true, "", true},
		{"kiểu sai", `{"to_date":123}`, true, "", true},
	}
	for _, c := range ca {
		var b struct {
			ToDate json.RawMessage `json:"to_date"`
		}
		if err := json.Unmarshal([]byte(c.body), &b); err != nil {
			t.Fatalf("%s: body hỏng: %v", c.ten, err)
		}
		co, v, loi := vehicleNgay(b.ToDate, "Ngày ngừng")
		if co != c.co {
			t.Errorf("%s: có gửi = %v, mong %v", c.ten, co, c.co)
		}
		if (loi != "") != c.coLoi {
			t.Errorf("%s: lỗi = %q, mong coLoi=%v", c.ten, loi, c.coLoi)
		}
		got := ""
		if v != nil {
			got = *v
		}
		if !c.coLoi && got != c.gia {
			t.Errorf("%s: giá trị = %q, mong %q", c.ten, got, c.gia)
		}
	}
}

func TestVehicleKhoangNgay(t *testing.T) {
	ngay := func(s string) *string { return &s }
	ca := []struct {
		ten      string
		from, to *string
		coLoi    bool
	}{
		{"trong khoảng", ngay("2026-03-08"), ngay("2026-07-25"), false},
		{"cùng ngày vẫn hợp lệ", ngay("2026-03-08"), ngay("2026-03-08"), false},
		{"ngừng trước bắt đầu", ngay("2026-07-25"), ngay("2026-03-08"), true},
		{"để ngỏ ngày ngừng", ngay("2026-03-08"), nil, false},
		{"thiếu ngày bắt đầu", nil, ngay("2026-07-25"), false},
	}
	for _, c := range ca {
		if loi := vehicleKhoangNgay(c.from, c.to); (loi != "") != c.coLoi {
			t.Errorf("%s: lỗi = %q, mong coLoi=%v", c.ten, loi, c.coLoi)
		}
	}
}

func TestVehicleNgayCua(t *testing.T) {
	if vehicleNgayCua(nil) != nil {
		t.Error("không có ngày -> phải trả nil để cột về NULL, không phải chuỗi rỗng")
	}
	d := time.Date(2026, 3, 8, 0, 0, 0, 0, time.UTC)
	if got := vehicleNgayCua(&d); got == nil || *got != "2026-03-08" {
		t.Errorf("đổi ngày sai: %v", got)
	}
}
