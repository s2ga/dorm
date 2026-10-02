// Giám sát hệ thống và toàn vẹn dữ liệu: quét API CHỈ-ĐỌC của một môi trường đang chạy rồi in cảnh báo.
// Mức cảnh báo phản ánh BẢN CHẤT lỗi, không phải lịch quét — một lượt -muc p3 vẫn có thể ra P1.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"sort"
	"strings"
	"time"
)

const (
	loiHeThong = "Lỗi Hệ Thống"
	loiDuLieu  = "Lỗi Dữ Liệu"
	treSLA     = "Trễ SLA"
)

// ict: cố định +07:00 thay vì LoadLocation — ảnh scratch không có tzdata.
var ict = time.FixedZone("ICT", 7*60*60)

type canhBao struct {
	Muc        string   `json:"muc"`
	Ten        string   `json:"ten"`
	LucPhat    string   `json:"luc_phat_hien"`
	PhanLoai   string   `json:"phan_loai"`
	MoTa       string   `json:"mo_ta"`
	DoiTuong   []string `json:"doi_tuong"`
	NguyenNhan string   `json:"nguyen_nhan_du_doan"`
	HanhDong   string   `json:"goi_y_hanh_dong"`
}

type cauHinh struct {
	goc        string
	muc        string
	dinhDang   string
	mail       string
	ky         string
	token      string
	taiKhoan   string
	matKhau    string
	slaNhan    time.Duration
	slaXong    time.Duration
	nguongVot  float64
	soThangTB  int
	choPhep    time.Duration
	soDoiTuong int
}

/* ---------- Khách gọi API ---------- */

type khach struct {
	goc   string
	token string
	hc    *http.Client
}

func moKhach(ch cauHinh) *khach {
	jar, _ := cookiejar.New(nil)
	return &khach{goc: ch.goc, token: ch.token, hc: &http.Client{Jar: jar, Timeout: ch.choPhep}}
}

// doc: GET một endpoint. Trả mã HTTP (0 = không gọi được) và lỗi.
func (k *khach) doc(duong string, ra interface{}) (int, error) {
	req, err := http.NewRequest(http.MethodGet, k.goc+duong, nil)
	if err != nil {
		return 0, err
	}
	if k.token != "" {
		req.Header.Set("Authorization", "Bearer "+k.token)
	}
	res, err := k.hc.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	than, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return res.StatusCode, err
	}
	if ra != nil && res.StatusCode == http.StatusOK {
		if err := json.Unmarshal(than, ra); err != nil {
			return res.StatusCode, fmt.Errorf("%s trả về thân không phải JSON hợp lệ", duong)
		}
	}
	return res.StatusCode, nil
}

// dangNhap: lấy cookie phiên. Không bao giờ in mật khẩu ra, kể cả trong thông điệp lỗi.
func (k *khach) dangNhap(ten, mk string) error {
	than, _ := json.Marshal(map[string]string{"username": ten, "password": mk})
	res, err := k.hc.Post(k.goc+"/api/auth/login", "application/json", bytes.NewReader(than))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		if e.Error == "" {
			e.Error = fmt.Sprintf("mã HTTP %d", res.StatusCode)
		}
		return fmt.Errorf("đăng nhập tài khoản %q thất bại: %s", ten, e.Error)
	}
	return nil
}

/* ---------- Phiên quét ---------- */

type phien struct {
	ch   cauHinh
	k    *khach
	bay  time.Time
	ban  string
	list []canhBao
	dh   []map[string]interface{}
	don  []map[string]interface{}
}

func (p *phien) them(muc, ten, phanLoai, moTa string, doiTuong []string, nguyenNhan, hanhDong string) {
	p.list = append(p.list, canhBao{
		Muc: muc, Ten: ten, LucPhat: p.bay.Format("02/01/2006 15:04:05 -07:00"), PhanLoai: phanLoai,
		MoTa: moTa, DoiTuong: p.catBot(doiTuong), NguyenNhan: nguyenNhan, HanhDong: hanhDong,
	})
}

func (p *phien) catBot(ds []string) []string {
	if len(ds) <= p.ch.soDoiTuong {
		return ds
	}
	con := len(ds) - p.ch.soDoiTuong
	return append(ds[:p.ch.soDoiTuong:p.ch.soDoiTuong], fmt.Sprintf("… và %d mục khác", con))
}

// loiApi: cảnh báo dùng chung khi một endpoint không trả được dữ liệu -> phép kiểm bị mù, không phải "sạch".
func (p *phien) loiApi(duong string, ma int, err error) {
	chiTiet := fmt.Sprintf("mã HTTP %d", ma)
	if ma == 0 {
		chiTiet = "không gọi được: " + err.Error()
	} else if err != nil {
		chiTiet = err.Error()
	}
	p.them("P1", "Không đọc được "+duong, loiHeThong,
		"Phép kiểm dựa trên "+duong+" đã bị bỏ qua ("+chiTiet+") — lượt quét này KHÔNG kết luận được là sạch.",
		nil,
		"Endpoint lỗi, tài khoản giám sát thiếu vai, hoặc mạng gián đoạn giữa lượt quét.",
		"Gọi tay endpoint đó bằng tài khoản giám sát để xem thân phản hồi, rồi soi log máy chủ cùng mốc giờ.")
}

/* ---------- P1: sống còn ---------- */

// quetSongCon: trả false nếu API không gọi được (mọi phép kiểm sau đó vô nghĩa).
func (p *phien) quetSongCon() bool {
	var hl struct {
		Ok bool   `json:"ok"`
		Db string `json:"db"`
	}
	ma, err := p.k.doc("/api/health", &hl)
	switch {
	case ma == 0:
		p.them("P1", "App không phản hồi", loiHeThong,
			"Gọi "+p.ch.goc+"/api/health thất bại: "+err.Error(),
			nil,
			"App sập hoặc đang khởi động lại, tên miền/DNS hỏng, hoặc lối ra mạng bị chặn.",
			"Kiểm tra pod đang chạy (kubectl get pods -n dorm), sau đó log của bản mới nhất; chưa cần đụng CSDL.")
		return false
	case ma == http.StatusServiceUnavailable:
		p.them("P1", "CSDL không phản hồi", loiHeThong,
			"/api/health trả 503 (db=\""+hl.Db+"\") — app còn sống nhưng ping CSDL thất bại trong 2 giây.",
			nil,
			"CSDL tắt, hết kết nối trong pool, hoặc chuỗi kết nối sai sau một lần đổi mật khẩu.",
			"Soi CSDL trước: 503 ở đây nghĩa là CSDL, KHÔNG phải app hỏng. Restart app không cứu được.")
	case ma != http.StatusOK || !hl.Ok:
		p.them("P1", "Health check không xanh", loiHeThong,
			fmt.Sprintf("/api/health trả mã %d, ok=%v, db=%q.", ma, hl.Ok, hl.Db),
			nil,
			"App vừa deploy hỏng, hoặc có proxy/WAF chắn trước trả về mã lạ.",
			"Xem log bản dựng mới nhất và mã trả về ở proxy trước app.")
	}

	var v map[string]interface{}
	if ma, err := p.k.doc("/api/version", &v); ma != http.StatusOK {
		p.loiApi("/api/version", ma, err)
	} else {
		p.ban = fmt.Sprintf("%v · commit %v · asset ?v=%v · env %v",
			traChu(v["version"], "(trống)"), traChu(v["commit_short"], "?"),
			traChu(v["asset_version"], "?"), traChu(v["app_env"], "?"))
	}
	return true
}

// quetDangNhap: đăng nhập được hay không là phép kiểm P1 — đồng thời là điều kiện của mọi quét P2/P3.
func (p *phien) quetDangNhap() bool {
	if p.ch.token == "" && p.ch.taiKhoan == "" {
		return false
	}
	if p.ch.token == "" {
		if err := p.k.dangNhap(p.ch.taiKhoan, p.ch.matKhau); err != nil {
			p.them("P1", "Không đăng nhập được", loiHeThong,
				"Tài khoản giám sát không vào được: "+err.Error(),
				nil,
				"Mật khẩu đã đổi, tài khoản bị khoá, hoặc đang bị chặn tạm vì đăng nhập sai quá nhiều.",
				"Thử đăng nhập tay bằng tài khoản đó. Nếu báo tạm khoá thì đợi hết 15 phút rồi đặt lại KTX_PASS cho đúng.")
			return false
		}
	}
	ma, err := p.k.doc("/api/auth/me", nil)
	if ma == http.StatusOK {
		return true
	}
	if ma == http.StatusUnauthorized || ma == http.StatusForbidden {
		p.them("P1", "Phiên giám sát không còn hiệu lực", loiHeThong,
			fmt.Sprintf("/api/auth/me trả %d — token hết hạn (hạn 30 ngày) hoặc tài khoản đã bị khoá/đổi vai.", ma),
			nil,
			"Token cấp từ lần trước đã quá hạn, hoặc tài khoản giám sát bị khoá.",
			"Cấp lại KTX_TOKEN mới, hoặc chuyển sang cấu hình KTX_USER/KTX_PASS.")
		return false
	}
	p.loiApi("/api/auth/me", ma, err)
	return false
}

/* ---------- P2: trong ngày ---------- */

func (p *phien) quetDon() {
	var ds []map[string]interface{}
	if ma, err := p.k.doc("/api/requests/damage", &ds); ma != http.StatusOK {
		p.loiApi("/api/requests/damage", ma, err)
		return
	}
	p.don = ds
	var chuaNhan, chuaXong []string
	for _, d := range ds {
		if chu(d["status"]) == "done" {
			continue
		}
		tao, ok := moc(d["created_at"])
		if !ok {
			continue
		}
		treo := p.bay.Sub(tao)
		nhan := "#" + soNguyen(d["id"]) + " " + nhanDon(d) + fmt.Sprintf(" · mở %s", gioGon(treo))
		if _, daNhan := moc(d["assigned_at"]); !daNhan && treo > p.ch.slaNhan {
			chuaNhan = append(chuaNhan, nhan)
		}
		if treo > p.ch.slaXong {
			chuaXong = append(chuaXong, nhan+" · trạng thái "+chu(d["status"]))
		}
	}
	if len(chuaNhan) > 0 {
		p.them("P2", "Đơn chưa có người tiếp nhận", treSLA,
			fmt.Sprintf("%d đơn mở quá %s mà chưa được chuyển cho bộ phận bảo trì.", len(chuaNhan), gioGon(p.ch.slaNhan)),
			chuaNhan,
			"Đơn vào ngoài giờ hoặc không ai theo màn Yêu cầu hỗ trợ trong ngày.",
			"Mở màn Yêu cầu hỗ trợ, chuyển từng đơn cho bảo trì; đơn không thuộc bảo trì thì đổi phân loại rồi đóng.")
	}
	if len(chuaXong) > 0 {
		p.them("P2", "Đơn chưa hoàn thành quá hạn", treSLA,
			fmt.Sprintf("%d đơn mở quá %s mà chưa chuyển sang hoàn thành.", len(chuaXong), gioGon(p.ch.slaXong)),
			chuaXong,
			"Việc chờ vật tư, chờ học viên có mặt, hoặc đã sửa xong nhưng không ai đóng đơn.",
			"Đơn đã sửa xong thì đóng ngay để số liệu SLA đúng; đơn còn treo thì ghi rõ lý do vào ghi chú.")
	}
}

func (p *phien) quetDien() {
	var ds []map[string]interface{}
	duong := "/api/electric?month=" + p.ch.ky
	if ma, err := p.k.doc(duong, &ds); ma != http.StatusOK {
		p.loiApi(duong, ma, err)
		return
	}
	var lui, trongMaTon []string
	for _, e := range ds {
		dau, cuoi, kwh := so(e["reading_start"]), so(e["reading_end"]), so(e["kwh"])
		phong := chu(e["room_name"])
		if cuoi > 0 && cuoi < dau {
			lui = append(lui, fmt.Sprintf("Phòng %s: số đầu %.1f → số cuối %.1f (tiêu thụ %.1f kWh)", phong, dau, cuoi, kwh))
		}
		if kwh > 0 && so(e["occupancy"]) == 0 {
			trongMaTon = append(trongMaTon, fmt.Sprintf("Phòng %s: %.1f kWh, không có người ở", phong, kwh))
		}
	}
	if len(lui) > 0 {
		p.them("P2", "Chỉ số điện mới nhỏ hơn chỉ số cũ", loiDuLieu,
			fmt.Sprintf("Kỳ %s có %d phòng ghi số cuối thấp hơn số đầu — tiêu thụ ra số âm, tiền điện cả phòng sai.", p.ch.ky, len(lui)),
			lui,
			"Gõ nhầm chữ số, đọc lộn công-tơ giữa hai phòng, hoặc công-tơ vừa được thay mà chưa ghi lại số gốc.",
			"Mở màn Tiền điện đúng kỳ, đối chiếu ảnh chụp công-tơ rồi sửa số cuối. Công-tơ thay mới thì ghi chú lại.")
	}
	if len(trongMaTon) > 0 {
		p.them("P2", "Phòng không có người ở nhưng vẫn phát sinh điện", loiDuLieu,
			fmt.Sprintf("Kỳ %s có %d phòng đang trống mà vẫn có tiêu thụ — số này không chia được cho ai.", p.ch.ky, len(trongMaTon)),
			trongMaTon,
			"Hồ sơ người ở chưa được ghi (thiếu lượt ở), hoặc thiết bị còn cắm điện sau khi phòng trống.",
			"Đối chiếu danh sách phòng: có người ở thật thì sửa hồ sơ; phòng trống thật thì kiểm tra thiết bị còn cắm.")
	}
}

func (p *phien) quetVotDien() {
	var kq struct {
		Months []string `json:"months"`
		Rooms  []struct {
			RoomName string `json:"room_name"`
			Series   []struct {
				Month string  `json:"month"`
				Kwh   float64 `json:"kwh"`
			} `json:"series"`
		} `json:"rooms"`
	}
	duong := fmt.Sprintf("/api/electric/history?month=%s&n=%d", p.ch.ky, p.ch.soThangTB+1)
	if ma, err := p.k.doc(duong, &kq); ma != http.StatusOK {
		p.loiApi(duong, ma, err)
		return
	}
	var vot []string
	for _, r := range kq.Rooms {
		if len(r.Series) < 2 {
			continue
		}
		nay := r.Series[len(r.Series)-1]
		if nay.Month != p.ch.ky || nay.Kwh <= 0 {
			continue
		}
		tong, dem := 0.0, 0
		for _, s := range r.Series[:len(r.Series)-1] {
			if s.Kwh > 0 {
				tong += s.Kwh
				dem++
			}
		}
		if dem < 2 {
			continue
		}
		tb := tong / float64(dem)
		if nay.Kwh > tb*p.ch.nguongVot/100 {
			vot = append(vot, fmt.Sprintf("Phòng %s: %.1f kWh kỳ này · trung bình %d kỳ trước %.1f kWh (%.0f%%)",
				r.RoomName, nay.Kwh, dem, tb, nay.Kwh/tb*100))
		}
	}
	if len(vot) > 0 {
		p.them("P2", "Tiêu thụ điện tăng vọt", loiDuLieu,
			fmt.Sprintf("Kỳ %s có %d phòng vượt %.0f%% trung bình %d kỳ gần nhất của chính phòng đó.",
				p.ch.ky, len(vot), p.ch.nguongVot, p.ch.soThangTB),
			vot,
			"Gõ thừa chữ số khi nhập số cuối, hoặc thật sự có thiết bị công suất lớn / rò điện trong phòng.",
			"Đối chiếu ảnh công-tơ trước khi phát phiếu thu — số nhập sai mà phát phiếu rồi thì phải mở khoá phiếu để tính lại.")
	}
}

var khoanTien = []struct{ khoa, ten string }{
	{"room_charge", "tiền phòng"}, {"electric_charge", "tiền điện"}, {"water_charge", "tiền nước"},
	{"service_charge", "dịch vụ"}, {"washing_charge", "máy giặt"}, {"parking_charge", "gửi xe"},
	{"other_charge", "khoản khác"}, {"total", "tổng cộng"},
}

func (p *phien) quetPhieuAm() {
	var ds []map[string]interface{}
	duong := "/api/invoices?month=" + p.ch.ky
	if ma, err := p.k.doc(duong, &ds); ma != http.StatusOK {
		p.loiApi(duong, ma, err)
		return
	}
	var am []string
	for _, i := range ds {
		var xau []string
		for _, kt := range khoanTien {
			if so(i[kt.khoa]) < 0 {
				xau = append(xau, fmt.Sprintf("%s %.0fđ", kt.ten, so(i[kt.khoa])))
			}
		}
		if len(xau) > 0 {
			am = append(am, fmt.Sprintf("#%s %s · phòng %s: %s", soNguyen(i["id"]), chu(i["student_name"]),
				chu(i["room_name"]), strings.Join(xau, ", ")))
		}
	}
	if len(am) > 0 {
		p.them("P2", "Phiếu thu có khoản tiền âm", loiDuLieu,
			fmt.Sprintf("Kỳ %s có %d phiếu chứa khoản tiền âm — bản in gửi học viên sẽ ra số âm.", p.ch.ky, len(am)),
			am,
			"Nhập tay số âm để bù trừ kỳ trước, hoặc một lần tính lại bị lỗi làm tròn.",
			"Không dùng số âm để bù trừ: sửa phiếu kỳ gốc rồi tính lại, phần chênh ghi vào ghi chú phiếu.")
	}
}

/* ---------- P3: toàn vẹn dữ liệu ---------- */

func (p *phien) quetToanVen() {
	var kq struct {
		Guards []map[string]interface{} `json:"guards"`
		Checks []struct {
			Ma      string                   `json:"ma"`
			Ten     string                   `json:"ten"`
			ViSao   string                   `json:"vi_sao"`
			CachSua string                   `json:"cach_sua"`
			SoLuong int                      `json:"so_luong"`
			Rows    []map[string]interface{} `json:"rows"`
		} `json:"checks"`
	}
	if ma, err := p.k.doc("/api/admin/data-health", &kq); ma != http.StatusOK {
		p.loiApi("/api/admin/data-health", ma, err)
		return
	}
	if len(kq.Guards) > 0 {
		var ds []string
		for _, g := range kq.Guards {
			ds = append(ds, fmt.Sprintf("%v: %v", g["ten"], g["loi"]))
		}
		p.them("P1", "Ràng buộc CSDL chưa áp được", loiHeThong,
			fmt.Sprintf("%d ràng buộc trong schema_guard chưa áp vì dữ liệu hiện tại vi phạm — CSDL đang chạy thiếu lớp chặn đó.", len(kq.Guards)),
			ds,
			"Dữ liệu cũ vi phạm ràng buộc nên câu lệnh áp lược đồ lúc khởi động bị bỏ qua.",
			"Dọn các bản ghi vi phạm theo danh sách bên dưới rồi khởi động lại app để ràng buộc được áp.")
	}
	for _, c := range kq.Checks {
		if c.SoLuong == 0 {
			continue
		}
		p.dh = append(p.dh, map[string]interface{}{"ten": c.Ten, "so_luong": c.SoLuong})
		var ds []string
		for _, r := range c.Rows {
			ds = append(ds, fmt.Sprintf("%v — %v", r["khoa"], r["chi_tiet"]))
		}
		p.them("P3", c.Ten, loiDuLieu,
			fmt.Sprintf("%d bản ghi lệch (mã kiểm: %s).", c.SoLuong, c.Ma),
			ds, c.ViSao, c.CachSua)
	}
}

func (p *phien) quetTaiKhoanSauTraPhong() {
	var ds []map[string]interface{}
	if ma, err := p.k.doc("/api/admin/student-accounts", &ds); ma != http.StatusOK {
		p.loiApi("/api/admin/student-accounts", ma, err)
		return
	}
	var mo []string
	for _, u := range ds {
		if chu(u["student_status"]) != "out" || dung(u["locked"]) {
			continue
		}
		mo = append(mo, fmt.Sprintf("%s (%s) · tài khoản %s · phòng %s",
			chu(u["student_name"]), chu(u["student_code"]), chu(u["username"]), chu(u["room_name"])))
	}
	if len(mo) > 0 {
		p.them("P3", "Đã trả phòng nhưng tài khoản vẫn đăng nhập được", loiDuLieu,
			fmt.Sprintf("%d học viên trạng thái đã ra mà tài khoản chưa khoá — trái luật xác nhận trả phòng phải khoá tài khoản.", len(mo)),
			mo,
			"Ngày trả được ghi thẳng vào hồ sơ thay vì đi qua bước xác nhận trả phòng, nên app không khoá tài khoản.",
			"Màn Cài đặt → Tài khoản học viên → khoá từng tài khoản trong danh sách.")
	}
}

func (p *phien) quetVuotSucChua() {
	var ds []map[string]interface{}
	if ma, err := p.k.doc("/api/rooms", &ds); ma != http.StatusOK {
		p.loiApi("/api/rooms", ma, err)
		return
	}
	var vuot []string
	for _, r := range ds {
		sucChua, dangO := so(r["capacity"]), so(r["occupancy"])
		if sucChua > 0 && dangO > sucChua {
			vuot = append(vuot, fmt.Sprintf("Phòng %s (%s): %.0f người / sức chứa %.0f · sắp vào %.0f · sắp ra %.0f",
				chu(r["name"]), chu(r["facility_name"]), dangO, sucChua, so(r["upcoming"]), so(r["leaving"])))
		}
	}
	if len(vuot) > 0 {
		p.them("P3", "Phòng đang ở quá sức chứa", loiDuLieu,
			fmt.Sprintf("%d phòng có số người ở vượt sức chứa. Đây là tình huống ĐƯỢC PHÉP (quyết định 15/07/2026: học viên vào chờ bạn xuất cảnh) — liệt kê để đối chiếu, KHÔNG phải lỗi cần sửa.", len(vuot)),
			vuot,
			"Xếp người vào trước khi người cũ xuất cảnh; hoặc hồ sơ người đã rời chưa được đóng lượt ở.",
			"Đối chiếu cột sắp ra: phòng nào không có ai sắp ra mà vẫn quá số thì kiểm lại hồ sơ người đã rời.")
	}
}

func (p *phien) quetChoDuyet() {
	var kq struct {
		Pending int `json:"pending"`
	}
	if ma, err := p.k.doc("/api/admin/pending-count", &kq); ma != http.StatusOK {
		p.loiApi("/api/admin/pending-count", ma, err)
		return
	}
	if kq.Pending > 0 {
		p.them("P3", "Tài khoản đăng nhập SSO chờ duyệt", loiDuLieu,
			fmt.Sprintf("%d tài khoản đang ở vai chờ duyệt — người đó đăng nhập được nhưng chưa dùng được gì.", kq.Pending),
			nil,
			"Nhân viên mới đăng nhập bằng Microsoft, chưa ai gán vai cho họ.",
			"Màn Cài đặt → Tài khoản nhân viên → gán vai đúng, hoặc khoá nếu không phải người của mình.")
	}
}

/* ---------- Tổng kết tuần ---------- */

func (p *phien) tomTatTuan() string {
	var b strings.Builder
	b.WriteString("\n════ TỔNG KẾT TUẦN ════\n")
	dem := p.demMuc()
	b.WriteString(fmt.Sprintf("Sức khoẻ hệ thống: %s · bản đang chạy: %s\n", trangThaiChung(dem), traTrong(p.ban, "không đọc được")))
	b.WriteString(fmt.Sprintf("Cảnh báo lượt này: P1=%d · P2=%d · P3=%d\n", dem["P1"], dem["P2"], dem["P3"]))

	tuNgay := p.bay.AddDate(0, 0, -7)
	dungHan, tre := 0, 0
	for _, d := range p.don {
		xong, ok := moc(d["resolved_at"])
		tao, ok2 := moc(d["created_at"])
		if !ok || !ok2 || xong.Before(tuNgay) {
			continue
		}
		if xong.Sub(tao) <= p.ch.slaXong {
			dungHan++
		} else {
			tre++
		}
	}
	if tong := dungHan + tre; tong > 0 {
		b.WriteString(fmt.Sprintf("Đơn đóng trong 7 ngày: %d · đúng hạn %s: %d (%.0f%%) · trễ: %d\n",
			tong, gioGon(p.ch.slaXong), dungHan, float64(dungHan)/float64(tong)*100, tre))
	} else {
		b.WriteString("Đơn đóng trong 7 ngày: không có đơn nào được đóng.\n")
	}

	if len(p.dh) == 0 {
		b.WriteString("Lỗi dữ liệu nhiều nhất: không có.\n")
		return b.String()
	}
	sort.SliceStable(p.dh, func(i, j int) bool {
		return soNguyenInt(p.dh[i]["so_luong"]) > soNguyenInt(p.dh[j]["so_luong"])
	})
	b.WriteString("Top lỗi dữ liệu nhiều nhất:\n")
	for i, c := range p.dh {
		if i >= 3 {
			break
		}
		b.WriteString(fmt.Sprintf("  %d. %v — %v bản ghi\n", i+1, c["ten"], c["so_luong"]))
	}
	return b.String()
}

/* ---------- Trình bày ---------- */

var thuTuMuc = map[string]int{"P1": 0, "P2": 1, "P3": 2}

// dungVanBan: bản báo cáo văn bản. Cùng một chuỗi dùng cho stdout và cho thân mail — hai nơi
// trình bày khác nhau là sớm muộn trôi lệch.
func (p *phien) dungVanBan(tomTat string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "KTX · GIÁM SÁT [%s] · %s\n", strings.ToUpper(p.ch.muc), p.bay.Format("02/01/2006 15:04:05 -07:00"))
	fmt.Fprintf(&b, "Môi trường: %s · kỳ tính tiền: %s\n", p.ch.goc, p.ch.ky)
	if p.ban != "" {
		fmt.Fprintf(&b, "Bản đang chạy: %s\n", p.ban)
	}
	if len(p.list) == 0 {
		b.WriteString("\nKhông phát hiện bất thường.\n")
	}
	for _, c := range p.list {
		fmt.Fprintf(&b, "\n🚨 [MỨC ĐỘ: %s] - %s\n", c.Muc, strings.ToUpper(c.Ten))
		fmt.Fprintf(&b, "- Thời gian phát hiện: %s\n", c.LucPhat)
		fmt.Fprintf(&b, "- Phân loại: %s\n", c.PhanLoai)
		fmt.Fprintf(&b, "- Mô tả chi tiết: %s\n", c.MoTa)
		if len(c.DoiTuong) == 0 {
			b.WriteString("- Đối tượng bị ảnh hưởng: toàn hệ thống\n")
		} else {
			b.WriteString("- Đối tượng bị ảnh hưởng:\n")
			for _, d := range c.DoiTuong {
				fmt.Fprintf(&b, "    · %s\n", d)
			}
		}
		fmt.Fprintf(&b, "- Nguyên nhân dự đoán: %s\n", c.NguyenNhan)
		fmt.Fprintf(&b, "- Gợi ý hành động: %s\n", c.HanhDong)
	}
	if tomTat != "" {
		b.WriteString(tomTat)
	}
	d := p.demMuc()
	fmt.Fprintf(&b, "\n── Kết thúc: %d cảnh báo (P1=%d · P2=%d · P3=%d)\n", len(p.list), d["P1"], d["P2"], d["P3"])
	return b.String()
}

func (p *phien) demMuc() map[string]int {
	dem := map[string]int{}
	for _, c := range p.list {
		dem[c.Muc]++
	}
	return dem
}

func (p *phien) inJson() error {
	ra := map[string]interface{}{
		"luc_quet":      p.bay.Format(time.RFC3339),
		"muc":           p.ch.muc,
		"moi_truong":    p.ch.goc,
		"ky":            p.ch.ky,
		"ban_dang_chay": p.ban,
		"canh_bao":      p.list,
	}
	if p.list == nil {
		ra["canh_bao"] = []canhBao{}
	}
	b, err := json.MarshalIndent(ra, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(b))
	return nil
}

/* ---------- Gửi mail qua máy chủ ---------- */

// nenGuiMail: chính sách gửi. "khong" không gửi · "co-canh-bao" chỉ gửi khi có cảnh báo ·
// "luon" gửi cả khi sạch (dùng cho lượt tuần, để im lặng không bị hiểu là chưa chạy).
func (p *phien) nenGuiMail() bool {
	switch p.ch.mail {
	case "luon":
		return true
	case "co-canh-bao":
		return len(p.list) > 0
	}
	return false
}

// guiMail: đẩy báo cáo lên /api/admin/giam-sat/mail. Mật khẩu SMTP nằm trong CSDL và KHÔNG lộ ra
// API, nên máy chủ là nơi gửi — công cụ chỉ đưa nội dung.
func (p *phien) guiMail(vanBan string) error {
	d := p.demMuc()
	than, err := json.Marshal(map[string]interface{}{
		"muc": p.ch.muc, "noi_dung": vanBan,
		"p1": d["P1"], "p2": d["P2"], "p3": d["P3"],
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, p.ch.goc+"/api/admin/giam-sat/mail", bytes.NewReader(than))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.ch.token != "" {
		req.Header.Set("Authorization", "Bearer "+p.ch.token)
	}
	res, err := p.k.hc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		if e.Error == "" {
			e.Error = fmt.Sprintf("mã HTTP %d", res.StatusCode)
		}
		return errors.New(e.Error)
	}
	var kq struct {
		DaGui int `json:"da_gui"`
	}
	_ = json.Unmarshal(body, &kq)
	fmt.Printf("\nĐã gửi báo cáo tới %d địa chỉ.\n", kq.DaGui)
	return nil
}

/* ---------- Đọc giá trị JSON (số NUMERIC về float64, DATE về chuỗi) ---------- */

// so: JSON giải mã số thành float64, nhưng giá trị dựng trong chương trình vẫn là int — nhận cả hai.
func so(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	case string:
		var f float64
		if _, err := fmt.Sscanf(n, "%g", &f); err == nil {
			return f
		}
	}
	return 0
}

func soNguyen(v interface{}) string { return fmt.Sprintf("%.0f", so(v)) }
func soNguyenInt(v interface{}) int { return int(so(v)) }

func chu(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

func dung(v interface{}) bool {
	b, ok := v.(bool)
	return ok && b
}

func moc(v interface{}) (time.Time, bool) {
	s, ok := v.(string)
	if !ok || s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, false
	}
	return t.In(ict), true
}

func traChu(v interface{}, khiTrong string) string {
	s := chu(v)
	if strings.TrimSpace(s) == "" {
		return khiTrong
	}
	return s
}

func traTrong(s, khiTrong string) string {
	if strings.TrimSpace(s) == "" {
		return khiTrong
	}
	return s
}

func nhanDon(d map[string]interface{}) string {
	nhan := chu(d["title"])
	if nhan == "" {
		nhan = "(không tiêu đề)"
	}
	if phong := chu(d["room_name"]); phong != "" {
		nhan += " · phòng " + phong
	}
	if lo := chu(d["category"]); lo != "" {
		nhan += " · " + lo
	}
	return nhan
}

func gioGon(d time.Duration) string {
	gio := int(d.Hours())
	if gio < 48 {
		return fmt.Sprintf("%dh", gio)
	}
	return fmt.Sprintf("%d ngày %dh", gio/24, gio%24)
}

func trangThaiChung(dem map[string]int) string {
	switch {
	case dem["P1"] > 0:
		return "CÓ SỰ CỐ"
	case dem["P2"] > 0:
		return "CẦN XỬ LÝ"
	case dem["P3"] > 0:
		return "ỔN, còn sai lệch dữ liệu"
	}
	return "ỔN"
}

/* ---------- Cấu hình và điều phối ---------- */

func docCauHinh() (cauHinh, error) {
	ch := cauHinh{}
	flag.StringVar(&ch.goc, "url", os.Getenv("KTX_URL"), "Gốc môi trường cần quét, ví dụ https://dev.s2.technology (hoặc biến KTX_URL)")
	flag.StringVar(&ch.muc, "muc", "p1", "Lượt quét: p1 (sống còn) · p2 (trong ngày) · p3 (toàn vẹn dữ liệu) · tuan (p2+p3+tổng kết)")
	flag.StringVar(&ch.dinhDang, "dinh-dang", "text", "Định dạng in ra: text hoặc json")
	flag.StringVar(&ch.mail, "mail", "khong", "Gửi mail cho quản trị: khong · co-canh-bao · luon (SMTP lấy từ Cài đặt trong CSDL)")
	flag.StringVar(&ch.ky, "ky", "", "Kỳ tính tiền YYYY-MM cho các phép kiểm điện/phiếu thu (trống = tháng hiện tại)")
	flag.DurationVar(&ch.slaNhan, "sla-nhan", 12*time.Hour, "Hạn tiếp nhận đơn hỗ trợ")
	flag.DurationVar(&ch.slaXong, "sla-xong", 24*time.Hour, "Hạn hoàn thành đơn hỗ trợ")
	flag.Float64Var(&ch.nguongVot, "nguong-vot", 200, "Ngưỡng tăng vọt điện, tính theo %% trung bình các kỳ trước")
	flag.IntVar(&ch.soThangTB, "so-thang-tb", 3, "Số kỳ trước dùng để lấy trung bình điện")
	flag.DurationVar(&ch.choPhep, "cho-phep", 30*time.Second, "Hạn chờ mỗi lượt gọi API")
	flag.IntVar(&ch.soDoiTuong, "so-doi-tuong", 15, "Số đối tượng liệt kê tối đa cho mỗi cảnh báo")
	flag.Parse()

	ch.token = os.Getenv("KTX_TOKEN")
	ch.taiKhoan = os.Getenv("KTX_USER")
	ch.matKhau = os.Getenv("KTX_PASS")
	ch.goc = strings.TrimRight(strings.TrimSpace(ch.goc), "/")
	ch.muc = strings.ToLower(ch.muc)

	if ch.goc == "" {
		return ch, errors.New("thiếu -url (hoặc biến KTX_URL)")
	}
	if !strings.HasPrefix(ch.goc, "http://") && !strings.HasPrefix(ch.goc, "https://") {
		return ch, errors.New("-url phải bắt đầu bằng http:// hoặc https://")
	}
	if ch.muc != "p1" && ch.muc != "p2" && ch.muc != "p3" && ch.muc != "tuan" {
		return ch, fmt.Errorf("-muc không hợp lệ: %q (nhận p1, p2, p3, tuan)", ch.muc)
	}
	if ch.dinhDang != "text" && ch.dinhDang != "json" {
		return ch, fmt.Errorf("-dinh-dang không hợp lệ: %q (nhận text, json)", ch.dinhDang)
	}
	ch.mail = strings.ToLower(strings.TrimSpace(ch.mail))
	if ch.mail != "khong" && ch.mail != "co-canh-bao" && ch.mail != "luon" {
		return ch, fmt.Errorf("-mail không hợp lệ: %q (nhận khong, co-canh-bao, luon)", ch.mail)
	}
	if ch.mail != "khong" && ch.token == "" && ch.taiKhoan == "" {
		return ch, errors.New("-mail cần tài khoản để gọi máy chủ: đặt KTX_TOKEN, hoặc KTX_USER + KTX_PASS")
	}
	if ch.ky == "" {
		ch.ky = time.Now().In(ict).Format("2006-01")
	} else if len(ch.ky) != 7 || ch.ky[4] != '-' {
		return ch, fmt.Errorf("-ky phải dạng YYYY-MM, nhận %q", ch.ky)
	}
	if ch.soThangTB < 2 {
		return ch, errors.New("-so-thang-tb phải từ 2 trở lên")
	}
	if ch.muc != "p1" && ch.token == "" && ch.taiKhoan == "" {
		return ch, fmt.Errorf("lượt quét %q cần tài khoản: đặt KTX_TOKEN, hoặc KTX_USER + KTX_PASS", ch.muc)
	}
	return ch, nil
}

func main() {
	ch, err := docCauHinh()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Cấu hình sai: "+err.Error())
		os.Exit(2)
	}
	p := &phien{ch: ch, k: moKhach(ch), bay: time.Now().In(ict)}

	tomTat := ""
	if p.quetSongCon() {
		vao := p.quetDangNhap()
		if !vao && ch.muc != "p1" {
			p.them("P1", "Không quét được phần cần đăng nhập", loiHeThong,
				fmt.Sprintf("Lượt %s bị dừng vì không có phiên hợp lệ — mọi phép kiểm dữ liệu đã bị bỏ qua.", strings.ToUpper(ch.muc)),
				nil,
				"Token hết hạn, mật khẩu đổi, hoặc tài khoản giám sát bị khoá.",
				"Cấp lại thông tin đăng nhập cho công cụ giám sát rồi chạy lại lượt này.")
		}
		if vao {
			if ch.muc == "p2" || ch.muc == "tuan" {
				p.quetDon()
				p.quetDien()
				p.quetVotDien()
				p.quetPhieuAm()
			}
			if ch.muc == "p3" || ch.muc == "tuan" {
				p.quetToanVen()
				p.quetTaiKhoanSauTraPhong()
				p.quetVuotSucChua()
				p.quetChoDuyet()
			}
		}
		if ch.muc == "tuan" {
			tomTat = p.tomTatTuan()
		}
	}

	sort.SliceStable(p.list, func(i, j int) bool { return thuTuMuc[p.list[i].Muc] < thuTuMuc[p.list[j].Muc] })

	vanBan := p.dungVanBan(tomTat)
	if ch.dinhDang == "json" {
		if err := p.inJson(); err != nil {
			fmt.Fprintln(os.Stderr, "Không dựng được JSON: "+err.Error())
			os.Exit(2)
		}
	} else {
		fmt.Print(vanBan)
	}

	// Gửi mail thất bại là lỗi RIÊNG: báo cáo đã dựng xong rồi, nhưng không ai nhận được nó.
	loiMail := false
	if p.nenGuiMail() {
		if err := p.guiMail(vanBan); err != nil {
			fmt.Fprintln(os.Stderr, "Không gửi được mail báo cáo: "+err.Error())
			loiMail = true
		}
	}
	switch {
	case loiMail:
		os.Exit(2)
	case len(p.list) > 0:
		os.Exit(1)
	}
}
