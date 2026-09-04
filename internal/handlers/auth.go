package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"ktx/internal/auth"
	"ktx/internal/loginguard"
	"ktx/internal/valid"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// msgTaiKhoanBiKhoa: câu trả lời DUY NHẤT cho tài khoản đã bị khoá (đăng nhập thường và SSO dùng
// chung). Khoá là "đóng cửa", không phải "chờ duyệt" — nói đúng để người dùng biết đường liên hệ,
// và tuyệt đối KHÔNG cấp vé phiên.
const msgTaiKhoanBiKhoa = "Tài khoản đang không đăng nhập được. Vui lòng liên hệ ban quản lý khu nội trú."

type loginUser struct {
	ID           int
	Username     string
	PasswordHash *string
	Role         string
	FullName     string
	StudentID    *int
	FacilityID   *int
	MustChange   bool
	TokenEpoch   int
	Approved     bool
	Email        *string
	AuthProvider *string
	Locked       bool // deleted_at IS NOT NULL -> đã bị khoá (deactive), không cho vào
}

func (h *Handlers) loadLoginUser(c *gin.Context, username string) (*loginUser, error) {
	var u loginUser
	// KHÔNG lọc deleted_at: tài khoản bị khoá vẫn phải nạp được để trả 403 "đã bị khoá" thay vì 401.
	// ORDER BY đưa hàng còn hiệu lực lên trước — lower(username) có thể khớp 2 hàng vì
	// uq_users_username_ci chỉ ràng buộc hàng chưa khoá ("nv01" đã khoá và "NV01" đang dùng sống chung).
	err := h.pool().QueryRow(c.Request.Context(),
		`SELECT id, username, password_hash, role, full_name, student_id, facility_id,
		        must_change_password, token_epoch, approved, email, auth_provider,
		        (deleted_at IS NOT NULL) AS locked
		 FROM users WHERE lower(username) = lower($1)
		 ORDER BY (deleted_at IS NOT NULL), id LIMIT 1`, username).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.FullName, &u.StudentID, &u.FacilityID,
			&u.MustChange, &u.TokenEpoch, &u.Approved, &u.Email, &u.AuthProvider, &u.Locked)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// Login: POST /api/auth/login — xác thực + đặt cookie, KHÔNG trả token/user. server/routes/auth.routes.js:31-82
func (h *Handlers) Login(c *gin.Context) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	_ = c.ShouldBindJSON(&body) // field lạ (portal…) bị bỏ qua; body hỏng -> username rỗng -> 400 dưới
	username, password := body.Username, body.Password
	if username == "" || password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Nhập tên đăng nhập và mật khẩu"})
		return
	}
	now := time.Now().UnixMilli()

	if khoa, conLai := h.Guard.TruocKhiThu(c.Request.Context(), username, now); khoa {
		phut := (conLai + 59) / 60
		loginLog(h, c, nil, trimSpace(username), "", "bị khoá (đang trong thời gian khoá)")
		c.JSON(http.StatusTooManyRequests, gin.H{"error": fmt.Sprintf("Tài khoản tạm khoá do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau %d phút.", phut)})
		return
	}

	user, err := h.loadLoginUser(c, trimSpace(username))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi máy chủ"})
		return
	}

	// SSO thuần (không có mật khẩu) -> câu lỗi CHUNG với sai mật khẩu (không lộ tài khoản dùng SSO)
	if user != nil && user.PasswordHash == nil {
		h.Guard.GhiNhanKetQua(c.Request.Context(), username, false, now)
		loginLog(h, c, &user.ID, user.Username, user.Role, "tài khoản chỉ đăng nhập bằng Microsoft (không có mật khẩu)")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Sai tên đăng nhập hoặc mật khẩu"})
		return
	}

	if user == nil || bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(password)) != nil {
		khoaMoi := h.Guard.GhiNhanKetQua(c.Request.Context(), username, false, now)
		var uid *int
		var uname, urole string
		if user != nil {
			uid, uname, urole = &user.ID, user.Username, user.Role
		} else {
			uname = trimSpace(username)
		}
		ket := "SAI mật khẩu"
		if khoaMoi {
			ket = "SAI mật khẩu — vượt ngưỡng, KHOÁ tài khoản"
		}
		loginLog(h, c, uid, uname, urole, ket)
		if khoaMoi {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": fmt.Sprintf("Đăng nhập sai quá nhiều lần. Tài khoản tạm khoá %d phút để bảo vệ.", loginguard.KhoaMs/60000)})
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Sai tên đăng nhập hoặc mật khẩu"})
		return
	}

	// TÀI KHOẢN BỊ KHOÁ -> 403, không cấp vé. Đặt SAU khi so mật khẩu để câu trả lời này không thành
	// máy dò "tài khoản nào có thật" (mật khẩu sai vẫn là 401 chung như mọi trường hợp khác).
	// Mật khẩu ĐÚNG nên KHÔNG tính là lần thử sai -> đừng cộng vào bộ đếm chống dò mật khẩu.
	if user.Locked {
		h.Guard.GhiNhanKetQua(c.Request.Context(), username, true, now)
		loginLog(h, c, &user.ID, user.Username, user.Role, "tài khoản đã bị KHOÁ")
		c.JSON(http.StatusForbidden, gin.H{"error": msgTaiKhoanBiKhoa})
		return
	}

	// Học viên đã bị KHOÁ hồ sơ -> cũng là cửa đóng, trả 403 cùng câu với khoá tài khoản
	if user.Role == "student" && user.StudentID != nil {
		var one int
		if h.pool().QueryRow(c.Request.Context(), "SELECT 1 FROM students WHERE id=$1 AND deleted_at IS NULL", *user.StudentID).Scan(&one) != nil {
			h.Guard.GhiNhanKetQua(c.Request.Context(), username, true, now)
			loginLog(h, c, &user.ID, user.Username, user.Role, "hồ sơ học viên đã bị KHOÁ")
			c.JSON(http.StatusForbidden, gin.H{"error": msgTaiKhoanBiKhoa})
			return
		}
	}

	// SSO tự tạo, chưa duyệt
	if !user.Approved {
		h.Guard.GhiNhanKetQua(c.Request.Context(), username, true, now)
		loginLog(h, c, &user.ID, user.Username, user.Role, "tài khoản chờ admin duyệt")
		c.JSON(http.StatusForbidden, gin.H{"error": "Tài khoản đang chờ quản trị viên duyệt. Vui lòng liên hệ ban quản lý."})
		return
	}

	h.Guard.GhiNhanKetQua(c.Request.Context(), username, true, now)
	loginLog(h, c, &user.ID, user.Username, user.Role, "đăng nhập thành công")
	token, err := h.Auth.SignToken(user.ID, user.Username, user.Role, user.StudentID, user.TokenEpoch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi máy chủ"})
		return
	}
	h.Auth.SetAuthCookie(c, token)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Logout: POST /api/auth/logout — chỉ xoá cookie của THIẾT BỊ NÀY. Truyền all=true để thu hồi vé
// ở cấp tài khoản (đá mọi thiết bị). server/routes/auth.routes.js:86-93
func (h *Handlers) Logout(c *gin.Context) {
	var b struct {
		All *bool `json:"all"`
	}
	_ = c.ShouldBindJSON(&b)
	if b.All != nil && *b.All {
		if t := h.Auth.ReadToken(c); t != "" {
			if id, ok := h.Auth.TokenUserID(t); ok {
				_ = h.Auth.RevokeTokens(c.Request.Context(), id)
			}
		}
	}
	h.Auth.ClearAuthCookie(c)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Me: GET /api/auth/me — thông tin người đang đăng nhập. server/routes/auth.routes.js:96-102
func (h *Handlers) Me(c *gin.Context) {
	u := auth.CurrentUser(c)
	var (
		id                   int
		username, role       string
		fullName             string
		studentID, facID     *int
		mustChange, approved bool
		email, authProvider  *string
	)
	err := h.pool().QueryRow(c.Request.Context(),
		`SELECT id, username, role, full_name, student_id, facility_id, must_change_password, email, auth_provider, approved
		 FROM users WHERE id = $1`, u.ID).
		Scan(&id, &username, &role, &fullName, &studentID, &facID, &mustChange, &email, &authProvider, &approved)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Tài khoản không tồn tại"})
		return
	}
	c.JSON(http.StatusOK, publicUser(id, username, role, fullName, studentID, facID, mustChange, email, authProvider, approved))
}

// publicUser: shape /auth/me + /login từng trả. server/routes/auth.routes.js:13-23
func publicUser(id int, username, role, fullName string, studentID, facID *int, mustChange bool, email, authProvider *string, approved bool) gin.H {
	ap := "local"
	if authProvider != nil && *authProvider != "" {
		ap = *authProvider
	}
	var em interface{}
	if email != nil && *email != "" {
		em = *email
	}
	var fid interface{}
	if facID != nil {
		fid = *facID
	}
	var sid interface{}
	if studentID != nil {
		sid = *studentID
	}
	return gin.H{
		"id": id, "username": username, "role": role, "full_name": fullName,
		"student_id": sid, "must_change_password": mustChange,
		"facility_id": fid, "email": em, "auth_provider": ap, "approved": approved,
	}
}

// ChangePassword: POST /api/auth/change-password. server/routes/auth.routes.js:105-126
// NỚI LỎNG 23/07/2026 (chốt owner): KHÔNG còn đòi mật khẩu cũ. Người gọi đã xác thực bằng cookie
// ktx_token; lần đổi BẮT BUỘC thì vừa đăng nhập bằng mật khẩu khởi tạo xong nên hỏi lại là thừa.
// Vẫn chặn đặt LẠI y hệt mật khẩu hiện tại để lần đổi bắt buộc thực sự thay đổi (chỉ khi có mật khẩu).
func (h *Handlers) ChangePassword(c *gin.Context) {
	u := auth.CurrentUser(c)
	var body struct {
		NewPassword string `json:"newPassword"`
	}
	_ = c.ShouldBindJSON(&body)

	if loiMk := valid.CheckPassword(body.NewPassword, nil); loiMk != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": loiMk})
		return
	}

	var curHash *string
	if err := h.pool().QueryRow(c.Request.Context(),
		"SELECT password_hash FROM users WHERE id = $1", u.ID).Scan(&curHash); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi máy chủ"})
		return
	}
	if curHash != nil && bcrypt.CompareHashAndPassword([]byte(*curHash), []byte(body.NewPassword)) == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mật khẩu mới phải khác mật khẩu hiện tại"})
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), 10)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi máy chủ"})
		return
	}
	if _, err := h.pool().Exec(c.Request.Context(),
		"UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2", string(newHash), u.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi máy chủ"})
		return
	}
	_ = h.Auth.RevokeTokens(c.Request.Context(), u.ID)

	var fid int
	var uname, role string
	var sid *int
	var epoch int
	if err := h.pool().QueryRow(c.Request.Context(),
		"SELECT id, username, role, student_id, token_epoch FROM users WHERE id=$1", u.ID).
		Scan(&fid, &uname, &role, &sid, &epoch); err == nil {
		if token, e := h.Auth.SignToken(fid, uname, role, sid, epoch); e == nil {
			h.Auth.SetAuthCookie(c, token)
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// SSOConfig: GET /api/auth/sso/config — chỉ trả {enabled}. server/routes/auth.routes.js:136-139
func (h *Handlers) SSOConfig(c *gin.Context) {
	cfg := h.SSO.Config(c.Request.Context())
	// CHỈ trả cờ bật/tắt. KHÔNG kèm tenantId/clientId: endpoint này mở cho khách chưa đăng nhập, trả
	// thêm là ai cũng đọc được tenant + client của công ty chỉ bằng một request, không cần tài khoản.
	// Trình duyệt cũng không cần chúng nữa — yêu cầu uỷ quyền do MÁY CHỦ dựng (SSOStart) rồi 302 đi.
	c.JSON(http.StatusOK, gin.H{"enabled": cfg.Enabled})
}

func trimSpace(s string) string {
	i, j := 0, len(s)
	for i < j && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r') {
		i++
	}
	for j > i && (s[j-1] == ' ' || s[j-1] == '\t' || s[j-1] == '\n' || s[j-1] == '\r') {
		j--
	}
	return s[i:j]
}
