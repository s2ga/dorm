package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Handler xe (vehicles). Port từ server/routes/vehicles.routes.js.
// Toàn bộ route: requireAuth + requireRole('admin','staff') (vehicles.routes.js:7).

// vehicleChuanBien: chuẩn hoá biển số để so trùng — bỏ ký tự không phải chữ/số, viết hoa.
// "63-B4 508.58" và "63B450858" là CÙNG một xe (V2-22). vehicles.routes.js:24
func vehicleChuanBien(p string) string {
	up := strings.ToUpper(p)
	var b strings.Builder
	for _, r := range up {
		if (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// vehicleIsDup: lỗi vi phạm unique index (23505). vehicles.routes.js:84,117
func vehicleIsDup(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

// vehicleNgay: đọc ô ngày hiệu lực. Vắng khoá = không đổi · null/"" = để trống · "YYYY-MM-DD" = đặt.
func vehicleNgay(raw json.RawMessage, ten string) (bool, *string, string) {
	if len(raw) == 0 {
		return false, nil, ""
	}
	var s *string
	if err := json.Unmarshal(raw, &s); err != nil {
		return true, nil, ten + " không hợp lệ"
	}
	if s == nil {
		return true, nil, ""
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return true, nil, ""
	}
	if len(v) > 10 {
		v = v[:10]
	}
	if !valid.IsValidYmd(v) {
		return true, nil, ten + ` không hợp lệ: "` + v + `"`
	}
	return true, &v, ""
}

// vehicleKhoangNgay: xe phải ngừng SAU hoặc ĐÚNG ngày bắt đầu.
func vehicleKhoangNgay(from, to *string) string {
	if from == nil || to == nil {
		return ""
	}
	if *to < *from {
		return "Ngày ngừng (" + *to + ") trước ngày bắt đầu (" + *from + ")"
	}
	return ""
}

func vehicleNgayCua(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

// vehicleNum: mô phỏng +value của JS — số hoặc chuỗi số; 0/NaN/rỗng -> không hợp lệ (!sid).
// vehicles.routes.js:52-53
func vehicleNum(raw json.RawMessage) (int, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		if f == 0 {
			return 0, false
		}
		return int(f), true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		n, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil || n == 0 {
			return 0, false
		}
		return int(n), true
	}
	return 0, false
}

// vehicleFacilityGuard: (router.param) xe /:id phải thuộc cơ sở người dùng qua HV chủ xe.
// vehicles.routes.js:10-20. Điều hành -> bỏ qua; không có xe -> để handler tự xử (404/không đổi).
func (h *Handlers) vehicleFacilityGuard(c *gin.Context, u *auth.User, id int) bool {
	if scope.IsExecutive(u) {
		return true
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(),
		"SELECT s.facility_id FROM vehicles v JOIN students s ON s.id=v.student_id WHERE v.id=$1", id).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true // không có xe -> next (vehicles.routes.js:15)
		}
		serverErr(c)
		return false
	}
	if fe := scope.AssertFacility(u, fid); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return false
	}
	return true
}

// ListVehicles: GET /api/vehicles (admin,staff). vehicles.routes.js:27-47
func (h *Handlers) ListVehicles(c *gin.Context) {
	u := auth.CurrentUser(c)
	cond := []string{"v.deleted_at IS NULL", "s.deleted_at IS NULL"}
	params := []interface{}{}
	// Điều hành lọc tuỳ chọn ?facility; quản lý cơ sở bị ÉP theo cơ sở của mình (qua HV). vehicles.routes.js:32-36
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			fv, _ := strconv.ParseFloat(f, 64)
			params = append(params, int(fv))
			cond = append(cond, "s.facility_id = $"+itoa(len(params)))
		}
	} else {
		scope.ApplyFacilityFilter(u, "s.facility_id", &cond, &params)
	}
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT v.*, s.name AS student_name, s.status AS student_status, s.check_out_date,
		  r.name AS room_name, r.gender AS room_gender
		FROM vehicles v
		JOIN students s ON s.id = v.student_id
		LEFT JOIN rooms r ON r.id = s.room_id
		WHERE `+joinAnd(cond)+`
		ORDER BY r.name, s.name`, params...)
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

type vehicleCreateBody struct {
	StudentID   json.RawMessage `json:"student_id"`
	Plate       string          `json:"plate"`
	VehicleType string          `json:"vehicle_type"`
	Sticker     string          `json:"sticker"`
	Note        string          `json:"note"`
	FromDate    json.RawMessage `json:"from_date"`
	ToDate      json.RawMessage `json:"to_date"`
}

// CreateVehicle: POST /api/vehicles (admin,staff). vehicles.routes.js:49-88
func (h *Handlers) CreateVehicle(c *gin.Context) {
	u := auth.CurrentUser(c)
	var b vehicleCreateBody
	_ = c.ShouldBindJSON(&b)
	sid, ok := vehicleNum(b.StudentID)
	if !ok {
		badRequest(c, "Thiếu học viên")
		return
	}
	ctx := c.Request.Context()
	// HV phải TỒN TẠI + chưa xoá; trước đây id rác -> FK 23503 -> 500, giờ 400 có nghĩa (V2-25). vehicles.routes.js:56-58
	var (
		stFac                           *int
		stStatus                        string
		stCheckIn, stCheckOut, stLichRa *time.Time
	)
	err := h.pool().QueryRow(ctx,
		`SELECT facility_id, status, check_in_date, check_out_date, planned_check_out FROM students WHERE id=$1 AND deleted_at IS NULL`, sid).
		Scan(&stFac, &stStatus, &stCheckIn, &stCheckOut, &stLichRa)
	if err != nil {
		badRequest(c, "Học viên không tồn tại hoặc đã xoá")
		return
	}
	if fe := scope.AssertFacility(u, stFac); fe != nil { // đa cơ sở. vehicles.routes.js:59
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	// Không đăng ký xe cho HV đã TRẢ PHÒNG: đang ở = status 'in' + đã tới ngày nhận & chưa tới ngày trả.
	// vehicles.routes.js:62-66
	today := timeutil.Today()
	occupying := stStatus == "in"
	if occupying && stCheckIn != nil {
		occupying = stCheckIn.Format("2006-01-02") <= today
	}
	if occupying && stCheckOut != nil {
		occupying = stCheckOut.Format("2006-01-02") > today
	}
	if !occupying {
		badRequest(c, "Học viên đã trả phòng (hoặc chưa tới ngày nhận phòng) — không đăng ký xe.")
		return
	}
	// Biển số BẮT BUỘC — biển rỗng lọt qua unique index, nhân phí gửi xe tuỳ ý (V2-21). vehicles.routes.js:70
	if strings.TrimSpace(b.Plate) == "" {
		badRequest(c, "Biển số xe là bắt buộc")
		return
	}
	// Trùng biển (kể cả khác format dấu chấm/gạch) -> 400 có nghĩa (V2-22). vehicles.routes.js:72-76
	bien := vehicleChuanBien(b.Plate)
	var dupName string
	if h.pool().QueryRow(ctx,
		`SELECT s.name FROM vehicles v JOIN students s ON s.id=v.student_id
		  WHERE v.deleted_at IS NULL AND regexp_replace(upper(v.plate),'[^0-9A-Z]','','g') = $1`, bien).Scan(&dupName) == nil {
		badRequest(c, "Biển số này đã đăng ký cho học viên "+dupName)
		return
	}
	// Khoảng hiệu lực: không gửi thì lấy theo lượt ở của chủ xe (nhận phòng -> trả phòng),
	// trả phòng còn bỏ ngỏ thì to_date để trống = còn hiệu lực.
	coFrom, from, e1 := vehicleNgay(b.FromDate, "Ngày bắt đầu")
	coTo, to, e2 := vehicleNgay(b.ToDate, "Ngày ngừng")
	if e1 != "" || e2 != "" {
		badRequest(c, e1+e2)
		return
	}
	if !coFrom || from == nil {
		if from = vehicleNgayCua(stCheckIn); from == nil {
			t := today
			from = &t
		}
	}
	if !coTo {
		if to = vehicleNgayCua(stCheckOut); to == nil {
			to = vehicleNgayCua(stLichRa) // BL-117: chưa rời thì theo LỊCH trả phòng
		}
	}
	if e := vehicleKhoangNgay(from, to); e != "" {
		badRequest(c, e)
		return
	}
	rows, err := h.pool().Query(ctx,
		`INSERT INTO vehicles (student_id, plate, vehicle_type, sticker, note, from_date, to_date)
		 VALUES ($1,$2,$3,$4,$5,$6::date,$7::date) RETURNING *`,
		sid, strings.TrimSpace(b.Plate), b.VehicleType, b.Sticker, b.Note, from, to)
	if err != nil {
		if vehicleIsDup(err) { // vehicles.routes.js:84
			badRequest(c, "Biển số này đã tồn tại")
			return
		}
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil || row == nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusCreated, row)
}

type vehicleUpdateBody struct {
	Plate       *string         `json:"plate"`
	VehicleType *string         `json:"vehicle_type"`
	Sticker     *string         `json:"sticker"`
	Note        *string         `json:"note"`
	FromDate    json.RawMessage `json:"from_date"`
	ToDate      json.RawMessage `json:"to_date"`
}

// UpdateVehicle: PUT /api/vehicles/:id (admin,staff). vehicles.routes.js:90-121
func (h *Handlers) UpdateVehicle(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> câu lệnh SQL vỡ như Node (500)
		return
	}
	if !h.vehicleFacilityGuard(c, u, id) {
		return
	}
	var b vehicleUpdateBody
	_ = c.ShouldBindJSON(&b)
	// Chỉ đổi field CÓ gửi lên (COALESCE/CASE) — tránh ghi đè biển số/mã dán về rỗng (V2-25). vehicles.routes.js:93
	if b.Plate != nil && strings.TrimSpace(*b.Plate) == "" {
		badRequest(c, "Biển số không được để trống")
		return
	}
	ctx := c.Request.Context()
	if b.Plate != nil {
		bien := vehicleChuanBien(*b.Plate)
		var dupName string
		if h.pool().QueryRow(ctx,
			`SELECT s.name FROM vehicles v JOIN students s ON s.id=v.student_id
			  WHERE v.deleted_at IS NULL AND v.id<>$2 AND regexp_replace(upper(v.plate),'[^0-9A-Z]','','g') = $1`, bien, id).Scan(&dupName) == nil {
			badRequest(c, "Biển số này đã đăng ký cho học viên "+dupName)
			return
		}
	}
	// null = không đổi (khớp `!= null` của Node — undefined/null đều bỏ qua). vehicles.routes.js:104-113
	var pPlate, pType, pSticker, pNote interface{}
	if b.Plate != nil {
		pPlate = strings.TrimSpace(*b.Plate)
	}
	if b.VehicleType != nil {
		pType = *b.VehicleType
	}
	if b.Sticker != nil {
		pSticker = *b.Sticker
	}
	if b.Note != nil {
		pNote = *b.Note
	}
	// Ngày cần BA trạng thái nên đi kèm cờ "có gửi": null là XOÁ ngày, khác hẳn "không gửi".
	coFrom, from, e1 := vehicleNgay(b.FromDate, "Ngày bắt đầu")
	coTo, to, e2 := vehicleNgay(b.ToDate, "Ngày ngừng")
	if e1 != "" || e2 != "" {
		badRequest(c, e1+e2)
		return
	}
	if coFrom || coTo {
		var curFrom, curTo *time.Time
		if h.pool().QueryRow(ctx, "SELECT from_date, to_date FROM vehicles WHERE id=$1 AND deleted_at IS NULL", id).
			Scan(&curFrom, &curTo) != nil {
			notFound(c, "Không tìm thấy xe")
			return
		}
		hlFrom, hlTo := from, to
		if !coFrom {
			hlFrom = vehicleNgayCua(curFrom)
		}
		if !coTo {
			hlTo = vehicleNgayCua(curTo)
		}
		if e := vehicleKhoangNgay(hlFrom, hlTo); e != "" {
			badRequest(c, e)
			return
		}
	}
	rows, err := h.pool().Query(ctx,
		`UPDATE vehicles SET
		   plate = CASE WHEN $1::text IS NULL THEN plate ELSE $1 END,
		   vehicle_type = CASE WHEN $2::text IS NULL THEN vehicle_type ELSE $2 END,
		   sticker = CASE WHEN $3::text IS NULL THEN sticker ELSE $3 END,
		   note = CASE WHEN $4::text IS NULL THEN note ELSE $4 END,
		   from_date = CASE WHEN $6::bool THEN $7::date ELSE from_date END,
		   to_date   = CASE WHEN $8::bool THEN $9::date ELSE to_date END
		 WHERE id=$5 AND deleted_at IS NULL RETURNING *`,
		pPlate, pType, pSticker, pNote, id, coFrom, from, coTo, to)
	if err != nil {
		if vehicleIsDup(err) { // vehicles.routes.js:117
			badRequest(c, "Biển số này đã tồn tại")
			return
		}
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		notFound(c, "Không tìm thấy xe")
		return
	}
	c.JSON(http.StatusOK, row)
}

// DeleteVehicle: DELETE /api/vehicles/:id (admin,staff) — XOÁ HẲN, dành cho bản ghi nhập nhầm.
// Ngừng gửi giữa chừng thì đặt "đến ngày" ở form sửa, xe vẫn nằm trong hồ sơ.
func (h *Handlers) DeleteVehicle(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> câu lệnh SQL vỡ như Node (500)
		return
	}
	if !h.vehicleFacilityGuard(c, u, id) {
		return
	}
	// Ngày ngừng đã đặt tay thì GIỮ — gỡ xe không được đè lên khoảng hiệu lực người dùng khai.
	tag, err := h.pool().Exec(c.Request.Context(), "DELETE FROM vehicles WHERE id=$1", id)
	if err != nil {
		serverErr(c)
		return
	}
	if tag.RowsAffected() == 0 {
		notFound(c, "Không tìm thấy xe")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
