package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/scope"
)

// Chuyển phòng: lượt mới mở ĐÚNG hôm sau ở phòng khác, và không có nhật ký 'out' (Transfer chỉ ghi
// 'in'; có 'out' là trả phòng hẳn rồi quay lại). So `= to_date + 1` cho khớp electric_reads.go:63 —
// nơi quyết định ngày chốt công-tơ.
const staysDieuKienChuyen = `rs.to_date IS NOT NULL
       AND n.from_date = rs.to_date + 1
       AND n.room_id IS DISTINCT FROM rs.room_id
       AND NOT EXISTS (SELECT 1 FROM logs lo
                        WHERE lo.student_id = rs.student_id AND lo.type = 'out'
                          AND lo.date BETWEEN rs.to_date AND rs.to_date + 1)`

const staysChuyenPhong = `(SELECT 1 FROM room_stays n
     WHERE n.student_id = rs.student_id AND n.id <> rs.id AND ` + staysDieuKienChuyen + `
     ORDER BY n.from_date, n.id LIMIT 1)`

const staysPhongKe = `(SELECT COALESCE(r2.name,'') FROM room_stays n
     LEFT JOIN rooms r2 ON r2.id = n.room_id
     WHERE n.student_id = rs.student_id AND n.id <> rs.id AND ` + staysDieuKienChuyen + `
     ORDER BY n.from_date, n.id LIMIT 1)`

// StudentStays: GET /api/students/:id/stays — lịch sử ở của HV, đọc từ room_stays (nguồn sự thật
// về ở/rời — thứ tính tiền dùng). Mỗi lượt kèm ghi chú nhật ký khớp ngày; NULL = không có nhật ký,
// tức mốc đó ghi từ hồ sơ chứ không qua nút Check-in/out.
func (h *Handlers) StudentStays(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	ctx := c.Request.Context()
	// log 'out' khớp ở to_date hoặc to_date+1 (chuyển phòng ngày D -> lượt cũ hết D-1, log ghi ngày D).
	rows, err := h.pool().Query(ctx,
		`SELECT rs.id, rs.room_id, r.name AS room_name,
		        to_char(rs.from_date,'YYYY-MM-DD') AS from_date,
		        to_char(rs.to_date,'YYYY-MM-DD')   AS to_date,
		        (SELECT COALESCE(l.note,'') FROM logs l
		          WHERE l.student_id = rs.student_id AND l.type = 'in' AND l.date = rs.from_date
		          ORDER BY l.id LIMIT 1) AS log_vao,
		        (SELECT COALESCE(l.note,'') FROM logs l
		          WHERE l.student_id = rs.student_id AND l.type = 'out'
		            AND rs.to_date IS NOT NULL AND l.date BETWEEN rs.to_date AND rs.to_date + 1
		          ORDER BY l.id LIMIT 1) AS log_ra,
		        `+staysChuyenPhong+` IS NOT NULL AS chuyen_phong,
		        `+staysPhongKe+` AS phong_ke
		   FROM room_stays rs LEFT JOIN rooms r ON r.id = rs.room_id
		  WHERE rs.student_id = $1
		  ORDER BY rs.from_date, rs.id`, id)
	if err != nil {
		serverErr(c)
		return
	}
	stays, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"stays": stays})
}

// roomsFacilityGuard: phòng /:id phải thuộc cơ sở của người dùng. Giống studentsFacilityGuard.
func (h *Handlers) roomsFacilityGuard(c *gin.Context, u *auth.User, idStr string) bool {
	if scope.IsExecutive(u) {
		return true
	}
	// id phi số: KHÔNG nhả cho qua. strconv.Atoi ở paramInt nhận "+12" nên nhả là mất luôn rào cơ sở.
	if !studentsIsDigits(idStr) {
		notFound(c, "Không tìm thấy phòng")
		return false
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(), "SELECT facility_id FROM rooms WHERE id=$1", idStr).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true
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

// RoomStays: GET /api/rooms/:id/stays — ai đã từng ở phòng này, vào/rời ngày nào. Mới nhất trước.
// KHÔNG lọc students.deleted_at: hồ sơ bị khoá vẫn là người đã ở thật, bỏ đi là mất dấu lịch sử
// và lệch phần chia tiền điện theo ngày ở.
func (h *Handlers) RoomStays(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.roomsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy phòng")
		return
	}
	ctx := c.Request.Context()
	rows, err := h.pool().Query(ctx,
		`SELECT rs.id, rs.student_id, COALESCE(s.name,'') AS student_name, COALESCE(s.code,'') AS student_code,
		        to_char(rs.from_date,'YYYY-MM-DD') AS from_date,
		        to_char(rs.to_date,'YYYY-MM-DD')   AS to_date,
		        (s.deleted_at IS NOT NULL) AS da_khoa,
		        `+staysChuyenPhong+` IS NOT NULL AS chuyen_phong,
		        `+staysPhongKe+` AS phong_ke
		   FROM room_stays rs LEFT JOIN students s ON s.id = rs.student_id
		  WHERE rs.room_id = $1
		  ORDER BY rs.from_date DESC, rs.id DESC`, id)
	if err != nil {
		serverErr(c)
		return
	}
	stays, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"stays": stays})
}
