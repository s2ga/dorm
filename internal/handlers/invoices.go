package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/auth"
	"ktx/internal/billing"
	"ktx/internal/db"
	"ktx/internal/invoicecalc"
	"ktx/internal/roomleaders"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
	"ktx/internal/vehiclecount"
)

// Handler hoá đơn (invoices). Port từ server/routes/invoices.routes.js.
// Toàn bộ route: requireAuth + requireRole('admin','staff') (invoices.routes.js:12); riêng
// mark-paid thêm requireRole('admin') (invoices.routes.js:419). Đa cơ sở qua router.param('id').

// errInvoicePreview: sentinel để bắt WithTx ROLLBACK sau khi đã tính xong ở chế độ xem trước
// (invoices.routes.js:268-270 — preview: BEGIN...ROLLBACK, không lưu gì).
var errInvoicePreview = errors.New("invoices: preview rollback")

// invoiceSELECT: câu SELECT chung của GET / (invoices.routes.js:62-66).
const invoiceSELECT = `
  SELECT i.*, s.name AS student_name, s.code AS student_code, r.name AS room_name
  FROM invoices i
  JOIN students s ON s.id = i.student_id
  LEFT JOIN rooms r ON r.id = i.room_id`

// invoiceMoneyFields: mọi khoản tiền phải là số KHÔNG ÂM (invoices.routes.js:29).
var invoiceMoneyFields = []string{"room_charge", "electric_charge", "water_charge", "service_charge", "washing_charge", "parking_charge", "other_charge", "electric_kwh", "days_stayed"}

// invDateStr: pgtype.Date -> 'YYYY-MM-DD' (rỗng nếu NULL).
func invDateStr(d pgtype.Date) string {
	if d.Valid {
		return d.Time.Format("2006-01-02")
	}
	return ""
}

// invoiceTruthy: mô phỏng truthiness của JS (!!x). null/absent/false/0/"" -> false. server: !!req.body.preview, !b.student_id, !b.month.
func invoiceTruthy(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	s := strings.TrimSpace(string(raw))
	if s == "null" || s == "false" {
		return false
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		return f != 0
	}
	var str string
	if json.Unmarshal(raw, &str) == nil {
		return str != ""
	}
	return true // object/array/true -> truthy
}

// invoiceStr: giá trị chuỗi (String(x)) — chuỗi giữ nguyên; số/khác -> literal thô. Dùng cho month.
func invoiceStr(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(raw))
}

// invoiceStrOr: mô phỏng phép JS "x hoặc chuỗi rỗng" (b.other_note, String(req.body.month) khi falsy -> rỗng).
func invoiceStrOr(raw json.RawMessage) string {
	if !invoiceTruthy(raw) {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(raw))
}

// invoiceRawDisp: mô phỏng `${x}` của JS (nội suy giá trị thô). absent -> "undefined"; null -> "null";
// chuỗi -> bỏ nháy; số/khác -> literal. Dùng cho câu lỗi badMoney + chỉ số điện.
func invoiceRawDisp(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "undefined"
	}
	s := string(raw)
	if s == "null" {
		return "null"
	}
	var str string
	if json.Unmarshal(raw, &str) == nil {
		return str
	}
	return s
}

// invoiceNumOr0: mô phỏng `+x || 0` của JS. number|"số" -> giá trị; ""/absent/null/NaN -> 0.
func invoiceNumOr0(raw json.RawMessage) float64 {
	n, ok := jsNum(raw)
	if !ok {
		return 0
	}
	return n
}

// invoiceIntID: id dạng số từ body (number|string) -> int (0 nếu không phải số).
func invoiceIntID(raw json.RawMessage) int {
	n, _ := jsNum(raw)
	return int(n)
}

// invoiceStartProvided: r.reading_start khác null và khác chuỗi rỗng (invoices.routes.js:121).
func invoiceStartProvided(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false // undefined
	}
	s := string(raw)
	return s != "null" && s != `""`
}

// invoiceMonthFormat: chỉ xét ĐỊNH DẠNG ^\d{4}-\d{2}$ (KHÔNG kiểm 01–12) như mark-paid (invoices.routes.js:422).
func invoiceMonthFormat(s string) bool {
	if len(s) != 7 || s[4] != '-' {
		return false
	}
	for i := 0; i < 7; i++ {
		if i == 4 {
			continue
		}
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// invoiceBadMoney: câu lỗi nếu có khoản tiền không phải số / âm; "" nếu ổn (invoices.routes.js:30-38).
func invoiceBadMoney(b map[string]json.RawMessage) string {
	for _, k := range invoiceMoneyFields {
		raw, ok := b[k]
		if !ok || len(raw) == 0 || string(raw) == "null" || string(raw) == `""` {
			continue // undefined || null || ''
		}
		n, fin := jsNum(raw)
		if !fin {
			return `"` + k + `" phải là số (đang nhận: "` + invoiceRawDisp(raw) + `")`
		}
		if n < 0 {
			return `"` + k + `" không được âm (đang nhận: ` + numDisp(n) + `)`
		}
	}
	return ""
}

// invoiceBadDays: chặn days_stayed vượt số ngày của tháng; "" nếu ổn (invoices.routes.js:42-47).
func invoiceBadDays(daysRaw json.RawMessage, month string) string {
	if len(daysRaw) == 0 || string(daysRaw) == "null" || string(daysRaw) == `""` {
		return "" // days_stayed == null || === ''
	}
	if !valid.IsValidMonth(month) {
		return ""
	}
	d, fin := jsNum(daysRaw)
	dim := billing.DaysInMonth(month)
	if fin && d > float64(dim) {
		return "Số ngày ở (" + numDisp(d) + ") vượt số ngày của tháng " + month + " (" + itoa(dim) + " ngày)."
	}
	return ""
}

// invoicesExecFacilityFilter: điều hành lọc tuỳ chọn ?facility; quản lý cơ sở bị ÉP theo cơ sở của mình.
// invoices.routes.js:74-79, 154-158. column = 's.facility_id' (GET /) hoặc 'facility_id' (generate).
func invoicesExecFacilityFilter(c *gin.Context, u *auth.User, column string, cond *[]string, params *[]interface{}) {
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			if n, ok := jsNum(json.RawMessage(f)); ok {
				*params = append(*params, int(n))
				*cond = append(*cond, column+" = $"+itoa(len(*params)))
			}
		}
		return
	}
	scope.ApplyFacilityFilter(u, column, cond, params)
}

// invoiceFacilityGuard: (router.param 'id') hoá đơn /:id phải thuộc cơ sở người dùng qua HV.
// invoices.routes.js:15-25. Điều hành -> bỏ qua; không có hoá đơn -> để handler tự xử (404).
func (h *Handlers) invoiceFacilityGuard(c *gin.Context, u *auth.User, id int) bool {
	if scope.IsExecutive(u) {
		return true
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(),
		"SELECT s.facility_id FROM invoices i JOIN students s ON s.id=i.student_id WHERE i.id=$1", id).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true // không có hoá đơn -> next (invoices.routes.js:20)
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

// RecalcInvoice: POST /api/invoices/:id/recalc (admin,staff). invoices.routes.js:50-60.
func (h *Handlers) RecalcInvoice(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> câu lệnh SQL vỡ như Node (500)
		return
	}
	if !h.invoiceFacilityGuard(c, u, id) {
		return
	}
	ctx := c.Request.Context()
	var studentID int
	var month, status string
	err := h.pool().QueryRow(ctx, "SELECT student_id, month, status FROM invoices WHERE id=$1 AND deleted_at IS NULL", id).
		Scan(&studentID, &month, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy hóa đơn")
			return
		}
		serverErr(c)
		return
	}
	// Bấm "Tính lại" trên phiếu ĐÃ THU -> chặn rõ ràng (TP-07). invoices.routes.js:56
	if status == "paid" {
		badRequest(c, `Hoá đơn đã thu tiền — không tính lại được. Nếu cần điều chỉnh, chuyển trạng thái về "chưa thu" trước (thao tác này được ghi nhật ký).`)
		return
	}
	updated, err := invoicecalc.RecalcInvoice(ctx, h.DB, studentID, month)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, updated)
}

// ListInvoices: GET /api/invoices?month=&facility= (admin,staff). invoices.routes.js:68-84.
func (h *Handlers) ListInvoices(c *gin.Context) {
	u := auth.CurrentUser(c)
	month := c.Query("month")
	cond := []string{"i.deleted_at IS NULL"}
	params := []interface{}{}
	if month != "" {
		params = append(params, month)
		cond = append(cond, "i.month=$"+itoa(len(params)))
	}
	// BL-11: lọc hoá đơn theo học viên Ở SERVER (mở chi tiết 1 HV không kéo toàn bộ hoá đơn mọi kỳ về
	// rồi .filter — cùng lớp lỗi với /api/logs). Vẫn AND với chốt cơ sở của quản lý bên dưới.
	if sid := queryIntDefault(c, "student_id", 0); sid > 0 {
		params = append(params, sid)
		cond = append(cond, "i.student_id=$"+itoa(len(params)))
	}
	invoicesExecFacilityFilter(c, u, "s.facility_id", &cond, &params)
	order := "ORDER BY i.month DESC, s.name"
	if month != "" {
		order = "ORDER BY s.name"
	}
	rows, err := h.pool().Query(c.Request.Context(), invoiceSELECT+` WHERE `+joinAnd(cond)+` `+order, params...)
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

// InvoiceMonths: GET /api/invoices/months (admin,staff). invoices.routes.js:86-91.
func (h *Handlers) InvoiceMonths(c *gin.Context) {
	rows, err := h.pool().Query(c.Request.Context(),
		"SELECT DISTINCT month FROM invoices WHERE deleted_at IS NULL ORDER BY month DESC")
	if err != nil {
		serverErr(c)
		return
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			serverErr(c)
			return
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, out)
}

// invoiceGenReading: 1 dòng chỉ số điện gửi kèm khi lập hoá đơn hàng loạt.
type invoiceGenReading struct {
	RoomID       json.RawMessage `json:"room_id"`
	ReadingEnd   json.RawMessage `json:"reading_end"`
	ReadingStart json.RawMessage `json:"reading_start"`
}

// invoiceGenStudent: cột HV cần cho bộ tính tiền (chỉ lấy cột dùng -> nhẹ RAM/băng thông).
type invoiceGenStudent struct {
	id                       int
	roomID                   *int
	rentalType               string
	checkIn, checkOut        string
	usesWashing, usesParking bool
	discountPct              float64
	giam                     billing.GiamPct
}

// GenerateInvoices: POST /api/invoices/generate (admin,staff). invoices.routes.js:94-280.
// Tạo hoá đơn hàng loạt cho 1 tháng: lưu chỉ số điện + cắt chặng chia điện + bộ tính tiền.
func (h *Handlers) GenerateInvoices(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	var body struct {
		Month    string              `json:"month"`
		Readings []invoiceGenReading `json:"readings"`
		Preview  json.RawMessage     `json:"preview"`
	}
	_ = c.ShouldBindJSON(&body)
	preview := invoiceTruthy(body.Preview) // xem trước: tính rồi ROLLBACK, không ghi gì
	// isValidMonth chứ không chỉ "!month" (invoices.routes.js:101).
	if !valid.IsValidMonth(body.Month) {
		badRequest(c, "Kỳ (tháng) không hợp lệ — chọn dạng YYYY-MM.")
		return
	}
	// Đa cơ sở: quản lý cơ sở chỉ ghi chỉ số cho phòng CƠ SỞ MÌNH. invoices.routes.js:103-108
	if !scope.IsExecutive(u) && len(body.Readings) > 0 {
		fid := scope.UserFacility(u)
		ids := make([]int, 0, len(body.Readings))
		for _, r := range body.Readings {
			ids = append(ids, invoiceIntID(r.RoomID))
		}
		rows, err := h.pool().Query(ctx, "SELECT id, facility_id FROM rooms WHERE id = ANY($1)", ids)
		if err != nil {
			serverErr(c)
			return
		}
		var outside []string
		for rows.Next() {
			var id int
			var rf *int
			if err := rows.Scan(&id, &rf); err != nil {
				rows.Close()
				serverErr(c)
				return
			}
			if !(rf != nil && fid != nil && *rf == *fid) {
				outside = append(outside, itoa(id))
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			serverErr(c)
			return
		}
		if len(outside) > 0 {
			forbidden(c, "Có phòng không thuộc cơ sở bạn phụ trách (phòng #"+strings.Join(outside, ", #")+") — không lưu.")
			return
		}
	}
	fees, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	pmonth0 := prevMonth(body.Month) // tháng liền trước (invoices.routes.js:114)

	// TP-17: KIỂM chỉ số TRƯỚC transaction — báo 400 liệt kê phòng cần sửa. invoices.routes.js:115-128
	var loi []string
	for _, r := range body.Readings {
		rid := invoiceIntID(r.RoomID)
		ridDisp := invoiceRawDisp(r.RoomID)
		end, endOK := jsNum(r.ReadingEnd)
		if !endOK || end < 0 {
			loi = append(loi, `phòng #`+ridDisp+`: chỉ số "`+invoiceRawDisp(r.ReadingEnd)+`" không hợp lệ`)
			continue
		}
		var start float64
		startOK := true
		if invoiceStartProvided(r.ReadingStart) {
			start, startOK = jsNum(r.ReadingStart)
		} else {
			var pe *float64
			_ = h.pool().QueryRow(ctx, "SELECT reading_end FROM electric_readings WHERE room_id=$1 AND month=$2", rid, pmonth0).Scan(&pe)
			if pe != nil {
				start = *pe
			}
		}
		if !startOK || start < 0 || end < start {
			startDisp := numDisp(start)
			if !startOK {
				startDisp = "NaN"
			}
			loi = append(loi, "phòng #"+ridDisp+": chỉ số cuối ("+numDisp(end)+") nhỏ hơn đầu kỳ ("+startDisp+") — kiểm lại")
		}
	}
	if len(loi) > 0 {
		ids := make([]int, 0, len(body.Readings))
		for _, r := range body.Readings {
			ids = append(ids, invoiceIntID(r.RoomID))
		}
		names := map[int]string{}
		if rows, e := h.pool().Query(ctx, "SELECT id, name FROM rooms WHERE id = ANY($1)", ids); e == nil {
			for rows.Next() {
				var id int
				var name string
				if rows.Scan(&id, &name) == nil {
					names[id] = name
				}
			}
			rows.Close()
		}
		out := make([]string, len(loi))
		for i, l := range loi {
			out[i] = replacePhong(l, names) // thay "phòng #id" -> "phòng <tên>"
		}
		badRequest(c, "Chưa lập hoá đơn — có chỉ số điện chưa hợp lệ, sửa rồi làm lại:\n"+strings.Join(out, "\n"))
		return
	}

	var created, updated, skipped, totalStudents int
	txErr := h.DB.WithTx(ctx, func(tx pgx.Tx) error {
		// Lưu chỉ số điện (số đầu = số cuối tháng trước nếu không nhập). invoices.routes.js:133-146
		for _, r := range body.Readings {
			rid := invoiceIntID(r.RoomID)
			var start float64
			if invoiceStartProvided(r.ReadingStart) {
				start, _ = jsNum(r.ReadingStart)
			} else {
				var pe *float64
				_ = tx.QueryRow(ctx, "SELECT reading_end FROM electric_readings WHERE room_id=$1 AND month=$2", rid, pmonth0).Scan(&pe)
				if pe != nil {
					start = *pe
				}
			}
			end, _ := jsNum(r.ReadingEnd)
			kwh := end - start
			if kwh < 0 {
				kwh = 0 // Math.max(0, end-start)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,$3,$4,$5)
				 ON CONFLICT (room_id, month) DO UPDATE SET reading_start=EXCLUDED.reading_start, reading_end=EXCLUDED.reading_end, kwh=EXCLUDED.kwh`,
				rid, body.Month, start, end, kwh); err != nil {
				return err
			}
		}

		mStart, mEnd := billing.FirstDay(body.Month), billing.LastDay(body.Month)

		// HV có ở trong tháng. Đa cơ sở: điều hành tất cả/lọc ?facility; quản lý ép cơ sở. invoices.routes.js:152-164
		stCond := []string{"deleted_at IS NULL", "check_in_date IS NOT NULL", "check_in_date <= $1", "(check_out_date IS NULL OR check_out_date >= $2)"}
		stParams := []interface{}{mEnd, mStart}
		invoicesExecFacilityFilter(c, u, "facility_id", &stCond, &stParams)
		stRows, err := tx.Query(ctx,
			`SELECT id, room_id, rental_type, check_in_date, check_out_date, uses_washing, uses_parking, room_fee_discount_pct, `+
				billing.CotSQL+` FROM students WHERE `+joinAnd(stCond), stParams...)
		if err != nil {
			return err
		}
		var students []invoiceGenStudent
		for stRows.Next() {
			var s invoiceGenStudent
			var rentalType *string
			var ci, co pgtype.Date
			var pct *float64
			if err := stRows.Scan(append([]interface{}{&s.id, &s.roomID, &rentalType, &ci, &co, &s.usesWashing, &s.usesParking, &pct}, s.giam.Ptr()...)...); err != nil {
				stRows.Close()
				return err
			}
			if rentalType != nil {
				s.rentalType = *rentalType
			}
			s.checkIn, s.checkOut = invDateStr(ci), invDateStr(co)
			if pct != nil {
				s.discountPct = *pct
			}
			students = append(students, s)
		}
		stRows.Close()
		if err := stRows.Err(); err != nil {
			return err
		}
		totalStudents = len(students)

		// Chỉ số điện theo phòng (thấy cả bản vừa ghi trong tx). invoices.routes.js:167-168
		erRows, err := tx.Query(ctx, "SELECT room_id, reading_start, reading_end, kwh FROM electric_readings WHERE month=$1", body.Month)
		if err != nil {
			return err
		}
		type erItem struct {
			roomID                        int
			readingStart, readingEnd, kwh float64
		}
		var er []erItem
		kwhByRoom := map[int]float64{}
		for erRows.Next() {
			var it erItem
			if err := erRows.Scan(&it.roomID, &it.readingStart, &it.readingEnd, &it.kwh); err != nil {
				erRows.Close()
				return err
			}
			er = append(er, it)
			kwhByRoom[it.roomID] = it.kwh
		}
		erRows.Close()
		if err := erRows.Err(); err != nil {
			return err
		}

		// Chốt chỉ số giữa kỳ + lượt ở -> cắt chặng chia điện qua MỌI phòng. invoices.routes.js:174-182
		readsByRoom := map[int][]billing.MeterRead{}
		mrRows, err := tx.Query(ctx, "SELECT room_id, read_date AS date, reading FROM meter_reads WHERE read_date >= $1 AND read_date <= $2 ORDER BY read_date", mStart, mEnd)
		if err != nil {
			return err
		}
		for mrRows.Next() {
			var roomID int
			var rd pgtype.Date
			var reading float64
			if err := mrRows.Scan(&roomID, &rd, &reading); err != nil {
				mrRows.Close()
				return err
			}
			readsByRoom[roomID] = append(readsByRoom[roomID], billing.MeterRead{Date: invDateStr(rd), Reading: reading})
		}
		mrRows.Close()
		if err := mrRows.Err(); err != nil {
			return err
		}
		staysByRoom := map[int][]billing.Stay{}
		rsRows, err := tx.Query(ctx,
			`SELECT rs.room_id, rs.student_id, rs.from_date AS from, rs.to_date AS to
			   FROM room_stays rs JOIN students s ON s.id = rs.student_id
			  WHERE s.deleted_at IS NULL AND rs.from_date <= $1 AND (rs.to_date IS NULL OR rs.to_date >= $2)`, mEnd, mStart)
		if err != nil {
			return err
		}
		for rsRows.Next() {
			var roomID, sid int
			var from, to pgtype.Date
			if err := rsRows.Scan(&roomID, &sid, &from, &to); err != nil {
				rsRows.Close()
				return err
			}
			staysByRoom[roomID] = append(staysByRoom[roomID], billing.Stay{StudentID: sid, From: invDateStr(from), To: invDateStr(to)})
		}
		rsRows.Close()
		if err := rsRows.Err(); err != nil {
			return err
		}

		unit := billing.Fees(fees).Num("electric_unit")
		elec := map[int]float64{} // student_id -> tiền điện đã cộng qua mọi phòng
		for _, e := range er {
			stays := staysByRoom[e.roomID]
			if len(stays) == 0 {
				continue
			}
			segs := billing.BuildSegments(body.Month, e.readingStart, e.readingEnd, readsByRoom[e.roomID], stays)
			bsegs := make([]billing.Segment, len(segs))
			for i, sg := range segs {
				bsegs[i] = billing.Segment{Electric: sg.Kwh * unit, Roster: sg.Roster}
			}
			share := billing.SplitElectricExact(bsegs)
			// Ở phòng có chỉ số nhưng phần chia = 0 -> vẫn ghi 0 (invoices.routes.js:192).
			for _, st := range stays {
				if _, ok := elec[st.StudentID]; !ok {
					elec[st.StudentID] = 0
				}
			}
			for id, v := range share {
				elec[id] += float64(v)
			}
		}

		// Danh sách người ở mỗi phòng KÈM SỐ NGÀY Ở. invoices.routes.js:198-203
		rosterByRoom := map[int][]billing.RosterEntry{}
		for _, s := range students {
			if s.roomID == nil {
				continue
			}
			d := billing.DaysStayedInMonth(s.checkIn, s.checkOut, body.Month)
			if d > 0 {
				rosterByRoom[*s.roomID] = append(rosterByRoom[*s.roomID], billing.RosterEntry{StudentID: s.id, Days: d})
			}
		}

		// Cache phòng (capacity chọn ở Node nhưng không dùng -> bỏ). invoices.routes.js:206-207
		type genRoom struct {
			hang       string
			monthlyFee float64
			roomType   string
		}
		roomsCache := map[int]genRoom{}
		roomRows, err := tx.Query(ctx, "SELECT id, hang, monthly_fee, capacity, room_type FROM rooms")
		if err != nil {
			return err
		}
		for roomRows.Next() {
			var id int
			var hang *string
			var mf *float64
			var capCol *int
			var rt *string
			if err := roomRows.Scan(&id, &hang, &mf, &capCol, &rt); err != nil {
				roomRows.Close()
				return err
			}
			g := genRoom{}
			if hang != nil {
				g.hang = *hang
			}
			if mf != nil {
				g.monthlyFee = *mf
			}
			if rt != nil {
				g.roomType = *rt
			}
			roomsCache[id] = g
		}
		roomRows.Close()
		if err := roomRows.Err(); err != nil {
			return err
		}

		// Số xe theo HV CỦA THÁNG lập hoá đơn. invoices.routes.js:210
		vehByStudent, err := vehiclecount.CountByStudentForMonth(ctx, tx, body.Month)
		if err != nil {
			return err
		}

		// Số ngày làm PHÒNG TRƯỞNG trong kỳ (cộng qua mọi nhiệm kỳ). invoices.routes.js:214-223
		leaderDays := map[int]int{}
		lRows, err := tx.Query(ctx,
			`SELECT student_id, from_date, to_date FROM room_leaders
			  WHERE from_date <= $1 AND (to_date IS NULL OR to_date >= $2)`, mEnd, mStart)
		if err != nil {
			return err
		}
		for lRows.Next() {
			var sid int
			var from, to pgtype.Date
			if err := lRows.Scan(&sid, &from, &to); err != nil {
				lRows.Close()
				return err
			}
			leaderDays[sid] += billing.DaysStayedInRange(invDateStr(from), invDateStr(to), mStart, mEnd)
		}
		lRows.Close()
		if err := lRows.Err(); err != nil {
			return err
		}

		// Nạp sẵn hoá đơn hiện có của kỳ (diệt N+1). invoices.routes.js:226-228
		type genExisting struct {
			id     int
			status string
			other  float64
		}
		existing := map[int]genExisting{}
		exRows, err := tx.Query(ctx, "SELECT id, student_id, status, other_charge FROM invoices WHERE month=$1", body.Month)
		if err != nil {
			return err
		}
		for exRows.Next() {
			var iid, sid int
			var st string
			var other float64
			if err := exRows.Scan(&iid, &sid, &st, &other); err != nil {
				exRows.Close()
				return err
			}
			existing[sid] = genExisting{id: iid, status: st, other: other}
		}
		exRows.Close()
		if err := exRows.Err(); err != nil {
			return err
		}

		// invoices.routes.js:230-267
		for _, s := range students {
			dup, hasDup := existing[s.id]
			if hasDup && dup.status == "paid" {
				skipped++ // đã đóng -> khóa, không sửa
				continue
			}
			var room *billing.Room
			if s.roomID != nil {
				if rc, ok := roomsCache[*s.roomID]; ok {
					room = &billing.Room{Hang: rc.hang, MonthlyFee: rc.monthlyFee, RoomType: rc.roomType}
				}
			}
			var roster []billing.RosterEntry
			if s.roomID != nil {
				roster = rosterByRoom[*s.roomID]
			}
			var ec *float64
			if v, ok := elec[s.id]; ok {
				vv := v
				ec = &vv
			}
			kwh := 0.0
			if s.roomID != nil {
				kwh = kwhByRoom[*s.roomID]
			}
			vc := vehByStudent[s.id]
			hv := billing.Student{
				ID: s.id, RentalType: s.rentalType, CheckInDate: s.checkIn, CheckOutDate: s.checkOut,
				RoomFeeDiscountPct: s.discountPct, UsesWashing: s.usesWashing, UsesParking: s.usesParking,
			}
			s.giam.GanVao(&hv)
			inv := billing.ComputeInvoice(billing.ComputeInput{
				Student: hv,
				Room:    room, Month: body.Month, Fees: billing.Fees(fees),
				Roster: roster, ElectricCharge: ec, LeaderDays: leaderDays[s.id], Kwh: kwh, VehicleCount: &vc,
			})
			if hasDup {
				total := billing.InvoiceTotal(map[string]float64{
					"room_charge": float64(inv.RoomCharge), "electric_charge": float64(inv.ElectricCharge),
					"water_charge": float64(inv.WaterCharge), "service_charge": float64(inv.ServiceCharge),
					"washing_charge": float64(inv.WashingCharge), "parking_charge": float64(inv.ParkingCharge),
					"other_charge": dup.other, "leader_discount": float64(inv.LeaderDiscount), "room_discount": float64(inv.RoomDiscount),
					"fee_discount": float64(inv.FeeDiscount),
				})
				if _, err := tx.Exec(ctx,
					`UPDATE invoices SET days_stayed=$1, room_charge=$2, electric_kwh=$3, electric_charge=$4, water_charge=$5,
					   service_charge=$6, washing_charge=$7, parking_charge=$8, leader_discount=$9, room_discount=$10,
					   fee_discount=$11, total=$12, deleted_at=NULL WHERE id=$13`,
					inv.DaysStayed, inv.RoomCharge, inv.ElectricKwh, inv.ElectricCharge, inv.WaterCharge,
					inv.ServiceCharge, inv.WashingCharge, inv.ParkingCharge, inv.LeaderDiscount, inv.RoomDiscount,
					inv.FeeDiscount, total, dup.id); err != nil {
					return err
				}
				updated++
			} else {
				if _, err := tx.Exec(ctx,
					`INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, electric_kwh, electric_charge,
					   water_charge, service_charge, washing_charge, parking_charge, leader_discount, room_discount,
					   fee_discount, other_charge, total, status)
					 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending')`,
					s.id, s.roomID, body.Month, inv.DaysStayed, inv.RoomCharge, inv.ElectricKwh, inv.ElectricCharge,
					inv.WaterCharge, inv.ServiceCharge, inv.WashingCharge, inv.ParkingCharge,
					inv.LeaderDiscount, inv.RoomDiscount, inv.FeeDiscount, inv.OtherCharge, inv.Total); err != nil {
					return err
				}
				created++
			}
		}
		if preview {
			return errInvoicePreview // xem trước: không lưu gì
		}
		return nil
	})
	if txErr != nil && !errors.Is(txErr, errInvoicePreview) {
		serverErr(c)
		return
	}
	if preview {
		c.JSON(http.StatusOK, gin.H{"preview": true, "created": created, "updated": updated, "skipped": skipped, "total": totalStudents})
		return
	}
	c.JSON(http.StatusOK, gin.H{"created": created, "updated": updated, "skipped": skipped, "total": totalStudents})
}

// GenerateOneInvoice: POST /api/invoices/generate-one (admin,staff). invoices.routes.js:283-336.
func (h *Handlers) GenerateOneInvoice(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	var gb struct {
		StudentID json.RawMessage `json:"student_id"`
		Month     json.RawMessage `json:"month"`
	}
	_ = c.ShouldBindJSON(&gb)
	if !invoiceTruthy(gb.StudentID) {
		badRequest(c, "Thiếu học viên")
		return
	}
	monthStr := invoiceStr(gb.Month)
	if !valid.IsValidMonth(monthStr) {
		badRequest(c, "Kỳ (tháng) không hợp lệ — chọn dạng YYYY-MM.")
		return
	}
	sid := invoiceIntID(gb.StudentID)
	fees, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	var (
		sID       int
		facID     *int
		roomID    *int
		rentalTyp *string
		ci, co    pgtype.Date
		uw, up    bool
		pct       *float64
	)
	var giam billing.GiamPct
	err = h.pool().QueryRow(ctx,
		"SELECT id, facility_id, room_id, rental_type, check_in_date, check_out_date, uses_washing, uses_parking, room_fee_discount_pct, "+
			billing.CotSQL+" FROM students WHERE id=$1", sid).
		Scan(append([]interface{}{&sID, &facID, &roomID, &rentalTyp, &ci, &co, &uw, &up, &pct}, giam.Ptr()...)...)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên")
			return
		}
		serverErr(c)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil { // đa cơ sở (invoices.routes.js:291)
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	// dup + khoá phiếu đã đóng (invoices.routes.js:292-293)
	var dID int
	var dStatus string
	var dOther float64
	dupErr := h.pool().QueryRow(ctx, "SELECT id, status, other_charge FROM invoices WHERE student_id=$1 AND month=$2", sid, monthStr).
		Scan(&dID, &dStatus, &dOther)
	hasDup := dupErr == nil
	if dupErr != nil && !errors.Is(dupErr, pgx.ErrNoRows) {
		serverErr(c)
		return
	}
	if hasDup && dStatus == "paid" {
		badRequest(c, "Hóa đơn kỳ này đã đóng — không sửa")
		return
	}

	var room *billing.Room
	if roomID != nil {
		var hang *string
		var mf *float64
		var rt *string
		if e := h.pool().QueryRow(ctx, "SELECT hang, monthly_fee, room_type FROM rooms WHERE id=$1", *roomID).Scan(&hang, &mf, &rt); e == nil {
			r := billing.Room{}
			if hang != nil {
				r.Hang = *hang
			}
			if mf != nil {
				r.MonthlyFee = *mf
			}
			if rt != nil {
				r.RoomType = *rt
			}
			room = &r
		}
	}
	var roster []billing.RosterEntry
	if roomID != nil {
		roster, err = invoicecalc.RoomRoster(ctx, h.DB, *roomID, monthStr)
		if err != nil {
			serverErr(c)
			return
		}
	}
	kwh := 0.0
	if roomID != nil {
		var k *float64
		if e := h.pool().QueryRow(ctx, "SELECT kwh FROM electric_readings WHERE room_id=$1 AND month=$2", *roomID, monthStr).Scan(&k); e == nil && k != nil {
			kwh = *k
		}
	}
	vehicleCnt, err := vehiclecount.CountForMonth(ctx, h.pool(), sid, monthStr)
	if err != nil {
		serverErr(c)
		return
	}
	electricCharge, err := invoicecalc.StudentElectric(ctx, h.DB, sid, monthStr, billing.Fees(fees).Num("electric_unit"))
	if err != nil {
		serverErr(c)
		return
	}
	leaderDays, err := roomleaders.LeaderDaysInMonth(ctx, h.pool(), sid, monthStr)
	if err != nil {
		serverErr(c)
		return
	}
	rt := ""
	if rentalTyp != nil {
		rt = *rentalTyp
	}
	pctVal := 0.0
	if pct != nil {
		pctVal = *pct
	}
	hv := billing.Student{
		ID: sID, RentalType: rt, CheckInDate: invDateStr(ci), CheckOutDate: invDateStr(co),
		RoomFeeDiscountPct: pctVal, UsesWashing: uw, UsesParking: up,
	}
	giam.GanVao(&hv)
	inv := billing.ComputeInvoice(billing.ComputeInput{
		Student: hv,
		Room:    room, Month: monthStr, Fees: billing.Fees(fees),
		Roster: roster, ElectricCharge: electricCharge, LeaderDays: leaderDays, Kwh: kwh, VehicleCount: &vehicleCnt,
	})

	if hasDup {
		total := billing.InvoiceTotal(map[string]float64{
			"room_charge": float64(inv.RoomCharge), "electric_charge": float64(inv.ElectricCharge),
			"water_charge": float64(inv.WaterCharge), "service_charge": float64(inv.ServiceCharge),
			"washing_charge": float64(inv.WashingCharge), "parking_charge": float64(inv.ParkingCharge),
			"other_charge": dOther, "leader_discount": float64(inv.LeaderDiscount), "room_discount": float64(inv.RoomDiscount),
			"fee_discount": float64(inv.FeeDiscount),
		})
		rows, err := h.pool().Query(ctx,
			`UPDATE invoices SET days_stayed=$1, room_charge=$2, electric_kwh=$3, electric_charge=$4, water_charge=$5,
			   service_charge=$6, washing_charge=$7, parking_charge=$8, leader_discount=$9, room_discount=$10,
			   fee_discount=$11, total=$12, deleted_at=NULL WHERE id=$13 RETURNING *`,
			inv.DaysStayed, inv.RoomCharge, inv.ElectricKwh, inv.ElectricCharge, inv.WaterCharge,
			inv.ServiceCharge, inv.WashingCharge, inv.ParkingCharge, inv.LeaderDiscount, inv.RoomDiscount,
			inv.FeeDiscount, total, dID)
		if err != nil {
			serverErr(c)
			return
		}
		row, err := db.RowToMap(rows)
		if err != nil {
			serverErr(c)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "invoice": row, "created": false})
		return
	}
	rows, err := h.pool().Query(ctx,
		`INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, electric_kwh, electric_charge,
		   water_charge, service_charge, washing_charge, parking_charge, leader_discount, room_discount,
		   fee_discount, other_charge, total, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending') RETURNING *`,
		sid, roomID, monthStr, inv.DaysStayed, inv.RoomCharge, inv.ElectricKwh, inv.ElectricCharge,
		inv.WaterCharge, inv.ServiceCharge, inv.WashingCharge, inv.ParkingCharge,
		inv.LeaderDiscount, inv.RoomDiscount, inv.FeeDiscount, inv.OtherCharge, inv.Total)
	if err != nil {
		// TP-35: hai request cùng lúc -> cái sau va UNIQUE(student_id,month) (23505). invoices.routes.js:324-332
		if vehicleIsDup(err) {
			r2, e2 := h.pool().Query(ctx, "SELECT * FROM invoices WHERE student_id=$1 AND month=$2 AND deleted_at IS NULL", sid, monthStr)
			if e2 != nil {
				serverErr(c)
				return
			}
			row2, e3 := db.RowToMap(r2)
			if e3 != nil {
				serverErr(c)
				return
			}
			c.JSON(http.StatusOK, gin.H{"ok": true, "invoice": row2, "created": false, "race": true})
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
	c.JSON(http.StatusOK, gin.H{"ok": true, "invoice": row, "created": true})
}

// CreateInvoice: POST /api/invoices (admin,staff) — hoá đơn lẻ nhập tay. invoices.routes.js:339-379.
func (h *Handlers) CreateInvoice(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	var b map[string]json.RawMessage
	_ = c.ShouldBindJSON(&b)
	if !invoiceTruthy(b["student_id"]) || !invoiceTruthy(b["month"]) {
		badRequest(c, "Thiếu học viên hoặc kỳ")
		return
	}
	monthStr := invoiceStr(b["month"])
	if !valid.IsValidMonth(monthStr) {
		badRequest(c, `Kỳ không hợp lệ: "`+monthStr+`". Định dạng đúng: YYYY-MM (tháng 01–12).`)
		return
	}
	if e := invoiceBadMoney(b); e != "" {
		badRequest(c, e)
		return
	}
	if e := invoiceBadDays(b["days_stayed"], monthStr); e != "" {
		badRequest(c, e)
		return
	}
	sid := invoiceIntID(b["student_id"])
	var roomID, facID *int
	err := h.pool().QueryRow(ctx, "SELECT room_id, facility_id FROM students WHERE id=$1", sid).Scan(&roomID, &facID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên")
			return
		}
		serverErr(c)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil { // đa cơ sở (invoices.routes.js:351)
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	total := billing.InvoiceTotal(map[string]float64{
		"room_charge": invoiceNumOr0(b["room_charge"]), "electric_charge": invoiceNumOr0(b["electric_charge"]),
		"water_charge": invoiceNumOr0(b["water_charge"]), "service_charge": invoiceNumOr0(b["service_charge"]),
		"washing_charge": invoiceNumOr0(b["washing_charge"]), "parking_charge": invoiceNumOr0(b["parking_charge"]),
		"other_charge": invoiceNumOr0(b["other_charge"]),
	}) // body không có discount -> 0
	// vals: $1..$14 (invoices.routes.js:354-356)
	vals := []interface{}{
		sid, roomID, monthStr, invoiceNumOr0(b["days_stayed"]), invoiceNumOr0(b["room_charge"]),
		invoiceNumOr0(b["electric_kwh"]), invoiceNumOr0(b["electric_charge"]), invoiceNumOr0(b["water_charge"]),
		invoiceNumOr0(b["service_charge"]), invoiceNumOr0(b["washing_charge"]), invoiceNumOr0(b["parking_charge"]),
		invoiceNumOr0(b["other_charge"]), invoiceStrOr(b["other_note"]), total,
	}
	// Đã có hoá đơn kỳ này? (kể cả bản xoá mềm). invoices.routes.js:359-369
	var exID int
	var exDeleted *time.Time
	exErr := h.pool().QueryRow(ctx, "SELECT id, deleted_at FROM invoices WHERE student_id=$1 AND month=$2", sid, monthStr).Scan(&exID, &exDeleted)
	exists := exErr == nil
	if exErr != nil && !errors.Is(exErr, pgx.ErrNoRows) {
		serverErr(c)
		return
	}
	if exists && exDeleted == nil {
		badRequest(c, "Học viên đã có hóa đơn trong kỳ này")
		return
	}
	if exists && exDeleted != nil {
		// hồi sinh hoá đơn đã xoá mềm ($1,$3 không dùng nhưng vẫn truyền như Node)
		rows, err := h.pool().Query(ctx,
			`UPDATE invoices SET room_id=$2, days_stayed=$4, room_charge=$5, electric_kwh=$6, electric_charge=$7,
			   water_charge=$8, service_charge=$9, washing_charge=$10, parking_charge=$11, other_charge=$12,
			   other_note=$13, total=$14, status='pending', paid_date=NULL, deleted_at=NULL WHERE id=$15 RETURNING *`,
			append(vals, exID)...)
		if err != nil {
			serverErr(c)
			return
		}
		row, err := db.RowToMap(rows)
		if err != nil {
			serverErr(c)
			return
		}
		c.JSON(http.StatusCreated, row)
		return
	}
	rows, err := h.pool().Query(ctx,
		`INSERT INTO invoices (student_id, room_id, month, days_stayed, room_charge, electric_kwh, electric_charge,
		   water_charge, service_charge, washing_charge, parking_charge, other_charge, other_note, total, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') RETURNING *`, vals...)
	if err != nil {
		if vehicleIsDup(err) { // 23505 (invoices.routes.js:376)
			badRequest(c, "Học viên đã có hóa đơn trong kỳ này")
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
	c.JSON(http.StatusCreated, row)
}

// UpdateInvoice: PUT /api/invoices/:id (admin,staff). invoices.routes.js:382-414.
func (h *Handlers) UpdateInvoice(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if !h.invoiceFacilityGuard(c, u, id) {
		return
	}
	ctx := c.Request.Context()
	var b map[string]json.RawMessage
	_ = c.ShouldBindJSON(&b)
	if e := invoiceBadMoney(b); e != "" {
		badRequest(c, e)
		return
	}
	// KHÓA hoá đơn đã thu (invoices.routes.js:388-390)
	var curStatus, curMonth string
	var curLeaderDisc, curRoomDisc float64
	err := h.pool().QueryRow(ctx, "SELECT status, leader_discount, room_discount, month FROM invoices WHERE id=$1 AND deleted_at IS NULL", id).
		Scan(&curStatus, &curLeaderDisc, &curRoomDisc, &curMonth)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy hóa đơn")
			return
		}
		serverErr(c)
		return
	}
	if curStatus == "paid" {
		badRequest(c, `Hoá đơn đã thu tiền — không sửa được. Nếu cần điều chỉnh, chuyển trạng thái về "chưa thu" trước (thao tác này được ghi nhật ký).`)
		return
	}
	if e := invoiceBadDays(b["days_stayed"], curMonth); e != "" {
		badRequest(c, e)
		return
	}
	giam := curLeaderDisc + curRoomDisc
	// total = Σ7 phí − CÁC KHOẢN GIẢM (lấy discount từ bản ghi hiện tại). invoices.routes.js:398
	total := billing.InvoiceTotal(map[string]float64{
		"room_charge": invoiceNumOr0(b["room_charge"]), "electric_charge": invoiceNumOr0(b["electric_charge"]),
		"water_charge": invoiceNumOr0(b["water_charge"]), "service_charge": invoiceNumOr0(b["service_charge"]),
		"washing_charge": invoiceNumOr0(b["washing_charge"]), "parking_charge": invoiceNumOr0(b["parking_charge"]),
		"other_charge":    invoiceNumOr0(b["other_charge"]),
		"leader_discount": curLeaderDisc, "room_discount": curRoomDisc,
	})
	// BLK-7: total có thể ÂM nếu giảm > tổng phí -> chặn thẳng ở API. invoices.routes.js:402
	if total < 0 {
		badRequest(c, "Tổng tiền âm ("+numDisp(float64(total))+"đ): tổng 7 khoản phí ("+numDisp(float64(total)+giam)+"đ) nhỏ hơn khoản giảm ("+numDisp(giam)+"đ). Kiểm lại các khoản.")
		return
	}
	rows, err := h.pool().Query(ctx,
		`UPDATE invoices SET days_stayed=$1, room_charge=$2, electric_kwh=$3, electric_charge=$4,
		   water_charge=$5, service_charge=$6, washing_charge=$7, parking_charge=$8, other_charge=$9,
		   other_note=$10, total=$11, note=$12 WHERE id=$13 RETURNING *`,
		invoiceNumOr0(b["days_stayed"]), invoiceNumOr0(b["room_charge"]), invoiceNumOr0(b["electric_kwh"]), invoiceNumOr0(b["electric_charge"]),
		invoiceNumOr0(b["water_charge"]), invoiceNumOr0(b["service_charge"]), invoiceNumOr0(b["washing_charge"]), invoiceNumOr0(b["parking_charge"]),
		invoiceNumOr0(b["other_charge"]), invoiceStrOr(b["other_note"]), total, invoiceStrOr(b["note"]), id)
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
		notFound(c, "Không tìm thấy hóa đơn")
		return
	}
	c.JSON(http.StatusOK, row)
}

// MarkPaidInvoices: POST /api/invoices/mark-paid (CHỈ admin). invoices.routes.js:419-434.
func (h *Handlers) MarkPaidInvoices(c *gin.Context) {
	ctx := c.Request.Context()
	var body map[string]json.RawMessage
	_ = c.ShouldBindJSON(&body)
	month := invoiceStrOr(body["month"])
	if !invoiceMonthFormat(month) {
		badRequest(c, "Phải chọn đúng một kỳ (dạng YYYY-MM). Không cho phép đánh dấu đã thu cho toàn bộ các kỳ.")
		return
	}
	if string(body["confirm"]) != "true" { // req.body.confirm !== true (chỉ boolean true)
		var n int
		if err := h.pool().QueryRow(ctx, `SELECT COUNT(*)::int c FROM invoices WHERE month=$1 AND status<>'paid' AND deleted_at IS NULL`, month).Scan(&n); err != nil {
			serverErr(c)
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"error":        `Thao tác này sẽ đánh dấu ĐÃ THU cho ` + itoa(n) + ` phiếu của kỳ ` + month + ` và KHÔNG hoàn tác được. Gửi lại kèm "confirm": true nếu chắc chắn.`,
			"would_update": n,
			"month":        month,
		})
		return
	}
	date := timeutil.Today()
	ct, err := h.pool().Exec(ctx,
		`UPDATE invoices SET status='paid', paid_date=$1 WHERE month=$2 AND status<>'paid' AND deleted_at IS NULL`, date, month)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "updated": int(ct.RowsAffected()), "month": month})
}

// InvoiceStatus: POST /api/invoices/:id/status (admin,staff) — đổi trạng thái + ghi audit. invoices.routes.js:437-463.
func (h *Handlers) InvoiceStatus(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if !h.invoiceFacilityGuard(c, u, id) {
		return
	}
	ctx := c.Request.Context()
	var body struct {
		Status *string `json:"status"`
		Date   *string `json:"date"`
	}
	_ = c.ShouldBindJSON(&body)
	// TP-24: trạng thái LẠ -> báo lỗi rõ (invoices.routes.js:441-442)
	okStatus := body.Status != nil && (*body.Status == "pending" || *body.Status == "sent" || *body.Status == "paid")
	if !okStatus {
		disp := "undefined"
		if body.Status != nil {
			disp = *body.Status
		}
		badRequest(c, `Trạng thái không hợp lệ: "`+disp+`" (chỉ 'pending', 'sent', 'paid').`)
		return
	}
	status := *body.Status
	var paidDate interface{}
	if status == "paid" {
		d := timeutil.Today()
		if body.Date != nil && *body.Date != "" {
			d = *body.Date
		}
		paidDate = d
	}
	var curStatus string
	var curTotal float64
	err := h.pool().QueryRow(ctx, "SELECT status, total FROM invoices WHERE id=$1 AND deleted_at IS NULL", id).Scan(&curStatus, &curTotal)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy hóa đơn")
			return
		}
		serverErr(c)
		return
	}
	rows, err := h.pool().Query(ctx,
		`UPDATE invoices SET status=$1, paid_date=$2 WHERE id=$3 AND deleted_at IS NULL RETURNING *`, status, paidDate, id)
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
		notFound(c, "Không tìm thấy hóa đơn")
		return
	}
	// TP-10: đổi trạng thái là thao tác nhạy cảm -> ghi nhật ký (fire-and-forget). invoices.routes.js:454-460
	if curStatus != status {
		_, _ = h.pool().Exec(ctx,
			`INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,'STATUS',$4,$5)`,
			u.ID, u.Username, u.Role, "/api/invoices/"+itoa(id),
			`Đổi trạng thái "`+curStatus+`" → "`+status+`" · total tại thời điểm đổi = `+numDisp(curTotal))
	}
	c.JSON(http.StatusOK, row)
}

// DeleteInvoice: DELETE /api/invoices/:id (admin,staff) — xoá mềm. invoices.routes.js:466-476.
func (h *Handlers) DeleteInvoice(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	if !h.invoiceFacilityGuard(c, u, id) {
		return
	}
	ctx := c.Request.Context()
	var status string
	err := h.pool().QueryRow(ctx, "SELECT status FROM invoices WHERE id=$1 AND deleted_at IS NULL", id).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy hóa đơn")
			return
		}
		serverErr(c)
		return
	}
	// Xoá phiếu ĐÃ THU = xoá doanh thu đã ghi nhận (TP-09). invoices.routes.js:472
	if status == "paid" {
		badRequest(c, `Hoá đơn đã thu tiền — không xoá được. Nếu cần huỷ, chuyển trạng thái về "chưa thu" trước (thao tác này được ghi nhật ký).`)
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE invoices SET deleted_at=now() WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
