package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
	"golang.org/x/text/unicode/norm"
	"ktx/internal/sso"
)

// Handler SSO Microsoft (start/callback). Port từ server/routes/auth.routes.js:148-216 + sso.js.

// errTaiKhoanBiKhoa: danh tính Microsoft xác thực THÀNH CÔNG nhưng tài khoản trong app đang bị khoá.
// Không phải lỗi hệ thống, cũng không phải "chưa có tài khoản" -> trả 403 với msgTaiKhoanBiKhoa.
var errTaiKhoanBiKhoa = errors.New("tài khoản đã bị khoá")

// ssoRedirectURI: Microsoft trả người dùng về ORIGIN của app (path "/"), vì trình duyệt mới là bên đổi
// mã. SSO_REDIRECT_URI vẫn đọc nhưng chỉ lấy scheme+host (sau proxy Render đôi khi đoán sai), path luôn
// ép về "/" cho khớp URI đã khai trên Azure.
func (h *Handlers) ssoRedirectURI(c *gin.Context) string {
	if v := strings.TrimSpace(os.Getenv("SSO_REDIRECT_URI")); v != "" {
		if u, err := url.Parse(v); err == nil && u.Scheme != "" && u.Host != "" {
			return u.Scheme + "://" + u.Host + "/"
		}
	}
	proto := c.GetHeader("X-Forwarded-Proto")
	if proto == "" {
		if c.Request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	proto = strings.TrimSpace(strings.Split(proto, ",")[0])
	return proto + "://" + c.Request.Host + "/"
}

// SSOExchangeParams: POST /api/auth/sso/exchange-params — phát tenant/client/code_verifier cho trình
// duyệt tự đổi mã. Chỉ trả lời khi cookie ktx_sso hợp lệ và state khớp; khách gõ tay không lấy được gì.
func (h *Handlers) SSOExchangeParams(c *gin.Context) {
	var body struct {
		State string `json:"state"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.State) == "" {
		badRequest(c, "Thiếu state")
		return
	}
	ssoCookie, _ := c.Cookie(sso.StateCookie)
	p, err := h.SSO.ParamsForBrowserExchange(c.Request.Context(), ssoCookie, body.State)
	if err != nil {
		if he, ok := err.(*sso.HTTPError); ok {
			c.JSON(he.Status, gin.H{"error": he.Msg})
			return
		}
		serverErr(c)
		return
	}
	h.ssoClearCookie(c) // dùng một lần: mã uỷ quyền cũng chỉ đổi được một lần
	c.JSON(http.StatusOK, p)
}

func (h *Handlers) ssoClearCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sso.StateCookie, "", -1, "/api/auth/sso", "", h.Cfg.CookieSecure, true)
}

// SSOStart: GET /api/auth/sso/start -> 302 sang Microsoft. server/routes/auth.routes.js:148-160
func (h *Handlers) SSOStart(c *gin.Context) {
	urlStr, stateToken, err := h.SSO.BuildAuthRequest(c.Request.Context(), h.ssoRedirectURI(c))
	if err != nil {
		if he, ok := err.(*sso.HTTPError); ok && he.Status == 503 {
			c.String(http.StatusServiceUnavailable, "Đăng nhập Microsoft chưa được cấu hình.")
			return
		}
		serverErr(c)
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sso.StateCookie, stateToken, sso.StateTTLSec, "/api/auth/sso", "", h.Cfg.CookieSecure, true)
	c.Redirect(http.StatusFound, urlStr)
}

type ssoUser struct {
	ID         int
	Username   string
	Role       string
	StudentID  *int
	TokenEpoch int
	Approved   bool
}

func (h *Handlers) ssoLoadUser(ctx context.Context, whereClause string, arg interface{}) *ssoUser {
	var u ssoUser
	err := h.pool().QueryRow(ctx,
		"SELECT id, username, role, student_id, token_epoch, approved FROM users WHERE "+whereClause+" AND deleted_at IS NULL",
		arg).Scan(&u.ID, &u.Username, &u.Role, &u.StudentID, &u.TokenEpoch, &u.Approved)
	if err != nil {
		return nil
	}
	return &u
}

// SSOCallback: GET /api/auth/sso/callback. server/routes/auth.routes.js:164-216
func (h *Handlers) SSOCallback(c *gin.Context) {
	ctx := c.Request.Context()
	veTrang := func(msg string) {
		h.ssoClearCookie(c)
		c.Redirect(http.StatusFound, "/?sso_error="+url.QueryEscape(msg))
	}
	if c.Query("error") != "" {
		veTrang("Microsoft từ chối yêu cầu đăng nhập.")
		return
	}
	if c.Query("code") == "" {
		veTrang("Thiếu mã đăng nhập từ Microsoft.")
		return
	}
	ssoCookie, _ := c.Cookie(sso.StateCookie)
	identity, err := h.SSO.ExchangeAndVerify(ctx, ssoCookie, c.Query("code"), c.Query("state"))
	if err != nil {
		msg := "Không xác thực được với Microsoft."
		if he, ok := err.(*sso.HTTPError); ok {
			msg = he.Msg
		}
		veTrang(msg)
		return
	}

	user, e := h.ssoResolveUser(ctx, identity)
	if errors.Is(e, errTaiKhoanBiKhoa) {
		loginLog(h, c, nil, identity.Email, "", "đăng nhập Microsoft — tài khoản đã bị KHOÁ")
		veTrang(msgTaiKhoanBiKhoa) // về màn đăng nhập kèm lý do, KHÔNG cấp vé, KHÔNG mở khoá
		return
	}
	if e != nil {
		veTrang("Không tạo được tài khoản.")
		return
	}
	if user == nil {
		veTrang("Tài khoản không hợp lệ.")
		return
	}

	loginLog(h, c, &user.ID, user.Username, user.Role, "đăng nhập Microsoft")
	h.ssoClearCookie(c)
	// Cấp vé cho CẢ tài khoản đang chờ duyệt. Middleware pendingAllow chỉ cho tài khoản pending gọi
	// /me + /logout (mọi thứ khác 403), nên giao diện gọi được /me -> hiện màn "chờ duyệt"
	// (renderChoDuyet). Nếu KHÔNG cấp vé thì /me trả 401 "Chưa đăng nhập" -> người dùng bị bí, không
	// biết mình đã đăng nhập Microsoft xong và đang chờ duyệt.
	token, err := h.Auth.SignToken(user.ID, user.Username, user.Role, user.StudentID, user.TokenEpoch)
	if err != nil {
		veTrang("Lỗi cấp phiên.")
		return
	}
	h.Auth.SetAuthCookie(c, token)
	if !user.Approved {
		c.Redirect(http.StatusFound, "/?sso_pending=1")
		return
	}
	c.Redirect(http.StatusFound, "/")
}

// chuanHoaTen: đưa họ tên về dạng so sánh được — thường hoá, BỎ DẤU, gộp khoảng trắng thừa.
//
// Bỏ dấu vì dữ liệu thật lệch nhau ở đúng chỗ đó: tài khoản Microsoft ghi "ĐẶNG NGUYỄN PHƯƠNG THỦY"
// còn hồ sơ ghi "Đặng Nguyễn Phương Thuỷ" — cùng một người, khác vị trí dấu hỏi. So chặt theo dấu thì
// luật khớp tên gần như không bao giờ nổ. Nới ở đây an toàn vì tên KHÔNG đứng một mình: nó luôn đi
// kèm điều kiện mã học viên trùng email.
func chuanHoaTen(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "đ", "d")
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if unicode.Is(unicode.Mn, r) { // Mn = dấu thanh/dấu mũ tách ra sau khi phân rã
			continue
		}
		b.WriteRune(r)
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// ghepVaoHoSoHocVien: gắn danh tính Microsoft vào MỘT hồ sơ học viên đã xác định, rồi trả tài khoản
// dùng được ngay (approved=true, không qua hàng chờ). Dùng chung cho mọi luật tự ghép.
func (h *Handlers) ghepVaoHoSoHocVien(ctx context.Context, stID int, stName string, identity sso.Identity) (*ssoUser, error) {
	// Hồ sơ đã có tài khoản (admin từng cấp mật khẩu) -> LIÊN KẾT vào đúng tài khoản đó, tuyệt đối
	// không tạo bản thứ hai: users.student_id trùng nghĩa là học viên có 2 lối vào, thu hồi 1 cái vẫn
	// còn cái kia.
	var accID int
	var accLocked bool
	if h.pool().QueryRow(ctx, "SELECT id, (deleted_at IS NOT NULL) FROM users WHERE student_id = $1", stID).
		Scan(&accID, &accLocked) == nil {
		if accLocked {
			return nil, errTaiKhoanBiKhoa
		}
		if _, err := h.pool().Exec(ctx,
			`UPDATE users SET sso_subject = $1, email = $2,
			   auth_provider = CASE WHEN password_hash IS NULL THEN 'sso' ELSE 'both' END
			 WHERE id = $3`, identity.Subject, identity.Email, accID); err != nil {
			return nil, err
		}
		return h.ssoLoadUser(ctx, "id = $1", accID), nil
	}
	uname := identity.Email
	var taken int
	if h.pool().QueryRow(ctx, "SELECT 1 FROM users WHERE lower(username) = lower($1)", uname).Scan(&taken) == nil {
		uname = identity.Email + ":" + identity.Subject
	}
	ten := identity.FullName
	if ten == "" {
		ten = stName
	}
	var hvID int
	if e := h.pool().QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, email, student_id, sso_subject, auth_provider, approved)
		 VALUES ($1, NULL, 'student', $2, $3, $4, $5, 'sso', true) RETURNING id`,
		uname, ten, identity.Email, stID, identity.Subject).Scan(&hvID); e != nil {
		return nil, e
	}
	return h.ssoLoadUser(ctx, "id = $1", hvID), nil
}

// ssoResolveUser: từ danh tính Microsoft -> user trong CSDL. (1) khớp sso_subject; (2) khớp email ->
// liên kết; (3) chưa có -> tạo 'pending' chờ duyệt. Dùng chung cho callback (server-side) và verify (SPA).
// Tài khoản ĐÃ BỊ KHOÁ ở bước (1) hoặc (2) -> errTaiKhoanBiKhoa, KHÔNG mở lại và KHÔNG tạo bản mới.
func (h *Handlers) ssoResolveUser(ctx context.Context, identity sso.Identity) (*ssoUser, error) {
	// 1) Theo sso_subject — tìm KỂ CẢ hàng đã khoá: unique index (sso_subject, username) không loại trừ
	// deleted_at nên INSERT lại sẽ trùng khoá. Đang bị khoá thì DỪNG; mở khoá là việc của admin.
	var existID int
	var existLocked bool
	if h.pool().QueryRow(ctx, "SELECT id, (deleted_at IS NOT NULL) FROM users WHERE sso_subject = $1",
		identity.Subject).Scan(&existID, &existLocked) == nil {
		if existLocked {
			return nil, errTaiKhoanBiKhoa
		}
		if _, err := h.pool().Exec(ctx,
			`UPDATE users SET
			   email = $2,
			   full_name = CASE WHEN $3 <> '' THEN $3 ELSE full_name END,
			   auth_provider = CASE WHEN password_hash IS NULL THEN 'sso' ELSE 'both' END
			 WHERE id = $1`, existID, identity.Email, identity.FullName); err != nil {
			return nil, err
		}
		return h.ssoLoadUser(ctx, "id = $1", existID), nil
	}
	// 2) Theo email (tài khoản còn sống) -> liên kết lần đầu.
	if byEmail := h.ssoLoadUser(ctx, "lower(email) = lower($1)", identity.Email); byEmail != nil {
		_, _ = h.pool().Exec(ctx,
			`UPDATE users SET sso_subject = $1, auth_provider = CASE WHEN password_hash IS NULL THEN 'sso' ELSE 'both' END WHERE id = $2`,
			identity.Subject, byEmail.ID)
		return h.ssoLoadUser(ctx, "id = $1", byEmail.ID), nil
	}
	// 2b) Email khớp một tài khoản ĐANG BỊ KHOÁ (chưa từng liên kết SSO nên bước 1 không thấy) -> chặn.
	// Không có bước này thì bước 3 sẽ tạo một tài khoản 'pending' MỚI cho đúng con người vừa bị khoá:
	// khoá coi như vô nghĩa, danh sách chờ duyệt thì đầy bản trùng.
	var lockedByEmail int
	if h.pool().QueryRow(ctx,
		"SELECT 1 FROM users WHERE lower(email) = lower($1) AND deleted_at IS NOT NULL", identity.Email).
		Scan(&lockedByEmail) == nil {
		return nil, errTaiKhoanBiKhoa
	}
	// 2c-bis) MÔI TRƯỜNG THỬ (không phải production): mã học viên trùng phần trước @ của email VÀ họ tên
	// trùng -> ghép thẳng, bỏ qua hàng chờ duyệt.
	//
	// Vì sao chỉ ở môi trường thử: hai điều kiện này suy ra từ dữ liệu SẴN CÓ, không phải thứ admin
	// cố ý khai như students.email. Ở UAT nó tiết kiệm hàng trăm lượt bấm duyệt; ở production thì việc
	// một tài khoản tự gắn vào hồ sơ học viên phải có người thật xác nhận.
	//
	// Đòi CẢ HAI: chỉ mã thì trùng mã do nhập liệu vẫn ghép nhầm; chỉ tên thì trùng tên là chuyện
	// thường ở Việt Nam. Mã trùng nhiều hồ sơ -> BỎ QUA, không đoán (app có sẵn cảnh báo "Học viên
	// trùng mã" ở Tình trạng dữ liệu; đoán bừa lúc đó là ghép vào nhầm người).
	if h.Cfg == nil || !h.Cfg.LaProduction() {
		local := strings.ToLower(strings.TrimSpace(strings.SplitN(identity.Email, "@", 2)[0]))
		if local != "" && strings.TrimSpace(identity.FullName) != "" {
			rows, err := h.pool().Query(ctx,
				`SELECT id, name FROM students
				  WHERE deleted_at IS NULL AND btrim(code) <> '' AND lower(btrim(code)) = $1 LIMIT 2`, local)
			if err == nil {
				type ungVien struct {
					id  int
					ten string
				}
				var ds []ungVien
				for rows.Next() {
					var uv ungVien
					if rows.Scan(&uv.id, &uv.ten) == nil {
						ds = append(ds, uv)
					}
				}
				rows.Close()
				if len(ds) == 1 && chuanHoaTen(ds[0].ten) == chuanHoaTen(identity.FullName) {
					return h.ghepVaoHoSoHocVien(ctx, ds[0].id, ds[0].ten, identity)
				}
			}
		}
	}
	// 2c) Email khớp một HỒ SƠ HỌC VIÊN -> vào thẳng cổng học viên, KHÔNG qua hàng chờ duyệt.
	// Lý do students.email tồn tại: học viên đông gấp nhiều lần nhân viên, bắt admin duyệt tay từng
	// người thì đến đợt nhập học hàng chờ ngập, ai cũng đứng ngoài cổng.
	var stID int
	var stName string
	if h.pool().QueryRow(ctx,
		"SELECT id, name FROM students WHERE email <> '' AND lower(email) = lower($1)", identity.Email).
		Scan(&stID, &stName) == nil {
		return h.ghepVaoHoSoHocVien(ctx, stID, stName, identity)
	}
	// 3) Chưa có -> tạo 'pending'. Nếu username (email) đã bị một tài khoản khác dùng (kể cả đã xoá mềm)
	// thì né bằng hậu tố để KHÔNG 500 vì trùng username.
	fullName := identity.FullName
	if fullName == "" {
		fullName = identity.Email
	}
	uname := identity.Email
	var taken int
	if h.pool().QueryRow(ctx, "SELECT 1 FROM users WHERE lower(username) = lower($1)", uname).Scan(&taken) == nil {
		uname = identity.Email + ":" + identity.Subject
	}
	var newID int
	if e := h.pool().QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, email, sso_subject, auth_provider, approved)
		 VALUES ($1, NULL, 'pending', $2, $3, $4, 'sso', false) RETURNING id`,
		uname, fullName, identity.Email, identity.Subject).Scan(&newID); e != nil {
		return nil, e
	}
	return h.ssoLoadUser(ctx, "id = $1", newID), nil
}

// SSOVerify: POST /api/auth/sso/verify {id_token} — LUỒNG SPA (không secret). Trình duyệt tự đổi mã ở
// Microsoft bằng PKCE rồi gửi id_token về đây; server KIỂM (JWKS) + tìm/tạo user + CẤP COOKIE PHIÊN
// ktx_token. Token Microsoft chỉ dùng MỘT LẦN để xác minh danh tính — mọi API sau đó dùng cookie của
// app (thu hồi/khoá tức thì qua token_epoch + đọc DB mỗi request), KHÔNG phụ thuộc hạn token Microsoft.
func (h *Handlers) SSOVerify(c *gin.Context) {
	ctx := c.Request.Context()
	var body struct {
		IDToken string `json:"id_token"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.IDToken) == "" {
		badRequest(c, "Thiếu id_token")
		return
	}
	identity, err := h.SSO.VerifyIDToken(ctx, body.IDToken, "") // nonce đã kiểm phía trình duyệt
	if err != nil {
		if he, ok := err.(*sso.HTTPError); ok {
			c.JSON(he.Status, gin.H{"error": he.Msg})
			return
		}
		serverErr(c)
		return
	}
	user, e := h.ssoResolveUser(ctx, identity)
	if errors.Is(e, errTaiKhoanBiKhoa) {
		loginLog(h, c, nil, identity.Email, "", "đăng nhập Microsoft — tài khoản đã bị KHOÁ")
		c.JSON(http.StatusForbidden, gin.H{"error": msgTaiKhoanBiKhoa}) // 403: không cấp cookie phiên
		return
	}
	if e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Không tạo/khôi phục được tài khoản: " + e.Error()})
		return
	}
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Tài khoản không hợp lệ."})
		return
	}
	loginLog(h, c, &user.ID, user.Username, user.Role, "đăng nhập Microsoft")
	token, err := h.Auth.SignToken(user.ID, user.Username, user.Role, user.StudentID, user.TokenEpoch)
	if err != nil {
		serverErr(c)
		return
	}
	h.Auth.SetAuthCookie(c, token) // cấp vé cho CẢ pending (pendingAllow cho /me + /logout)
	c.JSON(http.StatusOK, gin.H{"ok": true, "pending": !user.Approved})
}
