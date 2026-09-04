package middleware

import (
	"bytes"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// bodyCapture giữ TỐI ĐA ~2KB đầu của phản hồi (đủ cho thông điệp lỗi) để log khi request lỗi —
// không nhân đôi payload lớn (vd danh sách học viên ~187KB).
type bodyCapture struct {
	gin.ResponseWriter
	buf *bytes.Buffer
}

func (w *bodyCapture) Write(b []byte) (int, error) {
	if w.buf.Len() < 2048 {
		w.buf.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

// RequestLog: log MỖI request /api ra stderr (Render/Docker bắt được) để CÒN BIẾT ĐƯỜNG DEBUG:
// method, path, status, thời gian, IP. Request lỗi (>=400) log KÈM nội dung phản hồi (thông điệp lỗi
// thật) — không phải mò qua giao diện nữa. Bỏ qua /api/health cho đỡ ồn.
func RequestLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		if !strings.HasPrefix(p, "/api/") || p == "/api/health" {
			c.Next()
			return
		}
		start := time.Now()
		bw := &bodyCapture{ResponseWriter: c.Writer, buf: &bytes.Buffer{}}
		c.Writer = bw
		c.Next()
		st := c.Writer.Status()
		line := fmt.Sprintf("%s %s -> %d (%dms) ip=%s", c.Request.Method, p, st, time.Since(start).Milliseconds(), c.ClientIP())
		if st >= 400 {
			if body := strings.TrimSpace(bw.buf.String()); body != "" {
				line += " | " + body
			}
		}
		log.Println(line)
	}
}
