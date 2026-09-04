package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/mail"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// violationsSendMail: lấy HV + danh sách vi phạm rồi gửi mail báo trường. server/routes/violations.routes.js:46-55
func (h *Handlers) violationsSendMail(ctx context.Context, studentID int) (bool, string, string) {
	var st mail.Student
	if h.pool().QueryRow(ctx,
		"SELECT name, COALESCE(code,''), COALESCE(class_name,''), COALESCE(phone,'') FROM students WHERE id=$1 AND deleted_at IS NULL", studentID).
		Scan(&st.Name, &st.Code, &st.ClassName, &st.Phone) != nil {
		return false, "Không tìm thấy học viên", ""
	}
	rows, err := h.pool().Query(ctx,
		"SELECT date, COALESCE(type_name,''), COALESCE(severity,''), COALESCE(note,'') FROM violations WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date, id", studentID)
	if err != nil {
		return false, "Lỗi đọc vi phạm", ""
	}
	var vios []mail.Violation
	for rows.Next() {
		var v mail.Violation
		var d pgtype.Date
		if rows.Scan(&d, &v.TypeName, &v.Severity, &v.Note) == nil {
			if d.Valid {
				v.Date = d.Time.Format("2006-01-02")
			}
			vios = append(vios, v)
		}
	}
	return mail.SendViolationMail(ctx, h.DB, st, vios)
}

// Handler vi phạm. /api/violations — requireAuth + role admin|staff; /types (POST/PUT/DELETE) chỉ admin.
// Mailer CHƯA port sang Go: bước gửi mail bị bỏ, cờ notified_school luôn gỡ lại sau transaction để
// nút "Gửi lại" dùng được; /mail-status trả "chưa cấu hình"; /notify trả {mail:{sent:false,reason}}.

// violationsSev: chuẩn hoá severity — chỉ minor/major/severe, mặc định minor. violations.routes.js:41
func violationsSev(v string) string {
	switch v {
	case "minor", "major", "severe":
		return v
	}
	return "minor"
}

// violationsThreshold: `+s.violation_mail_threshold || 3` — NaN/0 -> 3. violations.routes.js:110
func violationsThreshold(s map[string]string) int {
	f, ok := jsNum(json.RawMessage(`"` + s["violation_mail_threshold"] + `"`))
	if !ok || f == 0 {
		return 3
	}
	return int(f)
}

// violationsBodyStr: đọc 1 field body theo ngữ nghĩa `!= null` + String() của JS.
// Trả nil nếu key vắng hoặc JSON null; ngược lại trả chuỗi (chuỗi JSON -> giá trị,
// số/bool -> nguyên văn để mô phỏng String()).
func violationsBodyStr(raw map[string]json.RawMessage, key string) *string {
	v, ok := raw[key]
	if !ok || string(v) == "null" {
		return nil
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		return &s
	}
	t := string(v)
	return &t
}

// violationsRejectUnknown: chỉ chấp nhận đúng field khai báo, field lạ -> câu lỗi. valid.js:68-71
// (Thứ tự field lạ có thể khác Node vì map Go duyệt ngẫu nhiên — ca thường chỉ 1 field.)
func violationsRejectUnknown(raw map[string]json.RawMessage, allowed []string) string {
	var extra []string
	for k := range raw {
		found := false
		for _, a := range allowed {
			if a == k {
				found = true
				break
			}
		}
		if !found {
			extra = append(extra, k)
		}
	}
	if len(extra) == 0 {
		return ""
	}
	return "Trường không hợp lệ: " + strings.Join(extra, ", ") + ". Chỉ chấp nhận: " + strings.Join(allowed, ", ")
}

// violationsBlockByStudent: chặn thao tác lên HV NGOÀI cơ sở người dùng. violations.routes.js:10-16
// Trả true (đã gửi response) nếu chặn. HV không tồn tại -> facility nil -> non-exec bị 403 (như Node).
func (h *Handlers) violationsBlockByStudent(c *gin.Context, u *auth.User, studentID int) bool {
	if scope.IsExecutive(u) {
		return false
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(),
		"SELECT facility_id FROM students WHERE id=$1", studentID).Scan(&fid)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		serverErr(c)
		return true
	}
	// ErrNoRows -> fid nil (mô phỏng `row ? row.facility_id : null`)
	if fe := scope.AssertFacility(u, fid); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return true
	}
	return false
}

// violationsBlockByViolation: chặn theo cơ sở qua vi phạm. violations.routes.js:17-24
// Không có vi phạm -> false (để handler tự trả 404).
func (h *Handlers) violationsBlockByViolation(c *gin.Context, u *auth.User, vioID int) bool {
	if scope.IsExecutive(u) {
		return false
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(),
		"SELECT s.facility_id FROM violations v JOIN students s ON s.id=v.student_id WHERE v.id=$1", vioID).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false // không có -> để handler trả 404 (violations.routes.js:20)
		}
		serverErr(c)
		return true
	}
	if fe := scope.AssertFacility(u, fid); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return true
	}
	return false
}

/* ---------- Danh mục loại vi phạm ---------- */

// ListViolationTypes: GET /api/violations/types (admin,staff). violations.routes.js:65-70
func (h *Handlers) ListViolationTypes(c *gin.Context) {
	rows, err := h.pool().Query(c.Request.Context(), "SELECT * FROM violation_types ORDER BY sort, id")
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

// CreateViolationType: POST /api/violations/types (admin). violations.routes.js:73-82
// Danh mục là cấu hình -> CHỈ admin sửa (V2-19).
func (h *Handlers) CreateViolationType(c *gin.Context) {
	var raw map[string]json.RawMessage
	_ = c.ShouldBindJSON(&raw)
	name := ""
	if p := violationsBodyStr(raw, "name"); p != nil {
		name = *p
	}
	name = strings.TrimSpace(name)
	if name == "" {
		badRequest(c, "Nhập tên loại vi phạm")
		return
	}
	sev := ""
	if p := violationsBodyStr(raw, "severity"); p != nil {
		sev = *p
	}
	ctx := c.Request.Context()
	var nextSort int
	if err := h.pool().QueryRow(ctx, "SELECT COALESCE(MAX(sort),0)+1 AS s FROM violation_types").Scan(&nextSort); err != nil {
		serverErr(c)
		return
	}
	rows, err := h.pool().Query(ctx,
		"INSERT INTO violation_types (name, severity, sort) VALUES ($1,$2,$3) RETURNING *",
		name, violationsSev(sev), nextSort)
	if err != nil {
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

// UpdateViolationType: PUT /api/violations/types/:id (admin). violations.routes.js:83-94
func (h *Handlers) UpdateViolationType(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> SQL vỡ như Node (500)
		return
	}
	var raw map[string]json.RawMessage
	_ = c.ShouldBindJSON(&raw)
	// V2-10: PUT cũng kiểm tên rỗng (trước chỉ POST kiểm).
	name := ""
	if p := violationsBodyStr(raw, "name"); p != nil {
		name = *p
	}
	name = strings.TrimSpace(name)
	if name == "" {
		badRequest(c, "Nhập tên loại vi phạm")
		return
	}
	sev := ""
	if p := violationsBodyStr(raw, "severity"); p != nil {
		sev = *p
	}
	// active = `req.body.active !== false` -> chỉ JSON boolean false mới thành false.
	active := true
	if v, has := raw["active"]; has && string(v) == "false" {
		active = false
	}
	rows, err := h.pool().Query(c.Request.Context(),
		"UPDATE violation_types SET name=$1, severity=$2, active=$3 WHERE id=$4 RETURNING *",
		name, violationsSev(sev), active, id)
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
		notFound(c, "Không tìm thấy")
		return
	}
	c.JSON(http.StatusOK, row)
}

// DeleteViolationType: DELETE /api/violations/types/:id (admin) — "xoá" = ẩn (deactivate).
// violations.routes.js:96-99
func (h *Handlers) DeleteViolationType(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if _, err := h.pool().Exec(c.Request.Context(),
		"UPDATE violation_types SET active=false WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

/* ---------- Trạng thái gửi mail ---------- */

// ViolationMailStatus: GET /api/violations/mail-status (admin,staff). violations.routes.js:102-104
// Mailer CHƯA port sang Go -> luôn "chưa sẵn sàng" (mailer.js:34-39 shape {ready,reason}).
func (h *Handlers) ViolationMailStatus(c *gin.Context) {
	ready, reason := mail.MailStatus(c.Request.Context(), h.DB)
	res := gin.H{"ready": ready}
	if !ready {
		res["reason"] = reason
	}
	c.JSON(http.StatusOK, res)
}

/* ---------- Thống kê vi phạm ---------- */

// ViolationStats: GET /api/violations/stats (admin,staff). violations.routes.js:107-144
func (h *Handlers) ViolationStats(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	settings, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	threshold := violationsThreshold(settings)
	year := c.Query("year")
	if year == "" {
		year = timeutil.Now().Format("2006")
	}

	// facBase: mỗi truy vấn dựng cond/params riêng, facility là tham số ĐẦU (khớp placeholder).
	// violations.routes.js:115
	facBase := func() ([]string, []interface{}) {
		cond := []string{"v.deleted_at IS NULL", "s.deleted_at IS NULL"}
		params := []interface{}{}
		scope.ApplyFacilityFilter(u, "s.facility_id", &cond, &params)
		return cond, params
	}
	const JV = "FROM violations v JOIN students s ON s.id=v.student_id"

	// total
	condT, pT := facBase()
	var total int
	if err := h.pool().QueryRow(ctx,
		"SELECT COUNT(*)::int c "+JV+" WHERE "+joinAnd(condT), pT...).Scan(&total); err != nil {
		serverErr(c)
		return
	}

	// bySeverity
	condS, pS := facBase()
	rows, err := h.pool().Query(ctx,
		"SELECT v.severity, COUNT(*)::int c "+JV+" WHERE "+joinAnd(condS)+" GROUP BY v.severity", pS...)
	if err != nil {
		serverErr(c)
		return
	}
	bySeverity, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}

	// byType
	condTy, pTy := facBase()
	rows, err = h.pool().Query(ctx,
		"SELECT v.type_name, COUNT(*)::int c "+JV+" WHERE "+joinAnd(condTy)+" GROUP BY v.type_name ORDER BY c DESC", pTy...)
	if err != nil {
		serverErr(c)
		return
	}
	byType, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}

	// byMonth (lọc theo năm; year là tham số $1)
	condMo := []string{"to_char(v.date,'YYYY')=$1", "v.deleted_at IS NULL", "s.deleted_at IS NULL"}
	pMo := []interface{}{year}
	scope.ApplyFacilityFilter(u, "s.facility_id", &condMo, &pMo)
	rows, err = h.pool().Query(ctx,
		"SELECT to_char(v.date,'YYYY-MM') AS month, COUNT(*)::int c "+JV+
			" WHERE "+joinAnd(condMo)+" GROUP BY month ORDER BY month", pMo...)
	if err != nil {
		serverErr(c)
		return
	}
	byMonth, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}

	// byStudent (kèm cảnh báo ngưỡng gửi nhà trường)
	condBs, pBs := facBase()
	rows, err = h.pool().Query(ctx,
		`SELECT s.id, s.name, s.code, s.class_name, r.name AS room_name,
		    COUNT(v.id)::int AS cnt,
		    MAX(v.date) AS last_date,
		    BOOL_OR(v.notified_school) AS notified
		   `+JV+`
		   LEFT JOIN rooms r ON r.id=s.room_id
		   WHERE `+joinAnd(condBs)+`
		   GROUP BY s.id, s.name, s.code, s.class_name, r.name
		   ORDER BY cnt DESC, last_date DESC`, pBs...)
	if err != nil {
		serverErr(c)
		return
	}
	byStudent, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	// needMail: số HV đạt ngưỡng mà CHƯA báo. violations.routes.js:141
	needMail := 0
	for _, r := range byStudent {
		notified := false
		if b, ok := r["notified"].(bool); ok {
			notified = b
		}
		if intFromDB(r["cnt"]) >= threshold && !notified {
			needMail++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"threshold":  threshold,
		"total":      total,
		"bySeverity": bySeverity,
		"byType":     byType,
		"byMonth":    byMonth,
		"byStudent":  byStudent,
		"needMail":   needMail,
	})
}

/* ---------- Vi phạm theo học viên ---------- */

// ViolationsByStudent: GET /api/violations/student/:id (admin,staff). violations.routes.js:147-153
func (h *Handlers) ViolationsByStudent(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> SQL vỡ như Node (500)
		return
	}
	if h.violationsBlockByStudent(c, u, id) { // đa cơ sở
		return
	}
	rows, err := h.pool().Query(c.Request.Context(),
		"SELECT * FROM violations WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date DESC, id DESC", id)
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

/* ---------- Danh sách tất cả vi phạm ---------- */

// ListViolations: GET /api/violations (admin,staff). violations.routes.js:156-180
// Phân trang tuỳ chọn: có page/limit -> {rows,total,page,limit}, không thì cả list.
func (h *Handlers) ListViolations(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	paged := c.Query("page") != "" || c.Query("limit") != ""

	// facilityScope: điều hành lọc tuỳ chọn ?facility; quản lý ÉP theo cơ sở mình. violations.routes.js:28-36
	cond := []string{}
	params := []interface{}{}
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" { // +req.query.facility (khớp vehicles.go)
			fv, _ := strconv.ParseFloat(f, 64)
			params = append(params, int(fv))
			cond = append(cond, "s.facility_id = $"+itoa(len(params)))
		}
	} else {
		scope.ApplyFacilityFilter(u, "s.facility_id", &cond, &params)
	}
	facWhere := ""
	if len(cond) > 0 {
		facWhere = " AND " + joinAnd(cond)
	}
	baseFrom := `FROM violations v JOIN students s ON s.id=v.student_id
	  LEFT JOIN rooms r ON r.id=s.room_id
	  WHERE v.deleted_at IS NULL AND s.deleted_at IS NULL` + facWhere

	if paged {
		// limit ∈ [1,200] mặc định 50; page >= 1. violations.routes.js:165-166
		limit := queryIntDefault(c, "limit", 50)
		if limit < 1 {
			limit = 1
		}
		if limit > 200 {
			limit = 200
		}
		page := queryIntDefault(c, "page", 1)
		if page < 1 {
			page = 1
		}
		var total int
		if err := h.pool().QueryRow(ctx, "SELECT COUNT(*)::int c "+baseFrom, params...).Scan(&total); err != nil {
			serverErr(c)
			return
		}
		params = append(params, limit)
		pL := len(params)
		params = append(params, (page-1)*limit)
		pO := len(params)
		rows, err := h.pool().Query(ctx,
			"SELECT v.*, s.name AS student_name, s.code AS student_code, r.name AS room_name "+baseFrom+
				" ORDER BY v.date DESC, v.id DESC LIMIT $"+itoa(pL)+" OFFSET $"+itoa(pO), params...)
		if err != nil {
			serverErr(c)
			return
		}
		list, err := db.RowsToMaps(rows)
		if err != nil {
			serverErr(c)
			return
		}
		c.JSON(http.StatusOK, gin.H{"rows": list, "total": total, "page": page, "limit": limit})
		return
	}

	rows, err := h.pool().Query(ctx,
		"SELECT v.*, s.name AS student_name, s.code AS student_code, r.name AS room_name "+baseFrom+
			" ORDER BY v.date DESC, v.id DESC", params...)
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

/* ---------- Ghi nhận vi phạm mới ---------- */

// CreateViolation: POST /api/violations (admin,staff). violations.routes.js:183-248
func (h *Handlers) CreateViolation(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	var raw map[string]json.RawMessage
	_ = c.ShouldBindJSON(&raw)

	// V2-09: field lạ (vd violation_date thay vì date) -> 400 thay vì nuốt im lặng.
	if bad := violationsRejectUnknown(raw, []string{"student_id", "type_id", "date", "note"}); bad != "" {
		badRequest(c, bad)
		return
	}

	// V2-04: HV phải TỒN TẠI + chưa xoá. (student_id vắng/null -> coi như không tìm thấy.)
	sidF, sidOK := jsNum(raw["student_id"])
	if !sidOK {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	sid := int(sidF)
	var stID int
	if err := h.pool().QueryRow(ctx,
		"SELECT id FROM students WHERE id=$1 AND deleted_at IS NULL", sid).Scan(&stID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên")
			return
		}
		serverErr(c)
		return
	}
	if h.violationsBlockByStudent(c, u, sid) { // đa cơ sở
		return
	}

	// V2-06/07: loại vi phạm BẮT BUỘC từ danh mục (type_id), tồn tại + active; severity lấy TỪ loại.
	tidF, tidOK := jsNum(raw["type_id"])
	if !tidOK || tidF == 0 {
		badRequest(c, "Chọn loại vi phạm từ danh mục")
		return
	}
	var (
		tyID     int
		tyName   string
		tySev    string
		tyActive *bool
	)
	if err := h.pool().QueryRow(ctx,
		"SELECT id, name, severity, active FROM violation_types WHERE id=$1", int(tidF)).
		Scan(&tyID, &tyName, &tySev, &tyActive); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			badRequest(c, "Loại vi phạm không tồn tại")
			return
		}
		serverErr(c)
		return
	}
	if tyActive != nil && !*tyActive { // active === false
		badRequest(c, `Loại vi phạm "`+tyName+`" đã ngừng sử dụng`)
		return
	}

	// V2-10: ngày hợp lệ trên lịch + không ở tương lai. Mặc định hôm nay.
	today := timeutil.Today()
	dateStr := ""
	if p := violationsBodyStr(raw, "date"); p != nil {
		dateStr = *p
	}
	date := dateStr
	if date == "" {
		date = today
	}
	if !valid.IsValidYmd(date) {
		badRequest(c, `Ngày vi phạm không hợp lệ: "`+dateStr+`"`)
		return
	}
	if date > today {
		badRequest(c, "Ngày vi phạm không thể ở tương lai")
		return
	}
	notePtr := violationsBodyStr(raw, "note")
	if notePtr != nil && utf8.RuneCountInString(*notePtr) > 1000 {
		badRequest(c, "Ghi chú quá dài (tối đa 1000 ký tự)")
		return
	}
	noteVal := ""
	if notePtr != nil {
		noteVal = *notePtr
	}

	settings, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	threshold := violationsThreshold(settings)

	// GHI trong transaction, KHOÁ HV (FOR UPDATE) chống hai staff cùng thấy "đủ ngưỡng" -> 2 mail (V2-02).
	var (
		violation map[string]interface{}
		willSend  bool
	)
	txErr := h.DB.WithTx(ctx, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, "SELECT id FROM students WHERE id=$1 FOR UPDATE", sid); e != nil {
			return e
		}
		var insID int
		if e := tx.QueryRow(ctx,
			`INSERT INTO violations (student_id, type_id, type_name, severity, date, note, created_by, level)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,1) RETURNING id`,
			sid, tyID, tyName, tySev, date, noteVal, u.ID).Scan(&insID); e != nil {
			return e
		}
		// V2-05: đánh lại "lần thứ N" theo THỨ TỰ NGÀY cho toàn bộ (một công thức level duy nhất).
		if _, e := tx.Exec(ctx, `UPDATE violations v SET level = sub.rn
			FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY date, id) AS rn FROM violations WHERE student_id=$1 AND deleted_at IS NULL) sub
			WHERE v.id = sub.id`, sid); e != nil {
			return e
		}
		var cnt int
		if e := tx.QueryRow(ctx,
			"SELECT COUNT(*)::int c FROM violations WHERE student_id=$1 AND deleted_at IS NULL", sid).Scan(&cnt); e != nil {
			return e
		}
		var one int
		daBao := tx.QueryRow(ctx,
			"SELECT 1 FROM violations WHERE student_id=$1 AND deleted_at IS NULL AND notified_school=true LIMIT 1", sid).
			Scan(&one) == nil
		// Quyết định gửi + đánh dấu NGAY trong transaction (chống 2 mail). violations.routes.js:222-223
		willSend = cnt >= threshold && !daBao
		if willSend {
			if _, e := tx.Exec(ctx,
				"UPDATE violations SET notified_school=true, notified_at=COALESCE(notified_at, now()) WHERE student_id=$1 AND deleted_at IS NULL", sid); e != nil {
				return e
			}
		}
		rows, e := tx.Query(ctx, "SELECT * FROM violations WHERE id=$1", insID)
		if e != nil {
			return e
		}
		v, e := db.RowToMap(rows)
		if e != nil {
			return e
		}
		violation = v
		return nil
	})
	if txErr != nil {
		serverErr(c)
		return
	}

	// Trả response NGAY. Mailer CHƯA port -> coi như đường gửi mail THẤT BẠI của Node:
	// giữ nguyên response (mail queued) rồi gỡ cờ notified_school để nút "Gửi lại" dùng được
	// (violations.routes.js:230-243). violation trả về vẫn mang notified_school=true như Node.
	var mailField interface{}
	if willSend {
		mailField = gin.H{"queued": true}
	}
	c.JSON(http.StatusCreated, gin.H{
		"violation": violation,
		"level":     violation["level"],
		"threshold": threshold,
		"mail":      mailField,
	})
	if willSend {
		// Gửi mail báo trường (P-03: sau commit). Fail -> gỡ cờ để nút "Gửi lại" dùng được. (violations.routes.js:230-243)
		if sent, _, _ := h.violationsSendMail(ctx, sid); !sent {
			_, _ = h.pool().Exec(ctx,
				"UPDATE violations SET notified_school=false, notified_at=NULL WHERE student_id=$1 AND deleted_at IS NULL", sid)
		}
	}
}

/* ---------- Sửa vi phạm ---------- */

// UpdateViolation: PUT /api/violations/:id (admin,staff). violations.routes.js:250-270
func (h *Handlers) UpdateViolation(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.violationsBlockByViolation(c, u, id) { // đa cơ sở
		return
	}
	var raw map[string]json.RawMessage
	_ = c.ShouldBindJSON(&raw)
	if bad := violationsRejectUnknown(raw, []string{"note", "admin_note", "status"}); bad != "" {
		badRequest(c, bad)
		return
	}
	// V2-07: status chỉ 'open'|'resolved'.
	statusPtr := violationsBodyStr(raw, "status")
	if statusPtr != nil && *statusPtr != "open" && *statusPtr != "resolved" {
		badRequest(c, `Trạng thái không hợp lệ: "`+*statusPtr+`" (chỉ 'open' hoặc 'resolved')`)
		return
	}
	// V2-08: chỉ đổi field CÓ gửi (CASE/COALESCE).
	var notePar, adminPar, statusPar interface{}
	if p := violationsBodyStr(raw, "note"); p != nil {
		notePar = *p
	}
	if p := violationsBodyStr(raw, "admin_note"); p != nil {
		adminPar = *p
	}
	if statusPtr != nil && *statusPtr != "" { // `b.status || null`
		statusPar = *statusPtr
	}
	rows, err := h.pool().Query(c.Request.Context(),
		`UPDATE violations SET
		   note = CASE WHEN $1::text IS NULL THEN note ELSE $1 END,
		   admin_note = CASE WHEN $2::text IS NULL THEN admin_note ELSE $2 END,
		   status = COALESCE($3, status)
		 WHERE id=$4 AND deleted_at IS NULL RETURNING *`,
		notePar, adminPar, statusPar, id)
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
		notFound(c, "Không tìm thấy")
		return
	}
	c.JSON(http.StatusOK, row)
}

/* ---------- Xoá mềm ---------- */

// DeleteViolation: DELETE /api/violations/:id (admin,staff) — xoá mềm + đánh lại level.
// violations.routes.js:273-285
func (h *Handlers) DeleteViolation(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.violationsBlockByViolation(c, u, id) { // đa cơ sở
		return
	}
	var studentID int
	if err := h.pool().QueryRow(ctx,
		"SELECT student_id FROM violations WHERE id=$1 AND deleted_at IS NULL", id).Scan(&studentID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy vi phạm")
			return
		}
		serverErr(c)
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE violations SET deleted_at=now() WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	// Đánh lại "lần thứ N" cho các vi phạm còn lại (cùng công thức lúc ghi).
	if _, err := h.pool().Exec(ctx, `UPDATE violations v SET level = sub.rn
		FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY date, id) AS rn FROM violations WHERE student_id=$1 AND deleted_at IS NULL) sub
		WHERE v.id = sub.id`, studentID); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

/* ---------- Gửi (lại) mail nhà trường thủ công ---------- */

// NotifyStudentSchool: POST /api/violations/student/:id/notify (admin,staff). violations.routes.js:288-300
// Mailer CHƯA port -> mô phỏng đường gửi FAIL của Node: vẫn kiểm ngưỡng, KHÔNG đánh cờ, trả
// {mail:{sent:false,reason}} (như sendViolationMail trả khi lỗi). Không tự gửi lại được cho tới khi
// mailer được port.
func (h *Handlers) NotifyStudentSchool(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.violationsBlockByStudent(c, u, id) { // đa cơ sở
		return
	}
	// maybeNotifySchool(id, {force:true}) — violations.routes.js:45-62
	var stID int
	if err := h.pool().QueryRow(ctx,
		"SELECT id FROM students WHERE id=$1 AND deleted_at IS NULL", id).Scan(&stID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên") // skipped 'student-missing'
			return
		}
		serverErr(c)
		return
	}
	var cnt int
	if err := h.pool().QueryRow(ctx,
		"SELECT COUNT(*)::int c FROM violations WHERE student_id=$1 AND deleted_at IS NULL", id).Scan(&cnt); err != nil {
		serverErr(c)
		return
	}
	settings, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	threshold := violationsThreshold(settings)
	if cnt < threshold { // skipped 'under-threshold'
		badRequest(c, "Chưa đủ ngưỡng gửi mail (mới "+itoa(cnt)+"/"+itoa(threshold)+" vi phạm)")
		return
	}
	// force=true: bỏ qua 'already-notified'. Gửi mail thật; sent -> đánh cờ. violations.routes.js:55-60
	sent, reason, to := h.violationsSendMail(ctx, id)
	if sent {
		_, _ = h.pool().Exec(ctx,
			"UPDATE violations SET notified_school=true, notified_at=COALESCE(notified_at, now()) WHERE student_id=$1 AND deleted_at IS NULL", id)
	}
	mailRes := gin.H{"sent": sent}
	if sent {
		mailRes["to"] = to
	} else {
		mailRes["reason"] = reason
	}
	c.JSON(http.StatusOK, gin.H{"mail": mailRes})
}
