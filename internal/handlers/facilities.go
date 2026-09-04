package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"ktx/internal/db"
)

// Handler cơ sở (facilities). Port từ server/routes/facilities.routes.js. TEMPLATE cho CRUD đơn giản.

// ListFacilities: GET /api/facilities (admin,staff). server/routes/facilities.routes.js:8-16
func (h *Handlers) ListFacilities(c *gin.Context) {
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT f.*,
		  (SELECT COUNT(*) FROM rooms r WHERE r.facility_id=f.id AND r.deleted_at IS NULL)::int AS room_count
		FROM facilities f WHERE f.deleted_at IS NULL ORDER BY f.id`)
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

type facilityBody struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

// CreateFacility: POST /api/facilities (admin). server/routes/facilities.routes.js:18-30
func (h *Handlers) CreateFacility(c *gin.Context) {
	var b facilityBody
	_ = c.ShouldBindJSON(&b)
	if strings.TrimSpace(b.Name) == "" {
		badRequest(c, "Nhập tên cơ sở")
		return
	}
	if len(b.Address) > 300 {
		badRequest(c, "Địa chỉ quá dài (tối đa 300 ký tự)")
		return
	}
	ctx := c.Request.Context()
	var one int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM facilities WHERE deleted_at IS NULL AND lower(btrim(name))=lower(btrim($1))`, b.Name).Scan(&one) == nil {
		badRequest(c, `Cơ sở "`+strings.TrimSpace(b.Name)+`" đã tồn tại`)
		return
	}
	rows, err := h.pool().Query(ctx, "INSERT INTO facilities (name, address) VALUES ($1,$2) RETURNING *",
		strings.TrimSpace(b.Name), b.Address)
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

// UpdateFacility: PUT /api/facilities/:id (admin). server/routes/facilities.routes.js:32-45
func (h *Handlers) UpdateFacility(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy cơ sở (hoặc đã bị xoá)")
		return
	}
	var b facilityBody
	_ = c.ShouldBindJSON(&b)
	if strings.TrimSpace(b.Name) == "" {
		badRequest(c, "Nhập tên cơ sở")
		return
	}
	if len(b.Address) > 300 {
		badRequest(c, "Địa chỉ quá dài (tối đa 300 ký tự)")
		return
	}
	ctx := c.Request.Context()
	var one int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM facilities WHERE deleted_at IS NULL AND id<>$2 AND lower(btrim(name))=lower(btrim($1))`, b.Name, id).Scan(&one) == nil {
		badRequest(c, `Cơ sở "`+strings.TrimSpace(b.Name)+`" đã tồn tại`)
		return
	}
	rows, err := h.pool().Query(ctx, "UPDATE facilities SET name=$1, address=$2 WHERE id=$3 AND deleted_at IS NULL RETURNING *",
		strings.TrimSpace(b.Name), b.Address, id)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		notFound(c, "Không tìm thấy cơ sở (hoặc đã bị xoá)")
		return
	}
	c.JSON(http.StatusOK, row)
}

// DeleteFacility: DELETE /api/facilities/:id (admin). server/routes/facilities.routes.js:47-58
func (h *Handlers) DeleteFacility(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		badRequest(c, "id không hợp lệ")
		return
	}
	ctx := c.Request.Context()
	var roomC int
	_ = h.pool().QueryRow(ctx, "SELECT COUNT(*)::int FROM rooms WHERE facility_id=$1 AND deleted_at IS NULL", id).Scan(&roomC)
	if roomC > 0 {
		badRequest(c, "Cơ sở đang có phòng, không thể xóa")
		return
	}
	var userC int
	_ = h.pool().QueryRow(ctx, "SELECT COUNT(*)::int FROM users WHERE facility_id=$1 AND deleted_at IS NULL", id).Scan(&userC)
	if userC > 0 {
		badRequest(c, "Cơ sở đang có tài khoản quản lý/bảo trì, không thể xoá. Chuyển họ sang cơ sở khác (hoặc để \"Tất cả cơ sở\") trước.")
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE facilities SET deleted_at=now() WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
