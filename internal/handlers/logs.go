package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/scope"
)

// ListLogs: GET /api/logs (admin,staff) — lịch sử check-in/out, lọc theo cơ sở + phân trang tuỳ chọn.
// server/routes/logs.routes.js:10-43
func (h *Handlers) ListLogs(c *gin.Context) {
	u := auth.CurrentUser(c)
	cond := []string{}
	params := []interface{}{}

	if t := c.Query("type"); t == "in" || t == "out" {
		params = append(params, t)
		cond = append(cond, "l.type=$1")
	}
	// BL-11: lọc theo học viên Ở SERVER. Trước đây client kéo 500 dòng gần nhất của TOÀN hệ thống
	// rồi .filter() theo student_id -> HV có lượt ra/vào cũ hơn 500 bản ghi gần nhất sẽ hiện lịch sử
	// RỖNG một cách âm thầm. Vẫn AND với chốt cơ sở bên dưới (quản lý cơ sở A không xem được HV cơ sở B).
	if sid := queryIntDefault(c, "student_id", 0); sid > 0 {
		params = append(params, sid)
		cond = append(cond, "l.student_id=$"+itoa(len(params)))
	}
	scope.ApplyFacilityFilter(u, "s.facility_id", &cond, &params)

	where := ""
	if len(cond) > 0 {
		where = "WHERE " + joinAnd(cond)
	}
	lim := queryIntDefault(c, "limit", 500)
	if lim > 2000 {
		lim = 2000
	}
	baseFrom := "FROM logs l JOIN students s ON s.id = l.student_id LEFT JOIN rooms r ON r.id = l.room_id " + where

	_, pageSet := c.GetQuery("page")
	_, limitSet := c.GetQuery("limit")
	ctx := c.Request.Context()

	if pageSet || limitSet {
		page := queryIntDefault(c, "page", 1)
		if page < 1 {
			page = 1
		}
		var total int
		if err := h.pool().QueryRow(ctx, "SELECT COUNT(*)::int "+baseFrom, params...).Scan(&total); err != nil {
			serverErr(c)
			return
		}
		params = append(params, lim)
		pL := len(params)
		params = append(params, (page-1)*lim)
		pO := len(params)
		rows, err := h.pool().Query(ctx,
			"SELECT l.*, s.name AS student_name, r.name AS room_name "+baseFrom+
				" ORDER BY l.date DESC, l.id DESC LIMIT $"+itoa(pL)+" OFFSET $"+itoa(pO), params...)
		if err != nil {
			serverErr(c)
			return
		}
		list, err := db.RowsToMaps(rows)
		if err != nil {
			serverErr(c)
			return
		}
		c.JSON(http.StatusOK, gin.H{"rows": list, "total": total, "page": page, "limit": lim})
		return
	}

	params = append(params, lim)
	rows, err := h.pool().Query(ctx,
		"SELECT l.*, s.name AS student_name, r.name AS room_name "+baseFrom+
			" ORDER BY l.date DESC, l.id DESC LIMIT $"+itoa(len(params)), params...)
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
