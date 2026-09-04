package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"ktx/internal/auth"
)

// Audit: nhật ký thao tác. Ghi các request GHI (POST/PUT/DELETE/PATCH) + GET NHẠY CẢM (đọc CCCD /
// data-health / admin/audit). Bỏ /auth/* (login-guard tự ghi). server/index.js:82-130.
var (
	reRedact      = regexp.MustCompile(`(?i)password|cccd|image|data|smtp_pass|token`)
	writeMethods  = map[string]bool{"POST": true, "PUT": true, "DELETE": true, "PATCH": true}
)

func isSensitiveGetPath(p string) bool {
	lp := strings.ToLower(p)
	return strings.Contains(lp, "/cccd/") || strings.Contains(lp, "/data-health") || strings.Contains(lp, "/admin/audit")
}

func Audit(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		method := c.Request.Method
		apiPath := strings.TrimPrefix(c.Request.URL.Path, "/api") // tương đương req.path khi mount /api
		isWrite := writeMethods[method]
		isSensitiveGet := method == "GET" && isSensitiveGetPath(apiPath)
		if (!isWrite && !isSensitiveGet) || strings.HasPrefix(apiPath, "/auth/") {
			c.Next()
			return
		}

		var bodyBytes []byte
		if isWrite && c.Request.Body != nil {
			bodyBytes, _ = io.ReadAll(c.Request.Body)
			c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		}

		c.Next()

		status := c.Writer.Status()
		denied := status == 401 || status == 403

		var body map[string]interface{}
		if len(bodyBytes) > 0 {
			_ = json.Unmarshal(bodyBytes, &body)
		}
		if v, ok := body["preview"]; ok {
			if b, ok := v.(bool); ok && b {
				return // xem trước hoá đơn (ROLLBACK) -> không ghi
			}
		}

		u := auth.CurrentUser(c)
		if u == nil {
			hasToken := c.GetHeader("Authorization") != "" || strings.Contains(c.GetHeader("Cookie"), "ktx_token=")
			if !(denied && hasToken) {
				return
			}
		} else if !denied && status >= 400 {
			return // lỗi validate (không phải từ chối) -> bỏ cho đỡ nhiễu
		}

		// Dựng detail: redact + cắt chuỗi dài, thêm ip, gắn tag.
		red := map[string]interface{}{}
		for k, v := range body {
			if reRedact.MatchString(k) {
				red[k] = "***"
			} else if s, ok := v.(string); ok && len(s) > 100 {
				red[k] = s[:100] + "…"
			} else {
				red[k] = v
			}
		}
		red["ip"] = clientIPAudit(c)
		tag := ""
		if denied {
			tag = "[TỪ CHỐI " + itoaMW(status) + "] "
		} else if isSensitiveGet {
			tag = "[ĐỌC] "
		}
		detailJSON, _ := json.Marshal(red)
		detail := tag + string(detailJSON)
		if len(detail) > 460 {
			detail = detail[:460]
		}

		var userID *int
		username := "(chưa đăng nhập)"
		role := ""
		if u != nil {
			userID = &u.ID
			username = u.Username
			role = u.Role
		}
		path := c.Request.URL.Path
		// fire-and-forget (nhật ký hỏng không chặn request); context riêng vì req context đã đóng.
		go func() {
			_, _ = pool.Exec(context.Background(),
				"INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)",
				userID, username, role, method, path, detail)
		}()
	}
}

func clientIPAudit(c *gin.Context) string {
	ip := strings.TrimPrefix(c.ClientIP(), "::ffff:")
	if ip == "" {
		return "?"
	}
	return ip
}

func itoaMW(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
