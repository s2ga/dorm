package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"ktx/internal/db"
	"ktx/internal/storage"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Handler công khai (public) — không yêu cầu đăng nhập.
// 3 endpoint /apply, /image/:key, /doc/noi-quy phụ thuộc S3; package storage chưa port -> stub 501.

// publicMediaKeys: khoá ảnh hợp lệ của trang giới thiệu. public.routes.js:9
// (Chỉ dùng cho /image/:key — hiện là stub; giữ lại để tài liệu hoá hợp đồng.)
var publicMediaKeys = []string{"hero", "khuon-vien-1", "khuon-vien-2", "khuon-vien-3", "phong-1", "phong-2", "phong-3"}

// publicDemNguoiDangO: MỘT định nghĩa "đang ở" cho MỌI số liệu công khai — /info và /stats
// dùng chung để không nói hai con số khác nhau. public.routes.js:13-19
func (h *Handlers) publicDemNguoiDangO(c *gin.Context) (int, error) {
	var n int
	err := h.pool().QueryRow(c.Request.Context(),
		`SELECT COUNT(*)::int c FROM students s
		 JOIN rooms r ON r.id = s.room_id AND COALESCE(r.room_type,'shared') IN ('shared','whole') AND r.deleted_at IS NULL
		 WHERE s.deleted_at IS NULL
		   AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE)`).Scan(&n)
	return n, err
}

// publicPhongOWhere: tập phòng học viên ở được — thuê ghép + thuê trọn, bỏ phòng an ninh và phòng
// nhân viên. /info và /stats dùng CHUNG câu này để không đếm ra hai con số khác nhau (BL-125).
const publicPhongOWhere = `COALESCE(room_type,'shared') IN ('shared','whole') AND deleted_at IS NULL`

// publicGiuongTheoGioiTinh: giường trống và giường sắp trống của phòng nam / phòng nữ.
func (h *Handlers) publicGiuongTheoGioiTinh(ctx context.Context) (map[string]int, map[string]int, error) {
	trong, sapTrong := map[string]int{"male": 0, "female": 0}, map[string]int{"male": 0, "female": 0}
	rows, err := h.pool().Query(ctx,
		`SELECT CASE WHEN COALESCE(r.gender,'male') = 'female' THEN 'female' ELSE 'male' END AS gioi,
		        COALESCE(SUM(GREATEST(0, GREATEST(0, r.capacity - o.dang_o) - o.dat_cho)),0)::int AS trong,
		        COALESCE(SUM(GREATEST(0, GREATEST(0, r.capacity - o.dang_o + o.sap_roi) - o.dat_cho)
		                   - GREATEST(0, GREATEST(0, r.capacity - o.dang_o) - o.dat_cho)),0)::int AS sap_trong
		   FROM rooms r
		   JOIN LATERAL (
		     SELECT COUNT(*) FILTER (WHERE s.check_in_date <= CURRENT_DATE
		              AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE))::int AS dang_o,
		            COUNT(*) FILTER (WHERE s.check_in_date <= CURRENT_DATE
		              AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE)
		              AND s.planned_check_out IS NOT NULL)::int AS sap_roi,
		            COUNT(*) FILTER (WHERE s.check_in_date IS NULL AND s.check_out_date IS NULL
		              AND s.planned_check_in IS NOT NULL)::int AS dat_cho
		       FROM students s
		      WHERE s.room_id = r.id AND s.deleted_at IS NULL
		   ) o ON TRUE
		  WHERE COALESCE(r.room_type,'shared') IN ('shared','whole') AND r.deleted_at IS NULL
		  GROUP BY 1`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var gioi string
		var t, st int
		if err := rows.Scan(&gioi, &t, &st); err != nil {
			return nil, nil, err
		}
		trong[gioi], sapTrong[gioi] = t, st
	}
	return trong, sapTrong, rows.Err()
}

// PublicInfo: GET /api/info — thông tin KTX + đơn giá cho trang đăng ký. public.routes.js:54-93
func (h *Handlers) PublicInfo(c *gin.Context) {
	ctx := c.Request.Context()
	s, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	// Cơ sở ĐÃ ĐÓNG (deleted_at) không khoe ra ngoài. public.routes.js:59
	frows, err := h.pool().Query(ctx, "SELECT id, name, address FROM facilities WHERE deleted_at IS NULL ORDER BY id")
	if err != nil {
		serverErr(c)
		return
	}
	facilities, err := db.RowsToMaps(frows)
	if err != nil {
		serverErr(c)
		return
	}
	// fac = facilities[0] || {} — lấy tên/địa chỉ cơ sở đầu tiên. public.routes.js:60
	facName, facAddr := "", ""
	if len(facilities) > 0 {
		if v, ok := facilities[0]["name"].(string); ok {
			facName = v
		}
		if v, ok := facilities[0]["address"].(string); ok {
			facAddr = v
		}
	}
	// "Phòng ở" = phòng học viên ở được: thuê ghép + thuê trọn. Phòng an ninh và phòng nhân viên
	// không phải chỗ ở của học viên nên không đếm.
	var rooms, beds, bedFree, bedSoon int
	if err := h.pool().QueryRow(ctx,
		"SELECT COUNT(*)::int c FROM rooms WHERE "+publicPhongOWhere).Scan(&rooms); err != nil {
		serverErr(c)
		return
	}
	if err := h.pool().QueryRow(ctx,
		"SELECT COALESCE(SUM(capacity),0)::int c FROM rooms WHERE "+publicPhongOWhere).Scan(&beds); err != nil {
		serverErr(c)
		return
	}
	// Giường trống và giường SẮP trống, tách theo phòng nam / phòng nữ. Kẹp ở 0 theo TỪNG phòng rồi mới
	// cộng, và trừ chỗ đã đặt ở CẢ HAI con số (owner chốt 12/09/2026) — không thì giường đã có chủ bị
	// khoe hai lần. "Sắp trống" là phần TĂNG THÊM của chính "trống" khi người đã có lịch trả đi hết.
	freeTheoGT, soonTheoGT, err := h.publicGiuongTheoGioiTinh(ctx)
	if err != nil {
		serverErr(c, err)
		return
	}
	bedFree = freeTheoGT["male"] + freeTheoGT["female"]
	bedSoon = soonTheoGT["male"] + soonTheoGT["female"]
	// Số người đang ở: đếm NGƯỜI THẬT (thấy được cả người ở vượt sức chứa). public.routes.js:74
	occupancy, err := h.publicDemNguoiDangO(c)
	if err != nil {
		serverErr(c)
		return
	}
	// facilities.map(f => ({id, name, address})) — query chỉ chọn đúng 3 cột nên dùng thẳng. public.routes.js:78
	c.JSON(http.StatusOK, gin.H{
		"dorm_name": s["dorm_name"], "hotline": s["hotline"], "contact_person": s["contact_person"],
		"address": facAddr, "facility_name": facName,
		"facilities": facilities,
		"room_count": rooms, "bed_count": beds, "occupancy": occupancy, "bed_free": bedFree, "bed_soon": bedSoon,
		"bed_free_male": freeTheoGT["male"], "bed_free_female": freeTheoGT["female"],
		"bed_soon_male": soonTheoGT["male"], "bed_soon_female": soonTheoGT["female"],
		"room_fee": s["room_fee"], "deposit_fee": s["deposit_fee"],
		"electric_unit": s["electric_unit"], "water_fee": s["water_fee"], "service_fee": s["service_fee"],
		"washing_fee": s["washing_fee"], "parking_fee": s["parking_fee"],
		"intro_hero_title": s["intro_hero_title"], "intro_hero_desc": s["intro_hero_desc"],
		"intro_about_eyebrow": s["intro_about_eyebrow"], "intro_about_title": s["intro_about_title"], "intro_about_desc": s["intro_about_desc"],
		"intro_rooms_eyebrow": s["intro_rooms_eyebrow"], "intro_rooms_title": s["intro_rooms_title"], "intro_rooms_desc": s["intro_rooms_desc"],
		"intro_amenities_title": s["intro_amenities_title"],
		"intro_price_title":     s["intro_price_title"], "intro_price_desc": s["intro_price_desc"],
		"intro_contact_title": s["intro_contact_title"], "intro_contact_desc": s["intro_contact_desc"],
		"imgcap_khuon-vien-1": s["imgcap_khuon-vien-1"], "imgcap_khuon-vien-2": s["imgcap_khuon-vien-2"], "imgcap_khuon-vien-3": s["imgcap_khuon-vien-3"],
		"imgcap_phong-1": s["imgcap_phong-1"], "imgcap_phong-2": s["imgcap_phong-2"], "imgcap_phong-3": s["imgcap_phong-3"],
	})
}

// PublicStats: GET /api/stats — thống kê nhanh cho màn hình đăng nhập. public.routes.js:96-107
func (h *Handlers) PublicStats(c *gin.Context) {
	ctx := c.Request.Context()
	var rooms, zones int
	if err := h.pool().QueryRow(ctx,
		"SELECT COUNT(*)::int c FROM rooms WHERE "+publicPhongOWhere).Scan(&rooms); err != nil {
		serverErr(c)
		return
	}
	// Đếm ĐÚNG cái /info đang đếm — cùng định nghĩa "đang ở". public.routes.js:103
	students, err := h.publicDemNguoiDangO(c)
	if err != nil {
		serverErr(c)
		return
	}
	if err := h.pool().QueryRow(ctx,
		"SELECT COUNT(*)::int c FROM facilities WHERE deleted_at IS NULL").Scan(&zones); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"rooms": rooms, "students": students, "zones": zones})
}

// PublicAvailableRooms: GET /api/available-rooms — phòng còn slot trống cho HV tham khảo.
// public.routes.js:110-126
func (h *Handlers) PublicAvailableRooms(c *gin.Context) {
	// s.deleted_at IS NULL để HV đã xoá không "chiếm giường"; kẹp free ở 0; giữ ORDER BY r.floor,r.name.
	// Người ngoài chỉ thấy name/gender/hang/free (không lộ sức chứa/số người từng phòng). public.routes.js:114-123
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT name, gender, hang, free FROM (
		  SELECT r.name, r.floor, r.gender, r.hang,
		    GREATEST(0, GREATEST(0, COALESCE(r.capacity,0) - (
		      SELECT COUNT(*) FROM students s
		       WHERE s.room_id=r.id AND s.deleted_at IS NULL
		         AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE)
		    )) - (
		      SELECT COUNT(*) FROM students s
		       WHERE s.room_id=r.id AND s.deleted_at IS NULL
		         AND s.check_in_date IS NULL AND s.check_out_date IS NULL AND s.planned_check_in IS NOT NULL
		    ))::int AS free
		  FROM rooms r
		  WHERE COALESCE(r.room_type,'shared')='shared' AND r.deleted_at IS NULL
		) t
		WHERE free > 0
		ORDER BY floor, name`)
	if err != nil {
		serverErr(c)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, list)
}

// PublicImage: GET /api/public/image/:key — proxy ảnh giới thiệu từ S3. public.routes.js:23-35
func (h *Handlers) PublicImage(c *gin.Context) {
	key := c.Param("key")
	if !mediaInList(key, publicMediaKeys) || h.Store == nil {
		c.Status(http.StatusNotFound)
		return
	}
	ctx := c.Request.Context()
	var path *string
	if h.pool().QueryRow(ctx, "SELECT path FROM media WHERE key=$1", key).Scan(&path) != nil || path == nil || *path == "" {
		c.Status(http.StatusNotFound)
		return
	}
	obj, err := h.Store.GetObject(ctx, h.Store.IntroBucket, *path)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer obj.Body.Close()
	ct := obj.ContentType
	if ct == "" {
		ct = "image/jpeg"
	}
	c.Header("Content-Type", ct)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "public, max-age=300")
	_, _ = io.Copy(c.Writer, obj.Body)
}

// PublicDocNoiQuy: GET /api/public/doc/noi-quy — PDF nội quy từ S3 (inline). public.routes.js:39-51
func (h *Handlers) PublicDocNoiQuy(c *gin.Context) {
	if h.Store == nil {
		c.Status(http.StatusNotFound)
		return
	}
	ctx := c.Request.Context()
	var path *string
	if h.pool().QueryRow(ctx, "SELECT path FROM media WHERE key='noi-quy'").Scan(&path) != nil || path == nil || *path == "" {
		c.Status(http.StatusNotFound)
		return
	}
	obj, err := h.Store.GetObject(ctx, h.Store.IntroBucket, *path)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer obj.Body.Close()
	c.Header("Content-Type", "application/pdf")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", `inline; filename="noi-quy-ky-tuc-xa.pdf"`)
	c.Header("Cache-Control", "public, max-age=300")
	_, _ = io.Copy(c.Writer, obj.Body)
}

type publicApplyBody struct {
	Name           string          `json:"name"`
	Phone          string          `json:"phone"`
	Gender         string          `json:"gender"`
	FacilityID     json.RawMessage `json:"facility_id"`
	BirthDate      string          `json:"birth_date"`
	DesiredCheckIn string          `json:"desired_check_in"`
	Code           string          `json:"code"`
	ClassName      string          `json:"class_name"`
	RentalType     string          `json:"rental_type"`
	Pref           string          `json:"pref"`
	Note           string          `json:"note"`
	WantsWashing   bool            `json:"wants_washing"`
	WantsParking   bool            `json:"wants_parking"`
	Plate          string          `json:"plate"`
	CccdFront      string          `json:"cccd_front"`
	CccdBack       string          `json:"cccd_back"`
}

// PublicApply: POST /api/public/apply — gửi đơn đăng ký (kèm upload CCCD lên S3). public.routes.js:129-225
func (h *Handlers) PublicApply(c *gin.Context) {
	if h.Store == nil {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "Chức năng đang chuyển đổi"})
		return
	}
	var b publicApplyBody
	if err := c.ShouldBindJSON(&b); err != nil {
		st, msg := bindJSONLoi(err)
		c.JSON(st, gin.H{"error": msg})
		return
	}
	if strings.TrimSpace(b.Name) == "" {
		badRequest(c, "Vui lòng nhập họ tên")
		return
	}
	if strings.TrimSpace(b.Phone) == "" {
		badRequest(c, "Vui lòng nhập số điện thoại")
		return
	}
	if !valid.IsValidPhone(b.Phone) {
		badRequest(c, "Số điện thoại không hợp lệ (chỉ chữ số, 8–15 số)")
		return
	}
	if !valid.IsValidGender(b.Gender) {
		badRequest(c, "Vui lòng chọn giới tính (nam hoặc nữ)")
		return
	}
	facF, facOK := jsNum(b.FacilityID)
	facID := int(facF)
	if !facOK || facF != float64(facID) || facID <= 0 {
		badRequest(c, "Vui lòng chọn cơ sở ký túc xá bạn muốn đăng ký")
		return
	}
	ctx := c.Request.Context()
	var one int
	if h.pool().QueryRow(ctx, "SELECT 1 FROM facilities WHERE id=$1 AND deleted_at IS NULL", facID).Scan(&one) != nil {
		badRequest(c, "Cơ sở đã chọn không hợp lệ (có thể vừa bị gỡ) — vui lòng chọn lại")
		return
	}
	fields := map[string]string{"name": b.Name, "phone": b.Phone, "code": b.Code, "class_name": b.ClassName, "pref": b.Pref, "note": b.Note, "plate": b.Plate}
	get := func(k string) (string, bool) { v, ok := fields[k]; return v, ok }
	if e := valid.TooLong(get, []valid.TooLongField{{Key: "name", Max: 120}, {Key: "phone", Max: 20}, {Key: "code", Max: 40}, {Key: "class_name", Max: 80}, {Key: "pref", Max: 500}, {Key: "note", Max: 2000}, {Key: "plate", Max: 20}}); e != "" {
		badRequest(c, e)
		return
	}
	// Cửa công khai không được lỏng hơn cửa nội bộ: dữ liệu đơn được chép thẳng sang hồ sơ lúc duyệt.
	if e := valid.KhongChoHTML(get, []string{"name", "phone", "code", "class_name", "pref", "note", "plate"}); e != "" {
		badRequest(c, e)
		return
	}
	today := timeutil.Today()
	coNgaySinh := strings.TrimSpace(b.BirthDate) != ""
	if coNgaySinh && !valid.IsValidYmd(b.BirthDate) {
		badRequest(c, `Ngày sinh không hợp lệ: "`+b.BirthDate+`"`)
		return
	}
	if coNgaySinh && b.BirthDate > today {
		badRequest(c, "Ngày sinh không thể ở tương lai — vui lòng chọn lại.")
		return
	}
	var birthDate interface{}
	if coNgaySinh {
		birthDate = b.BirthDate
	}
	// Ngày muốn nhận phòng: BẮT BUỘC, phải là ngày thật và không lùi về quá khứ.
	ngayVao := strings.TrimSpace(b.DesiredCheckIn)
	if ngayVao == "" {
		badRequest(c, "Chọn ngày muốn nhận phòng.")
		return
	}
	if !valid.IsValidYmd(ngayVao) {
		badRequest(c, `Ngày muốn nhận phòng không hợp lệ: "`+b.DesiredCheckIn+`"`)
		return
	}
	if ngayVao < today {
		badRequest(c, "Ngày muốn nhận phòng đã qua — vui lòng chọn lại.")
		return
	}
	var desiredCheckIn interface{} = ngayVao
	// Chống trùng đơn pending (cùng tên + SĐT).
	if h.pool().QueryRow(ctx,
		`SELECT id FROM applications WHERE status='pending' AND lower(trim(name))=lower($1) AND $2 = regexp_replace(phone,'\D','','g')`,
		strings.TrimSpace(b.Name), valid.Digits(b.Phone)).Scan(&one) == nil {
		conflict(c, gin.H{"error": "Bạn đã có một đơn đăng ký đang chờ duyệt. Ký túc xá sẽ liên hệ sớm — không cần gửi lại."})
		return
	}
	// Kiểm ảnh CCCD TRƯỚC khi chèn. Đủ HAI mặt là BẮT BUỘC (owner chốt 12/09/2026): thiếu ảnh thì
	// hồ sơ tạm trú gửi công an không lập được, mà đòi lại sau khi học viên đã đi thì rất khó.
	for _, f := range []struct{ val, ten string }{{b.CccdFront, "mặt trước"}, {b.CccdBack, "mặt sau"}} {
		if f.val == "" {
			badRequest(c, "Vui lòng tải lên ảnh CCCD "+f.ten+" — hồ sơ đăng ký tạm trú bắt buộc có đủ 2 mặt.")
			return
		}
		if !strings.HasPrefix(f.val, "data:image/") {
			badRequest(c, "Ảnh CCCD "+f.ten+" không phải file ảnh. Vui lòng chụp lại và tải lên.")
			return
		}
		if len(f.val) > 8*1024*1024 {
			badRequest(c, "Ảnh CCCD "+f.ten+" quá lớn (tối đa ~6MB). Vui lòng chụp lại ảnh nhẹ hơn.")
			return
		}
		if storage.ParseDataUrl(f.val) == nil {
			badRequest(c, "Ảnh CCCD "+f.ten+" sai định dạng — chỉ nhận JPG, PNG hoặc WEBP.")
			return
		}
	}
	rental := "ghep"
	if b.RentalType == "phong" {
		rental = "phong"
	}
	var appID int
	if err := h.pool().QueryRow(ctx,
		`INSERT INTO applications (name, phone, gender, birth_date, code, class_name, rental_type, pref, note, wants_washing, wants_parking, plate, facility_id, desired_check_in)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
		strings.TrimSpace(b.Name), strings.TrimSpace(b.Phone), b.Gender, birthDate,
		b.Code, b.ClassName, rental, b.Pref, b.Note, b.WantsWashing, b.WantsParking, b.Plate, facID, desiredCheckIn).Scan(&appID); err != nil {
		serverErr(c)
		return
	}
	// Upload CCCD -> S3.
	var loiAnh []string
	for _, f := range []struct{ val, field, ten string }{{b.CccdFront, "cccd_front", "mặt trước"}, {b.CccdBack, "cccd_back", "mặt sau"}} {
		if f.val == "" {
			continue
		}
		p := storage.ParseDataUrl(f.val)
		objKey := "applications/" + itoa(appID) + "/" + f.field + "." + p.Ext
		if _, err := h.Store.PutDataUrl(ctx, h.Store.CccdBucket, objKey, f.val); err != nil {
			loiAnh = append(loiAnh, f.ten)
		} else {
			_, _ = h.pool().Exec(ctx, "UPDATE applications SET "+f.field+"=$1 WHERE id=$2", objKey, appID)
		}
	}
	if len(loiAnh) > 0 {
		_, _ = h.pool().Exec(ctx, "UPDATE applications SET note = TRIM(COALESCE(note,'') || $1) WHERE id=$2",
			"\n[HỆ THỐNG] Chưa lưu được ảnh CCCD "+strings.Join(loiAnh, " và ")+" — cần liên hệ học viên bổ sung.", appID)
		c.JSON(http.StatusCreated, gin.H{"ok": true, "id": appID, "warning": true,
			"error": "Đã nhận đơn đăng ký, NHƯNG chưa tải lên được ảnh CCCD " + strings.Join(loiAnh, " và ") + ". Ký túc xá sẽ liên hệ để bổ sung."})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "id": appID})
}
