package handlers

import (
	"reflect"
	"testing"
)

// Nắn ngày nhận nhiệm vụ phòng trưởng làm số ngày làm đổi ở MỌI kỳ giữa ngày cũ và ngày mới.
// Chỉ tính lại kỳ của ngày mới là bỏ sót các kỳ ở giữa, giảm giá kỳ đó nằm sai vĩnh viễn.
func TestRoomsKyCanTinhLai(t *testing.T) {
	cases := []struct {
		ten     string
		cu, moi string
		muon    []string
	}{
		{"lùi ngược 2 kỳ", "2026-08-02", "2026-06-28", []string{"2026-06", "2026-07", "2026-08"}},
		{"tiến tới 2 kỳ", "2026-06-28", "2026-08-02", []string{"2026-06", "2026-07", "2026-08"}},
		{"cùng kỳ", "2026-08-02", "2026-08-20", []string{"2026-08"}},
		{"vắt qua năm", "2025-12-20", "2026-02-01", []string{"2025-12", "2026-01", "2026-02"}},
		{"không có ngày cũ", "", "2026-08-02", []string{"2026-08"}},
		{"ngày mới hỏng", "2026-08-02", "", nil},
	}
	for _, c := range cases {
		if got := roomsKyCanTinhLai(c.cu, c.moi); !reflect.DeepEqual(got, c.muon) {
			t.Errorf("%s: roomsKyCanTinhLai(%q,%q) = %v, muốn %v", c.ten, c.cu, c.moi, got, c.muon)
		}
	}
}

// Hai ngày cách nhau vô lý (dữ liệu hỏng) không được làm vòng lặp chạy hàng nghìn kỳ.
func TestRoomsKyCanTinhLai_ChanTran(t *testing.T) {
	got := roomsKyCanTinhLai("2000-01-01", "2026-08-02")
	if len(got) != 36 {
		t.Errorf("cách nhau 26 năm: trả %d kỳ, phải chặn ở 36", len(got))
	}
}
