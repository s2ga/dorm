// Package middleware — các middleware cross-cutting cho gin, port từ server/index.js.
package middleware

import "github.com/gin-gonic/gin"

// CSP + header bảo mật, khớp cấu hình helmet ở server/index.js:22-41.
// scriptSrc CHỈ 'self' (không unsafe-inline) — frontend đã bỏ hết inline on* (event delegation).
const csp = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src 'self' https://fonts.gstatic.com data:; " +
	"img-src 'self' data: blob: https:; " +
	"connect-src 'self' https://login.microsoftonline.com; " + // SSO SPA: trình duyệt đổi mã ở token endpoint MS

	"frame-src 'self' https://www.google.com; " + // 'self': xem trước PDF nội quy ngay trong Cài đặt

	"object-src 'none'; " +
	"base-uri 'self'; " +
	// 'self' (KHÔNG phải 'none'): trang của chính app được nhúng tài nguyên cùng nguồn — cần cho khung
	// xem trước PDF nội quy trong Cài đặt (header CSP này áp cho MỌI response, kể cả file PDF, nên
	// 'none' làm trình duyệt chặn render nội dung dù iframe đã tải). Web ngoài vẫn KHÔNG nhúng được
	// (khớp X-Frame-Options: SAMEORIGIN) -> chống clickjacking vẫn còn.
	"frame-ancestors 'self'; " +
	"form-action 'self'"

// Security đặt CSP + các header helmet mặc định quan trọng.
func Security() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-DNS-Prefetch-Control", "off")
		h.Set("Strict-Transport-Security", "max-age=15552000; includeSubDomains")
		c.Next()
	}
}
