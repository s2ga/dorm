package handlers

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"ktx/internal/db"
	"ktx/internal/storage"
)

// Handler ảnh giới thiệu + nội quy PDF (bảng media, lưu S3). Port từ server/routes/media.routes.js. Chỉ admin.

var mediaKeys = []string{"hero", "khuon-vien-1", "khuon-vien-2", "khuon-vien-3", "phong-1", "phong-2", "phong-3"}
var docKeys = []string{"noi-quy"}
var reImagePrefix = regexp.MustCompile(`^data:image/[\w.+-]+;base64,`)

func mediaInList(k string, lists ...[]string) bool {
	for _, l := range lists {
		for _, x := range l {
			if x == k {
				return true
			}
		}
	}
	return false
}

func (h *Handlers) storeOr501(c *gin.Context) bool {
	if h.Store == nil {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "Chức năng đang chuyển đổi"})
		return false
	}
	return true
}

// ListMedia: GET /api/media. server/routes/media.routes.js:14-20
func (h *Handlers) ListMedia(c *gin.Context) {
	rows, err := h.pool().Query(c.Request.Context(), "SELECT key, updated_at FROM media")
	if err != nil {
		serverErr(c)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	set := map[string]interface{}{}
	for _, r := range list {
		set[strOf(r["key"])] = r["updated_at"]
	}
	out := []gin.H{}
	for _, key := range append(append([]string{}, mediaKeys...), docKeys...) {
		ua, ok := set[key]
		out = append(out, gin.H{"key": key, "uploaded": ok, "updated_at": nilIfMissing(ua, ok)})
	}
	c.JSON(http.StatusOK, out)
}

func nilIfMissing(v interface{}, ok bool) interface{} {
	if !ok {
		return nil
	}
	return v
}

// UploadDoc: POST /api/media/doc/:key (PDF). server/routes/media.routes.js:24-45
func (h *Handlers) UploadDoc(c *gin.Context) {
	if !h.storeOr501(c) {
		return
	}
	key := c.Param("key")
	if !mediaInList(key, docKeys) {
		badRequest(c, "Khóa tài liệu không hợp lệ")
		return
	}
	var body struct {
		Data string `json:"data"`
	}
	_ = c.ShouldBindJSON(&body)
	if !strings.HasPrefix(body.Data, "data:application/pdf;base64,") {
		badRequest(c, "Chỉ nhận file PDF")
		return
	}
	// Chuỗi base64 phồng ~4/3 so với tệp gốc: 34MB chuỗi ≈ 25MB tệp (owner chốt 12/08/2026).
	if len(body.Data) > 34*1024*1024 {
		badRequest(c, "File PDF quá lớn (tối đa 25MB). Vui lòng nén lại rồi tải lên.")
		return
	}
	if storage.ParsePdfDataUrl(body.Data) == nil {
		badRequest(c, "Tệp không phải PDF thật (sai chữ ký file)")
		return
	}
	ctx := c.Request.Context()
	objectKey := key + ".pdf"
	if _, err := h.Store.PutPdfDataUrl(ctx, h.Store.IntroBucket, objectKey, body.Data); err != nil {
		handleStorageErr(c, err)
		return
	}
	if _, err := h.pool().Exec(ctx,
		`INSERT INTO media (key, path, data, updated_at) VALUES ($1,$2,NULL,now())
		 ON CONFLICT (key) DO UPDATE SET path=EXCLUDED.path, data=NULL, updated_at=now()`, key, objectKey); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// UploadMedia: POST /api/media/:key (ảnh). server/routes/media.routes.js:48-73
func (h *Handlers) UploadMedia(c *gin.Context) {
	if !h.storeOr501(c) {
		return
	}
	key := c.Param("key")
	if !mediaInList(key, mediaKeys) {
		badRequest(c, "Khóa ảnh không hợp lệ")
		return
	}
	var body struct {
		Data string `json:"data"`
	}
	_ = c.ShouldBindJSON(&body)
	if !reImagePrefix.MatchString(body.Data) {
		badRequest(c, "Ảnh không hợp lệ")
		return
	}
	if len(body.Data) > 34*1024*1024 {
		badRequest(c, "Ảnh quá lớn (tối đa 25MB)")
		return
	}
	p := storage.ParseDataUrl(body.Data)
	if p == nil {
		badRequest(c, "Tệp không phải ảnh thật (sai chữ ký file) — chỉ nhận JPG, PNG, WEBP, GIF.")
		return
	}
	ctx := c.Request.Context()
	objectKey := key + "." + p.Ext
	var oldPath *string
	_ = h.pool().QueryRow(ctx, "SELECT path FROM media WHERE key=$1", key).Scan(&oldPath)
	if _, err := h.Store.PutDataUrl(ctx, h.Store.IntroBucket, objectKey, body.Data); err != nil {
		handleStorageErr(c, err)
		return
	}
	if oldPath != nil && *oldPath != "" && *oldPath != objectKey {
		_ = h.Store.DeleteObject(ctx, h.Store.IntroBucket, *oldPath)
	}
	if _, err := h.pool().Exec(ctx,
		`INSERT INTO media (key, path, data, updated_at) VALUES ($1,$2,NULL,now())
		 ON CONFLICT (key) DO UPDATE SET path=EXCLUDED.path, data=NULL, updated_at=now()`, key, objectKey); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DeleteMedia: DELETE /api/media/:key. server/routes/media.routes.js:76-87
func (h *Handlers) DeleteMedia(c *gin.Context) {
	if !h.storeOr501(c) {
		return
	}
	key := c.Param("key")
	if !mediaInList(key, mediaKeys, docKeys) {
		badRequest(c, "Khóa không hợp lệ")
		return
	}
	ctx := c.Request.Context()
	var path *string
	if err := h.pool().QueryRow(ctx, "SELECT path FROM media WHERE key=$1", key).Scan(&path); err != nil {
		notFound(c, "Không có gì để xoá (ảnh này chưa được tải lên).")
		return
	}
	if path != nil && *path != "" {
		_ = h.Store.DeleteObject(ctx, h.Store.IntroBucket, *path)
	}
	if _, err := h.pool().Exec(ctx, "DELETE FROM media WHERE key=$1", key); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func handleStorageErr(c *gin.Context, err error) {
	var he *storage.HTTPError
	if errors.As(err, &he) {
		c.JSON(he.Status, gin.H{"error": he.Msg})
		return
	}
	serverErr(c)
}
