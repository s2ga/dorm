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
	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/auth"
	"ktx/internal/billing"
	"ktx/internal/checkout"
	"ktx/internal/db"
	"ktx/internal/invoicecalc"
	"ktx/internal/meter"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Handler đơn từ (requests): báo cáo hư hỏng + đơn đăng ký trả phòng.
// Port từ server/routes/requests.routes.js. Mount: /api/requests.
// Toàn bộ route: requireAuth + requireRole('admin','staff') (requests.routes.js:12).

// requestsTaskStatus: trạng thái hợp lệ của việc bảo trì. requests.routes.js:57
var requestsTaskStatus = []string{"new", "processing", "blocked", "done"}

func requestsHasStatus(s string) bool {
	for _, v := range requestsTaskStatus {
		if v == s {
			return true
		}
	}
	return false
}

// requestsFacilityWhere: WHERE lọc theo cơ sở (qua HV s.facility_id). Điều hành: tuỳ chọn ?facility.
// Quản lý cơ sở: ép theo cơ sở của mình. requests.routes.js:15-23
func requestsFacilityWhere(c *gin.Context, u *auth.User) (string, []interface{}) {
	cond := []string{}
	params := []interface{}{}
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			fv, _ := strconv.ParseFloat(f, 64)
			params = append(params, int(fv))
			cond = append(cond, "s.facility_id = $"+itoa(len(params)))
		}
	} else {
		scope.ApplyFacilityFilter(u, "s.facility_id", &cond, &params)
	}
	if len(cond) == 0 {
		return "", params
	}
	return "WHERE " + joinAnd(cond), params
}

// requestsBlockByCheckoutReq: chặn thao tác lên đơn trả phòng NGOÀI cơ sở người dùng.
// Trả true nếu ĐÃ chặn (đã gửi phản hồi) hoặc gặp lỗi máy chủ. requests.routes.js:25-32
func (h *Handlers) requestsBlockByCheckoutReq(c *gin.Context, u *auth.User, id int) bool {
	if scope.IsExecutive(u) {
		return false
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(),
		"SELECT s.facility_id FROM checkout_requests c LEFT JOIN students s ON s.id=c.student_id WHERE c.id=$1", id).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false // không có đơn -> để handler tự xử (requests.routes.js:28)
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

// requestsBlockByDamage: chặn thao tác lên báo cáo hư hỏng NGOÀI cơ sở người dùng. requests.routes.js:33-40
func (h *Handlers) requestsBlockByDamage(c *gin.Context, u *auth.User, id int) bool {
	if scope.IsExecutive(u) {
		return false
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(),
		"SELECT COALESCE(s.facility_id, r.facility_id) AS fid FROM damage_reports d LEFT JOIN students s ON s.id=d.student_id LEFT JOIN rooms r ON r.id=d.room_id WHERE d.id=$1", id).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false // không có báo cáo -> để handler tự xử (requests.routes.js:36)
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

/* ---- Báo cáo hư hỏng ---- */

// ListDamageReports: GET /api/requests/damage (admin,staff). requests.routes.js:43-55
func (h *Handlers) ListDamageReports(c *gin.Context) {
	u := auth.CurrentUser(c)
	where, params := requestsFacilityWhere(c, u)
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT d.*, s.name AS student_name, r.name AS room_name
		FROM damage_reports d
		LEFT JOIN students s ON s.id = d.student_id
		LEFT JOIN rooms r ON r.id = d.room_id
		`+where+`
		ORDER BY (d.status<>'done') DESC, d.created_at DESC`, params...)
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

type damageUpdateBody struct {
	Status    *string `json:"status"`
	AdminNote *string `json:"admin_note"`
}

// UpdateDamageReport: PUT /api/requests/damage/:id (admin,staff). requests.routes.js:58-78
func (h *Handlers) UpdateDamageReport(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> câu lệnh SQL vỡ như Node (500)
		return
	}
	if h.requestsBlockByDamage(c, u, id) { // đa cơ sở
		return
	}
	var b damageUpdateBody
	_ = c.ShouldBindJSON(&b)
	// Trạng thái: chỉ đổi khi CÓ gửi và HỢP LỆ. Không gửi -> GIỮ nguyên. requests.routes.js:63-65
	hasStatus := b.Status != nil && *b.Status != ""
	if hasStatus && !requestsHasStatus(*b.Status) {
		badRequest(c, `Trạng thái không hợp lệ: "`+*b.Status+`". Chỉ nhận: `+strings.Join(requestsTaskStatus, ", ")+`.`)
		return
	}
	hasNote := b.AdminNote != nil // requests.routes.js:66
	var statusParam interface{}
	if hasStatus {
		statusParam = *b.Status
	}
	noteVal := ""
	if hasNote {
		noteVal = *b.AdminNote
	}
	rows, err := h.pool().Query(c.Request.Context(),
		`UPDATE damage_reports
		   SET status = COALESCE($1, status),
		       admin_note = CASE WHEN $2 THEN $3 ELSE admin_note END,
		       resolved_at = CASE WHEN COALESCE($1,status)='done' THEN COALESCE(resolved_at, now()) ELSE NULL END
		 WHERE id=$4 RETURNING *`,
		statusParam, hasNote, noteVal, id)
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
		notFound(c, "Không tìm thấy báo cáo") // requests.routes.js:75
		return
	}
	c.JSON(http.StatusOK, row)
}

// AssignDamageReport: POST /api/requests/damage/:id/assign (admin,staff).
// Duyệt & chuyển bộ phận bảo trì (chỉ áp dụng báo hư hỏng phòng). requests.routes.js:81-90
func (h *Handlers) AssignDamageReport(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.requestsBlockByDamage(c, u, id) { // đa cơ sở
		return
	}
	rows, err := h.pool().Query(c.Request.Context(),
		`UPDATE damage_reports SET assigned_at=now(), status=CASE WHEN status='done' THEN status ELSE 'processing' END
		 WHERE id=$1 AND category='damage' RETURNING *`, id)
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
		notFound(c, "Không tìm thấy báo hư hỏng (chỉ chuyển được mục hư hỏng phòng)") // requests.routes.js:87
		return
	}
	c.JSON(http.StatusOK, row)
}

/* ---- Đơn đăng ký trả phòng ---- */

// ListCheckoutRequests: GET /api/requests/checkout (admin,staff). requests.routes.js:93-105
func (h *Handlers) ListCheckoutRequests(c *gin.Context) {
	u := auth.CurrentUser(c)
	where, params := requestsFacilityWhere(c, u)
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT c.*, s.name AS student_name, s.deposit_status, r.name AS room_name
		FROM checkout_requests c
		LEFT JOIN students s ON s.id = c.student_id
		LEFT JOIN rooms r ON r.id = s.room_id
		`+where+`
		ORDER BY (c.status='pending') DESC, c.created_at DESC`, params...)
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

type checkoutConfirmBody struct {
	Date         string          `json:"date"`
	MeterReading json.RawMessage `json:"meter_reading"`
}

// requestsMeterVal: mô phỏng Node cho meter_reading.
//   - hasMeter = mr != null && String(mr).trim() !== ” (requests.routes.js:132)
//   - finite   = Number(reading) hữu hạn (meter.js:13 Number.isFinite)
func requestsMeterVal(raw json.RawMessage) (hasMeter bool, reading float64, finite bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return false, 0, false
	}
	var num float64
	if json.Unmarshal(raw, &num) == nil {
		// JSON number -> String(num).trim() luôn khác rỗng -> hasMeter, luôn hữu hạn
		return true, num, true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		if strings.TrimSpace(s) == "" {
			return false, 0, false
		}
		n, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			return true, 0, false // có nhập nhưng không phải số -> Number(...) = NaN
		}
		return true, n, true
	}
	return false, 0, false
}

// ConfirmCheckout: POST /api/requests/checkout/:id/confirm (admin,staff).
// Xác nhận trả phòng: thực hiện check-out THẬT cho học viên. requests.routes.js:108-172
func (h *Handlers) ConfirmCheckout(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.requestsBlockByCheckoutReq(c, u, id) { // đa cơ sở
		return
	}
	var body checkoutConfirmBody
	_ = c.ShouldBindJSON(&body)
	// Đọc đơn (requests.routes.js:111-112)
	var (
		crStatus  string
		desired   pgtype.Date
		crReason  *string
		createdAt time.Time
		crSID     *int
	)
	err := h.pool().QueryRow(ctx,
		"SELECT status, desired_date, reason, created_at, student_id FROM checkout_requests WHERE id=$1", id).
		Scan(&crStatus, &desired, &crReason, &createdAt, &crSID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy đơn")
			return
		}
		serverErr(c)
		return
	}
	// CHỈ duyệt đơn ĐANG CHỜ. requests.routes.js:115-116
	if crStatus != "pending" {
		xuLy := "đã từ chối"
		if crStatus == "done" {
			xuLy = "đã duyệt"
		}
		conflict(c, gin.H{"error": "Đơn này đã được xử lý (" + xuLy + ") — không thể duyệt lại."})
		return
	}
	// Ngày trả: body.date || desired_date || hôm nay. requests.routes.js:118-119
	date := body.Date
	if date == "" {
		if desired.Valid {
			date = desired.Time.Format("2006-01-02")
		}
	}
	if date == "" {
		date = timeutil.Today()
	}
	if !valid.IsValidYmd(date) {
		badRequest(c, `Ngày trả phòng không hợp lệ: "`+date+`"`)
		return
	}
	// noticeDate = created_at (UTC) cắt 10 ký tự. requests.routes.js:120
	noticeDate := createdAt.UTC().Format("2006-01-02")
	// Tìm học viên của đơn. requests.routes.js:121-122
	var (
		roomID  *int
		checkIn pgtype.Date
	)
	var sidArg interface{}
	if crSID != nil {
		sidArg = *crSID
	}
	err = h.pool().QueryRow(ctx,
		"SELECT room_id, check_in_date FROM students WHERE id=$1 AND deleted_at IS NULL", sidArg).
		Scan(&roomID, &checkIn)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên của đơn này")
			return
		}
		serverErr(c)
		return
	}
	studentID := *crSID // học viên tồn tại -> sid chắc chắn không nil
	checkInStr := ""
	if checkIn.Valid {
		checkInStr = checkIn.Time.Format("2006-01-02")
	}
	// Ngày trả KHÔNG được trước ngày nhận / trước ngày bắt đầu lượt ở (BLK-3). requests.routes.js:127-128
	badDate, err := checkout.BadCheckoutDate(ctx, h.pool(), studentID, date, checkInStr)
	if err != nil {
		serverErr(c)
		return
	}
	if badDate != "" {
		badRequest(c, badDate)
		return
	}
	// Chốt chỉ số điện ngày trả phòng (nếu người duyệt có nhập). requests.routes.js:131-137
	hasMeter, reading, finite := requestsMeterVal(body.MeterReading)
	if hasMeter {
		if roomID == nil {
			badRequest(c, "Học viên không ở phòng nào — không có công-tơ để chốt chỉ số")
			return
		}
		if !finite {
			// Number(reading) không hữu hạn -> meter.checkRead trả câu này (meter.js:14)
			badRequest(c, "Chỉ số công-tơ phải là số không âm")
			return
		}
		errMsg, err := meter.CheckRead(ctx, h.pool(), *roomID, date, reading)
		if err != nil {
			serverErr(c)
			return
		}
		if errMsg != "" {
			badRequest(c, errMsg)
			return
		}
	}
	// CLAIM NGUYÊN TỬ: chỉ MỘT request thắng WHERE status='pending'. requests.routes.js:143-144
	ct, err := h.pool().Exec(ctx,
		"UPDATE checkout_requests SET status='done', handled_at=now() WHERE id=$1 AND status='pending'", id)
	if err != nil {
		serverErr(c)
		return
	}
	if ct.RowsAffected() == 0 {
		conflict(c, gin.H{"error": "Đơn đã được xử lý bởi thao tác khác — tải lại để xem trạng thái mới nhất."})
		return
	}
	// Cập nhật học viên -> đã trả phòng. requests.routes.js:146-147
	var reasonArg interface{}
	if crReason != nil {
		reasonArg = *crReason
	}
	if _, err := h.pool().Exec(ctx,
		"UPDATE students SET status='out', check_out_date=$1, checkout_notice_date=$2, checkout_reason=$3 WHERE id=$4",
		date, noticeDate, reasonArg, studentID); err != nil {
		serverErr(c)
		return
	}
	// Ghi chỉ số công-tơ (nếu có). requests.routes.js:148-153
	if hasMeter {
		if _, err := meter.RecordRead(ctx, h.pool(), *roomID, date, reading, "checkout", &studentID,
			"Chốt chỉ số lúc trả phòng (duyệt đơn HV)", u.Username); err != nil {
			serverErr(c)
			return
		}
	}
	// Nhật ký ra: source='admin' (cán bộ duyệt đơn thực hiện, không phải HV). requests.routes.js:156-157
	byName := u.Username
	if byName == "" {
		byName = "cán bộ"
	}
	if _, err := h.pool().Exec(ctx,
		"INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out',$2,$3,$4,'admin')",
		studentID, date, roomID, "Trả phòng (duyệt đơn HV, bởi "+byName+")"); err != nil {
		serverErr(c)
		return
	}
	// BLK-1: đóng lượt ở + đóng phòng trưởng + dọn phiếu kỳ sau + tính lại. requests.routes.js:162
	dropped, err := checkout.FinalizeCheckout(ctx, h.pool(), h.DB, studentID, date)
	if err != nil {
		serverErr(c)
		return
	}
	// Chốt giữa kỳ đổi phần chia của cả phòng -> tính lại cho bạn cùng phòng. requests.routes.js:164-169
	if hasMeter {
		aff, err := meter.AffectedStudents(ctx, h.pool(), *roomID, date)
		if err == nil {
			for _, sid := range aff {
				if sid == studentID {
					continue
				}
				_, _ = invoicecalc.RecalcInvoice(ctx, h.DB, sid, date[:7]) // try/catch: bỏ qua lỗi
			}
		}
	}
	if dropped == nil {
		dropped = []string{} // khớp Node: rows.map(...) luôn là mảng
	}
	// BL-25: trả điều kiện hoàn cọc + phiếu tháng trả đã tính lại (như CheckOut thủ công) để FE nối bước
	// xử lý cọc (depositSettlePrompt). noticeDate = ngày HV gửi đơn (created_at); date = ngày rời thực tế.
	settings, _ := h.DB.GetSettings(ctx)
	reasonStr := ""
	if crReason != nil {
		reasonStr = *crReason
	}
	elig := billing.DepositRefundEligible(noticeDate, date, reasonStr, int(studentsSettingNum(settings, "deposit_notice_min_days")))
	var recalced interface{}
	if r, e := invoicecalc.RecalcInvoice(ctx, h.DB, studentID, date[:7]); e == nil && r != nil {
		recalced = r
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":                      true,
		"dropped_future_invoices": dropped,
		"refund":                  gin.H{"eligible": elig.Eligible, "reason": elig.Reason},
		"recalced":                recalced,
	})
}

// ApproveCheckout: POST /api/requests/checkout/:id/approve (admin,staff).
// BL-62: BQL duyệt đơn -> 'approved' (chờ an ninh bàn giao). KHÁC ConfirmCheckout cũ:
// KHÔNG trả phòng ở bước này; việc trả phòng thật để ở bước bàn giao.
func (h *Handlers) ApproveCheckout(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.requestsBlockByCheckoutReq(c, u, id) { // đa cơ sở
		return
	}
	// Duyệt NGUYÊN TỬ: chỉ đổi khi VẪN 'pending' (hai người duyệt cùng lúc -> một thắng).
	ctag, err := h.pool().Exec(ctx,
		"UPDATE checkout_requests SET status='approved', approved_by=$1, approved_at=now() WHERE id=$2 AND status='pending'",
		u.Username, id)
	if err != nil {
		serverErr(c)
		return
	}
	if ctag.RowsAffected() == 0 {
		var cur string
		e2 := h.pool().QueryRow(ctx, "SELECT status FROM checkout_requests WHERE id=$1", id).Scan(&cur)
		if e2 != nil {
			if errors.Is(e2, pgx.ErrNoRows) {
				notFound(c, "Không tìm thấy đơn")
				return
			}
			serverErr(c)
			return
		}
		msg := "Đơn không còn chờ duyệt (hiện: " + cur + ") — tải lại để xem trạng thái mới nhất."
		if cur == "rejected" {
			msg = "Đơn này đã bị từ chối — không thể duyệt."
		}
		conflict(c, gin.H{"error": msg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type checkoutHandoverBody struct {
	Date         string          `json:"date"`
	KeyReturned  bool            `json:"key_returned"`
	MeterReading json.RawMessage `json:"meter_reading"`
	Damages      []struct {
		AssetID  int `json:"asset_id"`
		Quantity int `json:"quantity"`
	} `json:"damages"`
}

// HandoverCheckout: POST /api/requests/checkout/:id/handover (admin,staff,maintenance).
// BL-62 GĐ2c — an ninh nhận bàn giao: đơn 'approved' -> 'handed_over'. Đây là chỗ THẬT SỰ trả phòng.
// Nhập: đã nhận chìa khóa, hư hao (tick theo danh mục — server tự tính từ assets.fee), số điện chốt.
// App: HV -> đã trả phòng, chốt công-tơ, đóng lượt ở/phòng trưởng/dọn phiếu kỳ sau, lưu bàn giao vào đơn.
// (Tính điện đúng "phương án A" để ở GĐ3; bước này chỉ LƯU số điện.)
func (h *Handlers) HandoverCheckout(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.requestsBlockByCheckoutReq(c, u, id) { // đa cơ sở
		return
	}
	var body checkoutHandoverBody
	_ = c.ShouldBindJSON(&body)

	// Đơn phải đang 'approved' (đã duyệt, chờ bàn giao).
	var (
		crStatus  string
		crReason  *string
		createdAt time.Time
		crSID     *int
	)
	if err := h.pool().QueryRow(ctx,
		"SELECT status, reason, created_at, student_id FROM checkout_requests WHERE id=$1", id).
		Scan(&crStatus, &crReason, &createdAt, &crSID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy đơn")
			return
		}
		serverErr(c)
		return
	}
	if crStatus != "approved" {
		msg := "Đơn phải được DUYỆT trước khi bàn giao (hiện: " + crStatus + ")."
		switch crStatus {
		case "handed_over", "billed", "done":
			msg = "Đơn này đã bàn giao rồi — không bàn giao lại."
		case "rejected":
			msg = "Đơn đã bị từ chối."
		}
		conflict(c, gin.H{"error": msg})
		return
	}
	if crSID == nil {
		notFound(c, "Không tìm thấy học viên của đơn này")
		return
	}
	studentID := *crSID

	// Học viên (phòng + ngày nhận).
	var (
		roomID  *int
		checkIn pgtype.Date
	)
	if err := h.pool().QueryRow(ctx,
		"SELECT room_id, check_in_date FROM students WHERE id=$1 AND deleted_at IS NULL", studentID).
		Scan(&roomID, &checkIn); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên của đơn này")
			return
		}
		serverErr(c)
		return
	}

	// Ngày rời thực tế: body.date || hôm nay; không tương lai; không trước ngày nhận/lượt ở (BLK-3).
	date := body.Date
	if date == "" {
		date = timeutil.Today()
	}
	if !valid.IsValidYmd(date) {
		badRequest(c, `Ngày trả phòng không hợp lệ: "`+date+`"`)
		return
	}
	if date > timeutil.Today() {
		badRequest(c, "Ngày trả phòng thực tế không thể ở tương lai.")
		return
	}
	checkInStr := ""
	if checkIn.Valid {
		checkInStr = checkIn.Time.Format("2006-01-02")
	}
	badDate, err := checkout.BadCheckoutDate(ctx, h.pool(), studentID, date, checkInStr)
	if err != nil {
		serverErr(c)
		return
	}
	if badDate != "" {
		badRequest(c, badDate)
		return
	}

	// Số điện chốt: BẮT BUỘC nếu HV còn ở phòng (để lập phiếu điện kỳ cuối).
	hasMeter, reading, finite := requestsMeterVal(body.MeterReading)
	if roomID != nil {
		if !hasMeter {
			badRequest(c, "Cần ghi số điện chốt lúc bàn giao.")
			return
		}
		if !finite {
			badRequest(c, "Chỉ số công-tơ phải là số không âm")
			return
		}
		errMsg, e := meter.CheckRead(ctx, h.pool(), *roomID, date, reading)
		if e != nil {
			serverErr(c)
			return
		}
		if errMsg != "" {
			badRequest(c, errMsg)
			return
		}
	}

	// Hư hao theo danh mục — server tự tính từ assets.fee (client chỉ gửi asset_id + số lượng).
	var damageAmount float64
	var damageParts []string
	for _, line := range body.Damages {
		if line.Quantity < 0 {
			badRequest(c, "Số lượng hư hao không hợp lệ")
			return
		}
		if line.Quantity == 0 {
			continue
		}
		var name string
		var fee float64
		if e := h.pool().QueryRow(ctx, "SELECT name, fee FROM assets WHERE id=$1 AND deleted_at IS NULL", line.AssetID).
			Scan(&name, &fee); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				badRequest(c, "Tài sản không tồn tại (id="+itoa(line.AssetID)+")")
				return
			}
			serverErr(c)
			return
		}
		lineTotal := float64(line.Quantity) * fee
		damageAmount += lineTotal
		damageParts = append(damageParts, name+" x"+itoa(line.Quantity)+" = "+studentsLocaleVN(lineTotal))
	}
	damageNote := strings.Join(damageParts, "; ")

	var meterArg interface{}
	if hasMeter {
		meterArg = reading
	}

	// CLAIM nguyên tử: chỉ MỘT lần bàn giao thắng WHERE status='approved'.
	ct, err := h.pool().Exec(ctx,
		`UPDATE checkout_requests
		   SET status='handed_over', key_returned=$1, damage_note=$2, damage_amount=$3,
		       meter_reading=$4, handover_by=$5, handover_at=now()
		 WHERE id=$6 AND status='approved'`,
		body.KeyReturned, damageNote, damageAmount, meterArg, u.Username, id)
	if err != nil {
		serverErr(c)
		return
	}
	if ct.RowsAffected() == 0 {
		conflict(c, gin.H{"error": "Đơn vừa được xử lý bởi thao tác khác — tải lại để xem trạng thái mới nhất."})
		return
	}

	// HV -> đã trả phòng (ngày rời thực tế = ngày bàn giao).
	noticeDate := createdAt.UTC().Format("2006-01-02")
	var reasonArg interface{}
	if crReason != nil {
		reasonArg = *crReason
	}
	if _, err := h.pool().Exec(ctx,
		"UPDATE students SET status='out', check_out_date=$1, checkout_notice_date=$2, checkout_reason=$3 WHERE id=$4",
		date, noticeDate, reasonArg, studentID); err != nil {
		serverErr(c)
		return
	}

	// Ghi chỉ số công-tơ (nếu có).
	if hasMeter {
		if _, err := meter.RecordRead(ctx, h.pool(), *roomID, date, reading, "checkout", &studentID,
			"Chốt chỉ số lúc an ninh nhận bàn giao (BL-62)", u.Username); err != nil {
			serverErr(c)
			return
		}
	}

	// Nhật ký ra — source theo VAI người thực hiện (an ninh = maintenance).
	src := "admin"
	if u != nil && u.Role == "maintenance" {
		src = "maintenance"
	}
	byName := u.Username
	if byName == "" {
		byName = "cán bộ"
	}
	_, _ = h.pool().Exec(ctx,
		"INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out',$2,$3,$4,$5)",
		studentID, date, roomID, "An ninh nhận bàn giao phòng (BL-62, bởi "+byName+")", src)

	// BLK-1: đóng lượt ở + phòng trưởng + dọn phiếu kỳ sau + tính lại.
	dropped, err := checkout.FinalizeCheckout(ctx, h.pool(), h.DB, studentID, date)
	if err != nil {
		serverErr(c)
		return
	}
	// Chốt giữa kỳ đổi phần chia của cả phòng -> tính lại cho bạn cùng phòng.
	if hasMeter {
		if aff, e := meter.AffectedStudents(ctx, h.pool(), *roomID, date); e == nil {
			for _, sid := range aff {
				if sid == studentID {
					continue
				}
				_, _ = invoicecalc.RecalcInvoice(ctx, h.DB, sid, date[:7])
			}
		}
	}
	if dropped == nil {
		dropped = []string{}
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":                      true,
		"dropped_future_invoices": dropped,
		"damage_amount":           damageAmount,
		"damage_note":             damageNote,
	})
}

type checkoutNoteBody struct {
	Note string `json:"note"`
}

// NoteCheckout: PUT /api/requests/checkout/:id/note (admin,staff). requests.routes.js:174-181
func (h *Handlers) NoteCheckout(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.requestsBlockByCheckoutReq(c, u, id) { // đa cơ sở
		return
	}
	var b checkoutNoteBody
	_ = c.ShouldBindJSON(&b)
	ctag, err := h.pool().Exec(c.Request.Context(),
		"UPDATE checkout_requests SET admin_note=$1 WHERE id=$2", b.Note, id)
	if err != nil {
		serverErr(c)
		return
	}
	if ctag.RowsAffected() == 0 {
		notFound(c, "Không tìm thấy đơn")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// RejectCheckout: POST /api/requests/checkout/:id/reject (admin,staff). requests.routes.js:183-197
func (h *Handlers) RejectCheckout(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.requestsBlockByCheckoutReq(c, u, id) { // đa cơ sở
		return
	}
	// Từ chối NGUYÊN TỬ: chỉ đổi khi VẪN 'pending'. requests.routes.js:189
	ctag, err := h.pool().Exec(ctx,
		"UPDATE checkout_requests SET status='rejected', handled_at=now() WHERE id=$1 AND status='pending'", id)
	if err != nil {
		serverErr(c)
		return
	}
	if ctag.RowsAffected() == 0 {
		var cur string
		e2 := h.pool().QueryRow(ctx, "SELECT status FROM checkout_requests WHERE id=$1", id).Scan(&cur)
		if e2 != nil {
			if errors.Is(e2, pgx.ErrNoRows) {
				notFound(c, "Không tìm thấy đơn") // requests.routes.js:192
				return
			}
			serverErr(c)
			return
		}
		xuLy := "đã từ chối"
		if cur == "done" {
			xuLy = "đã duyệt — học viên đã trả phòng"
		}
		conflict(c, gin.H{"error": "Đơn này đã được xử lý (" + xuLy + ") — không thể từ chối."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
