package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/invoicecalc"
	"ktx/internal/roomleaders"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Handler phòng. Port từ server/routes/rooms.routes.js.

func roomHang(h string) string {
	switch h {
	case "A", "B", "C", "D":
		return h
	}
	return "B"
}
func roomType(t string) string {
	switch t {
	case "shared", "whole", "security", "staff":
		return t
	}
	return "shared"
}
func roomFloorOf(name string) int {
	for _, ch := range name {
		if ch >= '0' && ch <= '9' {
			return int(ch - '0')
		}
	}
	return 1
}
func capsFromSettings(s map[string]string) map[string]int {
	n := func(k string) int {
		if v, err := strconv.ParseFloat(strings.TrimSpace(s[k]), 64); err == nil && v > 0 {
			return int(v)
		}
		return 8
	}
	return map[string]int{"A": n("room_cap_A"), "B": n("room_cap_B"), "C": n("room_cap_C"), "D": n("room_cap_D")}
}

type roomBody struct {
	Name       *string         `json:"name"`
	Gender     *string         `json:"gender"`
	Hang       *string         `json:"hang"`
	Note       *string         `json:"note"`
	RoomType   *string         `json:"room_type"`
	Capacity   json.RawMessage `json:"capacity"`
	MonthlyFee json.RawMessage `json:"monthly_fee"`
	FacilityID json.RawMessage `json:"facility_id"`
	facilitySet bool
}

type roomNumVal struct {
	validate bool
	isNum    bool
	num      float64
	disp     string
}

// mergeRoomNum: giá trị hiệu lực của capacity/monthly_fee = body nếu có, else cur (PUT). server/routes/rooms.routes.js:20-22
func mergeRoomNum(raw json.RawMessage, cur interface{}) roomNumVal {
	if len(raw) > 0 && string(raw) != "null" {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			if s == "" {
				return roomNumVal{} // '' -> bỏ qua (Node: !== '')
			}
			if v, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil {
				return roomNumVal{validate: true, isNum: true, num: v, disp: s}
			}
			return roomNumVal{validate: true, isNum: false, disp: s}
		}
		var f float64
		if json.Unmarshal(raw, &f) == nil {
			return roomNumVal{validate: true, isNum: true, num: f, disp: numDisp(f)}
		}
		return roomNumVal{validate: true, isNum: false, disp: string(raw)}
	}
	if cur == nil {
		return roomNumVal{}
	}
	f := toFloat(cur)
	return roomNumVal{validate: true, isNum: true, num: f, disp: numDisp(f)}
}

func storedNum(mv roomNumVal) float64 {
	if mv.isNum {
		return mv.num
	}
	return 0
}

// badRoom: sức chứa & giá phòng hợp lý. "" nếu ổn. server/routes/rooms.routes.js:20-35
func badRoom(cap, fee roomNumVal, hangEff string, caps map[string]int) string {
	if cap.validate {
		if !cap.isNum {
			return `Sức chứa phải là số (đang nhận: "` + cap.disp + `")`
		}
		if cap.num < 0 {
			return "Sức chứa không được âm (đang nhận: " + numDisp(cap.num) + ")"
		}
		hd := hangEff
		if hd == "" {
			hd = "B"
		}
		max := caps[strings.ToUpper(hd)]
		if max == 0 {
			max = 8
		}
		if cap.num > float64(max) {
			return "Sức chứa " + numDisp(cap.num) + " vượt mức hợp lý cho phòng hạng " + hd + " (tối đa " + itoa(max) + " giường)"
		}
	}
	if fee.validate {
		if !fee.isNum {
			return `Giá phòng phải là số (đang nhận: "` + fee.disp + `")`
		}
		if fee.num < 0 {
			return "Giá phòng không được âm (đang nhận: " + numDisp(fee.num) + ")"
		}
	}
	return ""
}

func (h *Handlers) facilityOk(c *gin.Context, facilityID *int) bool {
	if facilityID == nil {
		return true
	}
	var one int
	return h.pool().QueryRow(c.Request.Context(), "SELECT 1 FROM facilities WHERE id=$1 AND deleted_at IS NULL", *facilityID).Scan(&one) == nil
}

func rawInt(raw json.RawMessage) *int {
	if n, ok := jsNum(raw); ok {
		v := int(n)
		return &v
	}
	return nil
}

// ListRooms: GET /api/rooms (admin,staff). ?deleted=1, ?facility. server/routes/rooms.routes.js:38-61
func (h *Handlers) ListRooms(c *gin.Context) {
	u := auth.CurrentUser(c)
	del := "r.deleted_at IS NULL"
	if c.Query("deleted") == "1" {
		del = "r.deleted_at IS NOT NULL"
	}
	cond := []string{del}
	params := []interface{}{}
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			if n, ok := jsNum(json.RawMessage(f)); ok {
				params = append(params, int(n))
				cond = append(cond, "r.facility_id = $"+itoa(len(params)))
			}
		}
	} else {
		scope.ApplyFacilityFilter(u, "r.facility_id", &cond, &params)
	}
	// BL-107: ?date=YYYY-MM-DD dịch MỐC đếm sang ngày đó thay vì hôm nay. Xếp phòng cho người vào ngày
	// 21 phải trừ người rời ngày 15 và cộng người đã xếp vào ngày 20 — tính theo hôm nay thì phòng còn
	// chỗ vẫn báo "đầy", còn phòng sắp kín lại trông thoáng. Không truyền thì giữ y hành vi cũ.
	moc := "CURRENT_DATE"
	if d := c.Query("date"); d != "" {
		if !valid.IsValidYmd(d) {
			badRequest(c, "Ngày không hợp lệ (cần dạng YYYY-MM-DD)")
			return
		}
		params = append(params, d)
		moc = "$" + itoa(len(params)) + "::date"
	}
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT r.*, f.name AS facility_name,
		  (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.deleted_at IS NULL AND `+roomsDangO(moc)+`)::int AS occupancy,
		  (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.deleted_at IS NULL AND `+roomsSapVao(moc)+`)::int AS upcoming,
		  (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.deleted_at IS NULL AND `+roomsSapRa(moc)+`)::int AS leaving
		FROM rooms r
		LEFT JOIN facilities f ON f.id = r.facility_id
		WHERE `+joinAnd(cond)+`
		ORDER BY r.floor, r.name`, params...)
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

// RoomsCalendar: GET /rooms/lich?tu=&den=[&facility=] (admin,staff) — ma trận phòng × ngày cho lịch
// chỗ trống. Ba mệnh đề FILTER sao y ListRooms để lịch KHÔNG đẻ thêm định nghĩa "ai đang ở" mới;
// truyền tu=den=X phải ra đúng con số ?date=X (tests/e2e/lich-cho-trong.test.js canh).
func (h *Handlers) RoomsCalendar(c *gin.Context) {
	u := auth.CurrentUser(c)
	tu, den := c.Query("tu"), c.Query("den")
	if !valid.IsValidYmd(tu) || !valid.IsValidYmd(den) {
		badRequest(c, "Ngày không hợp lệ (cần dạng YYYY-MM-DD)")
		return
	}
	t1, _ := time.Parse("2006-01-02", tu)
	t2, _ := time.Parse("2006-01-02", den)
	soNgay := int(t2.Sub(t1).Hours()/24) + 1
	if soNgay < 1 {
		badRequest(c, "Ngày kết thúc phải từ ngày bắt đầu trở đi")
		return
	}
	if soNgay > 180 {
		badRequest(c, "Khoảng ngày tối đa 180 ngày")
		return
	}
	cond := []string{"r.deleted_at IS NULL"}
	params := []interface{}{tu, den}
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			if n, ok := jsNum(json.RawMessage(f)); ok {
				params = append(params, int(n))
				cond = append(cond, "r.facility_id = $"+itoa(len(params)))
			}
		}
	} else {
		scope.ApplyFacilityFilter(u, "r.facility_id", &cond, &params)
	}
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT r.id, r.name, r.floor, r.gender, r.capacity, r.facility_id,
		       COALESCE(r.room_type,'shared') AS room_type,
		       (COALESCE(r.room_type,'shared') IN ('shared','security','staff')) AS dem_giuong,
		       x.dang_o, x.sap_vao, x.sap_ra
		  FROM rooms r
		  CROSS JOIN LATERAL (
		    SELECT json_agg(t.o ORDER BY t.ngay) AS dang_o,
		           json_agg(t.u ORDER BY t.ngay) AS sap_vao,
		           json_agg(t.l ORDER BY t.ngay) AS sap_ra
		      FROM (
		        SELECT d.ngay,
		               COUNT(s.id) FILTER (WHERE `+roomsDangO("d.ngay")+`)::int AS o,
		               COUNT(s.id) FILTER (WHERE `+roomsSapVao("d.ngay")+`)::int AS u,
		               COUNT(s.id) FILTER (WHERE `+roomsSapRa("d.ngay")+`)::int AS l
		          FROM (SELECT g::date AS ngay
		                  FROM generate_series($1::date, $2::date, interval '1 day') g) d
		          LEFT JOIN students s
		                 ON s.room_id = r.id AND s.deleted_at IS NULL
		                AND (s.check_out_date IS NULL OR s.check_out_date > $1::date)
		         GROUP BY d.ngay
		      ) t
		  ) x
		 WHERE `+joinAnd(cond)+`
		 ORDER BY r.floor, r.name`, params...)
	if err != nil {
		serverErr(c)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tu": tu, "den": den, "so_ngay": soNgay, "phong": list})
}

func bindRoomBody(c *gin.Context) roomBody {
	var raw map[string]json.RawMessage
	_ = c.ShouldBindJSON(&raw)
	var b roomBody
	get := func(k string) *string {
		if v, ok := raw[k]; ok {
			var s string
			if json.Unmarshal(v, &s) == nil {
				return &s
			}
		}
		return nil
	}
	b.Name = get("name")
	b.Gender = get("gender")
	b.Hang = get("hang")
	b.Note = get("note")
	b.RoomType = get("room_type")
	b.Capacity = raw["capacity"]
	b.MonthlyFee = raw["monthly_fee"]
	b.FacilityID = raw["facility_id"]
	_, b.facilitySet = raw["facility_id"]
	return b
}

func genderOf(p *string, def string) string {
	v := def
	if p != nil {
		v = *p
	}
	if v == "female" {
		return "female"
	}
	return "male"
}

// CreateRoom: POST /api/rooms (admin,staff). server/routes/rooms.routes.js:76-98
func (h *Handlers) CreateRoom(c *gin.Context) {
	u := auth.CurrentUser(c)
	b := bindRoomBody(c)
	if b.Name == nil || strings.TrimSpace(*b.Name) == "" {
		badRequest(c, "Nhập tên phòng")
		return
	}
	name := *b.Name
	facilityID := scope.ResolveFacilityForCreate(u, rawInt(b.FacilityID))
	if !h.facilityOk(c, facilityID) {
		badRequest(c, "Cơ sở không tồn tại hoặc đã bị xoá")
		return
	}
	fees, err := h.DB.GetSettings(c.Request.Context())
	if err != nil {
		serverErr(c)
		return
	}
	caps := capsFromSettings(fees)
	hangEff := ""
	if b.Hang != nil {
		hangEff = *b.Hang
	}
	if e := badRoom(mergeRoomNum(b.Capacity, nil), mergeRoomNum(b.MonthlyFee, nil), hangEff, caps); e != "" {
		badRequest(c, e)
		return
	}
	ctx := c.Request.Context()
	var one int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM rooms WHERE lower(trim(name))=lower(trim($1)) AND COALESCE(facility_id,0)=COALESCE($2,0) AND deleted_at IS NULL`, name, facilityID).Scan(&one) == nil {
		badRequest(c, `Phòng "`+strings.TrimSpace(name)+`" đã tồn tại trong cơ sở này`)
		return
	}
	note := ""
	if b.Note != nil {
		note = *b.Note
	}
	roomTypeVal := "shared"
	if b.RoomType != nil {
		roomTypeVal = roomType(*b.RoomType)
	}
	rows, err := h.pool().Query(ctx,
		`INSERT INTO rooms (facility_id, name, floor, gender, hang, capacity, monthly_fee, note, room_type)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
		facilityID, strings.TrimSpace(name), roomFloorOf(name), genderOf(b.Gender, "male"),
		roomHang(hangEff), int(storedNum(mergeRoomNum(b.Capacity, nil))), storedNum(mergeRoomNum(b.MonthlyFee, nil)), note, roomTypeVal)
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

// UpdateRoom: PUT /api/rooms/:id (admin,staff). server/routes/rooms.routes.js:100-139
func (h *Handlers) UpdateRoom(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy phòng")
		return
	}
	ctx := c.Request.Context()
	curRows, err := h.pool().Query(ctx, "SELECT * FROM rooms WHERE id=$1 AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	cur, err := db.RowToMap(curRows)
	if err != nil {
		serverErr(c)
		return
	}
	if cur == nil {
		notFound(c, "Không tìm thấy phòng")
		return
	}
	curFacID := intPtrFromDB(cur["facility_id"])
	if fe := scope.AssertFacility(u, curFacID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	b := bindRoomBody(c)
	name := strOf(cur["name"])
	if b.Name != nil {
		name = *b.Name
	}
	if strings.TrimSpace(name) == "" {
		badRequest(c, "Nhập tên phòng")
		return
	}
	if b.facilitySet && !h.facilityOk(c, rawInt(b.FacilityID)) {
		badRequest(c, "Cơ sở không tồn tại hoặc đã bị xoá")
		return
	}
	fees, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	caps := capsFromSettings(fees)
	hangEff := strOf(cur["hang"])
	if b.Hang != nil {
		hangEff = *b.Hang
	}
	if e := badRoom(mergeRoomNum(b.Capacity, cur["capacity"]), mergeRoomNum(b.MonthlyFee, cur["monthly_fee"]), hangEff, caps); e != "" {
		badRequest(c, e)
		return
	}
	// dup: facility hiệu lực = body.facility_id nếu gửi, else cur
	facForDup := curFacID
	if b.facilitySet {
		facForDup = rawInt(b.FacilityID)
	}
	var one int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM rooms WHERE lower(trim(name))=lower(trim($1)) AND COALESCE(facility_id,0)=COALESCE($2,0) AND id<>$3 AND deleted_at IS NULL`, name, facForDup, id).Scan(&one) == nil {
		badRequest(c, `Phòng "`+strings.TrimSpace(name)+`" đã tồn tại trong cơ sở này`)
		return
	}
	// BLK-2: đổi giới tính phòng không để lại người khác giới đang ở.
	newGender := genderOf(b.Gender, strOf(cur["gender"]))
	if newGender != strOf(cur["gender"]) {
		var conflictC int
		_ = h.pool().QueryRow(ctx,
			"SELECT COUNT(*)::int FROM students WHERE room_id=$1 AND deleted_at IS NULL AND status='in' AND gender<>$2", id, newGender).Scan(&conflictC)
		if conflictC > 0 {
			g := "nữ"
			if newGender == "female" {
				g = "nam"
			}
			gg := "nam"
			if newGender == "female" {
				gg = "nữ"
			}
			badRequest(c, "Phòng đang có "+itoa(conflictC)+" người "+g+" đang ở — chuyển họ sang phòng khác trước khi đổi thành phòng "+gg+".")
			return
		}
	}
	facForSave := scope.ResolveFacilityForCreate(u, facForDup)
	roomTypeVal := roomType(strOf(cur["room_type"]))
	if b.RoomType != nil {
		roomTypeVal = roomType(*b.RoomType)
	}
	note := strOf(cur["note"])
	if b.Note != nil {
		note = *b.Note
	}
	rows, err := h.pool().Query(ctx,
		`UPDATE rooms SET facility_id=$1, name=$2, floor=$3, gender=$4, hang=$5, capacity=$6, monthly_fee=$7, note=$8, room_type=$9
		 WHERE id=$10 RETURNING *`,
		facForSave, strings.TrimSpace(name), roomFloorOf(name), newGender, roomHang(hangEff),
		int(storedNum(mergeRoomNum(b.Capacity, cur["capacity"]))), storedNum(mergeRoomNum(b.MonthlyFee, cur["monthly_fee"])),
		note, roomTypeVal, id)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, row)
}

// DeleteRoom: DELETE /api/rooms/:id (admin,staff). server/routes/rooms.routes.js:142-162
func (h *Handlers) DeleteRoom(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy phòng")
		return
	}
	ctx := c.Request.Context()
	var facID *int
	if err := h.pool().QueryRow(ctx, "SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL", id).Scan(&facID); err != nil {
		notFound(c, "Không tìm thấy phòng")
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	var cnt, sapVao int
	_ = h.pool().QueryRow(ctx,
		`SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE check_in_date > CURRENT_DATE)::int
		 FROM students WHERE room_id=$1 AND deleted_at IS NULL AND status='in'`, id).Scan(&cnt, &sapVao)
	if cnt > 0 {
		extra := ""
		if sapVao > 0 {
			extra = " (trong đó " + itoa(sapVao) + " người chưa đến ngày nhận phòng)"
		}
		badRequest(c, "Phòng đang gán cho "+itoa(cnt)+" học viên"+extra+", không thể xóa. Chuyển họ sang phòng khác trước.")
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE rooms SET deleted_at=now() WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// RestoreRoom: POST /api/rooms/:id/restore (admin,staff). server/routes/rooms.routes.js:165-174
func (h *Handlers) RestoreRoom(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy phòng đã xoá")
		return
	}
	ctx := c.Request.Context()
	var facID *int
	if err := h.pool().QueryRow(ctx, "SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NOT NULL", id).Scan(&facID); err != nil {
		notFound(c, "Không tìm thấy phòng đã xoá")
		return
	}
	if !h.facilityOk(c, facID) {
		badRequest(c, "Cơ sở của phòng này đã bị xoá — khôi phục cơ sở trước, hoặc chuyển phòng sang cơ sở khác.")
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE rooms SET deleted_at=NULL WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetRoomLeader: GET /api/rooms/:id/leader (mọi user đăng nhập). server/routes/rooms.routes.js:178-187
func (h *Handlers) GetRoomLeader(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy phòng")
		return
	}
	ctx := c.Request.Context()
	current, err := roomleaders.CurrentOf(ctx, h.pool(), id)
	if err != nil {
		serverErr(c)
		return
	}
	rows, err := h.pool().Query(ctx,
		`SELECT rl.*, s.name AS student_name FROM room_leaders rl
		   JOIN students s ON s.id = rl.student_id
		  WHERE rl.room_id=$1 ORDER BY rl.from_date DESC`, id)
	if err != nil {
		serverErr(c)
		return
	}
	history, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	var cur interface{}
	if current != nil {
		cur = current
	}
	c.JSON(http.StatusOK, gin.H{"current": cur, "history": history})
}

// SetRoomLeader: POST /api/rooms/:id/leader (admin,staff). server/routes/rooms.routes.js:190-210
func (h *Handlers) SetRoomLeader(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy phòng")
		return
	}
	var body struct {
		StudentID json.RawMessage `json:"student_id"`
		Date      *string         `json:"date"`
		Note      *string         `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	sidNum, ok := jsNum(body.StudentID)
	if !ok || sidNum == 0 {
		badRequest(c, "Chọn học viên làm phòng trưởng")
		return
	}
	if body.Date != nil && *body.Date != "" && !valid.IsValidYmd(*body.Date) {
		badRequest(c, "Ngày nhận nhiệm vụ không hợp lệ")
		return
	}
	d := timeutil.Today()
	if body.Date != nil && *body.Date != "" {
		d = *body.Date
	}
	note := ""
	if body.Note != nil {
		note = *body.Note
	}
	ctx := c.Request.Context()
	r, err := roomleaders.SetLeader(ctx, h.pool(), id, int(sidNum), d, note, u.Username)
	if err != nil {
		serverErr(c)
		return
	}
	if r.Err != "" {
		badRequest(c, r.Err)
		return
	}
	if r.Already {
		c.JSON(http.StatusOK, gin.H{"ok": true, "already": true, "leader": r.Leader})
		return
	}
	ids := []int{int(sidNum)}
	if r.ReplacedStudentID != nil && *r.ReplacedStudentID != int(sidNum) {
		ids = append(ids, *r.ReplacedStudentID)
	}
	// Nắn ngày lùi/tiến làm số ngày làm đổi ở MỌI kỳ nằm giữa ngày cũ và ngày mới, không riêng kỳ
	// của ngày mới.
	ky := roomsKyCanTinhLai(r.NgayCu, d)
	recalced := []int{}
	for _, sid := range ids {
		xong := false
		for _, month := range ky {
			if res, e := invoicecalc.RecalcInvoice(ctx, h.DB, sid, month); e == nil && res != nil {
				xong = true
			}
		}
		if xong {
			recalced = append(recalced, sid)
		}
	}
	var replaced interface{}
	if r.Replaced != nil {
		replaced = r.Replaced
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "leader": r.Leader, "replaced": replaced, "recalced": recalced, "doi_ngay": r.DoiNgay})
}

// roomsKyCanTinhLai: các kỳ nằm giữa hai ngày (kể cả hai đầu). ngayCu rỗng = chỉ kỳ của ngayMoi.
// Chặn trần 36 kỳ phòng khi hai ngày cách nhau vô lý.
func roomsKyCanTinhLai(ngayCu, ngayMoi string) []string {
	if len(ngayMoi) < 7 {
		return nil
	}
	if len(ngayCu) < 7 {
		return []string{ngayMoi[:7]}
	}
	tu, den := ngayCu[:7], ngayMoi[:7]
	if tu > den {
		tu, den = den, tu
	}
	out := []string{}
	for m := tu; m <= den && len(out) < 36; m = invoicecalc.NextMonthOf(m) {
		out = append(out, m)
	}
	return out
}

// UnsetRoomLeader: DELETE /api/rooms/:id/leader (admin,staff). server/routes/rooms.routes.js:213-222
func (h *Handlers) UnsetRoomLeader(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy phòng")
		return
	}
	d := timeutil.Today()
	if dq := c.Query("date"); dq != "" && valid.IsValidYmd(dq) {
		d = dq
	}
	ctx := c.Request.Context()
	closed, err := roomleaders.CloseRoom(ctx, h.pool(), id, d)
	if err != nil {
		serverErr(c)
		return
	}
	if closed == nil {
		notFound(c, "Phòng này chưa có phòng trưởng")
		return
	}
	sid := intFromDB(closed["student_id"])
	var recalced interface{}
	if res, e := invoicecalc.RecalcInvoice(ctx, h.DB, sid, d[:7]); e == nil && res != nil {
		recalced = sid
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "closed": closed, "recalced": recalced})
}

// intPtrFromDB: id nullable (facility_id) từ map -> *int.
func intPtrFromDB(v interface{}) *int {
	if v == nil {
		return nil
	}
	n := intFromDB(v)
	return &n
}
