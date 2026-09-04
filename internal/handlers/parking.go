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
	"ktx/internal/scope"
	"ktx/internal/storage"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Handler điểm danh bãi xe (parking_checks) — vai 'maintenance' (an ninh) dùng là chính.
// CHỈ ĐỌC bảng vehicles, không bao giờ ghi: vehiclecount đếm hàng ở đó để ra tiền gửi xe.

// Ba trạng thái, khớp ràng buộc ck_parking_checks_status.
const (
	parkingCoMat = "present"  // xe có trong bãi
	parkingVang  = "absent"   // đã đăng ký nhưng hôm nay không gửi
	parkingXeLa  = "stranger" // trong bãi nhưng không có trong danh sách đăng ký

	parkingMaxNgay   = 92 // báo cáo tối đa 92 ngày một lần
	parkingNguongMac = 7  // ngày vắng liên tiếp -> gắn cờ, khi Cài đặt không có giá trị
)

// parkingSQLNorm: bản SQL của vehicleChuanBien, khớp chỉ mục uq_vehicles_plate_norm.
const parkingSQLNorm = `regexp_replace(upper(v.plate),'[^0-9A-Z]','','g')`

// parkingNgay: ngày điểm danh; trống = hôm nay. Không nhận ngày tương lai.
func parkingNgay(raw string) (string, string) {
	d := strings.TrimSpace(raw)
	if d == "" {
		return timeutil.Today(), ""
	}
	if len(d) > 10 {
		d = d[:10]
	}
	if !valid.IsValidYmd(d) {
		return "", `Ngày điểm danh không hợp lệ: "` + raw + `"`
	}
	if d > timeutil.Today() {
		return "", "Không điểm danh cho ngày ở tương lai."
	}
	return d, ""
}

// parkingXeHieuLuc: mệnh đề "xe đang hiệu lực trong ngày $n", lấy đúng logic của vehiclecount.
func parkingXeHieuLuc(ph string) string {
	return `COALESCE(v.from_date, v.created_at::date) <= ` + ph +
		` AND (v.to_date IS NULL OR v.to_date >= ` + ph + `)`
}

// parkingFacCond: lọc theo cơ sở. Xe không có facility_id nên phải đi qua students.
func parkingFacCond(u *auth.User, c *gin.Context, cond *[]string, params *[]interface{}, col string) {
	if scope.IsExecutive(u) {
		if n, err := parkingSoNguyen(c.Query("facility")); err == nil && n > 0 {
			*params = append(*params, n)
			*cond = append(*cond, col+" = $"+itoa(len(*params)))
		}
		return
	}
	scope.ApplyFacilityFilter(u, col, cond, params)
}

// parkingSoNguyen: chuỗi số nguyên không âm, không nuốt lỗi như Atoi bỏ qua.
func parkingSoNguyen(s string) (int, error) {
	if s == "" {
		return 0, errors.New("rỗng")
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, errors.New("không phải số")
		}
		n = n*10 + int(r-'0')
		if n > 1<<30 {
			return 0, errors.New("quá lớn")
		}
	}
	return n, nil
}

// parkingLuuAnh: ảnh biển số (data URL) -> S3 bucket riêng tư, trả khoá. Không ảnh -> ("", true).
func (h *Handlers) parkingLuuAnh(c *gin.Context, dataURL, ngay string) (string, bool) {
	if strings.TrimSpace(dataURL) == "" {
		return "", true
	}
	if h.Store == nil {
		badRequest(c, "Máy chủ chưa cấu hình kho ảnh — bỏ ảnh rồi lưu lại.")
		return "", false
	}
	key := "parking/" + ngay + "/" + itoa(int(timeutil.Now().UnixNano())) + ".img"
	saved, err := h.Store.PutDataUrl(c.Request.Context(), h.Store.CccdBucket, key, dataURL)
	if err != nil {
		var he *storage.HTTPError
		if errors.As(err, &he) {
			c.JSON(he.Status, gin.H{"error": he.Msg})
			return "", false
		}
		serverErr(c, err)
		return "", false
	}
	return saved, true
}

// ParkingList: GET /api/maintenance/parking?date= — xe phải điểm danh trong ngày + kết quả + xe lạ.
func (h *Handlers) ParkingList(c *gin.Context) {
	u := auth.CurrentUser(c)
	ngay, errMsg := parkingNgay(c.Query("date"))
	if errMsg != "" {
		badRequest(c, errMsg)
		return
	}
	ctx := c.Request.Context()

	cond := []string{"v.deleted_at IS NULL", "s.deleted_at IS NULL", parkingXeHieuLuc("$1")}
	params := []interface{}{ngay}
	parkingFacCond(u, c, &cond, &params, "s.facility_id")

	// Không trả photo_key (đường dẫn thật trên kho ảnh) — chỉ cờ có/không, xem qua /photo/:id.
	rows, err := h.pool().Query(ctx, `
		SELECT v.id AS vehicle_id, v.plate, v.vehicle_type, v.sticker,
		       `+parkingSQLNorm+` AS plate_norm,
		       s.name AS student_name, r.name AS room_name,
		       pc.id AS check_id, pc.status, pc.note, pc.checked_by, pc.updated_at,
		       (pc.photo_key IS NOT NULL AND pc.photo_key <> '') AS has_photo
		FROM vehicles v
		JOIN students s ON s.id = v.student_id
		LEFT JOIN rooms r ON r.id = s.room_id
		LEFT JOIN parking_checks pc ON pc.vehicle_id = v.id AND pc.check_date = $1
		WHERE `+joinAnd(cond)+`
		ORDER BY r.name NULLS LAST, s.name, v.plate`, params...)
	if err != nil {
		serverErr(c, err)
		return
	}
	xe, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c, err)
		return
	}

	condLa := []string{"pc.check_date = $1", "pc.status = $2"}
	paramsLa := []interface{}{ngay, parkingXeLa}
	parkingFacCond(u, c, &condLa, &paramsLa, "pc.facility_id")
	rowsLa, err := h.pool().Query(ctx, `
		SELECT pc.id, pc.plate, pc.note, pc.checked_by, pc.created_at,
		       (pc.photo_key IS NOT NULL AND pc.photo_key <> '') AS has_photo
		FROM parking_checks pc
		WHERE `+joinAnd(condLa)+`
		ORDER BY pc.created_at DESC`, paramsLa...)
	if err != nil {
		serverErr(c, err)
		return
	}
	xeLa, err := db.RowsToMaps(rowsLa)
	if err != nil {
		serverErr(c, err)
		return
	}

	coMat, vang, chuaDanh := 0, 0, 0
	for _, x := range xe {
		switch studentsJSString(x["status"]) {
		case parkingCoMat:
			coMat++
		case parkingVang:
			vang++
		default:
			chuaDanh++
		}
	}
	if xe == nil {
		xe = []map[string]interface{}{}
	}
	if xeLa == nil {
		xeLa = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, gin.H{
		"date": ngay, "hom_nay": timeutil.Today(),
		"vehicles": xe, "strangers": xeLa,
		"summary": gin.H{"tong": len(xe), "co_mat": coMat, "vang": vang, "chua_danh": chuaDanh},
	})
}

type parkingMarkBody struct {
	VehicleID int    `json:"vehicle_id"`
	Date      string `json:"date"`
	Status    string `json:"status"`
	Note      string `json:"note"`
	Photo     string `json:"photo"`
}

// ParkingMark: POST /api/maintenance/parking/mark — đánh dấu một xe có mặt/vắng; đánh lại là ghi đè.
func (h *Handlers) ParkingMark(c *gin.Context) {
	u := auth.CurrentUser(c)
	var b parkingMarkBody
	_ = c.ShouldBindJSON(&b)
	if b.Status != parkingCoMat && b.Status != parkingVang {
		badRequest(c, `Trạng thái không hợp lệ: "`+b.Status+`". Chỉ nhận: có mặt hoặc vắng.`)
		return
	}
	ngay, errMsg := parkingNgay(b.Date)
	if errMsg != "" {
		badRequest(c, errMsg)
		return
	}
	if b.VehicleID <= 0 {
		badRequest(c, "Thiếu xe cần điểm danh")
		return
	}
	ctx := c.Request.Context()

	var (
		plate string
		facID *int
	)
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

	photoKey, ok := h.parkingLuuAnh(c, b.Photo, ngay)
	if !ok {
		return
	}
	var photoArg interface{}
	if photoKey != "" {
		photoArg = photoKey
	}

	// COALESCE ở photo_key: đánh lại bằng tay không được xoá mất tấm ảnh đã chụp lúc trước.
	var id int
	err = h.pool().QueryRow(ctx, `
		INSERT INTO parking_checks (check_date, facility_id, vehicle_id, plate, plate_norm, status, photo_key, note, checked_by)
		VALUES ($1,$2,$3,$4,regexp_replace(upper($4),'[^0-9A-Z]','','g'),$5,$6,$7,$8)
		ON CONFLICT (vehicle_id, check_date) WHERE vehicle_id IS NOT NULL
		DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note, checked_by=EXCLUDED.checked_by,
		              plate=EXCLUDED.plate, plate_norm=EXCLUDED.plate_norm,
		              photo_key=COALESCE(EXCLUDED.photo_key, parking_checks.photo_key),
		              updated_at=now()
		RETURNING id`,
		ngay, facID, b.VehicleID, plate, b.Status, photoArg, strings.TrimSpace(b.Note), u.Username).Scan(&id)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "date": ngay, "status": b.Status})
}

type parkingStrangerBody struct {
	Plate string `json:"plate"`
	Date  string `json:"date"`
	Note  string `json:"note"`
	Photo string `json:"photo"`
}

// ParkingStranger: POST /api/maintenance/parking/stranger — ghi nhận xe lạ trong bãi.
// Biển hoá ra đã đăng ký -> 409 kèm thông tin xe để màn hình mời điểm danh đúng chỗ.
func (h *Handlers) ParkingStranger(c *gin.Context) {
	u := auth.CurrentUser(c)
	var b parkingStrangerBody
	_ = c.ShouldBindJSON(&b)
	plate := strings.TrimSpace(b.Plate)
	if plate == "" {
		badRequest(c, "Nhập biển số xe lạ")
		return
	}
	norm := vehicleChuanBien(plate)
	if norm == "" {
		badRequest(c, `Biển số không hợp lệ: "`+plate+`"`)
		return
	}
	ngay, errMsg := parkingNgay(b.Date)
	if errMsg != "" {
		badRequest(c, errMsg)
		return
	}
	ctx := c.Request.Context()

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

	photoKey, ok := h.parkingLuuAnh(c, b.Photo, ngay)
	if !ok {
		return
	}
	var photoArg interface{}
	if photoKey != "" {
		photoArg = photoKey
	}
	facID := scope.UserFacility(u) // điều hành không gắn cơ sở -> NULL

	var id int
	err = h.pool().QueryRow(ctx, `
		INSERT INTO parking_checks (check_date, facility_id, vehicle_id, plate, plate_norm, status, photo_key, note, checked_by)
		VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8) RETURNING id`,
		ngay, facID, plate, norm, parkingXeLa, photoArg, strings.TrimSpace(b.Note), u.Username).Scan(&id)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "date": ngay})
}

type parkingFinishBody struct {
	Date string `json:"date"`
}

// ParkingFinish: POST /api/maintenance/parking/finish — chốt lượt: xe chưa đánh dấu thành VẮNG.
func (h *Handlers) ParkingFinish(c *gin.Context) {
	u := auth.CurrentUser(c)
	var b parkingFinishBody
	_ = c.ShouldBindJSON(&b)
	ngay, errMsg := parkingNgay(b.Date)
	if errMsg != "" {
		badRequest(c, errMsg)
		return
	}

	cond := []string{"v.deleted_at IS NULL", "s.deleted_at IS NULL", parkingXeHieuLuc("$1")}
	params := []interface{}{ngay}
	parkingFacCond(u, c, &cond, &params, "s.facility_id")
	params = append(params, parkingVang)
	phStatus := "$" + itoa(len(params))
	params = append(params, u.Username)
	phBy := "$" + itoa(len(params))

	ct, err := h.pool().Exec(c.Request.Context(), `
		INSERT INTO parking_checks (check_date, facility_id, vehicle_id, plate, plate_norm, status, checked_by)
		SELECT $1, s.facility_id, v.id, v.plate, `+parkingSQLNorm+`, `+phStatus+`, `+phBy+`
		FROM vehicles v JOIN students s ON s.id = v.student_id
		WHERE `+joinAnd(cond)+`
		  AND NOT EXISTS (SELECT 1 FROM parking_checks pc WHERE pc.vehicle_id = v.id AND pc.check_date = $1)`,
		params...)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "date": ngay, "da_ghi_vang": ct.RowsAffected()})
}

// ParkingUndo: DELETE /api/maintenance/parking/:id — bỏ một lần đánh dấu hoặc xoá bản ghi xe lạ.
func (h *Handlers) ParkingUndo(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		badRequest(c, "Mã bản ghi không hợp lệ")
		return
	}
	ctx := c.Request.Context()

	var (
		facID    *int
		photoKey *string
	)
	err := h.pool().QueryRow(ctx, "SELECT facility_id, photo_key FROM parking_checks WHERE id=$1", id).
		Scan(&facID, &photoKey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy bản ghi điểm danh")
			return
		}
		serverErr(c, err)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	if _, err := h.pool().Exec(ctx, "DELETE FROM parking_checks WHERE id=$1", id); err != nil {
		serverErr(c, err)
		return
	}
	// Ảnh mồ côi chỉ tốn chỗ, không hỏng gì -> xoá được thì xoá.
	if photoKey != nil && *photoKey != "" && h.Store != nil {
		_ = h.Store.DeleteObject(ctx, h.Store.CccdBucket, *photoKey)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ParkingPhoto: GET /api/maintenance/parking/photo/:id — proxy ảnh biển số từ bucket riêng tư.
func (h *Handlers) ParkingPhoto(c *gin.Context) {
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
	if h.pool().QueryRow(ctx, "SELECT facility_id, photo_key FROM parking_checks WHERE id=$1", id).
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

// ParkingReport: GET /api/maintenance/parking/report?from=&to= — ma trận xe × ngày + thống kê.
func (h *Handlers) ParkingReport(c *gin.Context) {
	u := auth.CurrentUser(c)
	to := strings.TrimSpace(c.Query("to"))
	if to == "" {
		to = timeutil.Today()
	}
	from := strings.TrimSpace(c.Query("from"))
	if from == "" {
		from = parkingLuiNgay(to, 13) // mặc định 14 ngày gần nhất
	}
	if !valid.IsValidYmd(from) || !valid.IsValidYmd(to) {
		badRequest(c, "Khoảng ngày không hợp lệ")
		return
	}
	if from > to {
		from, to = to, from
	}
	ngayList := parkingDaySeq(from, to)
	if len(ngayList) > parkingMaxNgay {
		badRequest(c, "Khoảng xem tối đa "+itoa(parkingMaxNgay)+" ngày — thu hẹp lại rồi xem tiếp.")
		return
	}
	ctx := c.Request.Context()

	// Xe có hiệu lực ở BẤT KỲ ngày nào trong khoảng.
	cond := []string{"v.deleted_at IS NULL", "s.deleted_at IS NULL",
		"COALESCE(v.from_date, v.created_at::date) <= $2",
		"(v.to_date IS NULL OR v.to_date >= $1)"}
	params := []interface{}{from, to}
	parkingFacCond(u, c, &cond, &params, "s.facility_id")
	rows, err := h.pool().Query(ctx, `
		SELECT v.id AS vehicle_id, v.plate, v.vehicle_type, v.sticker,
		       s.name AS student_name, r.name AS room_name
		FROM vehicles v
		JOIN students s ON s.id = v.student_id
		LEFT JOIN rooms r ON r.id = s.room_id
		WHERE `+joinAnd(cond)+`
		ORDER BY r.name NULLS LAST, s.name, v.plate`, params...)
	if err != nil {
		serverErr(c, err)
		return
	}
	dsXe, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c, err)
		return
	}

	condM := []string{"pc.check_date BETWEEN $1 AND $2"}
	paramsM := []interface{}{from, to}
	parkingFacCond(u, c, &condM, &paramsM, "pc.facility_id")
	rowsM, err := h.pool().Query(ctx, `
		SELECT pc.id, pc.vehicle_id, pc.check_date, pc.status, pc.plate, pc.plate_norm, pc.note, pc.checked_by,
		       (pc.photo_key IS NOT NULL AND pc.photo_key <> '') AS has_photo
		FROM parking_checks pc
		WHERE `+joinAnd(condM)+`
		ORDER BY pc.check_date DESC, pc.id DESC`, paramsM...)
	if err != nil {
		serverErr(c, err)
		return
	}
	danhDau, err := db.RowsToMaps(rowsM)
	if err != nil {
		serverErr(c, err)
		return
	}

	theoXe := map[int]map[string]string{}          // vehicle_id -> ngày -> trạng thái
	theoBienDaGo := map[string]map[string]string{} // biển chuẩn hoá của xe đã gỡ khỏi danh sách
	tenDaGo := map[string]string{}
	xeLa := []map[string]interface{}{}
	theoNgay := map[string][2]int{} // ngày -> [có mặt, vắng]

	for _, m := range danhDau {
		st := studentsJSString(m["status"])
		ngay := studentsJSString(m["check_date"])
		if len(ngay) > 10 {
			ngay = ngay[:10]
		}
		if st == parkingXeLa {
			xeLa = append(xeLa, m)
			continue
		}
		d := theoNgay[ngay]
		if st == parkingCoMat {
			d[0]++
		} else {
			d[1]++
		}
		theoNgay[ngay] = d

		if vid, ok := parkingSo(m["vehicle_id"]); ok {
			if theoXe[vid] == nil {
				theoXe[vid] = map[string]string{}
			}
			theoXe[vid][ngay] = st
			continue
		}
		// vehicle_id NULL mà không phải xe lạ = xe đã bị gỡ khỏi danh sách; vẫn phải hiện.
		norm := studentsJSString(m["plate_norm"])
		if norm == "" {
			continue
		}
		if theoBienDaGo[norm] == nil {
			theoBienDaGo[norm] = map[string]string{}
			tenDaGo[norm] = studentsJSString(m["plate"])
		}
		theoBienDaGo[norm][ngay] = st
	}

	out := make([]gin.H, 0, len(dsXe)+len(theoBienDaGo))
	for _, x := range dsXe {
		vid, _ := parkingSo(x["vehicle_id"])
		marks := theoXe[vid]
		if marks == nil {
			marks = map[string]string{}
		}
		coMat, vang := parkingDem(marks)
		out = append(out, gin.H{
			"vehicle_id": vid, "plate": x["plate"], "vehicle_type": x["vehicle_type"], "sticker": x["sticker"],
			"student_name": x["student_name"], "room_name": x["room_name"], "da_go": false,
			"marks": marks, "co_mat": coMat, "vang": vang,
			"vang_lien_tiep": parkingChuoiVang(marks, ngayList),
		})
	}
	for norm, marks := range theoBienDaGo {
		coMat, vang := parkingDem(marks)
		out = append(out, gin.H{
			"vehicle_id": 0, "plate": tenDaGo[norm], "vehicle_type": "", "sticker": "",
			"student_name": "", "room_name": "", "da_go": true,
			"marks": marks, "co_mat": coMat, "vang": vang,
			"vang_lien_tiep": parkingChuoiVang(marks, ngayList),
		})
	}

	tomTatNgay := make([]gin.H, 0, len(ngayList))
	for _, d := range ngayList {
		v := theoNgay[d]
		tomTatNgay = append(tomTatNgay, gin.H{"date": d, "co_mat": v[0], "vang": v[1], "da_kiem": v[0] + v[1]})
	}

	c.JSON(http.StatusOK, gin.H{
		"from": from, "to": to, "days": ngayList,
		"rows": out, "strangers": xeLa, "day_summary": tomTatNgay,
		"alert_days": h.parkingNguongCanhBao(ctx),
	})
}

// parkingNguongCanhBao: số ngày vắng liên tiếp thì gắn cờ, đọc từ Cài đặt.
func (h *Handlers) parkingNguongCanhBao(ctx context.Context) int {
	var s *string
	if h.pool().QueryRow(ctx, "SELECT value FROM settings WHERE key='parking_absent_alert_days'").Scan(&s) != nil || s == nil {
		return parkingNguongMac
	}
	n, err := parkingSoNguyen(strings.TrimSpace(*s))
	if err != nil || n <= 0 {
		return parkingNguongMac
	}
	return n
}

// parkingDem: số ngày có mặt / vắng.
func parkingDem(marks map[string]string) (int, int) {
	coMat, vang := 0, 0
	for _, v := range marks {
		if v == parkingCoMat {
			coMat++
		} else if v == parkingVang {
			vang++
		}
	}
	return coMat, vang
}

// parkingChuoiVang: số ngày VẮNG liên tiếp tính lùi từ cuối khoảng.
// Ngày không ai đi kiểm thì bỏ qua; gặp ngày có mặt thì dừng.
func parkingChuoiVang(marks map[string]string, days []string) int {
	n := 0
	for i := len(days) - 1; i >= 0; i-- {
		switch marks[days[i]] {
		case parkingCoMat:
			return n
		case parkingVang:
			n++
		}
	}
	return n
}

// parkingSo: số nguyên từ giá trị đã map, bỏ qua nil.
func parkingSo(v interface{}) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int32:
		return int(n), true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	}
	return 0, false
}

// parkingDaySeq: dãy ngày liên tục [from..to].
func parkingDaySeq(from, to string) []string {
	t1, e1 := time.Parse("2006-01-02", from)
	t2, e2 := time.Parse("2006-01-02", to)
	if e1 != nil || e2 != nil {
		return []string{}
	}
	out := []string{}
	for d := t1; !d.After(t2); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format("2006-01-02"))
		if len(out) > parkingMaxNgay+1 {
			break
		}
	}
	return out
}

// parkingLuiNgay: lùi n ngày so với ymd.
func parkingLuiNgay(ymd string, n int) string {
	t, err := time.Parse("2006-01-02", ymd)
	if err != nil {
		return ymd
	}
	return t.AddDate(0, 0, -n).Format("2006-01-02")
}
