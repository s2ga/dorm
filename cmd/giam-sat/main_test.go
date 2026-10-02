package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// mocThu: mốc "hiện tại" cố định để phép tính hạn SLA không đổi theo ngày chạy test.
var mocThu = time.Date(2026, 9, 29, 10, 0, 0, 0, ict)

// isoTruoc: mốc thời gian cách mocThu n giờ, đúng định dạng máy chủ trả ra (ISO-UTC có ms).
func isoTruoc(gio int) string {
	return mocThu.Add(-time.Duration(gio) * time.Hour).UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

type tuyenThu struct {
	ma   int
	than string
}

func moPhienThu(t *testing.T, tuyen map[string]tuyenThu) (*phien, func()) {
	t.Helper()
	mux := http.NewServeMux()
	for duong, tt := range tuyen {
		x := tt
		mux.HandleFunc(duong, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if x.ma != 0 && x.ma != http.StatusOK {
				w.WriteHeader(x.ma)
			}
			_, _ = io.WriteString(w, x.than)
		})
	}
	sv := httptest.NewServer(mux)
	ch := cauHinh{
		goc: sv.URL, muc: "p2", dinhDang: "text", ky: "2026-09", token: "thu",
		slaNhan: 12 * time.Hour, slaXong: 24 * time.Hour,
		nguongVot: 200, soThangTB: 3, choPhep: 5 * time.Second, soDoiTuong: 15,
	}
	return &phien{ch: ch, k: moKhach(ch), bay: mocThu}, sv.Close
}

func timTen(p *phien, ten string) *canhBao {
	for i := range p.list {
		if p.list[i].Ten == ten {
			return &p.list[i]
		}
	}
	return nil
}

func phaiCo(t *testing.T, p *phien, ten, muc string, soDoiTuong int) *canhBao {
	t.Helper()
	cb := timTen(p, ten)
	if cb == nil {
		var co []string
		for _, c := range p.list {
			co = append(co, c.Muc+" "+c.Ten)
		}
		t.Fatalf("thiếu cảnh báo %q; đang có: %v", ten, co)
	}
	if cb.Muc != muc {
		t.Errorf("%q: mức %q, mong %q", ten, cb.Muc, muc)
	}
	if soDoiTuong >= 0 && len(cb.DoiTuong) != soDoiTuong {
		t.Errorf("%q: %d đối tượng, mong %d — %v", ten, len(cb.DoiTuong), soDoiTuong, cb.DoiTuong)
	}
	return cb
}

func phaiSach(t *testing.T, p *phien) {
	t.Helper()
	if len(p.list) != 0 {
		for _, c := range p.list {
			t.Errorf("dữ liệu sạch mà vẫn báo: %s %s — %s", c.Muc, c.Ten, c.MoTa)
		}
	}
}

/* ---------- P1 ---------- */

func TestSongConCsdlChet(t *testing.T) {
	p, dong := moPhienThu(t, map[string]tuyenThu{
		"/api/health": {ma: http.StatusServiceUnavailable, than: `{"ok":false,"db":"down"}`},
	})
	defer dong()
	if !p.quetSongCon() {
		t.Fatal("CSDL chết nhưng API còn trả lời -> phải tiếp tục quét, không được coi là mất liên lạc")
	}
	phaiCo(t, p, "CSDL không phản hồi", "P1", 0)
}

func TestSongConKhongGoiDuoc(t *testing.T) {
	p, dong := moPhienThu(t, map[string]tuyenThu{})
	dong() // đóng server trước khi quét: mô phỏng app sập
	if p.quetSongCon() {
		t.Fatal("không gọi được API mà vẫn báo tiếp tục quét được")
	}
	phaiCo(t, p, "App không phản hồi", "P1", 0)
}

func TestDangNhapHetHan(t *testing.T) {
	p, dong := moPhienThu(t, map[string]tuyenThu{
		"/api/auth/me": {ma: http.StatusUnauthorized, than: `{"error":"Chưa đăng nhập"}`},
	})
	defer dong()
	if p.quetDangNhap() {
		t.Fatal("token hết hạn mà vẫn coi là đăng nhập được")
	}
	phaiCo(t, p, "Phiên giám sát không còn hiệu lực", "P1", 0)
}

// Endpoint lỗi phải thành cảnh báo: im lặng bỏ qua thì lượt quét trông như "sạch" trong khi nó đang MÙ.
func TestEndpointLoiKhongDuocImLang(t *testing.T) {
	p, dong := moPhienThu(t, map[string]tuyenThu{
		"/api/admin/data-health": {ma: http.StatusForbidden, than: `{"error":"Không đủ quyền"}`},
	})
	defer dong()
	p.quetToanVen()
	cb := phaiCo(t, p, "Không đọc được /api/admin/data-health", "P1", 0)
	if !strings.Contains(cb.MoTa, "KHÔNG kết luận được là sạch") {
		t.Errorf("mô tả phải nói rõ lượt quét bị mù, đang là: %s", cb.MoTa)
	}
}

/* ---------- P2 ---------- */

func TestDonTreSLA(t *testing.T) {
	don := `[
      {"id":1,"status":"new","title":"Vòi nước rỉ","room_name":"101","category":"damage","created_at":"` + isoTruoc(2) + `","assigned_at":null,"resolved_at":null},
      {"id":2,"status":"new","title":"Đèn cháy","room_name":"102","category":"damage","created_at":"` + isoTruoc(13) + `","assigned_at":null,"resolved_at":null},
      {"id":3,"status":"processing","title":"Cửa kẹt","room_name":"103","category":"damage","created_at":"` + isoTruoc(30) + `","assigned_at":"` + isoTruoc(29) + `","resolved_at":null},
      {"id":4,"status":"done","title":"Đã xong","room_name":"104","category":"damage","created_at":"` + isoTruoc(99) + `","assigned_at":"` + isoTruoc(98) + `","resolved_at":"` + isoTruoc(97) + `"}
    ]`
	p, dong := moPhienThu(t, map[string]tuyenThu{"/api/requests/damage": {than: don}})
	defer dong()
	p.quetDon()

	chuaNhan := phaiCo(t, p, "Đơn chưa có người tiếp nhận", "P2", 1)
	if !strings.Contains(chuaNhan.DoiTuong[0], "#2") {
		t.Errorf("đơn quá hạn tiếp nhận phải là #2, đang là: %v", chuaNhan.DoiTuong)
	}
	// Đơn #2 mở 13h: quá hạn TIẾP NHẬN nhưng chưa quá hạn hoàn thành (24h) — hai hạn tính riêng.
	chuaXong := phaiCo(t, p, "Đơn chưa hoàn thành quá hạn", "P2", 1)
	if !strings.Contains(chuaXong.DoiTuong[0], "#3") {
		t.Errorf("đơn quá hạn hoàn thành phải là #3, đang là: %v", chuaXong.DoiTuong)
	}
	// #4 đã done và #1 mới mở 2h: không được xuất hiện ở bất kỳ cảnh báo nào.
	het := strings.Join(append(chuaNhan.DoiTuong, chuaXong.DoiTuong...), " ")
	if strings.Contains(het, "#4") || strings.Contains(het, "#1 ") {
		t.Errorf("đơn đã xong hoặc còn trong hạn bị báo oan: %s", het)
	}
}

func TestDienChiSoLuiVaPhongTrong(t *testing.T) {
	dien := `[
      {"room_id":1,"room_name":"101","reading_start":1200,"reading_end":1350,"kwh":150,"occupancy":4},
      {"room_id":2,"room_name":"102","reading_start":900,"reading_end":880,"kwh":-20,"occupancy":3},
      {"room_id":3,"room_name":"103","reading_start":500,"reading_end":560,"kwh":60,"occupancy":0},
      {"room_id":4,"room_name":"104","reading_start":700,"reading_end":0,"kwh":0,"occupancy":0}
    ]`
	p, dong := moPhienThu(t, map[string]tuyenThu{"/api/electric": {than: dien}})
	defer dong()
	p.quetDien()

	lui := phaiCo(t, p, "Chỉ số điện mới nhỏ hơn chỉ số cũ", "P2", 1)
	if !strings.Contains(lui.DoiTuong[0], "102") {
		t.Errorf("phải chỉ ra phòng 102, đang là: %v", lui.DoiTuong)
	}
	trong := phaiCo(t, p, "Phòng không có người ở nhưng vẫn phát sinh điện", "P2", 1)
	if !strings.Contains(trong.DoiTuong[0], "103") {
		t.Errorf("phải chỉ ra phòng 103, đang là: %v", trong.DoiTuong)
	}
	// Phòng 104 chưa chốt số (số cuối 0) — chưa nhập KHÔNG phải lỗi, không được báo lùi.
	if strings.Contains(strings.Join(lui.DoiTuong, " "), "104") {
		t.Error("phòng chưa nhập số cuối bị báo là chỉ số lùi")
	}
}

func TestVotDien(t *testing.T) {
	ls := `{"months":["2026-06","2026-07","2026-08","2026-09"],"rooms":[
      {"room_id":1,"room_name":"101","series":[{"month":"2026-06","kwh":100},{"month":"2026-07","kwh":110},{"month":"2026-08","kwh":90},{"month":"2026-09","kwh":400}]},
      {"room_id":2,"room_name":"102","series":[{"month":"2026-06","kwh":100},{"month":"2026-07","kwh":110},{"month":"2026-08","kwh":90},{"month":"2026-09","kwh":150}]},
      {"room_id":3,"room_name":"103","series":[{"month":"2026-06","kwh":0},{"month":"2026-07","kwh":0},{"month":"2026-08","kwh":50},{"month":"2026-09","kwh":300}]}
    ]}`
	p, dong := moPhienThu(t, map[string]tuyenThu{"/api/electric/history": {than: ls}})
	defer dong()
	p.quetVotDien()

	vot := phaiCo(t, p, "Tiêu thụ điện tăng vọt", "P2", 1)
	if !strings.Contains(vot.DoiTuong[0], "101") {
		t.Errorf("phải chỉ ra phòng 101, đang là: %v", vot.DoiTuong)
	}
	// Phòng 103 chỉ có 1 kỳ trước có số: trung bình 1 kỳ quá mong manh, không được báo.
	if strings.Contains(vot.DoiTuong[0], "103") {
		t.Error("phòng thiếu dữ liệu quá khứ bị báo tăng vọt")
	}
}

func TestPhieuThuKhoanAm(t *testing.T) {
	phieu := `[
      {"id":11,"student_name":"Nguyễn Văn A","room_name":"101","room_charge":1200000,"electric_charge":90000,"water_charge":50000,"service_charge":0,"washing_charge":0,"parking_charge":0,"other_charge":0,"total":1340000},
      {"id":12,"student_name":"Trần Thị B","room_name":"102","room_charge":1200000,"electric_charge":-45000,"water_charge":50000,"service_charge":0,"washing_charge":0,"parking_charge":0,"other_charge":0,"total":1205000}
    ]`
	p, dong := moPhienThu(t, map[string]tuyenThu{"/api/invoices": {than: phieu}})
	defer dong()
	p.quetPhieuAm()

	cb := phaiCo(t, p, "Phiếu thu có khoản tiền âm", "P2", 1)
	if !strings.Contains(cb.DoiTuong[0], "tiền điện") || !strings.Contains(cb.DoiTuong[0], "#12") {
		t.Errorf("phải nêu phiếu #12 khoản tiền điện, đang là: %v", cb.DoiTuong)
	}
}

/* ---------- P3 ---------- */

func TestToanVenDuLieu(t *testing.T) {
	dh := `{"guards":[{"ten":"students_code_unique","loi":"còn 2 mã trùng"}],"checks":[
      {"ma":"cccd_trung","ten":"Học viên trùng CCCD","vi_sao":"vì sao","cach_sua":"cách sửa","so_luong":2,
       "rows":[{"khoa":"0123","chi_tiet":"A (#1) + B (#2)"},{"khoa":"0456","chi_tiet":"C (#3) + D (#4)"}]},
      {"ma":"so_hd_trung","ten":"Trùng số hợp đồng","vi_sao":"vì sao","cach_sua":"cách sửa","so_luong":0,"rows":[]}
    ]}`
	p, dong := moPhienThu(t, map[string]tuyenThu{"/api/admin/data-health": {than: dh}})
	defer dong()
	p.quetToanVen()

	phaiCo(t, p, "Ràng buộc CSDL chưa áp được", "P1", 1)
	cb := phaiCo(t, p, "Học viên trùng CCCD", "P3", 2)
	if cb.NguyenNhan != "vì sao" || cb.HanhDong != "cách sửa" {
		t.Errorf("phải dùng lại vì_sao/cách_sửa của máy chủ, đang là %q / %q", cb.NguyenNhan, cb.HanhDong)
	}
	if timTen(p, "Trùng số hợp đồng") != nil {
		t.Error("phép kiểm có so_luong=0 không được sinh cảnh báo")
	}
}

func TestTaiKhoanConMoSauTraPhong(t *testing.T) {
	tk := `[
      {"username":"hv001","student_name":"A","student_code":"E1","student_status":"out","locked":false,"room_name":"101"},
      {"username":"hv002","student_name":"B","student_code":"E2","student_status":"out","locked":true,"room_name":"102"},
      {"username":"hv003","student_name":"C","student_code":"E3","student_status":"in","locked":false,"room_name":"103"}
    ]`
	p, dong := moPhienThu(t, map[string]tuyenThu{"/api/admin/student-accounts": {than: tk}})
	defer dong()
	p.quetTaiKhoanSauTraPhong()

	cb := phaiCo(t, p, "Đã trả phòng nhưng tài khoản vẫn đăng nhập được", "P3", 1)
	if !strings.Contains(cb.DoiTuong[0], "hv001") {
		t.Errorf("chỉ hv001 vi phạm, đang là: %v", cb.DoiTuong)
	}
}

// Quá sức chứa là tình huống ĐƯỢC PHÉP (chốt 15/07/2026): chỉ liệt kê ở mức P3 và phải nói rõ.
func TestVuotSucChuaChiLaGhiNhan(t *testing.T) {
	phong := `[
      {"name":"101","facility_name":"CS1","capacity":4,"occupancy":6,"upcoming":0,"leaving":1},
      {"name":"102","facility_name":"CS1","capacity":4,"occupancy":4,"upcoming":0,"leaving":0},
      {"name":"103","facility_name":"CS1","capacity":0,"occupancy":2,"upcoming":0,"leaving":0}
    ]`
	p, dong := moPhienThu(t, map[string]tuyenThu{"/api/rooms": {than: phong}})
	defer dong()
	p.quetVuotSucChua()

	cb := phaiCo(t, p, "Phòng đang ở quá sức chứa", "P3", 1)
	if !strings.Contains(cb.MoTa, "ĐƯỢC PHÉP") {
		t.Errorf("mô tả phải nói rõ đây là tình huống được phép, đang là: %s", cb.MoTa)
	}
	if !strings.Contains(cb.DoiTuong[0], "101") {
		t.Errorf("chỉ phòng 101 vượt, đang là: %v", cb.DoiTuong)
	}
}

/* ---------- Dữ liệu sạch thì phải im ---------- */

func TestDuLieuSachKhongBaoGi(t *testing.T) {
	p, dong := moPhienThu(t, map[string]tuyenThu{
		"/api/requests/damage": {than: `[{"id":1,"status":"done","title":"x","room_name":"101","category":"damage","created_at":"` + isoTruoc(50) + `","assigned_at":"` + isoTruoc(49) + `","resolved_at":"` + isoTruoc(40) + `"}]`},
		"/api/electric":        {than: `[{"room_id":1,"room_name":"101","reading_start":100,"reading_end":180,"kwh":80,"occupancy":4}]`},
		"/api/electric/history": {than: `{"months":["2026-06","2026-07","2026-08","2026-09"],"rooms":[
		   {"room_id":1,"room_name":"101","series":[{"month":"2026-06","kwh":80},{"month":"2026-07","kwh":85},{"month":"2026-08","kwh":75},{"month":"2026-09","kwh":80}]}]}`},
		"/api/invoices":               {than: `[{"id":1,"student_name":"A","room_name":"101","room_charge":1200000,"electric_charge":80000,"water_charge":50000,"total":1330000}]`},
		"/api/admin/data-health":      {than: `{"guards":[],"checks":[{"ma":"cccd_trung","ten":"Học viên trùng CCCD","vi_sao":"x","cach_sua":"y","so_luong":0,"rows":[]}]}`},
		"/api/admin/student-accounts": {than: `[{"username":"hv001","student_name":"A","student_code":"E1","student_status":"in","locked":false,"room_name":"101"}]`},
		"/api/rooms":                  {than: `[{"name":"101","facility_name":"CS1","capacity":4,"occupancy":4,"upcoming":0,"leaving":0}]`},
		"/api/admin/pending-count":    {than: `{"pending":0}`},
	})
	defer dong()
	p.quetDon()
	p.quetDien()
	p.quetVotDien()
	p.quetPhieuAm()
	p.quetToanVen()
	p.quetTaiKhoanSauTraPhong()
	p.quetVuotSucChua()
	p.quetChoDuyet()
	phaiSach(t, p)
}

/* ---------- Gửi mail ---------- */

func TestChinhSachGuiMail(t *testing.T) {
	cases := []struct {
		chinhSach string
		soCanhBao int
		muon      bool
	}{
		{"khong", 0, false},
		{"khong", 3, false},
		{"co-canh-bao", 0, false},
		{"co-canh-bao", 1, true},
		{"luon", 0, true},
		{"luon", 2, true},
	}
	for _, c := range cases {
		p, dong := moPhienThu(t, map[string]tuyenThu{})
		p.ch.mail = c.chinhSach
		p.list = make([]canhBao, c.soCanhBao)
		if got := p.nenGuiMail(); got != c.muon {
			t.Errorf("-mail %s với %d cảnh báo: gửi=%v, muốn %v", c.chinhSach, c.soCanhBao, got, c.muon)
		}
		dong()
	}
}

func TestGuiMailGoiTin(t *testing.T) {
	var duong, phuongThuc, xacThuc string
	var than map[string]interface{}
	sv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		duong, phuongThuc, xacThuc = r.URL.Path, r.Method, r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&than)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true,"da_gui":2}`)
	}))
	defer sv.Close()

	ch := cauHinh{goc: sv.URL, muc: "p2", ky: "2026-09", token: "vexe", choPhep: 5 * time.Second, soDoiTuong: 15}
	p := &phien{ch: ch, k: moKhach(ch), bay: mocThu, ban: "v315"}
	p.list = []canhBao{{Muc: "P2", Ten: "x"}, {Muc: "P3", Ten: "y"}, {Muc: "P3", Ten: "z"}}

	if err := p.guiMail("NỘI DUNG BÁO CÁO"); err != nil {
		t.Fatalf("gửi mail lỗi: %v", err)
	}
	if duong != "/api/admin/giam-sat/mail" || phuongThuc != http.MethodPost {
		t.Errorf("gọi sai: %s %s", phuongThuc, duong)
	}
	if xacThuc != "Bearer vexe" {
		t.Errorf("thiếu token: %q", xacThuc)
	}
	if than["muc"] != "p2" || than["noi_dung"] != "NỘI DUNG BÁO CÁO" {
		t.Errorf("thân sai: %v", than)
	}
	// Người nhận do máy chủ quyết: công cụ KHÔNG được gửi địa chỉ nào lên.
	for _, cam := range []string{"to", "email", "nguoi_nhan"} {
		if _, co := than[cam]; co {
			t.Errorf("thân có khoá %q — người nhận không được đến từ công cụ: %v", cam, than)
		}
	}
	if than["p1"] != float64(0) || than["p2"] != float64(1) || than["p3"] != float64(2) {
		t.Errorf("đếm mức sai: p1=%v p2=%v p3=%v", than["p1"], than["p2"], than["p3"])
	}
}

// Máy chủ từ chối thì công cụ phải nêu đúng lý do, không nuốt im.
func TestGuiMailBaoLoiMayChu(t *testing.T) {
	sv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, `{"ok":false,"error":"Chưa cấu hình SMTP trong Cài đặt"}`)
	}))
	defer sv.Close()

	ch := cauHinh{goc: sv.URL, muc: "p3", token: "vexe", choPhep: 5 * time.Second, soDoiTuong: 15}
	p := &phien{ch: ch, k: moKhach(ch), bay: mocThu}
	err := p.guiMail("x")
	if err == nil {
		t.Fatal("máy chủ trả 503 mà công cụ coi như gửi xong")
	}
	if !strings.Contains(err.Error(), "Chưa cấu hình SMTP") {
		t.Errorf("thông điệp lỗi phải nêu lý do của máy chủ, đang là: %v", err)
	}
}

/* ---------- Trình bày ---------- */

func TestCatBotDoiTuong(t *testing.T) {
	p, dong := moPhienThu(t, map[string]tuyenThu{})
	defer dong()
	p.ch.soDoiTuong = 3
	ds := []string{"a", "b", "c", "d", "e"}
	ra := p.catBot(ds)
	if len(ra) != 4 || ra[3] != "… và 2 mục khác" {
		t.Fatalf("cắt sai: %v", ra)
	}
	if ds[3] != "d" {
		t.Errorf("catBot ghi đè lát gốc: %v", ds)
	}
}

// Top lỗi phải xếp GIẢM DẦN theo số bản ghi — so_luong là int nên hàm đọc số phải nhận cả int.
func TestTomTatTuanXepTopGiamDan(t *testing.T) {
	p, dong := moPhienThu(t, map[string]tuyenThu{})
	defer dong()
	p.dh = []map[string]interface{}{
		{"ten": "Lỗi bị loại", "so_luong": 1},
		{"ten": "Lỗi vừa", "so_luong": 7},
		{"ten": "Lỗi nhiều", "so_luong": 30},
		{"ten": "Lỗi ít", "so_luong": 2},
	}
	tt := p.tomTatTuan()
	viTri := func(ten string) int { return strings.Index(tt, ten) }
	if viTri("Lỗi nhiều") < 0 || viTri("Lỗi nhiều") > viTri("Lỗi vừa") || viTri("Lỗi vừa") > viTri("Lỗi ít") {
		t.Errorf("top lỗi không giảm dần:\n%s", tt)
	}
	if strings.Contains(tt, "Lỗi bị loại") {
		t.Errorf("chỉ lấy 3 lỗi đầu:\n%s", tt)
	}
}

func TestTomTatTuanTiLeDungHan(t *testing.T) {
	p, dong := moPhienThu(t, map[string]tuyenThu{})
	defer dong()
	p.don = []map[string]interface{}{
		{"created_at": isoTruoc(60), "resolved_at": isoTruoc(50)},
		{"created_at": isoTruoc(100), "resolved_at": isoTruoc(20)},
		{"created_at": isoTruoc(400), "resolved_at": isoTruoc(300)},
	}
	tt := p.tomTatTuan()
	if !strings.Contains(tt, "Đơn đóng trong 7 ngày: 2") || !strings.Contains(tt, "đúng hạn 24h: 1 (50%)") {
		t.Errorf("tỉ lệ đúng hạn sai:\n%s", tt)
	}
}
