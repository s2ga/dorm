package handlers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/mail"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Báo cáo bãi xe của an ninh: parking_reports (từng báo cáo, quản trị đánh dấu đã xem/xử lý),
// parking_daily_reports (bản tổng kết khi chốt ngày + kết quả gửi mail), /vehicles/parking-alerts
// (số liệu cho chuông quản trị). Vẫn CHỈ ĐỌC bảng vehicles như parking.go.

const (
	parkingBaoCaoXeLa    = "stranger"    // xe không có trong danh sách đăng ký
	parkingBaoCaoVangLau = "absent_long" // xe đăng ký nhưng vắng nhiều ngày
	parkingBaoCaoKhac    = "other"

	parkingBcMoi    = "new"
	parkingBcDaXem  = "seen"
	parkingBcDaXuLy = "done"

	parkingChuyenPhongNgay = 30 // "phòng cũ -> phòng mới" chỉ hiện trong 30 ngày sau khi chuyển
	parkingDeNghiHienNgay  = 7  // đề nghị sửa biển đã duyệt / từ chối còn hiện trên dòng xe 7 ngày
	parkingGioChotMac      = "23:00"
	parkingMailTimeout     = 25 * time.Second
	parkingBaoCaoTran      = 500
)

var parkingLoaiBaoCao = map[string]string{
	parkingBaoCaoXeLa: "Xe lạ", parkingBaoCaoVangLau: "Vắng nhiều ngày", parkingBaoCaoKhac: "Khác",
}

// parkingChuDaTra: chủ xe đã trả phòng TRƯỚC ngày ph -> xe không còn phải điểm danh.
func parkingChuDaTra(ph string) string {
	return `(s.check_out_date IS NOT NULL AND s.check_out_date < ` + ph + `)`
}

// parkingSQLPhongCu: lateral tìm phòng cũ khi học viên vừa chuyển phòng. ph = tham số ngày ($n).
func parkingSQLPhongCu(ph string) string {
	return `SELECT r2.name AS prev_room_name, to_char(rs.to_date + 1, 'YYYY-MM-DD') AS moved_on
		FROM room_stays rs JOIN rooms r2 ON r2.id = rs.room_id
		WHERE rs.student_id = s.id AND s.room_id IS NOT NULL AND rs.room_id <> s.room_id
		  AND rs.to_date IS NOT NULL AND rs.to_date < ` + ph + `::date
		  AND rs.to_date >= ` + ph + `::date - ` + itoa(parkingChuyenPhongNgay) + `
		ORDER BY rs.to_date DESC LIMIT 1`
}

// parkingSQLDeNghiBien: lateral lấy đề nghị sửa biển gần nhất còn đáng hiện trên dòng xe.
var parkingSQLDeNghiBien = `SELECT q.id AS req_id, q.plate_moi AS req_plate, q.status AS req_status,
		q.decision_note AS req_note, q.decided_at AS req_decided_at, q.requested_by AS req_by
		FROM vehicle_plate_requests q
		WHERE q.vehicle_id = v.id
		  AND (q.status = 'pending' OR q.decided_at >= now() - make_interval(days => ` + itoa(parkingDeNghiHienNgay) + `))
		ORDER BY q.requested_at DESC LIMIT 1`

// parkingFacChot: cơ sở gắn với bản chốt ngày — cơ sở của người chốt; điều hành chọn qua ?facility=.
func parkingFacChot(u *auth.User, c *gin.Context) *int {
	if fid := scope.UserFacility(u); fid != nil {
		return fid
	}
	if n, err := parkingSoNguyen(c.Query("facility")); err == nil && n > 0 {
		return &n
	}
	return nil
}

func parkingWhere(cond []string) string {
	if len(cond) == 0 {
		return "TRUE"
	}
	return joinAnd(cond)
}

/* ===================== Báo cáo của an ninh ===================== */

type parkingReportBody struct {
	Date      string `json:"date"`
	Kind      string `json:"kind"`
	VehicleID int    `json:"vehicle_id"`
	Plate     string `json:"plate"`
	Note      string `json:"note"`
	Photo     string `json:"photo"`
}

// ParkingReportCreate: POST /api/maintenance/parking-reports — an ninh gửi một báo cáo.
func (h *Handlers) ParkingReportCreate(c *gin.Context) {
	var b parkingReportBody
	_ = c.ShouldBindJSON(&b)
	h.parkingGhiBaoCao(c, b)
}

// ParkingStranger: POST /api/maintenance/parking/stranger — đường cũ, nay là báo cáo loại xe lạ.
// Biển hoá ra đã đăng ký -> 409 kèm thông tin xe để màn hình mời điểm danh đúng chỗ.
func (h *Handlers) ParkingStranger(c *gin.Context) {
	var b parkingReportBody
	_ = c.ShouldBindJSON(&b)
	b.Kind = parkingBaoCaoXeLa
	h.parkingGhiBaoCao(c, b)
}

func (h *Handlers) parkingGhiBaoCao(c *gin.Context, b parkingReportBody) {
	u := auth.CurrentUser(c)
	if b.Kind != parkingBaoCaoXeLa && b.Kind != parkingBaoCaoVangLau && b.Kind != parkingBaoCaoKhac {
		badRequest(c, `Loại báo cáo không hợp lệ: "`+b.Kind+`". Chỉ nhận: xe lạ, vắng nhiều ngày, khác.`)
		return
	}
	ngay, errMsg := parkingNgay(b.Date)
	if errMsg != "" {
		badRequest(c, errMsg)
		return
	}
	note := strings.TrimSpace(b.Note)
	ctx := c.Request.Context()

	var (
		plate, norm string
		vehicleArg  interface{}
		facID       *int
	)
	if b.Kind == parkingBaoCaoXeLa {
		plate = strings.TrimSpace(b.Plate)
		if plate == "" {
			badRequest(c, "Nhập biển số xe lạ")
			return
		}
		norm = vehicleChuanBien(plate)
		if norm == "" {
			badRequest(c, `Biển số không hợp lệ: "`+plate+`"`)
			return
		}
		cond := []string{"v.deleted_at IS NULL", "s.deleted_at IS NULL", parkingSQLNorm + " = $1"}
		params := []interface{}{norm}
		parkingFacCond(u, c, &cond, &params, "s.facility_id")
		rows, err := h.pool().Query(ctx, `
			SELECT v.id AS vehicle_id, v.plate, s.name AS student_name, r.name AS room_name
			FROM vehicles v JOIN students s ON s.id = v.student_id
			LEFT JOIN rooms r ON r.id = s.room_id
			WHERE `+joinAnd(cond)+` LIMIT 1`, params...)
		if err != nil {
			serverErr(c, err)
			return
		}
		daDangKy, err := db.RowToMap(rows)
		if err != nil {
			serverErr(c, err)
			return
		}
		if daDangKy != nil {
			conflict(c, gin.H{
				"error":      "Biển số này ĐÃ đăng ký gửi xe — điểm danh ở danh sách thay vì ghi xe lạ.",
				"registered": daDangKy,
			})
			return
		}
		facID = scope.UserFacility(u) // điều hành không gắn cơ sở -> NULL
	} else {
		if b.VehicleID <= 0 {
			badRequest(c, "Thiếu xe cần báo cáo")
			return
		}
		if b.Kind == parkingBaoCaoKhac && note == "" {
			badRequest(c, "Báo cáo loại khác phải có nội dung")
			return
		}
		err := h.pool().QueryRow(ctx, `
			SELECT v.plate, s.facility_id
			FROM vehicles v JOIN students s ON s.id = v.student_id
			WHERE v.id = $1 AND v.deleted_at IS NULL AND s.deleted_at IS NULL`, b.VehicleID).Scan(&plate, &facID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				notFound(c, "Không tìm thấy xe")
				return
			}
			serverErr(c, err)
			return
		}
		if fe := scope.AssertFacility(u, facID); fe != nil {
			c.JSON(fe.Status, gin.H{"error": fe.Error})
			return
		}
		norm = vehicleChuanBien(plate)
		vehicleArg = b.VehicleID
	}

	photoKey, ok := h.parkingLuuAnh(c, b.Photo, ngay)
	if !ok {
		return
	}
	var photoArg interface{}
	if photoKey != "" {
		photoArg = photoKey
	}
	var id int
	err := h.pool().QueryRow(ctx, `
		INSERT INTO parking_reports (report_date, facility_id, vehicle_id, plate, plate_norm, kind, note, photo_key, reported_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		ngay, facID, vehicleArg, plate, norm, b.Kind, note, photoArg, u.Username).Scan(&id)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "date": ngay, "kind": b.Kind})
}

// ParkingReportDelete: DELETE /api/maintenance/parking-reports/:id — an ninh xoá báo cáo ghi nhầm.
// Quản trị viên đã xem rồi thì không xoá được nữa (đã thành thông tin của người khác).
func (h *Handlers) ParkingReportDelete(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		badRequest(c, "Mã báo cáo không hợp lệ")
		return
	}
	ctx := c.Request.Context()
	var (
		facID    *int
		photoKey *string
		status   string
	)
	err := h.pool().QueryRow(ctx, "SELECT facility_id, photo_key, status FROM parking_reports WHERE id=$1", id).
		Scan(&facID, &photoKey, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy báo cáo")
			return
		}
		serverErr(c, err)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	if status != parkingBcMoi {
		conflict(c, gin.H{"error": "Quản trị viên đã xem báo cáo này — không xoá được nữa."})
		return
	}
	if _, err := h.pool().Exec(ctx, "DELETE FROM parking_reports WHERE id=$1", id); err != nil {
		serverErr(c, err)
		return
	}
	if photoKey != nil && *photoKey != "" && h.Store != nil {
		_ = h.Store.DeleteObject(ctx, h.Store.CccdBucket, *photoKey)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ParkingReportPhoto: GET /api/maintenance/parking-reports/:id/photo — ảnh đính kèm báo cáo.
func (h *Handlers) ParkingReportPhoto(c *gin.Context) {
	h.parkingPhotoTuBang(c, "parking_reports")
}

// parkingPhotoTuBang: proxy ảnh biển số từ bucket riêng tư, theo bảng (parking_checks / parking_reports).
func (h *Handlers) parkingPhotoTuBang(c *gin.Context, bang string) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok || h.Store == nil {
		c.Status(http.StatusNotFound)
		return
	}
	ctx := c.Request.Context()
	var (
		facID *int
		key   *string
	)
	if h.pool().QueryRow(ctx, "SELECT facility_id, photo_key FROM "+bang+" WHERE id=$1", id).
		Scan(&facID, &key) != nil || key == nil || *key == "" {
		c.Status(http.StatusNotFound)
		return
	}
	if !scope.CanAccessFacility(u, facID) {
		c.Status(http.StatusForbidden)
		return
	}
	obj, err := h.Store.GetObject(ctx, h.Store.CccdBucket, *key)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer obj.Body.Close()
	ct := obj.ContentType
	if ct == "" {
		ct = "image/jpeg"
	}
	c.Header("Content-Type", ct)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, max-age=300")
	_, _ = io.Copy(c.Writer, obj.Body)
}

// parkingBaoCaoNgay: mọi báo cáo của một ngày trong tầm nhìn.
func (h *Handlers) parkingBaoCaoNgay(ctx context.Context, u *auth.User, c *gin.Context, ngay string) ([]map[string]interface{}, error) {
	cond := []string{"pr.report_date = $1"}
	params := []interface{}{ngay}
	parkingFacCond(u, c, &cond, &params, "pr.facility_id")
	rows, err := h.pool().Query(ctx, `
		SELECT pr.id, pr.kind, pr.vehicle_id, pr.plate, pr.note, pr.reported_by, pr.status,
		       pr.handled_by, pr.handled_note, pr.created_at,
		       (pr.photo_key IS NOT NULL AND pr.photo_key <> '') AS has_photo,
		       s.name AS student_name, r.name AS room_name
		FROM parking_reports pr
		LEFT JOIN vehicles v ON v.id = pr.vehicle_id
		LEFT JOIN students s ON s.id = v.student_id
		LEFT JOIN rooms r ON r.id = s.room_id
		WHERE `+joinAnd(cond)+`
		ORDER BY pr.created_at DESC`, params...)
	if err != nil {
		return nil, err
	}
	return db.RowsToMaps(rows)
}

// AdminParkingReports: GET /api/vehicles/parking-reports?status=new|all&from=&to= — quản trị xem.
// status=new: mọi báo cáo chưa xem, không giới hạn ngày (cũ mấy vẫn phải xử lý).
func (h *Handlers) AdminParkingReports(c *gin.Context) {
	u := auth.CurrentUser(c)
	status := strings.TrimSpace(c.Query("status"))
	cond := []string{}
	params := []interface{}{}
	from, to := "", ""
	switch status {
	case parkingBcMoi:
		cond = append(cond, "pr.status = 'new'")
	case "", "all":
		status = "all"
		to = strings.TrimSpace(c.Query("to"))
		if to == "" {
			to = timeutil.Today()
		}
		from = strings.TrimSpace(c.Query("from"))
		if from == "" {
			from = parkingLuiNgay(to, 29) // mặc định 30 ngày gần nhất
		}
		if !valid.IsValidYmd(from) || !valid.IsValidYmd(to) {
			badRequest(c, "Khoảng ngày không hợp lệ")
			return
		}
		if from > to {
			from, to = to, from
		}
		if len(parkingDaySeq(from, to)) > parkingMaxNgay {
			badRequest(c, "Khoảng xem tối đa "+itoa(parkingMaxNgay)+" ngày — thu hẹp lại rồi xem tiếp.")
			return
		}
		params = append(params, from, to)
		cond = append(cond, "pr.report_date BETWEEN $1 AND $2")
	default:
		badRequest(c, `Bộ lọc không hợp lệ: "`+status+`"`)
		return
	}
	parkingFacCond(u, c, &cond, &params, "pr.facility_id")
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT pr.id, to_char(pr.report_date,'YYYY-MM-DD') AS report_date, pr.kind, pr.vehicle_id, pr.plate, pr.note,
		       pr.reported_by, pr.status, pr.handled_by, pr.handled_at, pr.handled_note, pr.created_at,
		       (pr.photo_key IS NOT NULL AND pr.photo_key <> '') AS has_photo,
		       s.name AS student_name, r.name AS room_name, f.name AS facility_name
		FROM parking_reports pr
		LEFT JOIN vehicles v ON v.id = pr.vehicle_id
		LEFT JOIN students s ON s.id = v.student_id
		LEFT JOIN rooms r ON r.id = s.room_id
		LEFT JOIN facilities f ON f.id = pr.facility_id
		WHERE `+parkingWhere(cond)+`
		ORDER BY pr.created_at DESC LIMIT `+itoa(parkingBaoCaoTran), params...)
	if err != nil {
		serverErr(c, err)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status, "from": from, "to": to, "rows": list})
}

// AdminParkingReportStatus: POST /api/vehicles/parking-reports/:id/status — đã xem / đã xử lý.
func (h *Handlers) AdminParkingReportStatus(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		badRequest(c, "Mã báo cáo không hợp lệ")
		return
	}
	var b struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	if b.Status != parkingBcDaXem && b.Status != parkingBcDaXuLy {
		badRequest(c, `Trạng thái không hợp lệ: "`+b.Status+`". Chỉ nhận: đã xem hoặc đã xử lý.`)
		return
	}
	ctx := c.Request.Context()
	var facID *int
	if err := h.pool().QueryRow(ctx, "SELECT facility_id FROM parking_reports WHERE id=$1", id).Scan(&facID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy báo cáo")
			return
		}
		serverErr(c, err)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	if _, err := h.pool().Exec(ctx,
		`UPDATE parking_reports SET status=$1, handled_by=$2, handled_at=now(), handled_note=$3 WHERE id=$4`,
		b.Status, u.Username, strings.TrimSpace(b.Note), id); err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": b.Status})
}

/* ===================== Chuỗi vắng · tổng kết ngày · chốt ===================== */

// parkingChuoiVangTheoXe: số ngày VẮNG liên tiếp tính lùi từ ngay, cho mọi xe trong tầm nhìn
// (cửa sổ parkingMaxNgay ngày). Ngày không ai kiểm bị bỏ qua; gặp ngày có mặt thì dừng.
func (h *Handlers) parkingChuoiVangTheoXe(ctx context.Context, u *auth.User, c *gin.Context, ngay string) (map[int]int, error) {
	tu := parkingLuiNgay(ngay, parkingMaxNgay-1)
	cond := []string{"pc.vehicle_id IS NOT NULL", "pc.check_date BETWEEN $1 AND $2", "pc.status IN ('present','absent')"}
	params := []interface{}{tu, ngay}
	parkingFacCond(u, c, &cond, &params, "pc.facility_id")
	rows, err := h.pool().Query(ctx,
		`SELECT pc.vehicle_id, to_char(pc.check_date,'YYYY-MM-DD'), pc.status FROM parking_checks pc WHERE `+joinAnd(cond), params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	theoXe := map[int]map[string]string{}
	for rows.Next() {
		var (
			vid   int
			d, st string
		)
		if err := rows.Scan(&vid, &d, &st); err != nil {
			return nil, err
		}
		if theoXe[vid] == nil {
			theoXe[vid] = map[string]string{}
		}
		theoXe[vid][d] = st
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	days := parkingDaySeq(tu, ngay)
	out := map[int]int{}
	for vid, marks := range theoXe {
		out[vid] = parkingChuoiVang(marks, days)
	}
	return out, nil
}

type parkingXeDong struct {
	VehicleID          int
	Plate, Owner, Room string
	Days               int
}

type parkingTomTat struct {
	Tong, CoMat, Vang, ChuaDanh, SoBaoCao, VangLau, DeNghiBien, AlertDays int
	XeVang, XeVangLau                                                     []parkingXeDong
	BaoCao                                                                []map[string]interface{}
}

// parkingTomTat: số liệu điểm danh của một ngày trên tập xe PHẢI KIỂM (hiệu lực + chủ chưa trả phòng).
func (h *Handlers) parkingTomTat(ctx context.Context, u *auth.User, c *gin.Context, ngay string) (*parkingTomTat, error) {
	cond := []string{"v.deleted_at IS NULL", "s.deleted_at IS NULL", parkingXeHieuLuc("$1"), "NOT " + parkingChuDaTra("$1")}
	params := []interface{}{ngay}
	parkingFacCond(u, c, &cond, &params, "s.facility_id")
	rows, err := h.pool().Query(ctx, `
		SELECT v.id AS vehicle_id, v.plate, s.name AS student_name, COALESCE(r.name,'') AS room_name,
		       COALESCE(pc.status,'') AS status
		FROM vehicles v
		JOIN students s ON s.id = v.student_id
		LEFT JOIN rooms r ON r.id = s.room_id
		LEFT JOIN parking_checks pc ON pc.vehicle_id = v.id AND pc.check_date = $1
		WHERE `+joinAnd(cond)+`
		ORDER BY r.name NULLS LAST, s.name, v.plate`, params...)
	if err != nil {
		return nil, err
	}
	xe, err := db.RowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	chuoi, err := h.parkingChuoiVangTheoXe(ctx, u, c, ngay)
	if err != nil {
		return nil, err
	}
	t := &parkingTomTat{AlertDays: h.parkingNguongCanhBao(ctx), XeVang: []parkingXeDong{}, XeVangLau: []parkingXeDong{}}
	for _, x := range xe {
		vid, _ := parkingSo(x["vehicle_id"])
		dong := parkingXeDong{VehicleID: vid, Plate: studentsJSString(x["plate"]), Owner: studentsJSString(x["student_name"]),
			Room: studentsJSString(x["room_name"]), Days: chuoi[vid]}
		t.Tong++
		switch studentsJSString(x["status"]) {
		case parkingCoMat:
			t.CoMat++
		case parkingVang:
			t.Vang++
			t.XeVang = append(t.XeVang, dong)
		default:
			t.ChuaDanh++
		}
		if t.AlertDays > 0 && dong.Days >= t.AlertDays {
			t.XeVangLau = append(t.XeVangLau, dong)
			t.VangLau++
		}
	}
	if t.BaoCao, err = h.parkingBaoCaoNgay(ctx, u, c, ngay); err != nil {
		return nil, err
	}
	t.SoBaoCao = len(t.BaoCao)
	condQ := []string{"q.status = 'pending'", "v.deleted_at IS NULL"}
	paramsQ := []interface{}{}
	parkingFacCond(u, c, &condQ, &paramsQ, "q.facility_id")
	if err := h.pool().QueryRow(ctx,
		`SELECT COUNT(*)::int FROM vehicle_plate_requests q JOIN vehicles v ON v.id = q.vehicle_id WHERE `+joinAnd(condQ),
		paramsQ...).Scan(&t.DeNghiBien); err != nil {
		return nil, err
	}
	return t, nil
}

// parkingDailies: các bản chốt của một ngày trong tầm nhìn (điều hành thấy mọi cơ sở).
func (h *Handlers) parkingDailies(ctx context.Context, u *auth.User, c *gin.Context, ngay string) ([]map[string]interface{}, error) {
	cond := []string{"d.report_date = $1"}
	params := []interface{}{ngay}
	parkingFacCond(u, c, &cond, &params, "d.facility_id")
	rows, err := h.pool().Query(ctx, `
		SELECT d.id, d.facility_id, f.name AS facility_name, d.tong, d.co_mat, d.vang, d.so_bao_cao, d.vang_lau,
		       d.closed_by, d.closed_at, d.mail_to, d.mail_sent_at, d.mail_error
		FROM parking_daily_reports d LEFT JOIN facilities f ON f.id = d.facility_id
		WHERE `+joinAnd(cond)+`
		ORDER BY d.closed_at DESC`, params...)
	if err != nil {
		return nil, err
	}
	return db.RowsToMaps(rows)
}

// parkingChotNgay: ghi bản tổng kết ngày (chốt lại là ghi đè) rồi gửi mail ở nền.
func (h *Handlers) parkingChotNgay(ctx context.Context, u *auth.User, c *gin.Context, ngay string) (gin.H, error) {
	t, err := h.parkingTomTat(ctx, u, c, ngay)
	if err != nil {
		return nil, err
	}
	facID := parkingFacChot(u, c)
	var facArg interface{}
	if facID != nil {
		facArg = *facID
	}

	// Mail chỉ gửi lại khi số liệu ĐỔI so với lần chốt trước (chốt lại để bổ sung) — không dội mail trùng.
	var prevCo, prevVang, prevBc int
	daCo := h.pool().QueryRow(ctx, `
		SELECT co_mat, vang, so_bao_cao FROM parking_daily_reports
		WHERE report_date = $1 AND COALESCE(facility_id, 0) = COALESCE($2::int, 0)`, ngay, facArg).
		Scan(&prevCo, &prevVang, &prevBc) == nil
	guiMail := !daCo || prevCo != t.CoMat || prevVang != t.Vang || prevBc != t.SoBaoCao

	var id int
	err = h.pool().QueryRow(ctx, `
		INSERT INTO parking_daily_reports (report_date, facility_id, tong, co_mat, vang, so_bao_cao, vang_lau, closed_by, closed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
		ON CONFLICT (report_date, (COALESCE(facility_id, 0))) DO UPDATE SET
		  tong=EXCLUDED.tong, co_mat=EXCLUDED.co_mat, vang=EXCLUDED.vang, so_bao_cao=EXCLUDED.so_bao_cao,
		  vang_lau=EXCLUDED.vang_lau, closed_by=EXCLUDED.closed_by, closed_at=now()
		RETURNING id`,
		ngay, facArg, t.Tong, t.CoMat, t.Vang, t.SoBaoCao, t.VangLau, u.Username).Scan(&id)
	if err != nil {
		return nil, err
	}

	out := gin.H{
		"id": id, "date": ngay, "tong": t.Tong, "co_mat": t.CoMat, "vang": t.Vang, "chua_danh": t.ChuaDanh,
		"so_bao_cao": t.SoBaoCao, "vang_lau": t.VangLau, "closed_by": u.Username, "mail": "kept",
	}
	if guiMail {
		out["mail"] = "sending"
		tenCoSo := ""
		if facID != nil {
			_ = h.pool().QueryRow(ctx, "SELECT name FROM facilities WHERE id=$1", *facID).Scan(&tenCoSo)
		}
		go h.parkingGuiMailNgay(id, ngay, tenCoSo, u.Username, t)
	}
	return out, nil
}

// parkingGuiMailNgay: gửi mail tổng kết ở nền, ghi kết quả vào bản chốt (mail_sent_at / mail_error).
// Không chặn an ninh: SMTP chậm hay hỏng thì bản chốt vẫn ghi xong, quản trị viên thấy lý do trên màn.
func (h *Handlers) parkingGuiMailNgay(dailyID int, ngay, tenCoSo, nguoiChot string, t *parkingTomTat) {
	ctx, cancel := context.WithTimeout(context.Background(), parkingMailTimeout)
	defer cancel()
	ghi := func(to []string, ok bool, loi string) {
		if ok {
			_, _ = h.pool().Exec(context.Background(),
				"UPDATE parking_daily_reports SET mail_to=$1, mail_sent_at=now(), mail_error='' WHERE id=$2",
				strings.Join(to, ", "), dailyID)
			return
		}
		_, _ = h.pool().Exec(context.Background(),
			"UPDATE parking_daily_reports SET mail_to=$1, mail_error=$2 WHERE id=$3",
			strings.Join(to, ", "), loi, dailyID)
	}
	s, err := h.DB.GetSettings(ctx)
	if err != nil {
		ghi(nil, false, "Lỗi đọc cấu hình")
		return
	}
	to := h.parkingEmailNhan(ctx, s)
	if len(to) == 0 {
		ghi(nil, false, "Chưa có email nhận báo cáo — điền ở Cài đặt (Email nhận báo cáo bãi xe) hoặc gắn email cho tài khoản quản trị.")
		return
	}
	if !mail.SmtpConfigured(s) {
		ghi(to, false, "Chưa cấu hình SMTP trong Cài đặt")
		return
	}
	d := mail.ParkingDaily{
		Date: ngay, Facility: tenCoSo, ClosedBy: nguoiChot, ClosedAt: timeutil.Now().Format("15:04"),
		Tong: t.Tong, CoMat: t.CoMat, Vang: t.Vang, ChuaDanh: t.ChuaDanh, SoBaoCao: t.SoBaoCao,
		VangLau: t.VangLau, DeNghiBien: t.DeNghiBien, AlertDays: t.AlertDays,
	}
	for _, x := range t.XeVang {
		d.XeVang = append(d.XeVang, mail.ParkingXe{Plate: x.Plate, Owner: x.Owner, Room: x.Room, Days: x.Days})
	}
	for _, x := range t.XeVangLau {
		d.XeVangLau = append(d.XeVangLau, mail.ParkingXe{Plate: x.Plate, Owner: x.Owner, Room: x.Room, Days: x.Days})
	}
	for _, b := range t.BaoCao {
		d.BaoCao = append(d.BaoCao, mail.ParkingBaoCao{
			Kind: parkingLoaiBaoCao[studentsJSString(b["kind"])], Plate: studentsJSString(b["plate"]),
			Owner: studentsJSString(b["student_name"]), Note: studentsJSString(b["note"]), By: studentsJSString(b["reported_by"]),
		})
	}
	ok, loi := mail.SendParkingDaily(ctx, h.DB, to, d)
	ghi(to, ok, loi)
}

// parkingEmailNhan: người nhận mail báo cáo ngày — Cài đặt parking_report_email; trống thì lấy email
// của các tài khoản quản trị (users.role='admin').
func (h *Handlers) parkingEmailNhan(ctx context.Context, s map[string]string) []string {
	if to := parkingTachEmail(s["parking_report_email"]); len(to) > 0 {
		return to
	}
	rows, err := h.pool().Query(ctx,
		"SELECT COALESCE(email,'') FROM users WHERE role='admin' AND deleted_at IS NULL AND COALESCE(email,'') <> '' ORDER BY id")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var raw []string
	for rows.Next() {
		var e string
		if rows.Scan(&e) == nil {
			raw = append(raw, e)
		}
	}
	return parkingTachEmail(strings.Join(raw, ","))
}

// parkingTachEmail: tách danh sách email (phẩy / chấm phẩy / khoảng trắng), bỏ rác, bỏ trùng, giữ thứ tự.
func parkingTachEmail(raw string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, p := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\t' }) {
		e := strings.ToLower(strings.TrimSpace(p))
		if e == "" || seen[e] || !valid.IsValidEmail(e) {
			continue
		}
		seen[e] = true
		out = append(out, e)
	}
	return out
}

// parkingQuaGio: đã qua mốc giờ hhmm trong ngày chưa (giờ VN). Giờ rác -> coi như chưa qua.
func parkingQuaGio(now time.Time, hhmm string) bool {
	p := strings.Split(strings.TrimSpace(hhmm), ":")
	if len(p) != 2 {
		return false
	}
	hh, e1 := parkingSoNguyen(p[0])
	mm, e2 := parkingSoNguyen(p[1])
	if e1 != nil || e2 != nil || hh > 23 || mm > 59 {
		return false
	}
	return now.Hour()*60+now.Minute() >= hh*60+mm
}

// parkingGioChot: mốc giờ nhắc "chưa chốt bãi xe", đọc từ Cài đặt.
func (h *Handlers) parkingGioChot(ctx context.Context) string {
	var s *string
	if h.pool().QueryRow(ctx, "SELECT value FROM settings WHERE key='parking_close_alert_time'").Scan(&s) != nil ||
		s == nil || strings.TrimSpace(*s) == "" {
		return parkingGioChotMac
	}
	return strings.TrimSpace(*s)
}

/* ===================== Chuông quản trị ===================== */

// AdminParkingAlerts: GET /api/vehicles/parking-alerts — số liệu bãi xe hôm nay cho chuông + màn Gửi xe.
// Tính thẳng từ dữ liệu mỗi lần hỏi, không cần tác vụ hẹn giờ (máy chủ gói free hay ngủ).
func (h *Handlers) AdminParkingAlerts(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	homNay := timeutil.Today()
	t, err := h.parkingTomTat(ctx, u, c, homNay)
	if err != nil {
		serverErr(c, err)
		return
	}
	condM := []string{"pr.status = 'new'"}
	paramsM := []interface{}{}
	parkingFacCond(u, c, &condM, &paramsM, "pr.facility_id")
	var baoCaoMoi int
	if err := h.pool().QueryRow(ctx, `SELECT COUNT(*)::int FROM parking_reports pr WHERE `+joinAnd(condM), paramsM...).Scan(&baoCaoMoi); err != nil {
		serverErr(c, err)
		return
	}
	dailies, err := h.parkingDailies(ctx, u, c, homNay)
	if err != nil {
		serverErr(c, err)
		return
	}
	gio := h.parkingGioChot(ctx)
	vangLau := make([]gin.H, 0, len(t.XeVangLau))
	for _, x := range t.XeVangLau {
		vangLau = append(vangLau, gin.H{"vehicle_id": x.VehicleID, "plate": x.Plate, "student_name": x.Owner, "room_name": x.Room, "days": x.Days})
	}
	c.JSON(http.StatusOK, gin.H{
		"today": homNay, "tong": t.Tong, "co_mat": t.CoMat, "vang": t.Vang, "chua_danh": t.ChuaDanh,
		"plate_requests": t.DeNghiBien, "reports_new": baoCaoMoi,
		"vang_lau": vangLau, "alert_days": t.AlertDays,
		"dailies": dailies, "chua_chot": len(dailies) == 0 && parkingQuaGio(timeutil.Now(), gio), "alert_time": gio,
	})
}
