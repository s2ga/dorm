package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"ktx/internal/auth"
	"ktx/internal/checkout"
	"ktx/internal/db"
	"ktx/internal/invoicecalc"
	"ktx/internal/meter"
	"ktx/internal/roomrules"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Biên bản bàn giao (BL-121): an ninh LẬP, quản trị XÁC NHẬN. An ninh không ghi vào hồ sơ học viên;
// xác nhận biên bản đi đúng lõi Check-in (xacNhanNhanPhong) / Check-out (traPhong) của quản trị.

var hoCleanliness = map[string]bool{"": true, "sach": true, "ban_nhe": true, "ban_nang": true}

type hoDamageIn struct {
	AssetID  int `json:"asset_id"`
	Quantity int `json:"quantity"`
}

type hoCreateBody struct {
	Kind         string       `json:"kind"`
	StudentID    int          `json:"student_id"`
	Date         string       `json:"date"`
	MeterReading interface{}  `json:"meter_reading"`
	Damages      []hoDamageIn `json:"damages"`
	Cleanliness  string       `json:"cleanliness"`
	KeysCount    *int         `json:"keys_count"`
	Plates       string       `json:"plates"`
	Note         string       `json:"note"`
}

// hoFacCond: lọc theo cơ sở của biên bản (cơ sở của học viên lúc lập).
func hoFacCond(u *auth.User, c *gin.Context, cond *[]string, params *[]interface{}) {
	if scope.IsExecutive(u) {
		if n, err := parkingSoNguyen(c.Query("facility")); err == nil && n > 0 {
			*params = append(*params, n)
			*cond = append(*cond, "COALESCE(hr.facility_id, s.facility_id) = $"+itoa(len(*params)))
		}
		return
	}
	scope.ApplyFacilityFilter(u, "COALESCE(hr.facility_id, s.facility_id)", cond, params)
}

func hoDaXuLy(status string) string {
	if status == "approved" {
		return "Biên bản đã được xác nhận rồi."
	}
	return "Biên bản đã bị trả lại — chờ an ninh lập biên bản mới."
}

func hoYmd(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}

// MaintAssets: GET /api/maintenance/assets — danh mục tài sản chỉ đọc, để tick hư hao trong biên bản.
func (h *Handlers) MaintAssets(c *gin.Context) {
	rows, err := h.pool().Query(c.Request.Context(),
		"SELECT id, name, unit, category, fee FROM assets WHERE deleted_at IS NULL ORDER BY category DESC, sort, id")
	if err != nil {
		serverErr(c, err)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c, err)
		return
	}
	if list == nil {
		list = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, list)
}

// MaintReportCreate: POST /api/maintenance/reports — an ninh lập biên bản nhận / trả phòng.
// Chỉ ghi vào handover_reports; hồ sơ học viên giữ nguyên tới khi quản trị xác nhận.
func (h *Handlers) MaintReportCreate(c *gin.Context) {
	u := auth.CurrentUser(c)
	var b hoCreateBody
	if err := c.ShouldBindJSON(&b); err != nil {
		badRequest(c, "Dữ liệu biên bản không hợp lệ")
		return
	}
	if b.Kind != "checkin" && b.Kind != "checkout" {
		badRequest(c, `Loại biên bản không hợp lệ: "`+b.Kind+`". Chỉ nhận: checkin, checkout.`)
		return
	}
	if b.StudentID <= 0 {
		badRequest(c, "Thiếu học viên")
		return
	}
	today := timeutil.Today()
	d := strings.TrimSpace(b.Date)
	if d == "" {
		d = today
	}
	if !valid.IsValidYmd(d) {
		badRequest(c, `Ngày bàn giao không hợp lệ: "`+b.Date+`"`)
		return
	}
	if d > today {
		badRequest(c, "Ngày bàn giao thật không thể ở tương lai.")
		return
	}
	if !hoCleanliness[b.Cleanliness] {
		badRequest(c, `Mức vệ sinh không hợp lệ: "`+b.Cleanliness+`". Chỉ nhận: sach, ban_nhe, ban_nang.`)
		return
	}
	if b.KeysCount != nil && (*b.KeysCount < 0 || *b.KeysCount > 50) {
		badRequest(c, "Số chìa khoá không hợp lệ")
		return
	}
	note := strings.TrimSpace(b.Note)
	if len([]rune(note)) > 1000 {
		badRequest(c, "Ghi chú dài quá 1000 ký tự")
		return
	}
	plates := strings.TrimSpace(b.Plates)
	if len([]rune(plates)) > 200 {
		badRequest(c, "Biển số đối chiếu dài quá 200 ký tự")
		return
	}
	ctx := c.Request.Context()
	var (
		roomID, facID     *int
		status            string
		checkIn, checkOut *time.Time
		ciConf, coConf    *time.Time
	)
	err := h.pool().QueryRow(ctx,
		`SELECT room_id, facility_id, status, check_in_date, check_out_date, checkin_confirmed_at, checkout_confirmed_at
		   FROM students WHERE id=$1 AND deleted_at IS NULL`, b.StudentID).
		Scan(&roomID, &facID, &status, &checkIn, &checkOut, &ciConf, &coConf)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên")
			return
		}
		serverErr(c, err)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	if b.Kind == "checkin" {
		if ciConf != nil || checkIn != nil {
			conflict(c, gin.H{"error": "Học viên đã được xác nhận nhận phòng rồi — không lập biên bản nhận phòng nữa."})
			return
		}
	} else {
		if status == "out" || coConf != nil {
			conflict(c, gin.H{"error": "Học viên đã trả phòng rồi — không lập biên bản trả phòng nữa."})
			return
		}
		if checkIn == nil {
			conflict(c, gin.H{"error": "Học viên chưa được xác nhận nhận phòng — chưa có gì để bàn giao trả."})
			return
		}
		bad, e := checkout.BadCheckoutDate(ctx, h.pool(), b.StudentID, d, hoYmd(checkIn))
		if e != nil {
			serverErr(c, e)
			return
		}
		if bad != "" {
			badRequest(c, bad)
			return
		}
	}
	// Số điện: bắt buộc khi học viên có phòng; công-tơ không quay ngược.
	var meterArg interface{}
	hasMeter, reading, finite := studentsMeterVal(b.MeterReading)
	if roomID != nil {
		if !hasMeter {
			badRequest(c, "Cần ghi số điện công-tơ lúc bàn giao.")
			return
		}
		if !finite || reading < 0 {
			badRequest(c, "Chỉ số công-tơ phải là số không âm")
			return
		}
		msg, e := meter.CheckRead(ctx, h.pool(), *roomID, d, reading)
		if e != nil {
			serverErr(c, e)
			return
		}
		if msg != "" {
			badRequest(c, msg)
			return
		}
		meterArg = reading
	}
	// Hư hao: chỉ nhận asset_id + số lượng; tên và đơn giá lấy từ danh mục, an ninh không gõ tiền.
	lines := []map[string]interface{}{}
	var total float64
	for _, ln := range b.Damages {
		if ln.Quantity < 0 || ln.Quantity > 100 {
			badRequest(c, "Số lượng hư hao không hợp lệ")
			return
		}
		if ln.Quantity == 0 {
			continue
		}
		var aName, aUnit string
		var fee float64
		if e := h.pool().QueryRow(ctx,
			"SELECT name, COALESCE(unit,''), COALESCE(fee,0) FROM assets WHERE id=$1 AND deleted_at IS NULL", ln.AssetID).
			Scan(&aName, &aUnit, &fee); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				badRequest(c, "Tài sản không tồn tại (id="+itoa(ln.AssetID)+")")
				return
			}
			serverErr(c, e)
			return
		}
		lt := float64(ln.Quantity) * fee
		total += lt
		lines = append(lines, map[string]interface{}{
			"asset_id": ln.AssetID, "name": aName, "unit": aUnit, "quantity": ln.Quantity, "fee": fee, "total": lt,
		})
	}
	dmgJSON, _ := json.Marshal(lines)
	var keysArg interface{}
	if b.KeysCount != nil {
		keysArg = *b.KeysCount
	}
	var id int
	err = h.pool().QueryRow(ctx, `
		INSERT INTO handover_reports (kind, student_id, room_id, facility_id, actual_date, meter_reading, damages, damage_amount,
		                              cleanliness, keys_count, plates, note, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13) RETURNING id`,
		b.Kind, b.StudentID, studentsPtrArg(roomID), studentsPtrArg(facID), d, meterArg, string(dmgJSON), total,
		b.Cleanliness, keysArg, plates, note, u.Username).Scan(&id)
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			conflict(c, gin.H{"error": "Đã có biên bản đang chờ quản trị xác nhận cho học viên này — đợi xác nhận, hoặc bị trả lại rồi lập lại."})
			return
		}
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok": true, "id": id, "kind": b.Kind, "student_id": b.StudentID, "actual_date": d,
		"damage_amount": total, "damages": lines,
	})
}

// HandoverReportsList: GET /api/handover-reports?status=pending|approved|returned|all&month= (admin,staff).
func (h *Handlers) HandoverReportsList(c *gin.Context) {
	u := auth.CurrentUser(c)
	st := c.DefaultQuery("status", "pending")
	cond := []string{"s.deleted_at IS NULL"}
	params := []interface{}{}
	switch st {
	case "pending", "approved", "returned":
		params = append(params, st)
		cond = append(cond, "hr.status = $"+itoa(len(params)))
	case "all":
	default:
		badRequest(c, `Trạng thái không hợp lệ: "`+st+`". Chỉ nhận: pending, approved, returned, all.`)
		return
	}
	if m := c.Query("month"); m != "" {
		if !maintIsMonth(m) {
			badRequest(c, "Tháng không hợp lệ (YYYY-MM)")
			return
		}
		params = append(params, m)
		cond = append(cond, "to_char(hr.actual_date,'YYYY-MM') = $"+itoa(len(params)))
	}
	hoFacCond(u, c, &cond, &params)
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT hr.id, hr.kind, hr.student_id, hr.room_id, hr.facility_id, hr.actual_date, hr.meter_reading, hr.damages,
		       hr.damage_amount, hr.cleanliness, hr.keys_count, hr.plates, hr.note, hr.status, hr.created_by, hr.created_at,
		       hr.reviewed_by, hr.reviewed_at, hr.review_note,
		       s.name AS student_name, s.code AS student_code, s.deposit_status, s.room_id AS student_room_id,
		       COALESCE(r.name, r2.name) AS room_name
		FROM handover_reports hr
		JOIN students s ON s.id = hr.student_id
		LEFT JOIN rooms r ON r.id = hr.room_id
		LEFT JOIN rooms r2 ON r2.id = s.room_id
		WHERE `+joinAnd(cond)+`
		ORDER BY (hr.status = 'pending') DESC, hr.created_at DESC
		LIMIT 500`, params...)
	if err != nil {
		serverErr(c, err)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c, err)
		return
	}
	if list == nil {
		list = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, list)
}

// HandoverReportApprove: POST /api/handover-reports/:id/approve (admin,staff).
// Thân request cùng dạng Check-in / Check-out; thiếu ô nào thì lấy từ biên bản. Hồ sơ đổi ở ĐÂY.
func (h *Handlers) HandoverReportApprove(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy biên bản")
		return
	}
	ctx := c.Request.Context()
	data, b := studentsReadBody(c)
	if bad := studentsRejectUnknown(studentsOrderedKeys(data),
		[]string{"date", "notice_date", "reason", "note", "meter_reading", "room_id", "confirm_overload", "planned_check_out"}); bad != "" {
		badRequest(c, bad)
		return
	}
	var (
		kind, status, createdBy, rNote string
		sid                            int
		actual                         time.Time
		rMeter                         *float64
		rRoom                          *int
	)
	err := h.pool().QueryRow(ctx,
		"SELECT kind, student_id, actual_date, meter_reading, note, status, created_by, room_id FROM handover_reports WHERE id=$1", id).
		Scan(&kind, &sid, &actual, &rMeter, &rNote, &status, &createdBy, &rRoom)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy biên bản")
			return
		}
		serverErr(c, err)
		return
	}
	if status != "pending" {
		conflict(c, gin.H{"error": hoDaXuLy(status)})
		return
	}
	if !h.studentsFacilityGuard(c, u, itoa(sid)) {
		return
	}
	d := actual.Format("2006-01-02")
	if studentsJSTruthy(b["date"]) {
		d = studentsJSString(b["date"])
		if !valid.IsValidYmd(d) {
			badRequest(c, "Ngày không hợp lệ")
			return
		}
	}
	note := studentsStrOr(b["note"])
	if note == "" {
		note = "Biên bản bàn giao #" + itoa(id) + " (an ninh " + createdBy + ")"
		if rNote != "" {
			note += ": " + rNote
		}
	}
	// Số điện: quản trị ghi đè được; không thì lấy số an ninh đã ghi.
	hasMeter, reading, finite := false, 0.0, true
	if v, ok := b["meter_reading"]; ok && v != nil {
		hasMeter, reading, finite = studentsMeterVal(v)
	} else if rMeter != nil {
		hasMeter, reading = true, *rMeter
	}
	if hasMeter && !finite {
		badRequest(c, "Chỉ số công-tơ phải là số không âm")
		return
	}
	var res gin.H
	if kind == "checkout" {
		if nv := b["notice_date"]; nv != nil {
			if ns := studentsJSString(nv); ns != "" && !valid.IsValidYmd(ns) {
				badRequest(c, "Ngày báo trả phòng không hợp lệ")
				return
			}
		}
		in := traPhongIn{Date: d, NoticeDate: studentsStrOr(b["notice_date"]), Reason: studentsJSString(b["reason"]),
			Note: note, HasMeter: hasMeter, Meter: reading}
		out, code, msg := h.traPhong(ctx, u, sid, in)
		if code != 0 {
			traPhongLoi(c, code, msg)
			return
		}
		res = out
	} else {
		out, done := h.nhanPhongTuBienBan(c, u, sid, d, note, b, hasMeter, reading, rRoom)
		if !done {
			return
		}
		res = out
	}
	if _, err := h.pool().Exec(ctx,
		`UPDATE handover_reports SET status='approved', reviewed_by=$1, reviewed_at=now(), review_note=$2 WHERE id=$3 AND status='pending'`,
		u.Username, studentsStrOr(b["note"]), id); err != nil {
		serverErr(c, err)
		return
	}
	res["report_id"] = id
	c.JSON(http.StatusOK, res)
}

// nhanPhongTuBienBan: xác nhận nhận phòng từ biên bản — cùng luật với StudentCheckin, thêm chốt công-tơ
// ngày vào (reason 'checkin') để điện cắt chặng đúng ngày. Trả (kết quả, done); done=false đã ghi lỗi.
func (h *Handlers) nhanPhongTuBienBan(c *gin.Context, u *auth.User, id int, d, note string, b map[string]interface{},
	hasMeter bool, reading float64, rRoom *int) (gin.H, bool) {
	ctx := c.Request.Context()
	if d > timeutil.Today() {
		badRequest(c, "Ngày nhận phòng thật không thể ở tương lai.")
		return nil, false
	}
	var (
		gender, rental, name string
		curRoom              *int
		lichVao, lichTra     *string
		cccdTruoc, cccdSau   *string
		ciConf               *time.Time
	)
	err := h.pool().QueryRow(ctx,
		"SELECT gender, rental_type, name, room_id, planned_check_in::text, planned_check_out::text, cccd_front, cccd_back, checkin_confirmed_at FROM students WHERE id=$1 AND deleted_at IS NULL", id).
		Scan(&gender, &rental, &name, &curRoom, &lichVao, &lichTra, &cccdTruoc, &cccdSau, &ciConf)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên")
			return nil, false
		}
		serverErr(c, err)
		return nil, false
	}
	if ciConf != nil {
		conflict(c, gin.H{"error": "Học viên đã được xác nhận nhận phòng trước đó."})
		return nil, false
	}
	// Cùng luật với StudentCheckin: đủ 2 mặt CCCD mới nhận phòng được (owner chốt 12/09/2026).
	if thieu := studentsThieuCccd(applicationsDeref(cccdTruoc), applicationsDeref(cccdSau)); thieu != "" {
		badRequest(c, "Chưa có ảnh CCCD "+thieu+" trong hồ sơ học viên. Bổ sung ảnh rồi xác nhận biên bản lại.")
		return nil, false
	}
	roomIDPtr := curRoom
	if v, ok := b["room_id"]; ok {
		roomIDPtr = studentsRoomIDPtr(v)
	}
	if roomIDPtr == nil && rRoom != nil {
		roomIDPtr = rRoom
	}
	chk, err := roomrules.CheckRoomAssignment(ctx, h.pool(), &id, gender, rental, roomIDPtr)
	if err != nil {
		serverErr(c, err)
		return nil, false
	}
	if studentsBlockOrConfirm(c, chk, b["confirm_overload"] == true) {
		return nil, false
	}
	studentsLogOverloads(ctx, h.pool(), c, u, id, name, chk.Warnings)
	// Kiểm công-tơ TRƯỚC khi đổi hồ sơ.
	if hasMeter && roomIDPtr != nil {
		msg, e := meter.CheckRead(ctx, h.pool(), *roomIDPtr, d, reading)
		if e != nil {
			serverErr(c, e)
			return nil, false
		}
		if msg != "" {
			badRequest(c, msg)
			return nil, false
		}
	}
	if err := h.xacNhanNhanPhong(ctx, id, roomIDPtr, d, note, "admin"); err != nil {
		serverErr(c, err)
		return nil, false
	}
	// Xác nhận biên bản = xác nhận nhận phòng chính thức -> cấp số HĐ chuẩn giấy như luồng Check-in BQL
	// (gọi ở dưới, sau khi giữ lại ngày dự kiến trả — cùng thứ tự với StudentCheckin).
	// Ngày dự kiến trả: ô trên form quản trị, không có thì lấy lịch đã đăng ký (cùng luật với StudentCheckin).
	pout := studentsSlice10(studentsStrOr(b["planned_check_out"]))
	if pout != "" && pout <= d {
		badRequest(c, "Ngày dự kiến trả phải sau ngày nhận phòng")
		return nil, false
	}
	if pout == "" && lichTra != nil {
		if lt := studentsSlice10(*lichTra); lt > d {
			pout = lt
		}
	}
	_, _ = invoicecalc.RecalcInvoice(ctx, h.DB, id, d[:7])
	if lichVao != nil {
		if l := studentsSlice10(*lichVao); len(l) >= 7 && l[:7] != d[:7] {
			_, _ = invoicecalc.RecalcInvoice(ctx, h.DB, id, l[:7])
		}
	}
	if pout != "" {
		_, _ = h.pool().Exec(ctx, "UPDATE students SET planned_check_out=$1 WHERE id=$2", pout, id)
	}
	soHD, tenFileHD := h.capSoHDKhiNhanPhong(ctx, id, d, pout)
	recalcedRoommates := []int{}
	if hasMeter && roomIDPtr != nil {
		if _, e := meter.RecordRead(ctx, h.pool(), *roomIDPtr, d, reading, "checkin", &id,
			"Chốt chỉ số lúc "+name+" nhận phòng (biên bản bàn giao)", u.Username); e != nil {
			serverErr(c, e)
			return nil, false
		}
		if aff, e := meter.AffectedStudents(ctx, h.pool(), *roomIDPtr, d); e == nil {
			for _, other := range aff {
				if other == id {
					continue
				}
				if invoicecalc.RecalcQuanhKy(ctx, h.DB, other, d[:7]) > 0 {
					recalcedRoommates = append(recalcedRoommates, other)
				}
			}
		}
	}
	rows, err := h.pool().Query(ctx, "SELECT * FROM students WHERE id=$1", id)
	if err != nil {
		serverErr(c, err)
		return nil, false
	}
	row, err := db.RowToMap(rows)
	if err != nil || row == nil {
		serverErr(c, err)
		return nil, false
	}
	out := gin.H{"student": row, "recalced_roommates": recalcedRoommates, "check_in_date": d}
	if soHD != "" {
		out["so_hd_moi"] = soHD
		out["ten_file_hd"] = tenFileHD
	}
	return out, true
}

// HandoverReportReturn: POST /api/handover-reports/:id/return (admin,staff) — trả lại kèm lý do, an ninh lập lại.
func (h *Handlers) HandoverReportReturn(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy biên bản")
		return
	}
	var b struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	note := strings.TrimSpace(b.Note)
	if note == "" {
		badRequest(c, "Nhập lý do trả lại để an ninh biết cần sửa gì")
		return
	}
	ctx := c.Request.Context()
	var (
		sid    int
		status string
	)
	err := h.pool().QueryRow(ctx, "SELECT student_id, status FROM handover_reports WHERE id=$1", id).Scan(&sid, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy biên bản")
			return
		}
		serverErr(c, err)
		return
	}
	if status != "pending" {
		conflict(c, gin.H{"error": hoDaXuLy(status)})
		return
	}
	if !h.studentsFacilityGuard(c, u, itoa(sid)) {
		return
	}
	ct, err := h.pool().Exec(ctx,
		`UPDATE handover_reports SET status='returned', reviewed_by=$1, reviewed_at=now(), review_note=$2 WHERE id=$3 AND status='pending'`,
		u.Username, note, id)
	if err != nil {
		serverErr(c, err)
		return
	}
	if ct.RowsAffected() == 0 {
		conflict(c, gin.H{"error": "Biên bản vừa được xử lý bởi thao tác khác — tải lại để xem trạng thái mới nhất."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
