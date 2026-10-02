package handlers

import (
	"reflect"
	"testing"
)

// giam_sat_email phải nằm trong danh sách khoá được lưu, nếu không PUT /api/settings NUỐT IM
// giá trị người dùng vừa gõ: không báo lỗi, mà cũng không lưu.
func TestGiamSatEmailLuuDuoc(t *testing.T) {
	if !inList("giam_sat_email", settingsAllowed) {
		t.Fatal("giam_sat_email không có trong settingsAllowed -> cài đặt người nhận báo cáo bị bỏ im lặng")
	}
}

// Người nhận lấy từ Cài đặt, KHÔNG lấy từ thân yêu cầu — endpoint này không được thành đường
// gửi mail tới địa chỉ bất kỳ. Canh bằng chính hình dạng của struct thân.
func TestGiamSatBodyKhongCoNguoiNhan(t *testing.T) {
	kieu := reflect.TypeOf(giamSatMailBody{})
	for _, cam := range []string{"To", "Email", "NguoiNhan", "Nhan"} {
		if _, co := kieu.FieldByName(cam); co {
			t.Errorf("giamSatMailBody có trường %q — người nhận phải do máy chủ quyết", cam)
		}
	}
}

func TestGiamSatMucHopLe(t *testing.T) {
	for _, m := range []string{"p1", "p2", "p3", "tuan"} {
		if !giamSatMucHopLe[m] {
			t.Errorf("lượt %q phải được nhận", m)
		}
	}
	for _, m := range []string{"", "p0", "p4", "thang", "P1"} {
		if giamSatMucHopLe[m] {
			t.Errorf("lượt %q phải bị từ chối", m)
		}
	}
}

func TestGiamSatKhongAm(t *testing.T) {
	for _, c := range []struct{ vao, ra int }{{-5, 0}, {-1, 0}, {0, 0}, {3, 3}} {
		if got := giamSatKhongAm(c.vao); got != c.ra {
			t.Errorf("giamSatKhongAm(%d) = %d, muốn %d", c.vao, got, c.ra)
		}
	}
}
