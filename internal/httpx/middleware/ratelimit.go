package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// normIP: chuẩn hoá địa chỉ cho khoá rate-limit. IPv6 -> gộp về /64 (nhà mạng thường cấp nguyên một
// /64 cho mỗi thuê bao, nên xoay địa chỉ TRONG dải không được lách trần đếm). IPv4 giữ nguyên.
// BL-15: gin.ClientIP() trả IPv6 đầy đủ; nếu không gộp /64 thì máy IPv6 đổi hậu tố là ra khoá mới.
func normIP(ip string) string {
	addr := net.ParseIP(ip)
	if addr == nil {
		return ip // không parse được -> dùng nguyên chuỗi
	}
	if addr.To4() != nil {
		return ip // IPv4 (kể cả dạng ánh xạ) giữ nguyên
	}
	return addr.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// Limiter cửa sổ cố định (fixed-window) trong RAM, mô phỏng express-rate-limit.
type Limiter struct {
	windowMs int64
	max      int
	message  gin.H
	mu       sync.Mutex
	buckets  map[string]*bucket
}

type bucket struct {
	count   int
	resetAt int64
}

func NewLimiter(windowMs int64, max int, message string) *Limiter {
	return &Limiter{windowMs: windowMs, max: max, message: gin.H{"error": message}, buckets: map[string]*bucket{}}
}

// Handler giới hạn theo IP client.
func (l *Limiter) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		now := time.Now().UnixMilli()
		key := normIP(c.ClientIP())
		l.mu.Lock()
		b := l.buckets[key]
		if b == nil || now >= b.resetAt {
			b = &bucket{resetAt: now + l.windowMs}
			l.buckets[key] = b
		}
		if b.count >= l.max {
			l.mu.Unlock()
			c.AbortWithStatusJSON(http.StatusTooManyRequests, l.message)
			return
		}
		b.count++
		l.mu.Unlock()
		c.Next()
	}
}

// APILimiter: 600 req/phút/IP cho toàn bộ /api. server/index.js:50
func APILimiter() gin.HandlerFunc {
	return NewLimiter(60*1000, 600, "Quá nhiều yêu cầu, vui lòng thử lại sau ít phút.").Handler()
}

// ApplyLimiter: nộp đơn công khai — 10 req/phút/IP. server/index.js:72-75
func ApplyLimiter() gin.HandlerFunc {
	return NewLimiter(60*1000, 10, "Có quá nhiều đơn gửi lên cùng lúc từ mạng của bạn. Vui lòng đợi một phút rồi thử lại, hoặc gọi hotline để được hỗ trợ.").Handler()
}

// KeyedLimiter: limiter theo khoá tuỳ biến + tuỳ chọn bỏ đếm request THÀNH CÔNG (skipSuccessfulRequests).
type KeyedLimiter struct {
	windowMs    int64
	max         int
	skipSuccess bool
	message     gin.H
	keyFn       func(*gin.Context) string
	mu          sync.Mutex
	buckets     map[string]*bucket
}

func (l *KeyedLimiter) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := l.keyFn(c)
		now := time.Now().UnixMilli()
		l.mu.Lock()
		b := l.buckets[key]
		if b == nil || now >= b.resetAt {
			b = &bucket{resetAt: now + l.windowMs}
			l.buckets[key] = b
		}
		if b.count >= l.max {
			l.mu.Unlock()
			c.AbortWithStatusJSON(http.StatusTooManyRequests, l.message)
			return
		}
		b.count++
		l.mu.Unlock()

		c.Next()

		if l.skipSuccess && c.Writer.Status() < 400 {
			l.mu.Lock()
			if b2 := l.buckets[key]; b2 != nil && b2.count > 0 {
				b2.count--
			}
			l.mu.Unlock()
		}
	}
}

// SSOLimiter: đăng nhập Microsoft — 300 lượt/15 phút/IP, bỏ đếm lượt THÀNH CÔNG.
// Trần rộng vì ký túc xá và mạng 4G đều NAT nhiều người sau một IP.
func SSOLimiter() gin.HandlerFunc {
	l := &KeyedLimiter{
		windowMs: 15 * 60 * 1000, max: 300, skipSuccess: true,
		message: gin.H{"error": "Bạn đã thử đăng nhập Microsoft quá nhiều lần. Vui lòng đợi vài phút."},
		buckets: map[string]*bucket{},
		keyFn:   func(c *gin.Context) string { return normIP(c.ClientIP()) },
	}
	return l.Handler()
}

// AuthLimiter: chống dò mật khẩu — 20 lần/15 phút, KEY = IP|username, bỏ đếm lần ĐĂNG NHẬP ĐÚNG.
// server/index.js:58-63. (Rào THẬT theo tài khoản là login-guard; limiter này là net phụ.)
func AuthLimiter() gin.HandlerFunc {
	l := &KeyedLimiter{
		windowMs: 15 * 60 * 1000, max: 20, skipSuccess: true,
		message: gin.H{"error": "Đăng nhập sai quá nhiều lần với tài khoản này. Vui lòng đợi vài phút rồi thử lại."},
		buckets: map[string]*bucket{},
		keyFn: func(c *gin.Context) string {
			username := ""
			if c.Request.Body != nil {
				data, _ := io.ReadAll(c.Request.Body)
				c.Request.Body = io.NopCloser(bytes.NewReader(data))
				var m struct {
					Username string `json:"username"`
				}
				_ = json.Unmarshal(data, &m)
				username = strings.ToLower(strings.TrimSpace(m.Username))
			}
			return normIP(c.ClientIP()) + "|" + username
		},
	}
	return l.Handler()
}
