package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
)

// Handler bảo trì / an ninh (maintenance). Port từ server/routes/maintenance.routes.js.
// Toàn bộ route: requireAuth + requireRole('maintenance','admin') (maintenance.routes.js:10).
// An ninh KHÔNG ghi vào hồ sơ học viên: bàn giao đi qua biên bản (handover_reports.go), quản trị xác nhận.

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

	// Kèm biên bản mới nhất (BL-121) + lần chốt công-tơ gần nhất để an ninh đối chiếu ngay lúc bàn giao.
	bienBan := func(kind string) string {
		return `(SELECT row_to_json(x) FROM (SELECT hr.id, hr.status, hr.actual_date, hr.created_at, hr.created_by,
		            hr.reviewed_at, hr.reviewed_by, hr.review_note, hr.meter_reading, hr.damage_amount
		          FROM handover_reports hr WHERE hr.student_id = s.id AND hr.kind = '` + kind + `'
		          ORDER BY hr.id DESC LIMIT 1) x) AS report,
		       (SELECT row_to_json(y) FROM (SELECT mr.read_date, mr.reading FROM meter_reads mr
		          WHERE mr.room_id = s.room_id ORDER BY mr.read_date DESC LIMIT 1) y) AS last_meter,
		       (SELECT row_to_json(z) FROM (SELECT er.month, er.reading_start, er.reading_end FROM electric_readings er
		          WHERE er.room_id = s.room_id ORDER BY er.month DESC LIMIT 1) z) AS last_month_meter`
	}

	pIn := []interface{}{month}
	facIn := maintFacClause(u, c, &pIn, "s.facility_id")
	// Kèm XE để an ninh đối chiếu biển thật với biển trên app ngay lúc cho nhận phòng.
	rowsIn, err := h.pool().Query(ctx, `
		SELECT s.id, s.name, r.name AS room_name, COALESCE(s.check_in_date, s.planned_check_in) AS date,
		       s.status, s.check_in_date, s.checkin_confirmed_at, s.checkin_confirm_note,
		       (SELECT COALESCE(json_agg(json_build_object(
		                 'id', v.id, 'plate', v.plate, 'vehicle_type', v.vehicle_type
		               ) ORDER BY v.id), '[]'::json)
		          FROM vehicles v WHERE v.student_id = s.id AND v.deleted_at IS NULL) AS vehicles,
		       `+bienBan("checkin")+`
		FROM students s LEFT JOIN rooms r ON r.id = s.room_id
		WHERE s.deleted_at IS NULL AND to_char(COALESCE(s.check_in_date, s.planned_check_in),'YYYY-MM')=$1`+facIn+`
		ORDER BY COALESCE(s.check_in_date, s.planned_check_in), s.name`, pIn...)
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
		SELECT s.id, s.name, r.name AS room_name, COALESCE(s.check_out_date, s.planned_check_out) AS date,
		       s.status, s.check_out_date, s.checkout_confirmed_at, s.checkout_actual_date, s.checkout_confirm_note,
		       `+bienBan("checkout")+`
		FROM students s LEFT JOIN rooms r ON r.id = s.room_id
		WHERE s.deleted_at IS NULL AND to_char(COALESCE(s.check_out_date, s.planned_check_out),'YYYY-MM')=$1`+facOut+`
		ORDER BY COALESCE(s.check_out_date, s.planned_check_out), s.name`, pOut...)
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

// MaintHandoversSummary: GET /api/maintenance/handovers/summary (maintenance,admin).
// Số lượt tháng này an ninh CÒN PHẢI LẬP BIÊN BẢN (chưa xác nhận, chưa có biên bản đang chờ) — cho huy hiệu.
func (h *Handlers) MaintHandoversSummary(c *gin.Context) {
	u := auth.CurrentUser(c)
	m := maintCurMonth()
	ctx := c.Request.Context()

	pCi := []interface{}{m}
	fCi := maintFacClause(u, c, &pCi, "s.facility_id")
	var ci int
	if err := h.pool().QueryRow(ctx, `
		SELECT COUNT(*)::int FROM students s
		 WHERE s.deleted_at IS NULL AND to_char(COALESCE(s.check_in_date, s.planned_check_in),'YYYY-MM')=$1
		   AND s.checkin_confirmed_at IS NULL AND s.check_in_date IS NULL
		   AND NOT EXISTS (SELECT 1 FROM handover_reports hr WHERE hr.student_id = s.id AND hr.kind = 'checkin' AND hr.status = 'pending')`+fCi, pCi...).Scan(&ci); err != nil {
		serverErr(c, err)
		return
	}

	pCo := []interface{}{m}
	fCo := maintFacClause(u, c, &pCo, "s.facility_id")
	var co int
	if err := h.pool().QueryRow(ctx, `
		SELECT COUNT(*)::int FROM students s
		 WHERE s.deleted_at IS NULL AND to_char(COALESCE(s.check_out_date, s.planned_check_out),'YYYY-MM')=$1
		   AND s.checkout_confirmed_at IS NULL AND s.status <> 'out'
		   AND NOT EXISTS (SELECT 1 FROM handover_reports hr WHERE hr.student_id = s.id AND hr.kind = 'checkout' AND hr.status = 'pending')`+fCo, pCo...).Scan(&co); err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"month": m, "pendingCheckin": ci, "pendingCheckout": co, "pending": ci + co})
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
