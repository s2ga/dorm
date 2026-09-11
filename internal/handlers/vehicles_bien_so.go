package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/scope"
)

// BL-120 — sửa biển số từ cổng an ninh đi qua DUYỆT (owner chốt 10/09/2026, thay luật "sửa tại chỗ" 04/08).
// An ninh chỉ gửi đề nghị (vehicle_plate_requests); quản trị viên duyệt thì hồ sơ xe mới đổi, kèm nhật ký
// cũ -> mới, ai đề nghị, ai duyệt. Từ chối thì an ninh thấy lý do ngay trên dòng xe.

const (
	plateReqChoDuyet = "pending"
	plateReqDaDuyet  = "approved"
	plateReqTuChoi   = "rejected"
	plateReqTran     = 200
)

// bienChuanHienThi: viết hoa, gom khoảng trắng — dạng lưu trên hồ sơ (khác vehicleChuanBien dùng để so trùng).
func bienChuanHienThi(p string) string { return strings.ToUpper(strings.Join(strings.Fields(p), " ")) }

// vehicleBienTrung: biển đã đăng ký cho xe KHÁC (còn hiệu lực hồ sơ) -> tên chủ xe đó.
func (h *Handlers) vehicleBienTrung(c *gin.Context, norm string, tru int) (string, bool) {
	var ten string
	err := h.pool().QueryRow(c.Request.Context(),
		`SELECT s.name FROM vehicles v JOIN students s ON s.id = v.student_id
		  WHERE v.deleted_at IS NULL AND v.id <> $2 AND `+parkingSQLNorm+` = $1 LIMIT 1`, norm, tru).Scan(&ten)
	return ten, err == nil
}

// MaintDeNghiSuaBien: PUT /api/maintenance/vehicles/:id/plate — an ninh gửi đề nghị sửa biển số.
func (h *Handlers) MaintDeNghiSuaBien(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy xe")
		return
	}
	var b struct {
		Plate string `json:"plate"`
		Note  string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	moi := bienChuanHienThi(b.Plate)
	if moi == "" {
		badRequest(c, "Biển số không được để trống")
		return
	}
	if len([]rune(moi)) > 20 {
		badRequest(c, "Biển số dài quá 20 ký tự")
		return
	}
	normMoi := vehicleChuanBien(moi)
	if normMoi == "" {
		badRequest(c, `Biển số không hợp lệ: "`+moi+`"`)
		return
	}
	ctx := c.Request.Context()
	var (
		cu    string
		facID *int
	)
	err := h.pool().QueryRow(ctx,
		`SELECT COALESCE(v.plate,''), s.facility_id
		   FROM vehicles v JOIN students s ON s.id = v.student_id
		  WHERE v.id=$1 AND v.deleted_at IS NULL AND s.deleted_at IS NULL`, id).Scan(&cu, &facID)
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
	if vehicleChuanBien(cu) == normMoi {
		c.JSON(http.StatusOK, gin.H{"plate": cu, "doi": false})
		return
	}
	if ten, trung := h.vehicleBienTrung(c, normMoi, id); trung {
		badRequest(c, "Biển số này đã đăng ký cho học viên "+ten)
		return
	}
	var (
		reqID  int
		reqMoi string
	)
	if h.pool().QueryRow(ctx, "SELECT id, plate_moi FROM vehicle_plate_requests WHERE vehicle_id=$1 AND status='pending'", id).
		Scan(&reqID, &reqMoi) == nil {
		conflict(c, gin.H{
			"error":   "Xe này đã có đề nghị đang chờ duyệt (biển " + reqMoi + "). Chờ quản trị viên xử lý xong rồi gửi lại.",
			"request": gin.H{"id": reqID, "plate_moi": reqMoi},
		})
		return
	}
	err = h.pool().QueryRow(ctx,
		`INSERT INTO vehicle_plate_requests (vehicle_id, facility_id, plate_cu, plate_moi, note, requested_by)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		id, facID, cu, moi, strings.TrimSpace(b.Note), u.Username).Scan(&reqID)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": reqID, "status": plateReqChoDuyet, "cu": cu, "plate": moi, "doi": true})
}

// ListPlateRequests: GET /api/vehicles/plate-requests?status=pending|all — quản trị xem đề nghị.
func (h *Handlers) ListPlateRequests(c *gin.Context) {
	u := auth.CurrentUser(c)
	status := strings.TrimSpace(c.Query("status"))
	cond := []string{"v.deleted_at IS NULL", "s.deleted_at IS NULL"}
	params := []interface{}{}
	switch status {
	case "", plateReqChoDuyet:
		status = plateReqChoDuyet
		cond = append(cond, "q.status = 'pending'")
	case "all":
	default:
		badRequest(c, `Bộ lọc không hợp lệ: "`+status+`"`)
		return
	}
	parkingFacCond(u, c, &cond, &params, "q.facility_id")
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT q.id, q.vehicle_id, q.plate_cu, q.plate_moi, q.note, q.status, q.requested_by, q.requested_at,
		       q.decided_by, q.decided_at, q.decision_note,
		       v.plate AS plate_hien_tai, s.id AS student_id, s.name AS student_name, r.name AS room_name
		FROM vehicle_plate_requests q
		JOIN vehicles v ON v.id = q.vehicle_id
		JOIN students s ON s.id = v.student_id
		LEFT JOIN rooms r ON r.id = s.room_id
		WHERE `+joinAnd(cond)+`
		ORDER BY q.requested_at DESC LIMIT `+itoa(plateReqTran), params...)
	if err != nil {
		serverErr(c, err)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status, "rows": list})
}

// ApprovePlateRequest: POST /api/vehicles/plate-requests/:id/approve — đổi biển trên hồ sơ xe + nhật ký.
func (h *Handlers) ApprovePlateRequest(c *gin.Context) { h.plateRequestQuyetDinh(c, true) }

// RejectPlateRequest: POST /api/vehicles/plate-requests/:id/reject — từ chối, bắt buộc có lý do.
func (h *Handlers) RejectPlateRequest(c *gin.Context) { h.plateRequestQuyetDinh(c, false) }

func (h *Handlers) plateRequestQuyetDinh(c *gin.Context, duyet bool) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy đề nghị")
		return
	}
	var b struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	note := strings.TrimSpace(b.Note)
	if !duyet && note == "" {
		badRequest(c, "Nhập lý do từ chối để an ninh biết vì sao")
		return
	}
	ctx := c.Request.Context()
	var (
		vehicleID, hvID  int
		hienTai, moi, by string
		status, hvTen    string
		facID            *int
	)
	err := h.pool().QueryRow(ctx, `
		SELECT q.vehicle_id, q.plate_moi, q.requested_by, q.status, q.facility_id, COALESCE(v.plate,''), s.id, s.name
		FROM vehicle_plate_requests q
		JOIN vehicles v ON v.id = q.vehicle_id
		JOIN students s ON s.id = v.student_id
		WHERE q.id=$1 AND v.deleted_at IS NULL`, id).
		Scan(&vehicleID, &moi, &by, &status, &facID, &hienTai, &hvID, &hvTen)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy đề nghị")
			return
		}
		serverErr(c, err)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	if status != plateReqChoDuyet {
		conflict(c, gin.H{"error": "Đề nghị này đã được xử lý rồi (" + status + ")."})
		return
	}

	if !duyet {
		if _, err := h.pool().Exec(ctx,
			`UPDATE vehicle_plate_requests SET status='rejected', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3`,
			u.Username, note, id); err != nil {
			serverErr(c, err)
			return
		}
		maintGhiVet(ctx, h, u, "TỪ-CHỐI-BIỂN", c.Request.URL.Path,
			"Từ chối sửa biển số xe của "+hvTen+" (HV #"+itoa(hvID)+"): \""+hienTai+"\" -> \""+moi+"\" · đề nghị bởi "+by+" · lý do: "+note)
		c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": plateReqTuChoi})
		return
	}

	if ten, trung := h.vehicleBienTrung(c, vehicleChuanBien(moi), vehicleID); trung {
		badRequest(c, "Biển số này đã đăng ký cho học viên "+ten+" — không duyệt được, từ chối và ghi lý do.")
		return
	}
	err = h.DB.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "UPDATE vehicles SET plate=$1 WHERE id=$2 AND deleted_at IS NULL", moi, vehicleID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`UPDATE vehicle_plate_requests SET status='approved', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3`,
			u.Username, note, id)
		return err
	})
	if err != nil {
		if vehicleIsDup(err) {
			badRequest(c, "Biển số này đã tồn tại trên một xe khác")
			return
		}
		serverErr(c, err)
		return
	}
	maintGhiVet(ctx, h, u, "SỬA-BIỂN", c.Request.URL.Path,
		"Duyệt sửa biển số xe của "+hvTen+" (HV #"+itoa(hvID)+"): \""+hienTai+"\" -> \""+moi+"\" · đề nghị bởi "+by)
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": plateReqDaDuyet, "cu": hienTai, "plate": moi})
}
