package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"ktx/internal/auth"
	"ktx/internal/checkout"
	"ktx/internal/db"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Handler bảo trì / an ninh (maintenance). Port từ server/routes/maintenance.routes.js.
// Toàn bộ route: requireAuth + requireRole('maintenance','admin') (maintenance.routes.js:10).

// maintTaskStatus: vòng đời việc bảo trì — MỘT bộ trạng thái dùng chung. maintenance.routes.js:28
var maintTaskStatus = []string{"new", "processing", "blocked", "done"}

// maintCurMonth: tháng hiện tại "YYYY-MM" (giờ VN). maintenance.routes.js:23
func maintCurMonth() string { return timeutil.Today()[:7] }

// maintIsMonth: khớp /^\d{4}-\d{2}$/. maintenance.routes.js:24
func maintIsMonth(m string) bool {
	if len(m) != 7 || m[4] != '-' {
		return false
	}
	for i, r := range m {
		if i == 4 {
			continue
		}
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// maintFacClause: đa cơ sở — bảo trì/an ninh CHỈ thấy việc thuộc cơ sở mình. maintenance.routes.js:15-21
// Điều hành (admin, facility_id null): thấy tất cả, lọc tuỳ chọn ?facility. Bảo trì/quản lý: ÉP theo cơ sở.
// Trả mệnh đề AND (append params qua con trỏ, khớp thứ tự $n như Node).
func maintFacClause(u *auth.User, c *gin.Context, params *[]interface{}, col string) string {
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			fv, _ := strconv.ParseFloat(f, 64) // +req.query.facility
			*params = append(*params, int(fv))
			return " AND " + col + " = $" + itoa(len(*params))
		}
		return ""
	}
	*params = append(*params, *scope.UserFacility(u))
	return " AND " + col + " = $" + itoa(len(*params))
}

// MaintHandovers: GET /api/maintenance/handovers (maintenance,admin). maintenance.routes.js:31-50
// Danh sách bàn giao phòng theo tháng — bảo trì CHỈ thấy: tên, phòng, ngày, xác nhận, ghi chú.
func (h *Handlers) MaintHandovers(c *gin.Context) {
	u := auth.CurrentUser(c)
	month := c.Query("month")
	if !maintIsMonth(month) {
		month = maintCurMonth()
	}
	ctx := c.Request.Context()

	pIn := []interface{}{month}
	facIn := maintFacClause(u, c, &pIn, "s.facility_id")
	// Kèm XE để an ninh đối chiếu biển thật với biển trên app ngay lúc cho nhận phòng.
	rowsIn, err := h.pool().Query(ctx, `
		SELECT s.id, s.name, r.name AS room_name, s.check_in_date AS date,
		       s.checkin_confirmed_at, s.checkin_confirm_note,
		       (SELECT COALESCE(json_agg(json_build_object(
		                 'id', v.id, 'plate', v.plate, 'vehicle_type', v.vehicle_type
		               ) ORDER BY v.id), '[]'::json)
		          FROM vehicles v WHERE v.student_id = s.id AND v.deleted_at IS NULL) AS vehicles
		FROM students s LEFT JOIN rooms r ON r.id = s.room_id
		WHERE s.deleted_at IS NULL AND to_char(s.check_in_date,'YYYY-MM')=$1`+facIn+`
		ORDER BY s.check_in_date, s.name`, pIn...)
	if err != nil {
		serverErr(c)
		return
	}
	checkins, err := db.RowsToMaps(rowsIn)
	if err != nil {
		serverErr(c)
		return
	}

	pOut := []interface{}{month}
	facOut := maintFacClause(u, c, &pOut, "s.facility_id")
	rowsOut, err := h.pool().Query(ctx, `
		SELECT s.id, s.name, r.name AS room_name, s.check_out_date AS date,
		       s.checkout_confirmed_at, s.checkout_actual_date, s.checkout_confirm_note
		FROM students s LEFT JOIN rooms r ON r.id = s.room_id
		WHERE s.deleted_at IS NULL AND to_char(s.check_out_date,'YYYY-MM')=$1`+facOut+`
		ORDER BY s.check_out_date, s.name`, pOut...)
	if err != nil {
		serverErr(c)
		return
	}
	checkouts, err := db.RowsToMaps(rowsOut)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"month": month, "checkins": checkins, "checkouts": checkouts})
}

// MaintHandoversSummary: GET /api/maintenance/handovers/summary (maintenance,admin). maintenance.routes.js:53-62
// Số việc bàn giao chưa xác nhận (tháng này) — cho thông báo.
func (h *Handlers) MaintHandoversSummary(c *gin.Context) {
	u := auth.CurrentUser(c)
	m := maintCurMonth()
	ctx := c.Request.Context()

	pCi := []interface{}{m}
	fCi := maintFacClause(u, c, &pCi, "facility_id")
	var ci int
	if err := h.pool().QueryRow(ctx, `SELECT COUNT(*)::int c FROM students WHERE deleted_at IS NULL AND to_char(check_in_date,'YYYY-MM')=$1 AND checkin_confirmed_at IS NULL`+fCi, pCi...).Scan(&ci); err != nil {
		serverErr(c)
		return
	}

	pCo := []interface{}{m}
	fCo := maintFacClause(u, c, &pCo, "facility_id")
	var co int
	if err := h.pool().QueryRow(ctx, `SELECT COUNT(*)::int c FROM students WHERE deleted_at IS NULL AND to_char(check_out_date,'YYYY-MM')=$1 AND checkout_confirmed_at IS NULL`+fCo, pCo...).Scan(&co); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"month": m, "pendingCheckin": ci, "pendingCheckout": co, "pending": ci + co})
}

// MaintHandoverCheckin: POST /api/maintenance/handovers/:id/checkin (maintenance,admin). maintenance.routes.js:65-79
// Bảo trì xác nhận ĐÃ NHẬN phòng (bàn giao phòng cho HV). Xác nhận MỘT LẦN.
func (h *Handlers) MaintHandoverCheckin(c *gin.Context) {
	u := auth.CurrentUser(c)
	id := c.Param("id")
	var b struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	note := strings.TrimSpace(b.Note)
	ctx := c.Request.Context()

	var (
		confirmedAt *time.Time
		facID       *int
	)
	err := h.pool().QueryRow(ctx,
		"SELECT checkin_confirmed_at, facility_id FROM students WHERE id=$1 AND deleted_at IS NULL", id).
		Scan(&confirmedAt, &facID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên") // maintenance.routes.js:69
			return
		}
		serverErr(c)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil { // đa cơ sở. maintenance.routes.js:70
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	// Xác nhận lại sẽ ghi đè mốc bàn giao thật và (nếu note rỗng) xoá trắng ghi chú. maintenance.routes.js:72-73
	if confirmedAt != nil {
		conflict(c, gin.H{"error": "Đã xác nhận nhận phòng trước đó — không xác nhận lại (tránh mất dấu lần bàn giao thật)."})
		return
	}
	if _, err := h.pool().Exec(ctx,
		`UPDATE students SET checkin_confirmed_at=now(), checkin_confirm_note=$1
		 WHERE id=$2 AND deleted_at IS NULL`, note, id); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// MaintHandoverCheckout: POST /api/maintenance/handovers/:id/checkout (maintenance,admin). maintenance.routes.js:82-118
// Bảo trì xác nhận ĐÃ TRẢ phòng (ghi ngày thực tế, tính phiếu đúng). Xác nhận MỘT LẦN + CLAIM nguyên tử.
func (h *Handlers) MaintHandoverCheckout(c *gin.Context) {
	u := auth.CurrentUser(c)
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)
	var b struct {
		Note       string `json:"note"`
		ActualDate string `json:"actual_date"`
	}
	_ = c.ShouldBindJSON(&b)
	note := strings.TrimSpace(b.Note)
	// actual = isValidYmd(actual_date) ? actual_date : null. maintenance.routes.js:85-86
	if !valid.IsValidYmd(b.ActualDate) {
		badRequest(c, "Chọn ngày trả phòng thực tế hợp lệ")
		return
	}
	actual := b.ActualDate
	today := timeutil.Today()
	// Xác nhận ĐÃ TRẢ thực tế -> không thể ở tương lai. maintenance.routes.js:91-92
	if actual > today {
		badRequest(c, "Ngày trả phòng thực tế không thể ở tương lai.")
		return
	}
	ctx := c.Request.Context()
	// Ngày trả không thể trước ngày nhận / trước ngày bắt đầu lượt ở hiện tại (BLK-3). maintenance.routes.js:94
	var (
		checkIn    *time.Time
		facID      *int
		checkoutCA *time.Time
		status     string
	)
	err := h.pool().QueryRow(ctx,
		"SELECT check_in_date, facility_id, checkout_confirmed_at, status FROM students WHERE id=$1 AND deleted_at IS NULL", id).
		Scan(&checkIn, &facID, &checkoutCA, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên") // maintenance.routes.js:95
			return
		}
		serverErr(c)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil { // đa cơ sở. maintenance.routes.js:96
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	// Xác nhận MỘT LẦN. Đã 'out'/đã xác nhận -> chặn. maintenance.routes.js:99-100
	if checkoutCA != nil || status == "out" {
		conflict(c, gin.H{"error": "Đã xác nhận trả phòng trước đó — không xác nhận lại (tránh mất dấu lần bàn giao thật)."})
		return
	}
	checkInStr := ""
	if checkIn != nil {
		checkInStr = checkIn.Format("2006-01-02")
	}
	badDate, err := checkout.BadCheckoutDate(ctx, h.pool(), id, actual, checkInStr) // maintenance.routes.js:101
	if err != nil {
		serverErr(c)
		return
	}
	if badDate != "" {
		badRequest(c, badDate)
		return
	}
	// CLAIM nguyên tử: WHERE checkout_confirmed_at IS NULL — 2 người cùng lúc chỉ 1 thắng. maintenance.routes.js:104-107
	var (
		claimedID int
		roomID    *int
	)
	err = h.pool().QueryRow(ctx,
		`UPDATE students SET checkout_confirmed_at=now(), checkout_actual_date=$1, checkout_confirm_note=$2,
		   check_out_date=$1, status='out'
		 WHERE id=$3 AND deleted_at IS NULL AND checkout_confirmed_at IS NULL RETURNING id, room_id`,
		actual, note, id).Scan(&claimedID, &roomID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			conflict(c, gin.H{"error": "Đơn vừa được xác nhận bởi thao tác khác."}) // maintenance.routes.js:108
			return
		}
		serverErr(c)
		return
	}
	// source theo VAI người thực hiện — bảo trì ghi 'maintenance', không cứng 'admin' (V2-43). maintenance.routes.js:110
	src := "admin"
	if u != nil && u.Role == "maintenance" {
		src = "maintenance"
	}
	// try/catch -> bỏ qua lỗi ghi log. maintenance.routes.js:111-112
	_, _ = h.pool().Exec(ctx,
		`INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out',$2,$3,$4,$5)`,
		id, actual, roomID, "Bảo trì xác nhận trả phòng thực tế", src)
	// BLK-1: gọi phần CHUNG như 2 đường kia (đóng lượt ở + phòng trưởng + dọn phiếu kỳ sau + recalc). maintenance.routes.js:115
	dropped, err := checkout.FinalizeCheckout(ctx, h.pool(), h.DB, id, actual)
	if err != nil {
		serverErr(c)
		return
	}
	if dropped == nil {
		dropped = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "actual_date": actual, "dropped_future_invoices": dropped})
}

// MaintTasks: GET /api/maintenance/tasks (maintenance,admin). maintenance.routes.js:121-133
// Danh sách công việc bảo trì (báo hư hỏng đã được admin chuyển).
func (h *Handlers) MaintTasks(c *gin.Context) {
	u := auth.CurrentUser(c)
	params := []interface{}{}
	fac := maintFacClause(u, c, &params, "COALESCE(s.facility_id, r.facility_id)")
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT d.*, s.name AS student_name, s.phone AS student_phone, r.name AS room_name
		FROM damage_reports d
		LEFT JOIN students s ON s.id = d.student_id
		LEFT JOIN rooms r ON r.id = d.room_id
		WHERE d.category='damage' AND d.assigned_at IS NOT NULL`+fac+`
		ORDER BY (d.status<>'done') DESC, d.assigned_at DESC`, params...)
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

// MaintSummary: GET /api/maintenance/summary (maintenance,admin). maintenance.routes.js:136-145
// Số việc cần xử lý (cho thông báo).
func (h *Handlers) MaintSummary(c *gin.Context) {
	u := auth.CurrentUser(c)
	params := []interface{}{}
	fac := maintFacClause(u, c, &params, "COALESCE(s.facility_id, r.facility_id)")
	var n int
	if err := h.pool().QueryRow(c.Request.Context(),
		`SELECT COUNT(*)::int c FROM damage_reports d
		   LEFT JOIN students s ON s.id=d.student_id LEFT JOIN rooms r ON r.id=d.room_id
		  WHERE d.category='damage' AND d.assigned_at IS NOT NULL AND d.status<>'done'`+fac, params...).Scan(&n); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"pending": n})
}

// MaintTaskStatus: POST /api/maintenance/tasks/:id/status (maintenance,admin). maintenance.routes.js:148-176
// Bảo trì cập nhật tiến độ: đang xử lý / chưa xử lý được (kèm lý do) / đã xong (kèm ghi chú).
func (h *Handlers) MaintTaskStatus(c *gin.Context) {
	u := auth.CurrentUser(c)
	id := c.Param("id")
	var b struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	// Trạng thái LẠ -> BÁO LỖI, đừng lặng lẽ ép về 'processing'. maintenance.routes.js:152-153
	if !maintInStatus(b.Status) {
		badRequest(c, `Trạng thái không hợp lệ: "`+b.Status+`". Chỉ nhận: `+strings.Join(maintTaskStatus, ", ")+".")
		return
	}
	status := b.Status
	note := strings.TrimSpace(b.Note)
	if status == "blocked" && note == "" { // maintenance.routes.js:156
		badRequest(c, "Nhập lý do chưa xử lý được")
		return
	}
	ctx := c.Request.Context()
	// Đa cơ sở: bảo trì chỉ cập nhật việc thuộc cơ sở mình. maintenance.routes.js:158-160
	var fid *int
	err := h.pool().QueryRow(ctx, `SELECT COALESCE(s.facility_id, r.facility_id) AS fid FROM damage_reports d
		LEFT JOIN students s ON s.id=d.student_id LEFT JOIN rooms r ON r.id=d.room_id
		WHERE d.id=$1 AND d.category='damage' AND d.assigned_at IS NOT NULL`, id).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy công việc") // maintenance.routes.js:161
			return
		}
		serverErr(c)
		return
	}
	if fe := scope.AssertFacility(u, fid); fe != nil { // maintenance.routes.js:162
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	// Ghi chú: chỉ ĐÈ khi có nhập; note rỗng -> GIỮ ghi chú cũ. resolved_at chỉ đặt khi 'done'. maintenance.routes.js:166-172
	rows, err := h.pool().Query(ctx,
		`UPDATE damage_reports
		   SET status=$1,
		       admin_note = CASE WHEN $2='' THEN admin_note ELSE $2 END,
		       resolved_at = CASE WHEN $1='done' THEN now() ELSE NULL END
		 WHERE id=$3 AND category='damage' AND assigned_at IS NOT NULL RETURNING *`,
		status, note, id)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		notFound(c, "Không tìm thấy công việc") // maintenance.routes.js:173
		return
	}
	c.JSON(http.StatusOK, row)
}

// maintInStatus: TASK_STATUS.includes(status). maintenance.routes.js:152
func maintInStatus(s string) bool {
	for _, v := range maintTaskStatus {
		if v == s {
			return true
		}
	}
	return false
}
