package handlers

import (
	"log"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func joinAnd(cond []string) string { return strings.Join(cond, " AND ") }
func itoa(n int) string            { return strconv.Itoa(n) }

// Helper phản hồi chuẩn — shape lỗi luôn {"error":"..."} khớp hợp đồng frontend (public/js/api.js:39).

func badRequest(c *gin.Context, msg string)  { c.JSON(http.StatusBadRequest, gin.H{"error": msg}) }
func notFound(c *gin.Context, msg string)     { c.JSON(http.StatusNotFound, gin.H{"error": msg}) }
func forbidden(c *gin.Context, msg string)    { c.JSON(http.StatusForbidden, gin.H{"error": msg}) }
// serverErr: 500 cho client + LOG ra stderr (nơi gọi + nguyên nhân nếu truyền). cause tuỳ chọn nên
// 383 chỗ gọi cũ `serverErr(c)` vẫn biên dịch; chỗ nào có err thì `serverErr(c, err)` để log lý do thật.
func serverErr(c *gin.Context, cause ...error) {
	_, file, line, _ := runtime.Caller(1)
	extra := ""
	if len(cause) > 0 && cause[0] != nil {
		extra = " | " + cause[0].Error()
	}
	log.Printf("[500] %s %s (%s:%d)%s", c.Request.Method, c.Request.URL.Path, filepath.Base(file), line, extra)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi máy chủ"})
}
func conflict(c *gin.Context, body gin.H)     { c.JSON(http.StatusConflict, body) }

// paramInt đọc tham số :id dạng số nguyên.
func paramInt(c *gin.Context, name string) (int, bool) {
	n, err := strconv.Atoi(c.Param(name))
	if err != nil {
		return 0, false
	}
	return n, true
}

// queryIntDefault đọc query số nguyên với giá trị mặc định.
func queryIntDefault(c *gin.Context, name string, def int) int {
	if v := c.Query(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
