package scope

import (
	"testing"

	"ktx/internal/auth"
)

func iptr(v int) *int { return &v }

func nv(role string, fac *int) *auth.User { return &auth.User{Role: role, FacilityID: fac} }

// Admin LUÔN là điều hành, kể cả khi hồ sơ có gán cơ sở — nếu không, gán nhầm một cơ sở cho admin
// là cắt mất tầm nhìn toàn hệ thống mà không ai hiểu vì sao.
func TestAdminLuonLaDieuHanh(t *testing.T) {
	if !IsExecutive(nv("admin", iptr(7))) {
		t.Fatal("admin có facility_id vẫn phải là điều hành")
	}
	if !CanAccessFacility(nv("admin", iptr(7)), iptr(99)) {
		t.Fatal("admin phải chạm được cơ sở khác")
	}
}

func TestNhanVienBoTheoCoSo(t *testing.T) {
	nv7 := nv("staff", iptr(7))
	cases := []struct {
		ten  string
		fac  *int
		duoc bool
	}{
		{"đúng cơ sở của mình", iptr(7), true},
		{"cơ sở khác", iptr(8), false},
		{"bản ghi KHÔNG gắn cơ sở", nil, false}, // fail-closed: không rõ của ai thì không cho
	}
	for _, c := range cases {
		if got := CanAccessFacility(nv7, c.fac); got != c.duoc {
			t.Errorf("%s: được %v, phải %v", c.ten, got, c.duoc)
		}
	}
	if e := AssertFacility(nv7, iptr(8)); e == nil || e.Status != 403 {
		t.Errorf("chạm cơ sở khác phải 403, được %+v", e)
	}
	if e := AssertFacility(nv7, iptr(7)); e != nil {
		t.Errorf("chạm cơ sở của mình phải hợp lệ, được %+v", e)
	}
}

// Người dùng nil (chưa đăng nhập) KHÔNG được ngầm thành điều hành ở tầng lọc — tầng auth chặn trước,
// nhưng nếu tầng này tự nới thì một chỗ quên RequireAuth là lộ toàn bộ cơ sở.
func TestNguoiDungNilKhongDuocThanhDieuHanhNgamDinh(t *testing.T) {
	var cond []string
	var params []interface{}
	ApplyFacilityFilter(nil, "facility_id", &cond, &params)
	if len(cond) != 0 {
		t.Fatalf("người dùng nil: bộ lọc = %v (ghi nhận hành vi hiện tại: không thêm điều kiện)", cond)
	}
}

func TestApplyFacilityFilterDanhSoThamSoTiepNoi(t *testing.T) {
	cond := []string{"deleted_at IS NULL"}
	params := []interface{}{"2026-08"} // đã có $1 từ trước
	ApplyFacilityFilter(nv("staff", iptr(3)), "s.facility_id", &cond, &params)
	if len(cond) != 2 || cond[1] != "s.facility_id = $2" {
		t.Fatalf("phải nối tiếp số tham số đang có: %v", cond)
	}
	if len(params) != 2 || params[1] != 3 {
		t.Fatalf("tham số phải là id cơ sở của người dùng: %v", params)
	}
	// Điều hành: không thêm gì, giữ nguyên cond/params.
	ApplyFacilityFilter(nv("admin", nil), "s.facility_id", &cond, &params)
	if len(cond) != 2 || len(params) != 2 {
		t.Fatalf("điều hành không được thêm điều kiện: cond=%v params=%v", cond, params)
	}
}

// Tạo bản ghi mới: nhân viên KHÔNG được chọn cơ sở khác cho bản ghi của mình (nếu không thì cách ly
// dữ liệu chỉ chặn ĐỌC, còn GHI thì lách được bằng cách khai facility_id trong body).
func TestResolveFacilityForCreateEpTheoNguoiTao(t *testing.T) {
	got := ResolveFacilityForCreate(nv("staff", iptr(7)), iptr(8))
	if got == nil || *got != 7 {
		t.Fatalf("nhân viên cơ sở 7 khai 8 → phải ép về 7, được %v", got)
	}
	got = ResolveFacilityForCreate(nv("admin", nil), iptr(8))
	if got == nil || *got != 8 {
		t.Fatalf("điều hành khai 8 → giữ 8, được %v", got)
	}
	if got = ResolveFacilityForCreate(nv("admin", nil), nil); got != nil {
		t.Fatalf("điều hành không khai → nil, được %v", got)
	}
}
