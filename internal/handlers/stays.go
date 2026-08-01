package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/db"
)

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
		          ORDER BY l.id LIMIT 1) AS log_ra
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
