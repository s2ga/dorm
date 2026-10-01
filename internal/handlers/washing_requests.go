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
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// An ninh báo "có người muốn đăng ký máy giặt" -> GỬI BÁO CÁO, không ghi thẳng vào hồ sơ.
// Quản trị viên duyệt thì mới vào danh sách máy giặt (cùng luật với đề nghị sửa biển số, BL-120).

const (
	washReqChoDuyet = "pending"
	washReqDaDuyet  = "approved"
	washReqTuChoi   = "rejected"
	washReqTran     = 200
)

// washingFromSQL: biểu thức cho UPDATE — bật thì giữ ngày cũ (nếu có) hoặc lấy hôm nay, tắt thì xoá ngày.
// Dùng ở MỌI chỗ ghi uses_washing để "ngày đăng ký" không phụ thuộc vào đường nào bật cờ.
func washingFromSQL(co string) string {
	return "CASE WHEN " + co + "::boolean THEN COALESCE(washing_from, CURRENT_DATE) ELSE NULL END"
}

// washingFromMoiSQL: bản dùng cho INSERT — hàng mới chưa có ngày cũ để giữ.
func washingFromMoiSQL(co string) string {
	return "CASE WHEN " + co + "::boolean THEN CURRENT_DATE ELSE NULL END"
}

// MaintWashingRequest: POST /api/maintenance/washing/requests (maintenance,admin)
// An ninh báo có người muốn đăng ký máy giặt. seen_date = ngày báo, bỏ trống thì lấy hôm nay.
func (h *Handlers) MaintWashingRequest(c *gin.Context) {
	u := auth.CurrentUser(c)
	var b struct {
		StudentID int    `json:"student_id"`
		SeenDate  string `json:"seen_date"`
		Note      string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	if b.StudentID <= 0 {
		badRequest(c, "Chọn học viên.")
		return
	}
	ngay := strings.TrimSpace(b.SeenDate)
	if ngay == "" {
		ngay = timeutil.Today()
	}
	if !valid.IsValidYmd(ngay) {
		badRequest(c, loiNgay)
		return
	}
	if ngay > timeutil.Today() {
		badRequest(c, "Ngày gửi đề nghị không thể ở tương lai.")
		return
	}
	ctx := c.Request.Context()
	var (
		ten    string
		giat   bool
		facID  *int
		roomID *int
		dangO  bool
	)
	err := h.pool().QueryRow(ctx, `
		SELECT s.name, s.uses_washing, s.facility_id, s.room_id, `+roomsDangO("CURRENT_DATE")+`
		  FROM students s WHERE s.id=$1 AND s.deleted_at IS NULL`, b.StudentID).
		Scan(&ten, &giat, &facID, &roomID, &dangO)
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
	if !dangO {
		badRequest(c, ten+" không còn ở ký túc xá, không đăng ký máy giặt được.")
		return
	}
	if giat {
		badRequest(c, ten+" đã có trong danh sách máy giặt.")
		return
	}
	var cuID int
	if h.pool().QueryRow(ctx, "SELECT id FROM washing_requests WHERE student_id=$1 AND status='pending'", b.StudentID).
		Scan(&cuID) == nil {
		conflict(c, gin.H{
			"error":   ten + " đã có đề nghị đang chờ duyệt. Chờ Ban Quản lý xử lý xong rồi gửi lại.",
			"request": gin.H{"id": cuID},
		})
		return
	}
	var id int
	if err := h.pool().QueryRow(ctx,
		`INSERT INTO washing_requests (student_id, facility_id, room_id, seen_date, note, requested_by)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		b.StudentID, facID, roomID, ngay, strings.TrimSpace(b.Note), u.Username).Scan(&id); err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": washReqChoDuyet})
}

// ListWashingRequests: GET /api/washing-requests?status=pending|all (admin,staff).
func (h *Handlers) ListWashingRequests(c *gin.Context) {
	u := auth.CurrentUser(c)
	status := strings.TrimSpace(c.Query("status"))
	cond := []string{"s.deleted_at IS NULL"}
	params := []interface{}{}
	switch status {
	case "", washReqChoDuyet:
		status = washReqChoDuyet
		cond = append(cond, "q.status = 'pending'")
	case "all":
	default:
		badRequest(c, `Bộ lọc không hợp lệ: "`+status+`"`)
		return
	}
	scope.ApplyFacilityFilter(u, "q.facility_id", &cond, &params)
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT q.id, q.student_id, q.seen_date, q.note, q.status, q.requested_by, q.requested_at,
		       q.decided_by, q.decided_at, q.decision_note,
		       s.name AS student_name, s.code AS student_code, s.uses_washing, r.name AS room_name, r.floor
		  FROM washing_requests q
		  JOIN students s ON s.id = q.student_id
		  LEFT JOIN rooms r ON r.id = COALESCE(q.room_id, s.room_id)
		 WHERE `+joinAnd(cond)+`
		 ORDER BY q.requested_at DESC LIMIT `+itoa(washReqTran), params...)
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

// ApproveWashingRequest: POST /api/washing-requests/:id/approve — ghi vào danh sách máy giặt.
func (h *Handlers) ApproveWashingRequest(c *gin.Context) { h.washingRequestQuyetDinh(c, true) }

// RejectWashingRequest: POST /api/washing-requests/:id/reject — từ chối, bắt buộc có lý do.
func (h *Handlers) RejectWashingRequest(c *gin.Context) { h.washingRequestQuyetDinh(c, false) }

func (h *Handlers) washingRequestQuyetDinh(c *gin.Context, duyet bool) {
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
		hvID          int
		status, hvTen string
		by, ngayThay  string
		facID         *int
	)
	err := h.pool().QueryRow(ctx, `
		SELECT q.student_id, q.status, q.requested_by, q.seen_date::text, q.facility_id, s.name
		  FROM washing_requests q JOIN students s ON s.id = q.student_id
		 WHERE q.id=$1 AND s.deleted_at IS NULL`, id).
		Scan(&hvID, &status, &by, &ngayThay, &facID, &hvTen)
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
	if status != washReqChoDuyet {
		conflict(c, gin.H{"error": "Đề nghị này " + nhanTT(nhanTTDeNghi, status) + " — tải lại danh sách."})
		return
	}

	if !duyet {
		if _, err := h.pool().Exec(ctx,
			`UPDATE washing_requests SET status='rejected', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3`,
			u.Username, note, id); err != nil {
			serverErr(c, err)
			return
		}
		maintGhiVet(ctx, h, u, "TỪ-CHỐI-MÁY-GIẶT", c.Request.URL.Path,
			"Từ chối đề nghị đăng ký máy giặt cho "+hvTen+" (HV #"+itoa(hvID)+") · gửi ngày "+ngayThay+
				" · người gửi "+by+" · lý do: "+note)
		c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": washReqTuChoi})
		return
	}

	// Duyệt = vào danh sách máy giặt. Ngày đăng ký là HÔM NAY, ngày an ninh gửi vẫn nằm ở đề nghị.
	// Phí máy giặt tính theo kỳ của phiếu, KHÔNG cắt theo ngày đăng ký.
	err = h.DB.WithTx(ctx, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx,
			`UPDATE students SET uses_washing=true, washing_from=COALESCE(washing_from, CURRENT_DATE)
			  WHERE id=$1 AND deleted_at IS NULL`, hvID); e != nil {
			return e
		}
		_, e := tx.Exec(ctx,
			`UPDATE washing_requests SET status='approved', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3`,
			u.Username, note, id)
		return e
	})
	if err != nil {
		serverErr(c, err)
		return
	}
	maintGhiVet(ctx, h, u, "DUYỆT-MÁY-GIẶT", c.Request.URL.Path,
		"Duyệt đề nghị: thêm "+hvTen+" (HV #"+itoa(hvID)+") vào danh sách máy giặt · gửi ngày "+
			ngayThay+" · người gửi "+by)
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": washReqDaDuyet, "student_id": hvID})
}
