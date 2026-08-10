package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/billing"
	"ktx/internal/db"
	"ktx/internal/invoicecalc"
	"ktx/internal/meter"
	"ktx/internal/scope"
	"ktx/internal/valid"
)

// Chốt chỉ số công-tơ giữa kỳ (lúc học viên rời phòng / chuyển phòng), nhập bù được cho các
// lượt đã check-out.

// ListMeterReads: GET /api/electric/reads?month=YYYY-MM
// Trả cả lần chốt ĐÃ ghi lẫn lượt rời phòng CÒN THIẾU chỉ số, để biết còn nợ chỗ nào.
func (h *Handlers) ListMeterReads(c *gin.Context) {
	u := auth.CurrentUser(c)
	month := c.Query("month")
	if month == "" || !valid.IsValidYmd(month+"-01") {
		badRequest(c, "Kỳ không hợp lệ (cần YYYY-MM)")
		return
	}
	ctx := c.Request.Context()
	dau, cuoi := billing.FirstDay(month), billing.LastDay(month)

	cond := []string{"m.read_date >= $1", "m.read_date <= $2"}
	params := []interface{}{dau, cuoi}
	electricFacilityFilter(c, u, &cond, &params)
	rows, err := h.pool().Query(ctx,
		`SELECT m.id, m.room_id, r.name AS room_name, m.read_date, m.reading, m.reason,
		        m.student_id, s.name AS student_name, s.gender AS student_gender, m.note, m.created_by
		   FROM meter_reads m
		   JOIN rooms r ON r.id = m.room_id AND r.deleted_at IS NULL
		   LEFT JOIN students s ON s.id = m.student_id
		  WHERE `+joinAnd(cond)+`
		  ORDER BY r.name, m.read_date`, params...)
	if err != nil {
		serverErr(c)
		return
	}
	daChot, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}

	// Lượt ở kết thúc GIỮA kỳ mà chưa có chỉ số. Luật khớp ThieuDienKy: bỏ ngày cuối kỳ, nhận
	// chỉ số ở to_date (trả phòng) hoặc to_date+1 (chuyển phòng).
	// ngay_can_nhap = ngày nút Lưu phải POST lên.
	cond2 := []string{"rs.to_date >= $1", "rs.to_date < $2"}
	params2 := []interface{}{dau, cuoi}
	electricFacilityFilter(c, u, &cond2, &params2)
	rows2, err := h.pool().Query(ctx,
		`SELECT rs.student_id, s.name AS student_name, s.gender AS student_gender, s.code, rs.room_id, r.name AS room_name,
		        rs.to_date, rs.from_date,
		        EXISTS (SELECT 1 FROM room_stays n
		                 WHERE n.student_id = rs.student_id AND n.from_date = rs.to_date + 1) AS la_chuyen_phong,
		        to_char(rs.to_date + (CASE WHEN EXISTS (SELECT 1 FROM room_stays n
		                 WHERE n.student_id = rs.student_id AND n.from_date = rs.to_date + 1) THEN 1 ELSE 0 END),
		                'YYYY-MM-DD') AS ngay_can_nhap
		   FROM room_stays rs
		   JOIN students s ON s.id = rs.student_id AND s.deleted_at IS NULL
		   JOIN rooms r ON r.id = rs.room_id AND r.deleted_at IS NULL
		  WHERE `+joinAnd(cond2)+`
		    AND NOT EXISTS (SELECT 1 FROM meter_reads m
		                     WHERE m.room_id = rs.room_id
		                       AND m.read_date BETWEEN rs.to_date AND rs.to_date + 1)
		  ORDER BY rs.to_date, r.name`, params2...)
	if err != nil {
		serverErr(c)
		return
	}
	conThieu, err := db.RowsToMaps(rows2)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"month": month, "reads": daChot, "missing": conThieu})
}

// ElectricSegments: GET /api/electric/segments?room_id=&month= — các chặng chia điện của một
// phòng trong kỳ (cắt tại mỗi lần chốt giữa kỳ), kèm số ngày ở của từng người mỗi chặng.
// Phiếu thu dùng cái này để in rõ từng khoản điện theo từng sự kiện.
func (h *Handlers) ElectricSegments(c *gin.Context) {
	roomID := queryIntDefault(c, "room_id", 0)
	month := c.Query("month")
	if roomID <= 0 || month == "" || !valid.IsValidYmd(month+"-01") {
		badRequest(c, "Cần room_id và month (YYYY-MM)")
		return
	}
	ctx := c.Request.Context()
	segs, err := invoicecalc.RoomSegments(ctx, h.DB, roomID, month)
	if err != nil {
		serverErr(c)
		return
	}
	if segs == nil {
		c.JSON(http.StatusOK, gin.H{"month": month, "segments": []gin.H{}})
		return
	}
	out := make([]gin.H, 0, len(segs))
	for _, sg := range segs {
		roster := make([]gin.H, 0, len(sg.Roster))
		for _, r := range sg.Roster {
			roster = append(roster, gin.H{"student_id": r.StudentID, "days": r.Days})
		}
		out = append(out, gin.H{"from": sg.From, "to": sg.To, "kwh": sg.Kwh, "fallback": sg.Fellback, "roster": roster})
	}
	c.JSON(http.StatusOK, gin.H{"month": month, "segments": out})
}

// phongTrongPhamVi: phòng này có thuộc cơ sở người dùng phụ trách không. false = đã trả lỗi cho client.
func (h *Handlers) phongTrongPhamVi(ctx context.Context, c *gin.Context, u *auth.User, roomID int) bool {
	var facID *int
	if err := h.pool().QueryRow(ctx, "SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL", roomID).Scan(&facID); err != nil {
		notFound(c, "Không tìm thấy phòng")
		return false
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return false
	}
	return true
}

// thieuDienCuaHV: kỳ `month` còn thiếu gì để chia điện đúng cho MỘT học viên — gom mọi phòng
// HV từng ở trong kỳ đó. Câu trả về đã kèm tên phòng, dùng thẳng làm thông báo lỗi.
func (h *Handlers) thieuDienCuaHV(ctx context.Context, studentID int, month string) ([]string, error) {
	// Kèm NGÀY CUỐI học viên ở phòng đó trong kỳ: rời hoặc chuyển đi giữa kỳ thì chặng của họ khép
	// tại đó, không cần chỉ số cuối kỳ lẫn chỉ số của người rời sau họ (owner chốt 10/08/2026).
	rows, err := h.pool().Query(ctx,
		`SELECT rs.room_id, r.name,
		        bool_or(rs.to_date IS NULL OR rs.to_date >= $2) AS toi_cuoi_ky,
		        to_char(max(rs.to_date),'YYYY-MM-DD') AS ngay_cuoi
		   FROM room_stays rs JOIN rooms r ON r.id = rs.room_id AND r.deleted_at IS NULL
		  WHERE rs.student_id=$1 AND rs.from_date <= $2 AND (rs.to_date IS NULL OR rs.to_date >= $3)
		  GROUP BY rs.room_id, r.name`,
		studentID, billing.LastDay(month), billing.FirstDay(month))
	if err != nil {
		return nil, err
	}
	type phong struct {
		id      int
		ten     string
		denNgay string
	}
	var ds []phong
	for rows.Next() {
		var p phong
		var toiCuoiKy bool
		var ngayCuoi *string
		if err := rows.Scan(&p.id, &p.ten, &toiCuoiKy, &ngayCuoi); err != nil {
			rows.Close()
			return nil, err
		}
		if !toiCuoiKy && ngayCuoi != nil {
			p.denNgay = *ngayCuoi
		}
		ds = append(ds, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []string
	for _, p := range ds {
		thieu, err := invoicecalc.ThieuDienKyDenNgay(ctx, h.DB, p.id, month, p.denNgay)
		if err != nil {
			return nil, err
		}
		for _, t := range thieu {
			out = append(out, "phòng "+p.ten+": "+t)
		}
	}
	return out, nil
}

type meterReadBody struct {
	RoomID    json.RawMessage `json:"room_id"`
	StudentID json.RawMessage `json:"student_id"`
	Date      string          `json:"date"`
	Reading   json.RawMessage `json:"reading"`
	Note      string          `json:"note"`
}

// SaveMeterRead: POST /api/electric/reads — ghi chỉ số của MỘT phòng vào MỘT ngày, rồi tính lại
// phiếu của mọi người cùng phòng trong kỳ (chặng đổi thì phần chia của tất cả đều đổi).
func (h *Handlers) SaveMeterRead(c *gin.Context) {
	u := auth.CurrentUser(c)
	var b meterReadBody
	if err := c.ShouldBindJSON(&b); err != nil {
		badRequest(c, "Dữ liệu gửi lên không hợp lệ")
		return
	}
	ridNum, okR := jsNum(b.RoomID)
	if !okR || ridNum <= 0 {
		badRequest(c, "Thiếu phòng")
		return
	}
	roomID := int(ridNum)
	if !valid.IsValidYmd(b.Date) {
		badRequest(c, "Ngày chốt không hợp lệ")
		return
	}
	reading, okV := jsNum(b.Reading)
	if !okV || reading < 0 {
		badRequest(c, "Chỉ số công-tơ phải là số không âm")
		return
	}
	var studentID *int
	if n, ok := jsNum(b.StudentID); ok && n > 0 {
		v := int(n)
		studentID = &v
	}
	ctx := c.Request.Context()
	// Đa cơ sở: quản lý cơ sở A không được đụng công-tơ phòng của cơ sở B.
	if !h.phongTrongPhamVi(ctx, c, u, roomID) {
		return
	}

	// Công-tơ chỉ quay tới: chặn số lùi so với đầu kỳ, cuối kỳ, và các lần chốt trước/sau.
	msg, err := meter.CheckRead(ctx, h.pool(), roomID, b.Date, reading)
	if err != nil {
		serverErr(c)
		return
	}
	if msg != "" {
		badRequest(c, msg)
		return
	}
	ghiChu := b.Note
	if ghiChu == "" {
		ghiChu = "Chốt chỉ số ngày " + b.Date
	}
	by := ""
	if u != nil {
		by = u.Username
	}
	row, err := meter.RecordRead(ctx, h.pool(), roomID, b.Date, reading, "checkout", studentID, ghiChu, by)
	if err != nil {
		serverErr(c)
		return
	}
	ids, err := meter.AffectedStudents(ctx, h.pool(), roomID, b.Date)
	if err != nil {
		serverErr(c)
		return
	}
	month := b.Date[:7]
	tinhLai := 0
	for _, sid := range ids {
		tinhLai += invoicecalc.RecalcQuanhKy(ctx, h.DB, sid, month)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "read": row, "recalculated": tinhLai, "affected": len(ids)})
}

// DeleteMeterRead: DELETE /api/electric/reads/:id — gỡ lần chốt ghi nhầm, rồi tính lại.
func (h *Handlers) DeleteMeterRead(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		badRequest(c, "Mã lần chốt không hợp lệ")
		return
	}
	ctx := c.Request.Context()
	// Kiểm phạm vi cơ sở TRƯỚC khi xoá — xoá xong mới kiểm là đã mất dữ liệu.
	var roomID int
	var date string
	if err := h.pool().QueryRow(ctx,
		"SELECT room_id, to_char(read_date,'YYYY-MM-DD') FROM meter_reads WHERE id=$1", id).
		Scan(&roomID, &date); err != nil {
		notFound(c, "Không tìm thấy lần chốt")
		return
	}
	if !h.phongTrongPhamVi(ctx, c, u, roomID) {
		return
	}
	if _, err := h.pool().Exec(ctx, "DELETE FROM meter_reads WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	ids, err := meter.AffectedStudents(ctx, h.pool(), roomID, date)
	if err != nil {
		serverErr(c)
		return
	}
	for _, sid := range ids {
		invoicecalc.RecalcQuanhKy(ctx, h.DB, sid, date[:7])
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "affected": len(ids)})
}
