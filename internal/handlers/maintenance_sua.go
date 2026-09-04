package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"ktx/internal/auth"
	"ktx/internal/scope"
	"ktx/internal/valid"
)

// An ninh đối chiếu xe và ngày nhận phòng NGAY LÚC bàn giao — đứng trước mặt học viên, nhìn tận
// mắt. Đó là lúc duy nhất sửa được chính xác, nên cho sửa tại chỗ thay vì báo lên rồi chờ.
// Mọi lần sửa ghi vết CŨ -> MỚI: nhật ký chung chỉ giữ giá trị mới, không truy được đã đổi từ đâu.
func maintGhiVet(ctx context.Context, h *Handlers, u *auth.User, method, path, detail string) {
	var uid *int
	uname, urole := "(chưa đăng nhập)", ""
	if u != nil {
		uid, uname, urole = &u.ID, u.Username, u.Role
	}
	_, _ = h.pool().Exec(ctx,
		"INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)",
		uid, uname, urole, method, path, detail)
}

// MaintSuaBienSo: PUT /api/maintenance/vehicles/:id/plate — an ninh sửa biển số cho khớp xe thật.
func (h *Handlers) MaintSuaBienSo(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy xe")
		return
	}
	var b struct {
		Plate string `json:"plate"`
	}
	_ = c.ShouldBindJSON(&b)
	moi := strings.ToUpper(strings.Join(strings.Fields(b.Plate), " "))
	if moi == "" {
		badRequest(c, "Biển số không được để trống")
		return
	}
	if len([]rune(moi)) > 20 {
		badRequest(c, "Biển số dài quá 20 ký tự")
		return
	}
	ctx := c.Request.Context()
	var (
		cu     string
		hvID   int
		hvTen  string
		facID  *int
		hvRoom *string
	)
	err := h.pool().QueryRow(ctx,
		`SELECT COALESCE(v.plate,''), s.id, s.name, s.facility_id, r.name
		   FROM vehicles v JOIN students s ON s.id = v.student_id
		   LEFT JOIN rooms r ON r.id = s.room_id
		  WHERE v.id=$1 AND v.deleted_at IS NULL AND s.deleted_at IS NULL`, id).
		Scan(&cu, &hvID, &hvTen, &facID, &hvRoom)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy xe")
			return
		}
		serverErr(c)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	if cu == moi {
		c.JSON(http.StatusOK, gin.H{"plate": moi, "doi": false})
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE vehicles SET plate=$1 WHERE id=$2", moi, id); err != nil {
		serverErr(c)
		return
	}
	maintGhiVet(ctx, h, u, "SỬA-BIỂN", c.Request.URL.Path,
		"Sửa biển số xe của "+hvTen+" (HV #"+itoa(hvID)+"): \""+cu+"\" -> \""+moi+"\"")
	c.JSON(http.StatusOK, gin.H{"plate": moi, "cu": cu, "doi": true})
}

// MaintSuaNgayNhan: PUT /api/maintenance/handovers/:id/checkin-date — học viên đến nhận phòng lệch
// ngày ghi trên app thì an ninh sửa về ngày THẬT ngay lúc bàn giao.
func (h *Handlers) MaintSuaNgayNhan(c *gin.Context) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	var b struct {
		Date string `json:"date"`
	}
	_ = c.ShouldBindJSON(&b)
	d := strings.TrimSpace(b.Date)
	if !valid.IsValidYmd(d) {
		badRequest(c, "Ngày nhận phòng không hợp lệ")
		return
	}
	ctx := c.Request.Context()
	var (
		cu    *string
		ten   string
		facID *int
		coRa  *string
	)
	err := h.pool().QueryRow(ctx,
		`SELECT to_char(check_in_date,'YYYY-MM-DD'), name, facility_id, to_char(check_out_date,'YYYY-MM-DD')
		   FROM students WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&cu, &ten, &facID, &coRa)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy học viên")
			return
		}
		serverErr(c)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	if coRa != nil && *coRa != "" && d > *coRa {
		badRequest(c, "Ngày nhận phòng ("+d+") không thể sau ngày trả phòng ("+*coRa+")")
		return
	}
	cuStr := ""
	if cu != nil {
		cuStr = *cu
	}
	if cuStr == d {
		c.JSON(http.StatusOK, gin.H{"date": d, "doi": false})
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE students SET check_in_date=$1 WHERE id=$2", d, id); err != nil {
		serverErr(c)
		return
	}
	// room_stays là nguồn chia tiền điện — lệch với hồ sơ là sai tiền cả phòng.
	if err := h.maintDoiNgayVaoLuotO(ctx, id, d); err != nil {
		serverErr(c)
		return
	}
	maintGhiVet(ctx, h, u, "SỬA-NGÀY-VÀO", c.Request.URL.Path,
		"Sửa ngày nhận phòng của "+ten+" (HV #"+itoa(id)+"): \""+cuStr+"\" -> \""+d+"\"")
	c.JSON(http.StatusOK, gin.H{"date": d, "cu": cuStr, "doi": true})
}

// maintDoiNgayVaoLuotO: dời ngày bắt đầu của lượt ở ĐẦU TIÊN cho khớp hồ sơ. Chỉ đụng khi hồ sơ mới
// có đúng MỘT lượt — nhiều lượt nghĩa là đã chuyển phòng, sửa mù là phá lịch sử.
func (h *Handlers) maintDoiNgayVaoLuotO(ctx context.Context, studentID int, d string) error {
	var n, id int
	if err := h.pool().QueryRow(ctx, "SELECT COUNT(*)::int FROM room_stays WHERE student_id=$1", studentID).Scan(&n); err != nil {
		return err
	}
	if n != 1 {
		return nil
	}
	if err := h.pool().QueryRow(ctx, "SELECT id FROM room_stays WHERE student_id=$1", studentID).Scan(&id); err != nil {
		return err
	}
	_, err := h.pool().Exec(ctx,
		"UPDATE room_stays SET from_date=$1 WHERE id=$2 AND (to_date IS NULL OR to_date >= $1)", d, id)
	return err
}
