package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"ktx/internal/db"
)

// Handler danh mục tài sản. Port từ server/routes/assets.routes.js.

// intGteZero: số nguyên >= 0, mặc định def khi rỗng. server/routes/assets.routes.js:9-14
func intGteZero(raw json.RawMessage, def int, ten string) (int, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return def, ""
	}
	disp := string(raw)
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		if f != math.Trunc(f) || f < 0 {
			return 0, fmt.Sprintf(`%s phải là số nguyên ≥ 0 (đang nhận: "%s")`, ten, disp)
		}
		return int(f), ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		if strings.TrimSpace(s) == "" {
			return def, ""
		}
		disp = s
		if n, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil && n == math.Trunc(n) && n >= 0 {
			return int(n), ""
		}
	}
	return 0, fmt.Sprintf(`%s phải là số nguyên ≥ 0 (đang nhận: "%s")`, ten, disp)
}

type assetBody struct {
	Name     string          `json:"name"`
	Unit     string          `json:"unit"`
	Category string          `json:"category"`
	Note     string          `json:"note"`
	Quantity json.RawMessage `json:"quantity"`
	Fee      json.RawMessage `json:"fee"`
}

func normCategory(cat string) string {
	if cat == "person" {
		return "person"
	}
	return "fixed"
}

// ListAssets: GET /api/assets (admin,staff). server/routes/assets.routes.js:16-21
func (h *Handlers) ListAssets(c *gin.Context) {
	rows, err := h.pool().Query(c.Request.Context(), "SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY category DESC, sort, id")
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

// CreateAsset: POST /api/assets (admin). server/routes/assets.routes.js:23-39
func (h *Handlers) CreateAsset(c *gin.Context) {
	var b assetBody
	_ = c.ShouldBindJSON(&b)
	if strings.TrimSpace(b.Name) == "" {
		badRequest(c, "Nhập tên tài sản")
		return
	}
	q, qe := intGteZero(b.Quantity, 1, "Số lượng")
	if qe != "" {
		badRequest(c, qe)
		return
	}
	f, fe := intGteZero(b.Fee, 0, "Phí bồi hoàn")
	if fe != "" {
		badRequest(c, fe)
		return
	}
	ctx := c.Request.Context()
	var one int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM assets WHERE deleted_at IS NULL AND lower(btrim(name))=lower(btrim($1))`, b.Name).Scan(&one) == nil {
		badRequest(c, `Tài sản "`+strings.TrimSpace(b.Name)+`" đã có trong danh mục`)
		return
	}
	unit := b.Unit
	if unit == "" {
		unit = "Cái"
	}
	rows, err := h.pool().Query(ctx,
		"INSERT INTO assets (name, unit, category, quantity, fee, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
		strings.TrimSpace(b.Name), unit, normCategory(b.Category), q, f, b.Note)
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

// UpdateAsset: PUT /api/assets/:id (admin). server/routes/assets.routes.js:41-58
func (h *Handlers) UpdateAsset(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy tài sản (hoặc đã bị xoá)")
		return
	}
	var b assetBody
	_ = c.ShouldBindJSON(&b)
	if strings.TrimSpace(b.Name) == "" {
		badRequest(c, "Nhập tên tài sản")
		return
	}
	q, qe := intGteZero(b.Quantity, 1, "Số lượng")
	if qe != "" {
		badRequest(c, qe)
		return
	}
	f, fe := intGteZero(b.Fee, 0, "Phí bồi hoàn")
	if fe != "" {
		badRequest(c, fe)
		return
	}
	ctx := c.Request.Context()
	var one int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM assets WHERE deleted_at IS NULL AND id<>$2 AND lower(btrim(name))=lower(btrim($1))`, b.Name, id).Scan(&one) == nil {
		badRequest(c, `Tài sản "`+strings.TrimSpace(b.Name)+`" đã có trong danh mục`)
		return
	}
	unit := b.Unit
	if unit == "" {
		unit = "Cái"
	}
	rows, err := h.pool().Query(ctx,
		`UPDATE assets SET name=$1, unit=$2, category=$3, quantity=$4, fee=$5, note=$6
		 WHERE id=$7 AND deleted_at IS NULL RETURNING *`,
		strings.TrimSpace(b.Name), unit, normCategory(b.Category), q, f, b.Note, id)
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
		notFound(c, "Không tìm thấy tài sản (hoặc đã bị xoá)")
		return
	}
	c.JSON(http.StatusOK, row)
}

// DeleteAsset: DELETE /api/assets/:id (admin) — xoá mềm. server/routes/assets.routes.js:61-67
func (h *Handlers) DeleteAsset(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy tài sản (hoặc đã bị xoá)")
		return
	}
	var name string
	err := h.pool().QueryRow(c.Request.Context(),
		"UPDATE assets SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING name", id).Scan(&name)
	if err != nil {
		notFound(c, "Không tìm thấy tài sản (hoặc đã bị xoá)")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "deleted": name})
}

// RestoreAsset: POST /api/assets/:id/restore (admin). server/routes/assets.routes.js:70-79
func (h *Handlers) RestoreAsset(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy tài sản đã xoá")
		return
	}
	ctx := c.Request.Context()
	rows, err := h.pool().Query(ctx, "UPDATE assets SET deleted_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *", id)
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
		notFound(c, "Không tìm thấy tài sản đã xoá")
		return
	}
	name, _ := row["name"].(string)
	var one int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM assets WHERE deleted_at IS NULL AND id<>$2 AND lower(btrim(name))=lower(btrim($1))`, name, id).Scan(&one) == nil {
		_, _ = h.pool().Exec(ctx, "UPDATE assets SET deleted_at=now() WHERE id=$1", id)
		badRequest(c, `Đã có tài sản "`+name+`" trong danh mục — không khôi phục để tránh trùng.`)
		return
	}
	c.JSON(http.StatusOK, row)
}
