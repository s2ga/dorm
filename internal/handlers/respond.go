package handlers

import (
	"errors"
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

// bindJSONLoi: phân loại lỗi đọc body JSON — quá lớn (413) hay hỏng/sai kiểu (400). Không nuốt lỗi
// rồi chạy tiếp với thân rỗng, vì người gửi sẽ nhận thông điệp sai chỗ ("Vui lòng nhập họ tên").
func bindJSONLoi(err error) (int, string) {
	var qua *http.MaxBytesError
	if errors.As(err, &qua) {
		return http.StatusRequestEntityTooLarge, "Dữ liệu gửi lên quá lớn — ảnh CCCD quá nặng. Chụp lại ảnh nhẹ hơn rồi gửi lại."
	}
	return http.StatusBadRequest, "Dữ liệu gửi lên không đọc được. Tải lại trang rồi gửi lại."
}

// paramInt đọc tham số :id dạng số nguyên. CHỈ nhận chữ số (BL-105): Atoi còn nhận "+12", trong khi
// rào cơ sở kiểm bằng studentsIsDigits — hai mức khoan dung lệch nhau chính là cửa vượt rào.
func paramInt(c *gin.Context, name string) (int, bool) {
	s := c.Param(name)
	if !studentsIsDigits(s) {
		return 0, false
	}
	n, err := strconv.Atoi(s)
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
