package mail

import (
	"strings"
	"testing"
)

// Tiêu đề phải nói ngay mức nặng nhất: quản lý đọc danh sách mail chứ không mở từng cái.
func TestGiamSatTieuDe(t *testing.T) {
	cases := []struct {
		ten  string
		bc   GiamSatBaoCao
		muon string
	}{
		{"có P1", GiamSatBaoCao{Muc: "p1", P1: 1, P2: 0, P3: 5},
			"[KTX] Giám sát sống còn — CÓ SỰ CỐ (P1=1 · P2=0 · P3=5)"},
		{"chỉ P2", GiamSatBaoCao{Muc: "p2", P2: 3, P3: 2},
			"[KTX] Giám sát trong ngày — cần xử lý (P2=3 · P3=2)"},
		{"chỉ P3", GiamSatBaoCao{Muc: "p3", P3: 7},
			"[KTX] Giám sát toàn vẹn dữ liệu — sai lệch dữ liệu (P3=7)"},
		{"sạch", GiamSatBaoCao{Muc: "tuan"},
			"[KTX] Giám sát tổng kết tuần — không có bất thường"},
		{"lượt lạ thì giữ nguyên tên", GiamSatBaoCao{Muc: "p9"},
			"[KTX] Giám sát p9 — không có bất thường"},
	}
	for _, c := range cases {
		if got := giamSatTieuDe("KTX", c.bc); got != c.muon {
			t.Errorf("%s:\n  được: %s\n  muốn: %s", c.ten, got, c.muon)
		}
	}
}

func TestGiamSatThanGiuNguyenNoiDung(t *testing.T) {
	noi := "KTX · GIÁM SÁT [P2] · 01/10/2026 10:00:00 +07:00\nMôi trường: https://dev.s2.technology\n" +
		"🚨 [MỨC ĐỘ: P2] - CHỈ SỐ ĐIỆN MỚI NHỎ HƠN CHỈ SỐ CŨ\n- Phân loại: Lỗi Dữ Liệu\n"
	than := giamSatThan("KTX Esuhai", "0909", GiamSatBaoCao{Muc: "p2", NoiDung: noi, P2: 1})
	for _, phai := range []string{
		"https://dev.s2.technology", "01/10/2026 10:00:00 +07:00",
		"cần xử lý (P2=1 · P3=0)", "CHỈ SỐ ĐIỆN MỚI NHỎ HƠN CHỈ SỐ CŨ", "KTX Esuhai", "Hotline: 0909",
	} {
		if !strings.Contains(than, phai) {
			t.Errorf("thân mail thiếu %q:\n%s", phai, than)
		}
	}
}

// Phần đầu của báo cáo chỉ được xuất hiện MỘT lần: thân mail không dựng lại thứ NoiDung đã có.
func TestGiamSatThanKhongLapDauBaoCao(t *testing.T) {
	noi := "KTX · GIÁM SÁT [P3] · 01/10/2026 10:00:00 +07:00\nMôi trường: https://x.vn\nBản đang chạy: v315\n"
	than := giamSatThan("KTX", "", GiamSatBaoCao{Muc: "p3", NoiDung: noi, P3: 2})
	for _, khoa := range []string{"Môi trường:", "Bản đang chạy:"} {
		if n := strings.Count(than, khoa); n != 1 {
			t.Errorf("%q xuất hiện %d lần, phải đúng 1:\n%s", khoa, n, than)
		}
	}
	if strings.Contains(than, "Hotline:") {
		t.Errorf("hotline rỗng thì không được in nhãn:\n%s", than)
	}
}
