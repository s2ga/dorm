package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/auth"
	"ktx/internal/billing"
	"ktx/internal/chores"
	"ktx/internal/db"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Cổng học viên (role student). Port từ server/routes/me.routes.js.
// Router gốc gắn requireAuth + requireRole('student') (do người điều phối wire),
// RỒI middleware chặn student thiếu student_id (me.routes.js:14-18) — ở đây thay bằng
// meStudentID(c) gọi đầu mỗi handler để giữ đúng guard đó.

// meStudentID: lấy student_id của HV đang đăng nhập; chặn tài khoản student chưa gắn hồ sơ.
// server/routes/me.routes.js:14-18. NULL=NULL là UNKNOWN nên nếu lọt, "1 đơn chờ" vô hiệu -> spam đơn.
func meStudentID(c *gin.Context) (int, bool) {
	u := auth.CurrentUser(c)
	if u == nil || u.StudentID == nil {
		forbidden(c, "Tài khoản chưa được gắn với hồ sơ học viên. Vui lòng liên hệ ban quản lý.")
		return 0, false
	}
	return *u.StudentID, true
}

// meRuneLen: đếm ký tự như .length của JS (UTF-16, xấp xỉ số rune cho ký tự BMP tiếng Việt).
// Dùng rune count (không phải byte) để giới hạn tiêu đề/ghi chú tiếng Việt khớp Node.
func meRuneLen(s string) int { return utf8.RuneCountInString(s) }

// Cột GHI CHÚ NỘI BỘ của staff — KHÔNG bao giờ trả cho học viên. server/routes/me.routes.js:20-27
var meChuNoiBo = []string{"note", "deposit_deduction_note", "checkin_confirm_note", "checkout_confirm_note", "lock_reason"}

func meBoChuNoiBo(row map[string]interface{}) {
	if row == nil {
		return
	}
	for _, k := range meChuNoiBo {
		delete(row, k)
	}
}

// meCccdUrls: cột CCCD (đang lưu S3 KEY) -> URL proxy qua app. Port server/cccd-url.js:5-15.
func meCccdUrls(row map[string]interface{}) {
	if row == nil || row["id"] == nil {
		return
	}
	id := fmt.Sprintf("%v", row["id"])
	sides := [][2]string{{"cccd_front", "front"}, {"cccd_back", "back"}, {"cccd_image", "image"}}
	for _, p := range sides {
		field, side := p[0], p[1]
		v, _ := row[field].(string)
		if v != "" && !strings.HasPrefix(v, "data:") && !strings.HasPrefix(v, "http:") && !strings.HasPrefix(v, "https:") {
			row[field] = "/api/students/" + id + "/cccd/" + side
		} else if v == "" {
			row[field] = nil
		} else {
			row[field] = v
		}
	}
}

var meCheckoutReasons = map[string]bool{
	"departure": true, "personal": true, "facility": true, "dropout": true, "reserve": true, "other": true,
}
var meDamageCategories = map[string]bool{"damage": true, "violation": true, "other": true}

// MeProfile: GET /api/me/profile — hồ sơ của chính HV. server/routes/me.routes.js:30-46
func (h *Handlers) MeProfile(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	rows, err := h.pool().Query(ctx, `
		SELECT s.*, r.name AS room_name, r.floor AS room_floor, r.monthly_fee,
		  r.capacity AS room_capacity, r.hang AS room_hang,
		  EXISTS (SELECT 1 FROM room_leaders rl
		           WHERE rl.student_id=s.id AND rl.room_id=s.room_id AND rl.to_date IS NULL) AS is_leader
		FROM students s LEFT JOIN rooms r ON r.id = s.room_id
		WHERE s.id = $1 AND s.deleted_at IS NULL`, sid)
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
		notFound(c, "Không tìm thấy hồ sơ học viên")
		return
	}
	// Kèm đơn giá máy giặt/gửi xe để hiển thị dịch vụ tự đăng ký (HV không được gọi /settings)
	s, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	// Có nội quy chưa — trả kèm để client khỏi ăn 404 khi thử tải nội quy.
	var one int
	hasRules := h.pool().QueryRow(ctx, `SELECT 1 FROM media WHERE key='noi-quy' AND path IS NOT NULL`).Scan(&one) == nil

	meCccdUrls(row)
	meBoChuNoiBo(row)
	row["washing_fee"] = s["washing_fee"]
	row["parking_fee"] = s["parking_fee"]
	row["has_rules"] = hasRules
	// Diện tích đi theo HẠNG phòng (Cài đặt), không lưu riêng từng phòng.
	if hang, _ := row["room_hang"].(string); hang != "" {
		row["room_area"] = s["room_area_"+hang]
	}
	// Số gọi khi cần. Ca đêm là phần còn lại của ca ngày nên không lưu khung giờ riêng.
	row["hotline"] = s["hotline"]
	row["security_day_phone"] = s["security_day_phone"]
	row["security_night_phone"] = s["security_night_phone"]
	row["security_day_from"] = s["security_day_from"]
	row["security_day_to"] = s["security_day_to"]
	// Wifi CHỈ trả cho HV đang ở. MeProfile không chặn người đã trả phòng (họ vẫn đăng nhập xem
	// lịch sử phiếu được), nên không lọc ở đây là họ giữ mật khẩu wifi vĩnh viễn sau khi rời KTX.
	coDate, _ := row["check_out_date"].(string)
	stt, _ := row["status"].(string)
	if row["check_in_date"] != nil && meOccupyingStr(stt, coDate, timeutil.Today()) { // BL-117: chưa xác nhận vào = chưa ở
		row["wifi_ssid"] = s["wifi_ssid"]
		row["wifi_password"] = s["wifi_password"]
	}
	c.JSON(http.StatusOK, row)
}

// MeRoommates: GET /api/me/roommates — bạn cùng phòng (chỉ tên + cờ phòng trưởng).
// server/routes/me.routes.js:49-65
func (h *Handlers) MeRoommates(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var roomID *int
	err := h.pool().QueryRow(ctx, "SELECT room_id FROM students WHERE id=$1 AND deleted_at IS NULL", sid).Scan(&roomID)
	if err != nil || roomID == nil {
		c.JSON(http.StatusOK, []interface{}{})
		return
	}
	rows, err := h.pool().Query(ctx,
		`SELECT s.name,
		   EXISTS (SELECT 1 FROM room_leaders rl
		            WHERE rl.student_id=s.id AND rl.room_id=$1 AND rl.to_date IS NULL) AS is_leader
		 FROM students s
		 WHERE s.room_id=$1 AND s.id<>$2 AND s.deleted_at IS NULL
		   AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE)
		 ORDER BY is_leader DESC, s.name`, *roomID, sid)
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

// MeAssets: GET /api/me/assets — cơ sở vật chất trong phòng (kèm phí bồi hoàn). server/routes/me.routes.js:70-77
func (h *Handlers) MeAssets(c *gin.Context) {
	if _, ok := meStudentID(c); !ok {
		return
	}
	rows, err := h.pool().Query(c.Request.Context(),
		`SELECT name, unit, category, quantity, fee, note FROM assets
		  WHERE deleted_at IS NULL ORDER BY category DESC, sort, name`)
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

// MeChores: GET /api/me/chores — lịch trực nhật 4 tuần tới, xoay vòng theo tuần. server/routes/me.routes.js:80-92
func (h *Handlers) MeChores(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var roomID *int
	err := h.pool().QueryRow(ctx, "SELECT room_id FROM students WHERE id=$1 AND deleted_at IS NULL", sid).Scan(&roomID)
	if err != nil || roomID == nil {
		c.JSON(http.StatusOK, []interface{}{})
		return
	}
	rows, err := h.pool().Query(ctx,
		`SELECT id, name, check_in_date, check_out_date FROM students
		  WHERE room_id=$1 AND deleted_at IS NULL AND check_in_date IS NOT NULL
		    AND (check_out_date IS NULL OR check_out_date >= CURRENT_DATE)`, *roomID)
	if err != nil {
		serverErr(c)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	members := make([]chores.Member, 0, len(list))
	for _, m := range list {
		ci, _ := m["check_in_date"].(string)
		co, _ := m["check_out_date"].(string)
		name, _ := m["name"].(string)
		members = append(members, chores.Member{ID: meIntOf(m["id"]), Name: name, CheckInDate: ci, CheckOutDate: co})
	}
	today := timeutil.Today()
	sched := chores.Schedule(members, today, 4)
	out := make([]gin.H, 0, len(sched))
	for _, w := range sched {
		out = append(out, gin.H{"from": w.From, "to": w.To, "student_id": w.StudentID, "name": w.Name, "is_me": w.StudentID == sid})
	}
	c.JSON(http.StatusOK, out)
}

// meIntOf: ép giá trị id (int4/int8 do pgx trả) về int.
func meIntOf(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

// meOccupyingStr: cùng quy tắc meOccupying nhưng nhận ngày dạng chuỗi 'YYYY-MM-DD' — RowToMap
// đổi cột DATE thành chuỗi, NULL thành nil (ép kiểu hụt ra ""), nên không dùng lại pgtype được.
func meOccupyingStr(status, checkOut, today string) bool {
	if status != "in" {
		return false
	}
	return checkOut == "" || checkOut > today
}

// meOccupying: HV còn đang ở KTX? status='in' && (chưa có ngày trả HOẶC ngày trả > hôm nay).
// server/routes/me.routes.js:100, 153. found=false (không có hàng) -> không ở.
func meOccupying(found bool, status string, checkOut pgtype.Date, today string) bool {
	if !found || status != "in" {
		return false
	}
	if !checkOut.Valid {
		return true
	}
	return checkOut.Time.Format("2006-01-02") > today
}

type meWashingBody struct {
	On *bool `json:"on"`
}

// MeWashing: POST /api/me/washing — tự đăng ký/hủy dịch vụ máy giặt. server/routes/me.routes.js:95-106
func (h *Handlers) MeWashing(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var status string
	var checkOut pgtype.Date
	// BL-117: chưa xác nhận nhận phòng (check_in_date NULL) thì chưa ở, dù status còn 'in'.
	err := h.pool().QueryRow(ctx, "SELECT CASE WHEN check_in_date IS NULL THEN 'pending' ELSE status END, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL", sid).Scan(&status, &checkOut)
	today := timeutil.Today()
	if !meOccupying(err == nil, status, checkOut, today) {
		badRequest(c, "Bạn không còn ở ký túc xá nên không thể thay đổi dịch vụ.")
		return
	}
	var b meWashingBody
	_ = c.ShouldBindJSON(&b)
	on := b.On == nil || *b.On // mặc định = đăng ký (true); chỉ false khi gửi rõ on=false
	if _, err := h.pool().Exec(ctx, "UPDATE students SET uses_washing=$1 WHERE id=$2 AND deleted_at IS NULL", on, sid); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "uses_washing": on})
}

// MeInvoices: GET /api/me/invoices — hóa đơn của HV. server/routes/me.routes.js:109-114
func (h *Handlers) MeInvoices(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	rows, err := h.pool().Query(c.Request.Context(),
		"SELECT * FROM invoices WHERE student_id=$1 AND deleted_at IS NULL ORDER BY month DESC", sid)
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

// MeLogs: GET /api/me/logs — lịch sử check-in/out của HV (tối đa 100). server/routes/me.routes.js:116-121
func (h *Handlers) MeLogs(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	rows, err := h.pool().Query(c.Request.Context(),
		"SELECT * FROM logs WHERE student_id=$1 ORDER BY date DESC, id DESC LIMIT 100", sid)
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

// MeViolations: GET /api/me/violations — vi phạm/nhắc nhở của HV (chỉ đọc). server/routes/me.routes.js:124-129
func (h *Handlers) MeViolations(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	rows, err := h.pool().Query(c.Request.Context(),
		`SELECT date, type_name, severity, level, note, status FROM violations
		  WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date DESC, id DESC`, sid)
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

// MeDamageList: GET /api/me/damage — báo cáo hư hỏng của HV (bỏ admin_note). server/routes/me.routes.js:132-141
func (h *Handlers) MeDamageList(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	rows, err := h.pool().Query(c.Request.Context(),
		`SELECT id, category, title, description, status, assigned_at, resolved_at, created_at
		 FROM damage_reports WHERE student_id=$1 ORDER BY created_at DESC`, sid)
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

type meDamageBody struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
}

// MeDamageCreate: POST /api/me/damage — gửi yêu cầu hỗ trợ/báo hỏng. server/routes/me.routes.js:142-161
func (h *Handlers) MeDamageCreate(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	var b meDamageBody
	_ = c.ShouldBindJSON(&b)
	category := "damage"
	if meDamageCategories[b.Category] {
		category = b.Category
	}
	if strings.TrimSpace(b.Title) == "" {
		badRequest(c, "Nhập nội dung yêu cầu hỗ trợ")
		return
	}
	if meRuneLen(b.Title) > 200 {
		badRequest(c, "Tiêu đề quá dài (tối đa 200 ký tự)")
		return
	}
	if b.Description != "" && meRuneLen(b.Description) > 5000 {
		badRequest(c, "Nội dung quá dài (tối đa 5000 ký tự)")
		return
	}
	// Đã trả phòng thì không gửi báo hỏng nữa (giống /washing đã chặn).
	ctx := c.Request.Context()
	var roomID *int
	var status string
	var checkOut pgtype.Date
	err := h.pool().QueryRow(ctx, "SELECT room_id, CASE WHEN check_in_date IS NULL THEN 'pending' ELSE status END, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL", sid).
		Scan(&roomID, &status, &checkOut)
	today := timeutil.Today()
	if !meOccupying(err == nil, status, checkOut, today) {
		badRequest(c, "Bạn không còn ở ký túc xá nên không thể gửi yêu cầu hỗ trợ.")
		return
	}
	rows, err := h.pool().Query(ctx,
		`INSERT INTO damage_reports (student_id, room_id, category, title, description) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
		sid, roomID, category, strings.TrimSpace(b.Title), b.Description)
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

// MeCheckoutRequestList: GET /api/me/checkout-request — đơn trả phòng của HV (bỏ admin_note). server/routes/me.routes.js:164-172
func (h *Handlers) MeCheckoutRequestList(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	rows, err := h.pool().Query(c.Request.Context(),
		`SELECT id, desired_date, reason, note, status, created_at, handled_at
		 FROM checkout_requests WHERE student_id=$1 ORDER BY created_at DESC`, sid)
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

type meCheckoutBody struct {
	DesiredDate string `json:"desired_date"`
	Reason      string `json:"reason"`
	Note        string `json:"note"`
	BankAccount string `json:"bank_account"` // BL-62: STK HV nhận hoàn cọc (in trên phiếu; chuyển cọc làm ngoài app)
	BankName    string `json:"bank_name"`
}

// MeCheckoutRequestCreate: POST /api/me/checkout-request — HV tự xin trả phòng. server/routes/me.routes.js:173-201
func (h *Handlers) MeCheckoutRequestCreate(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	var b meCheckoutBody
	_ = c.ShouldBindJSON(&b)
	today := timeutil.Today()
	if b.Note != "" && meRuneLen(b.Note) > 2000 {
		badRequest(c, "Ghi chú quá dài (tối đa 2000 ký tự)")
		return
	}
	if meRuneLen(b.BankAccount) > 50 {
		badRequest(c, "Số tài khoản quá dài (tối đa 50 ký tự)")
		return
	}
	if meRuneLen(b.BankName) > 100 {
		badRequest(c, "Tên ngân hàng quá dài (tối đa 100 ký tự)")
		return
	}
	if b.DesiredDate != "" && !valid.IsValidYmd(b.DesiredDate) {
		badRequest(c, "Ngày trả phòng không hợp lệ")
		return
	}
	if b.DesiredDate != "" && b.DesiredDate < today {
		badRequest(c, "Ngày trả phòng phải từ hôm nay trở đi")
		return
	}
	ctx := c.Request.Context()
	// Chặn trên: ngày trả xa quá N ngày là gõ nhầm; đơn "đang chờ" đó khoá mọi đơn thật sau này. N = Cài đặt (mặc định 365).
	if b.DesiredDate != "" {
		maxDays := 365
		s, err := h.DB.GetSettings(ctx)
		if err != nil {
			serverErr(c)
			return
		}
		if n, e := strconv.ParseFloat(strings.TrimSpace(s["checkout_max_future_days"]), 64); e == nil && n != 0 {
			maxDays = int(n)
		}
		max := billing.AddDays(today, maxDays)
		if b.DesiredDate > max {
			badRequest(c, "Ngày trả phòng quá xa (chỉ nhận trong vòng "+itoa(maxDays)+" ngày tới). Vui lòng kiểm tra lại.")
			return
		}
	}
	// Chặn HV chưa nhận phòng (ngày vào ở tương lai) — chưa ở thì không thể "trả phòng".
	var checkIn pgtype.Date
	err := h.pool().QueryRow(ctx, "SELECT check_in_date FROM students WHERE id=$1 AND deleted_at IS NULL", sid).Scan(&checkIn)
	if err == nil && checkIn.Valid && checkIn.Time.Format("2006-01-02") > today {
		badRequest(c, "Bạn chưa đến ngày nhận phòng nên chưa thể gửi đơn trả phòng.")
		return
	}
	var one int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM checkout_requests WHERE student_id=$1 AND status='pending'`, sid).Scan(&one) == nil {
		badRequest(c, "Bạn đã có đơn trả phòng đang chờ duyệt")
		return
	}
	reason := "other"
	if meCheckoutReasons[b.Reason] {
		reason = b.Reason
	}
	var desired interface{}
	if b.DesiredDate != "" {
		desired = b.DesiredDate
	}
	rows, err := h.pool().Query(ctx,
		`INSERT INTO checkout_requests (student_id, desired_date, reason, note, bank_account, bank_name)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
		sid, desired, reason, b.Note, strings.TrimSpace(b.BankAccount), strings.TrimSpace(b.BankName))
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
