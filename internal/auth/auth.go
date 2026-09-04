// Package auth — JWT (HS256) trong cookie httpOnly + cơ chế token_epoch thu hồi vé tức thì.
// Port từ server/auth.js. Nguyên tắc: vé CHỈ để biết "ai"; role/quyền HỎI LẠI DB mỗi request.
package auth

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	CookieName   = "ktx_token"
	cookieMaxAge = 30 * 24 * 3600 // 30 ngày (giây)
)

// Khi bắt buộc đổi mật khẩu: chỉ cho đúng 3 đường. server/auth.js:54
var mustChangeAllow = map[string]bool{
	"/api/auth/change-password": true, "/api/auth/logout": true, "/api/auth/me": true,
}

// Tài khoản SSO chờ duyệt: chỉ đủ để giao diện biết mình đang chờ và thoát ra. server/auth.js:56
var pendingAllow = map[string]bool{
	"/api/auth/logout": true, "/api/auth/me": true,
}

// User = req.user: danh tính đã xác thực gắn vào context.
type User struct {
	ID         int
	Username   string
	Role       string
	FullName   string
	StudentID  *int
	FacilityID *int
}

type Auth struct {
	secret       []byte
	cookieSecure bool
	pool         *pgxpool.Pool
}

func New(secret string, cookieSecure bool, pool *pgxpool.Pool) *Auth {
	return &Auth{secret: []byte(secret), cookieSecure: cookieSecure, pool: pool}
}

// SignToken: payload {id,username,role,student_id,tv=token_epoch}, HS256, 30 ngày. server/auth.js:13-19
func (a *Auth) SignToken(id int, username, role string, studentID *int, tokenEpoch int) (string, error) {
	var sid interface{}
	if studentID != nil {
		sid = *studentID
	}
	claims := jwt.MapClaims{
		"id": id, "username": username, "role": role, "student_id": sid, "tv": tokenEpoch,
		"exp": time.Now().Add(30 * 24 * time.Hour).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.secret)
}

type claims struct {
	ID int
	TV int
}

func (a *Auth) verify(tokenStr string) (*claims, error) {
	mc := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(tokenStr, mc, func(t *jwt.Token) (interface{}, error) {
		return a.secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, err
	}
	id, _ := mc["id"].(float64)
	tv, _ := mc["tv"].(float64)
	return &claims{ID: int(id), TV: int(tv)}, nil
}

// ReadToken: ưu tiên cookie ktx_token; fallback Authorization: Bearer. server/auth.js:31-37
func (a *Auth) ReadToken(c *gin.Context) string {
	if ck, err := c.Request.Cookie(CookieName); err == nil && ck.Value != "" {
		return ck.Value
	}
	h := c.GetHeader("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

// SetAuthCookie: httpOnly + SameSite=Lax + Secure theo ENV + 30 ngày. server/auth.js:40-48
func (a *Auth) SetAuthCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(CookieName, token, cookieMaxAge, "/", "", a.cookieSecure, true)
}

func (a *Auth) ClearAuthCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(CookieName, "", -1, "/", "", a.cookieSecure, true)
}

// RevokeTokens: tăng token_epoch -> vô hiệu mọi vé cũ ngay. server/auth.js:22-25
func (a *Auth) RevokeTokens(ctx context.Context, userID int) error {
	_, err := a.pool.Exec(ctx, "UPDATE users SET token_epoch = token_epoch + 1 WHERE id = $1", userID)
	return err
}

// Verify chỉ giải mã token, trả id (dùng ở logout để thu hồi mà không cần middleware).
func (a *Auth) TokenUserID(tokenStr string) (int, bool) {
	cl, err := a.verify(tokenStr)
	if err != nil {
		return 0, false
	}
	return cl.ID, true
}

const ctxUserKey = "ktx_user"

// RequireAuth: middleware xác thực + gắn User. server/auth.js:61-94
func (a *Auth) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := a.ReadToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Chưa đăng nhập"})
			return
		}
		cl, err := a.verify(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Phiên đăng nhập không hợp lệ hoặc đã hết hạn"})
			return
		}
		ctx := c.Request.Context()
		var (
			id                         int
			username, role, fullName   string
			studentID, facilityID      *int
			mustChange, approved       bool
			tokenEpoch                 int
		)
		err = a.pool.QueryRow(ctx,
			`SELECT id, username, role, full_name, student_id, facility_id, must_change_password, token_epoch, approved
			 FROM users WHERE id = $1 AND deleted_at IS NULL`, cl.ID).
			Scan(&id, &username, &role, &fullName, &studentID, &facilityID, &mustChange, &tokenEpoch, &approved)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Tài khoản không còn hiệu lực"})
			return
		}
		if cl.TV != tokenEpoch {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại."})
			return
		}
		if role == "student" && studentID != nil {
			var one int
			if a.pool.QueryRow(ctx, "SELECT 1 FROM students WHERE id=$1 AND deleted_at IS NULL", *studentID).Scan(&one) != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Tài khoản không còn hiệu lực"})
				return
			}
		}
		u := &User{ID: id, Username: username, Role: role, FullName: fullName, StudentID: studentID, FacilityID: facilityID}
		c.Set(ctxUserKey, u)

		path := c.Request.URL.Path
		if !approved && !pendingAllow[path] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Tài khoản đang chờ quản trị viên duyệt."})
			return
		}
		if mustChange && !mustChangeAllow[path] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Bạn phải đổi mật khẩu trước khi sử dụng hệ thống."})
			return
		}
		c.Next()
	}
}

// RequireRole: yêu cầu vai trò cụ thể. server/auth.js:97-104
func (a *Auth) RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u := CurrentUser(c)
		if u == nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Bạn không có quyền thực hiện thao tác này"})
			return
		}
		for _, r := range roles {
			if u.Role == r {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Bạn không có quyền thực hiện thao tác này"})
	}
}

// RequireStudentLink: cổng khách thuê mở theo LIÊN KẾT HỒ SƠ (users.student_id), không theo vai —
// nhân viên kiêm khách thuê phòng (role giữ nguyên, chỉ gắn thêm hồ sơ) vẫn vào được /me/*.
func (a *Auth) RequireStudentLink() gin.HandlerFunc {
	return func(c *gin.Context) {
		u := CurrentUser(c)
		if u == nil || u.StudentID == nil {
			// Cùng câu với meStudentID (handlers/me.go) để client hiển thị nhất quán.
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Tài khoản chưa được gắn với hồ sơ học viên. Vui lòng liên hệ ban quản lý."})
			return
		}
		c.Next()
	}
}

// CurrentUser lấy User đã xác thực từ context.
func CurrentUser(c *gin.Context) *User {
	if v, ok := c.Get(ctxUserKey); ok {
		if u, ok := v.(*User); ok {
			return u
		}
	}
	return nil
}
