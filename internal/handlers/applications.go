package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/roomrules"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Handler đơn đăng ký nội trú (applications). Port từ server/routes/applications.routes.js.
// Mount: /api/applications. Toàn bộ route: requireAuth + requireRole('admin','staff') (applications.routes.js:11).

/* ---- helper đọc map hàng applications (RETURNING *) ---- */

// applicationsStr: giá trị chuỗi của cột (nil -> rỗng). Tương đương app.x hoặc chuỗi rỗng, chỉ dùng cho chuỗi.
func applicationsStr(m map[string]interface{}, k string) string {
	if v, ok := m[k]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// applicationsVal: giá trị thô của cột (giữ nil để INSERT NULL — dùng cho các cột truyền "as-is" như Node).
func applicationsVal(m map[string]interface{}, k string) interface{} {
	if v, ok := m[k]; ok {
		return v
	}
	return nil
}

// applicationsStrOrNil: chuỗi rỗng -> nil (tương đương app.x || null của Node cho cột chuỗi, vd cccd_*).
func applicationsStrOrNil(m map[string]interface{}, k string) interface{} {
	s := applicationsStr(m, k)
	if s == "" {
		return nil
	}
	return s
}

// applicationsBool: !!app.x cho cột boolean.
func applicationsBool(m map[string]interface{}, k string) bool {
	if v, ok := m[k]; ok && v != nil {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

// applicationsIntPtr: cột id (int/nil) -> *int.
func applicationsIntPtr(m map[string]interface{}, k string) *int {
	if v, ok := m[k]; ok && v != nil {
		n := intFromDB(v)
		return &n
	}
	return nil
}

// jsTruthy: mô phỏng truthiness của JS cho một giá trị JSON (dùng cho b.create_login, b.deposit_paid,
// b.confirm_duplicate...). null/absent/false/0/"" -> false; còn lại -> true.
func jsTruthy(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var v interface{}
	if json.Unmarshal(raw, &v) != nil {
		return false
	}
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t != ""
	default:
		return true
	}
}

// jsStrictTrue: mô phỏng `x === true` của JS (b.confirm_overload === true).
func jsStrictTrue(raw json.RawMessage) bool { return string(raw) == "true" }

// jsRawDisp: mô phỏng `${x}` của JS cho b.deposit_amount (số -> "5", chuỗi -> nội dung, absent -> "undefined").
func jsRawDisp(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "undefined"
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		return numDisp(f)
	}
	return string(raw)
}

// applicationsFirstNonEmpty: chuỗi khác rỗng đầu tiên (mô phỏng chuỗi `a || b || c` của JS).
func applicationsFirstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func applicationsDeref(p *string) string {
	if p != nil {
		return *p
	}
	return ""
}

// applicationsSettingNumOrZero: `+s || 0` của Node (Number(s), NaN/0 -> 0).
func applicationsSettingNumOrZero(s string) float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || v == 0 {
		return 0
	}
	return v
}

// applicationsErr: lỗi mang status trong transaction (mô phỏng e.status của Node).
type applicationsErr struct {
	status int
	msg    string
}

func (e *applicationsErr) Error() string { return e.msg }

// applicationsBlockByFacility: cách ly đa cơ sở cho MỌI thao tác trên /:id (router.param, applications.routes.js:14-24).
// Điều hành -> qua. Không có đơn -> để handler tự xử (404/500). Sai cơ sở -> 403 và ĐÃ chặn.
func (h *Handlers) applicationsBlockByFacility(c *gin.Context, u *auth.User, id int) bool {
	if scope.IsExecutive(u) {
		return false
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(),
		"SELECT facility_id FROM applications WHERE id=$1", id).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false // không có đơn -> để handler tự xử (applications.routes.js:19)
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

// applicationsBlockOrConfirm: mô phỏng blockOrConfirm(res, chk, confirmed) (room-rules.js:69-80).
// Có lỗi chặn -> 400; có cảnh báo mà chưa xác nhận -> 409 needs_confirm. Trả true nếu ĐÃ phản hồi.
func applicationsBlockOrConfirm(c *gin.Context, res *roomrules.Result, confirmed bool) bool {
	if len(res.Errors) > 0 {
		badRequest(c, strings.Join(res.Errors, " · "))
		return true
	}
	if len(res.Warnings) > 0 && !confirmed {
		msgs := make([]string, 0, len(res.Warnings))
		for _, w := range res.Warnings {
			msgs = append(msgs, w.Message)
		}
		conflict(c, gin.H{
			"error":         strings.Join(msgs, " · "),
			"needs_confirm": true,
			"warnings":      res.Warnings,
			"hint":          `Gửi lại kèm "confirm_overload": true để xác nhận vẫn xếp. Việc này sẽ được ghi vào nhật ký.`,
		})
		return true
	}
	return false
}

// ListApplications: GET /api/applications (admin,staff). applications.routes.js:26-43
func (h *Handlers) ListApplications(c *gin.Context) {
	u := auth.CurrentUser(c)
	// Đa cơ sở: đơn chỉ hiện cho quản lý ĐÚNG cơ sở (a.facility_id); điều hành thấy hết (lọc tuỳ chọn ?facility).
	cond := []string{"a.deleted_at IS NULL"}
	params := []interface{}{}
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			fv, _ := strconv.ParseFloat(f, 64)
			params = append(params, int(fv))
			cond = append(cond, "a.facility_id = $"+itoa(len(params)))
		}
	} else {
		scope.ApplyFacilityFilter(u, "a.facility_id", &cond, &params)
	}
	rows, err := h.pool().Query(c.Request.Context(), `SELECT a.*, f.name AS facility_name FROM applications a
		LEFT JOIN facilities f ON f.id = a.facility_id
		WHERE `+joinAnd(cond)+`
		ORDER BY (a.status='pending') DESC, a.created_at DESC`, params...)
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

type applicationsNoteBody struct {
	Note *string `json:"note"`
}

// NoteApplication: PUT /api/applications/:id/note (admin,staff). Ghi chú của quản lý. applications.routes.js:46-52
func (h *Handlers) NoteApplication(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> SQL vỡ như Node (500)
		return
	}
	if h.applicationsBlockByFacility(c, u, id) { // đa cơ sở (router.param)
		return
	}
	var b applicationsNoteBody
	_ = c.ShouldBindJSON(&b)
	note := "" // req.body.note || ''
	if b.Note != nil {
		note = *b.Note
	}
	var one int
	err := h.pool().QueryRow(c.Request.Context(),
		"UPDATE applications SET admin_note=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id", note, id).Scan(&one)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy đơn") // applications.routes.js:49
			return
		}
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type applicationsApproveBody struct {
	RoomID           json.RawMessage `json:"room_id"`
	CheckInDate      *string         `json:"check_in_date"`
	CreateLogin      json.RawMessage `json:"create_login"`
	DepositPaid      json.RawMessage `json:"deposit_paid"`
	DepositAmount    json.RawMessage `json:"deposit_amount"`
	ContractNo       *string         `json:"contract_no"`
	ContractDate     *string         `json:"contract_date"`
	ContractStatus   *string         `json:"contract_status"`
	RentalType       *string         `json:"rental_type"`
	ConfirmDuplicate json.RawMessage `json:"confirm_duplicate"`
	ConfirmOverload  json.RawMessage `json:"confirm_overload"`
	LoginUsername    *string         `json:"login_username"`
	LoginPassword    *string         `json:"login_password"`
}

// ApproveApplication: POST /api/applications/:id/approve (admin,staff).
// Duyệt đơn -> tạo học viên + xếp phòng + (tuỳ chọn) tạo tài khoản. applications.routes.js:55-199
// CCCD đã lưu từ lúc /apply nên KHÔNG cần S3 ở đây (theo yêu cầu port).
func (h *Handlers) ApproveApplication(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.applicationsBlockByFacility(c, u, id) { // đa cơ sở (router.param)
		return
	}

	// ---- KIỂM TRA & ĐỌC trước, KHÔNG mở transaction khi còn khả năng trả lỗi sớm ----
	// deleted_at IS NULL: không duyệt đơn ĐÃ XOÁ (V2-57a). applications.routes.js:59-60
	appRows, err := h.pool().Query(ctx, "SELECT * FROM applications WHERE id=$1 AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	app, err := db.RowToMap(appRows)
	if err != nil {
		serverErr(c)
		return
	}
	if app == nil {
		notFound(c, "Không tìm thấy đơn")
		return
	}
	// CHỈ duyệt đơn ĐANG CHỜ. applications.routes.js:63-64
	appStatus := applicationsStr(app, "status")
	if appStatus != "pending" {
		msg := "Đơn đã bị từ chối — không thể duyệt. Nếu muốn nhận, hãy để học viên nộp đơn mới."
		if appStatus == "approved" {
			msg = "Đơn đã được duyệt"
		}
		badRequest(c, msg)
		return
	}
	appFac := applicationsIntPtr(app, "facility_id")
	// Đa cơ sở: quản lý chỉ duyệt đơn THUỘC cơ sở mình. applications.routes.js:66-67
	if fe := scope.AssertFacility(u, appFac); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}

	var b applicationsApproveBody
	_ = c.ShouldBindJSON(&b)

	appCode := applicationsStr(app, "code")
	appPhone := applicationsStr(app, "phone")
	appGender := applicationsStr(app, "gender")

	// room_id: truthiness cho các nhánh `if (b.room_id)`; giá trị số -> *int (b.room_id || null).
	var roomID *int
	if jsTruthy(b.RoomID) {
		if f, ok := jsNum(b.RoomID); ok {
			n := int(f)
			roomID = &n
		}
	}

	// Chỉ xếp phòng THUỘC cơ sở của đơn. applications.routes.js:71-76
	if roomID != nil {
		var rmFac *int
		e := h.pool().QueryRow(ctx, "SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL", *roomID).Scan(&rmFac)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				badRequest(c, "Phòng không tồn tại")
				return
			}
			serverErr(c)
			return
		}
		if appFac != nil && !(rmFac != nil && *rmFac == *appFac) {
			badRequest(c, "Phòng được chọn không thuộc cơ sở của đơn đăng ký — chọn phòng đúng cơ sở.")
			return
		}
	}

	// V2-56: duyệt đơn phải qua validate ngày. applications.routes.js:79-82
	if b.CheckInDate != nil && !valid.IsValidYmd(*b.CheckInDate) {
		badRequest(c, `Ngày nhận phòng không hợp lệ: "`+*b.CheckInDate+`"`)
		return
	}
	if b.ContractDate != nil && *b.ContractDate != "" && !valid.IsValidYmd(*b.ContractDate) {
		badRequest(c, `Ngày hợp đồng không hợp lệ: "`+*b.ContractDate+`"`)
		return
	}
	// checkIn = b.check_in_date || hôm nay. applications.routes.js:83
	checkIn := timeutil.Today()
	if b.CheckInDate != nil && *b.CheckInDate != "" {
		checkIn = *b.CheckInDate
	}

	settings, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	takeDeposit := jsTruthy(b.DepositPaid)
	// depositAmt = b.deposit_amount != null ? Number(b.deposit_amount) : (+settings.deposit_fee || 0). applications.routes.js:86-88
	var depositAmt float64
	finiteDeposit := true
	depositProvided := len(b.DepositAmount) > 0 && string(b.DepositAmount) != "null"
	if depositProvided {
		if f, ok := jsNum(b.DepositAmount); ok {
			depositAmt = f
		} else {
			finiteDeposit = false
		}
	} else {
		depositAmt = applicationsSettingNumOrZero(settings["deposit_fee"])
	}
	if !finiteDeposit || depositAmt < 0 || depositAmt > 100000000 {
		badRequest(c, `Số tiền cọc không hợp lệ (đang nhận: "`+jsRawDisp(b.DepositAmount)+`")`)
		return
	}
	// cStatus: chỉ nhận done/scanned/unsigned/none, còn lại -> unsigned. applications.routes.js:89
	cStatus := "unsigned"
	if b.ContractStatus != nil {
		switch *b.ContractStatus {
		case "done", "scanned", "unsigned", "none":
			cStatus = *b.ContractStatus
		}
	}

	confirmDuplicate := jsTruthy(b.ConfirmDuplicate)
	confirmOverload := jsStrictTrue(b.ConfirmOverload)

	// Trùng hồ sơ (kiểm ngoài transaction). applications.routes.js:95-117
	if !confirmDuplicate {
		var dupExisting map[string]interface{}
		lyDo := ""
		if strings.TrimSpace(appCode) != "" {
			rows, e := h.pool().Query(ctx,
				`SELECT s.id, s.name, s.status, r.name AS room_name FROM students s LEFT JOIN rooms r ON r.id=s.room_id
				  WHERE s.deleted_at IS NULL AND lower(btrim(s.code)) = lower(btrim($1)) LIMIT 1`, appCode)
			if e != nil {
				serverErr(c)
				return
			}
			m, e := db.RowToMap(rows)
			if e != nil {
				serverErr(c)
				return
			}
			if m != nil {
				dupExisting = m
				lyDo = `trùng mã HV "` + appCode + `"`
			}
		}
		if dupExisting == nil && strings.TrimSpace(appPhone) != "" {
			rows, e := h.pool().Query(ctx,
				`SELECT s.id, s.name, s.status, r.name AS room_name FROM students s LEFT JOIN rooms r ON r.id=s.room_id
				  WHERE s.deleted_at IS NULL AND regexp_replace(s.phone,'\D','','g') = regexp_replace($1,'\D','','g')
				    AND regexp_replace($1,'\D','','g') <> '' LIMIT 1`, appPhone)
			if e != nil {
				serverErr(c)
				return
			}
			m, e := db.RowToMap(rows)
			if e != nil {
				serverErr(c)
				return
			}
			if m != nil {
				dupExisting = m
				lyDo = `trùng số điện thoại "` + appPhone + `"`
			}
		}
		if dupExisting != nil {
			dupName := applicationsStr(dupExisting, "name")
			tail := " — đã trả phòng."
			if applicationsStr(dupExisting, "status") == "in" {
				room := applicationsStr(dupExisting, "room_name")
				if room == "" {
					room = "chưa xếp"
				}
				tail = " — đang ở phòng " + room + "."
			}
			msg := dupName + " đã có hồ sơ (" + lyDo + ")" + tail +
				" Duyệt đơn này sẽ tạo hồ sơ thứ hai và bạn ấy bị tính tiền 2 lần. Nếu đúng là người khác" +
				" (vd trùng SĐT người nhà), gửi lại kèm xác nhận; nếu không, xử lý trên hồ sơ cũ rồi Từ chối đơn này."
			conflict(c, gin.H{"duplicate": true, "existing": dupExisting, "error": msg})
			return
		}
	}

	// LUẬT XẾP PHÒNG — áp cả ở đường DUYỆT ĐƠN. applications.routes.js:119-120
	rentalForCheck := applicationsFirstNonEmpty(applicationsDeref(b.RentalType), applicationsStr(app, "rental_type"))
	chk, err := roomrules.CheckRoomAssignment(ctx, h.pool(), nil, appGender, rentalForCheck, roomID)
	if err != nil {
		serverErr(c)
		return
	}
	if applicationsBlockOrConfirm(c, chk, confirmOverload) {
		return
	}

	// Tài khoản đăng nhập (tuỳ chọn) — validate trước transaction. applications.routes.js:122-133
	uname, pass := "", ""
	if jsTruthy(b.CreateLogin) {
		uname = strings.TrimSpace(applicationsFirstNonEmpty(applicationsDeref(b.LoginUsername), appPhone, appCode))
		pass = strings.TrimSpace(applicationsDeref(b.LoginPassword))
		if uname == "" {
			badRequest(c, "Cần tên đăng nhập")
			return
		}
		if len([]rune(pass)) < valid.InitialPasswordMin {
			badRequest(c, "Mật khẩu tối thiểu "+itoa(valid.InitialPasswordMin)+" ký tự")
			return
		}
		var one int
		e := h.pool().QueryRow(ctx, "SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL", uname).Scan(&one)
		if e == nil {
			badRequest(c, `Tên đăng nhập "`+uname+`" đã tồn tại`)
			return
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			serverErr(c)
			return
		}
	}

	// ---- Tham số INSERT students (khớp thứ tự Node applications.routes.js:167-172) ----
	contractNoArg := "" // b.contract_no || ''
	if b.ContractNo != nil && *b.ContractNo != "" {
		contractNoArg = *b.ContractNo
	}
	var contractDateArg interface{} // b.contract_date || null
	if b.ContractDate != nil && *b.ContractDate != "" {
		contractDateArg = *b.ContractDate
	}
	depositAmtArg := 0.0
	depositStatusArg := "none"
	var depositDateArg interface{}
	if takeDeposit {
		depositAmtArg = depositAmt
		depositStatusArg = "held"
		depositDateArg = checkIn
	}
	rentalArg := applicationsFirstNonEmpty(applicationsDeref(b.RentalType), applicationsStr(app, "rental_type"), "ghep")
	studentParams := []interface{}{
		appCode,                                 // $1  app.code || ''
		applicationsVal(app, "name"),            // $2
		applicationsVal(app, "gender"),          // $3
		applicationsVal(app, "phone"),           // $4
		applicationsVal(app, "birth_date"),      // $5
		applicationsVal(app, "class_name"),      // $6
		roomID,                                  // $7  b.room_id || null
		checkIn,                                 // $8
		applicationsStr(app, "note"),            // $9  app.note || ''
		rentalArg,                               // $10
		contractNoArg,                           // $11
		contractDateArg,                         // $12
		cStatus,                                 // $13
		applicationsBool(app, "wants_washing"),  // $14
		depositAmtArg,                           // $15
		depositStatusArg,                        // $16
		depositDateArg,                          // $17
		applicationsStrOrNil(app, "cccd_front"), // $18
		applicationsStrOrNil(app, "cccd_back"),  // $19
		appFac,                                  // $20
	}

	// ---- GHI trong 1 transaction (applications.routes.js:137-194) ----
	var studentMap map[string]interface{}
	var accountH gin.H
	txErr := h.DB.WithTx(ctx, func(tx pgx.Tx) error {
		// V2-54: KHOÁ dòng đơn rồi kiểm lại status. applications.routes.js:141-143
		var lockedStatus string
		if e := tx.QueryRow(ctx, "SELECT status FROM applications WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", id).Scan(&lockedStatus); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return &applicationsErr{404, "Không tìm thấy đơn"}
			}
			return e
		}
		if lockedStatus != "pending" {
			return &applicationsErr{409, "Đơn đã được xử lý (có thể một người khác vừa duyệt)."}
		}
		// M-6: khoá tư vấn theo SĐT/mã + kiểm trùng LẠI trong transaction. applications.routes.js:149-161
		if !confirmDuplicate {
			key := ""
			if strings.TrimSpace(appCode) != "" {
				key = "code:" + strings.ToLower(strings.TrimSpace(appCode))
			} else if strings.TrimSpace(appPhone) != "" {
				key = "phone:" + valid.Digits(appPhone)
			}
			if key != "" {
				if _, e := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", key); e != nil {
					return e
				}
				var dupName string
				e := tx.QueryRow(ctx,
					`SELECT s.name FROM students s WHERE s.deleted_at IS NULL AND (
						(btrim($1) <> '' AND lower(btrim(s.code)) = lower(btrim($1)))
						OR (regexp_replace($2,'\D','','g') <> '' AND regexp_replace(s.phone,'\D','','g') = regexp_replace($2,'\D','','g'))
					  ) LIMIT 1`, appCode, appPhone).Scan(&dupName)
				if e == nil {
					return &applicationsErr{409, dupName + " vừa được tạo hồ sơ (trùng mã HV/SĐT) bởi thao tác khác — không tạo hồ sơ thứ hai."}
				} else if !errors.Is(e, pgx.ErrNoRows) {
					return e
				}
			}
		}
		// INSERT học viên. BL-117: duyệt đơn chỉ chốt NGÀY DỰ KIẾN + phòng; ngày vào thật, lượt ở và
		// nhật ký "vào ở" chỉ sinh khi có bước xác nhận nhận phòng (Check-in / an ninh bàn giao).
		rows, e := tx.Query(ctx,
			`INSERT INTO students (code, name, gender, phone, birth_date, class_name, room_id, planned_check_in, status, note,
			   rental_type, residency_status, contract_no, contract_date, contract_status, uses_washing, deposit_amount, deposit_status, deposit_date,
			   cccd_front, cccd_back, facility_id)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in',$9,$10,'unregistered',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
			studentParams...)
		if e != nil {
			return e
		}
		st, e := db.RowToMap(rows)
		if e != nil {
			return e
		}
		stID := intFromDB(st["id"])
		// CHỈ tạo xe khi có BIỂN SỐ thật. applications.routes.js:182-184
		if plate := strings.TrimSpace(applicationsStr(app, "plate")); plate != "" {
			if _, e := tx.Exec(ctx, `INSERT INTO vehicles (student_id, plate, from_date) VALUES ($1,$2,$3)`, stID, plate, checkIn); e != nil {
				return e
			}
		}
		// Tài khoản HV: buộc đổi mật khẩu lần đầu. applications.routes.js:185-191
		if jsTruthy(b.CreateLogin) {
			hash, herr := bcrypt.GenerateFromPassword([]byte(pass), 10)
			if herr != nil {
				return herr
			}
			if _, e := tx.Exec(ctx,
				`INSERT INTO users (username, password_hash, role, full_name, student_id, must_change_password) VALUES ($1,$2,'student',$3,$4,true)`,
				uname, string(hash), applicationsVal(app, "name"), stID); e != nil {
				return e
			}
			accountH = gin.H{"username": uname, "password": pass}
		}
		if _, e := tx.Exec(ctx, `UPDATE applications SET status='approved', student_id=$1, reviewed_at=now() WHERE id=$2`, stID, id); e != nil {
			return e
		}
		studentMap = st
		return nil
	})
	if txErr != nil {
		if ae, ok := txErr.(*applicationsErr); ok {
			c.JSON(ae.status, gin.H{"error": ae.msg})
			return
		}
		serverErr(c)
		return
	}

	// Ghi vết QUÁ TẢI (ngoài transaction). applications.routes.js:196
	stID := intFromDB(studentMap["id"])
	stName := applicationsStr(studentMap, "name")
	for _, w := range chk.Warnings {
		roomrules.LogOverload(ctx, h.pool(), &u.ID, u.Username, u.Role, c.Request.Method, c.Request.URL.Path, stID, stName, w)
	}
	// account = null nếu không tạo (Node trả null). warnings luôn là mảng.
	var accountOut interface{}
	if accountH != nil {
		accountOut = accountH
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "student": studentMap, "account": accountOut, "warnings": chk.Warnings})
}

// RejectApplication: POST /api/applications/:id/reject (admin,staff). applications.routes.js:201-217
func (h *Handlers) RejectApplication(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.applicationsBlockByFacility(c, u, id) { // đa cơ sở (router.param)
		return
	}
	var status string
	if err := h.pool().QueryRow(ctx, "SELECT status FROM applications WHERE id=$1 AND deleted_at IS NULL", id).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy đơn")
			return
		}
		serverErr(c)
		return
	}
	if status == "approved" {
		badRequest(c, "Đơn đã được duyệt và học viên đã vào ở — không thể từ chối. Nếu người này không ở nữa, dùng chức năng Check-out / Xoá học viên.")
		return
	}
	if status == "rejected" {
		c.JSON(http.StatusOK, gin.H{"ok": true, "already": true})
		return
	}
	// BLK-4: cập nhật NGUYÊN TỬ — chỉ đổi khi VẪN 'pending'. applications.routes.js:213
	ct, err := h.pool().Exec(ctx,
		"UPDATE applications SET status='rejected', reviewed_at=now() WHERE id=$1 AND status='pending' AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	if ct.RowsAffected() == 0 {
		conflict(c, gin.H{"error": "Đơn vừa được xử lý bởi thao tác khác (duyệt/từ chối) — tải lại để xem trạng thái mới nhất."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DeleteApplication: DELETE /api/applications/:id (admin,staff). Xoá mềm. applications.routes.js:222-234
func (h *Handlers) DeleteApplication(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if h.applicationsBlockByFacility(c, u, id) { // đa cơ sở (router.param)
		return
	}
	var status string
	if err := h.pool().QueryRow(ctx, "SELECT status FROM applications WHERE id=$1 AND deleted_at IS NULL", id).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy đơn")
			return
		}
		serverErr(c)
		return
	}
	if status == "approved" {
		badRequest(c, "Đơn đã duyệt và học viên đã vào ở — không xoá đơn (hồ sơ gốc cần giữ). Nếu người này không ở nữa, dùng Check-out / Xoá học viên.")
		return
	}
	// BLK-4: xoá mềm NGUYÊN TỬ — chỉ khi CHƯA duyệt. applications.routes.js:230
	ct, err := h.pool().Exec(ctx,
		"UPDATE applications SET deleted_at=now() WHERE id=$1 AND status<>'approved' AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	if ct.RowsAffected() == 0 {
		conflict(c, gin.H{"error": "Đơn vừa được duyệt bởi thao tác khác — không xoá được (hồ sơ học viên đang ở cần giữ). Tải lại để xem."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
