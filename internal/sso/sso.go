// Package sso — đăng nhập Microsoft (OpenID Connect: Authorization Code + PKCE + state/nonce + verify RS256).
// Port từ server/sso.js. state/nonce/code_verifier gói trong JWT ngắn hạn ở cookie httpOnly ktx_sso (stateless).
package sso

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"ktx/internal/db"
)

const (
	StateCookie = "ktx_sso"
	StateTTLSec = 600 // 10 phút
)

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
func randBytes(n int) []byte {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return b
}

// HTTPError: lỗi có status cho handler.
type HTTPError struct {
	Status int
	Msg    string
}

func (e *HTTPError) Error() string { return e.Msg }

type Manager struct {
	secret []byte
	db     *db.DB
}

func NewManager(secret string, database *db.DB) *Manager {
	return &Manager{secret: []byte(secret), db: database}
}

type Config struct {
	Enabled        bool
	TenantID       string
	ClientID       string
	ClientSecret   string
	AllowedDomains []string
	FromEnv        bool // Tenant/Client đến từ ENV — màn Cài đặt không nhìn thấy, phải báo cho admin biết
}

// envMap2: chỉ ánh xạ THAM SỐ sang ENV (môi trường thật giữ bí mật ở ENV, không nằm trong CSDL).
// Cố ý KHÔNG có công tắc bật/tắt ở đây — xem ghi chú tại Config().
var envMap2 = map[string]string{
	"sso_tenant_id": "AZURE_TENANT_ID", "sso_client_id": "AZURE_CLIENT_ID",
	"sso_client_secret": "AZURE_CLIENT_SECRET", "sso_allowed_domains": "SSO_ALLOWED_DOMAINS",
}

// Config: tham số lấy ENV trước, thiếu thì lấy CSDL.
//
// BẬT/TẮT KHÔNG CÓ ENV — đủ Tenant ID + Client ID là TỰ BẬT; muốn tắt thì admin vào màn Cài đặt
// chọn "Tắt" (ghi sso_enabled='false'). Trước đây có ENV SSO_ENABLED và nó đi chung hàm pick():
// chuỗi "false" khác rỗng nên luôn thắng CSDL -> admin điền đủ tham số, bấm Bật trong giao diện mà
// vẫn không đăng nhập được, và không có đường nào mở ra từ giao diện. Đó là KHOÁ CỨNG chứ không
// phải "mặc định tắt". Một công tắc, một nơi: CSDL + WebUI.
func (m *Manager) Config(ctx context.Context) Config {
	s, _ := m.db.GetSettings(ctx)
	fromEnv := false
	pick := func(key string) string {
		if env := strings.TrimSpace(os.Getenv(envMap2[key])); env != "" {
			if key == "sso_tenant_id" || key == "sso_client_id" {
				fromEnv = true
			}
			return env
		}
		return strings.TrimSpace(s[key])
	}
	tenant := pick("sso_tenant_id")
	client := pick("sso_client_id")
	secret := pick("sso_client_secret")
	var domains []string
	for _, d := range strings.Split(pick("sso_allowed_domains"), ",") {
		d = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(d)), "@")
		if d != "" {
			domains = append(domains, d)
		}
	}
	// Chỉ "false" TƯỜNG MINH (admin bấm Tắt) mới chặn. Rỗng/chưa đặt = tự động theo tham số.
	off := strings.TrimSpace(s["sso_enabled"]) == "false"
	// Secret KHÔNG bắt buộc: có secret -> client tin cậy (confidential); bỏ trống -> public client,
	// đăng nhập dựa PKCE (đã dùng ở BuildAuthRequest/ExchangeAndVerify). Muốn chạy không secret thì
	// app trên Azure phải bật "Allow public client flows".
	return Config{
		Enabled: !off && tenant != "" && client != "",
		TenantID: tenant, ClientID: client, ClientSecret: secret, AllowedDomains: domains,
		FromEnv: fromEnv,
	}
}

// Enabled: cho endpoint /auth/sso/config.
func (m *Manager) Enabled(ctx context.Context) bool { return m.Config(ctx).Enabled }

func issuerOf(t string) string    { return "https://login.microsoftonline.com/" + t + "/v2.0" }
func authorizeEP(t string) string { return "https://login.microsoftonline.com/" + t + "/oauth2/v2.0/authorize" }
func tokenEP(t string) string     { return "https://login.microsoftonline.com/" + t + "/oauth2/v2.0/token" }
func jwksURI(t string) string     { return "https://login.microsoftonline.com/" + t + "/discovery/v2.0/keys" }

// stateClaims: nội dung JWT cookie ktx_sso.
type stateClaims struct {
	State string `json:"state"`
	Nonce string `json:"nonce"`
	CV    string `json:"cv"`
	URI   string `json:"uri"`
	jwt.RegisteredClaims
}

// BuildAuthRequest: dựng URL đẩy sang Microsoft + stateToken (cookie). server/sso.js:74-95
func (m *Manager) BuildAuthRequest(ctx context.Context, redirectURI string) (string, string, error) {
	cfg := m.Config(ctx)
	if !cfg.Enabled {
		return "", "", &HTTPError{503, "Đăng nhập Microsoft chưa được cấu hình"}
	}
	state := b64url(randBytes(24))
	nonce := b64url(randBytes(24))
	cv := b64url(randBytes(48))
	sum := sha256.Sum256([]byte(cv))
	challenge := b64url(sum[:])
	params := url.Values{
		"client_id":             {cfg.ClientID},
		"response_type":         {"code"},
		"redirect_uri":          {redirectURI},
		"response_mode":         {"query"},
		"scope":                 {"openid profile email"},
		"state":                 {state},
		"nonce":                 {nonce},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, stateClaims{
		State: state, Nonce: nonce, CV: cv, URI: redirectURI,
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(StateTTLSec * time.Second))},
	})
	stateToken, err := tok.SignedString(m.secret)
	if err != nil {
		return "", "", err
	}
	return authorizeEP(cfg.TenantID) + "?" + params.Encode(), stateToken, nil
}

type Identity struct {
	Subject  string
	Email    string
	FullName string
}

// ---- JWKS cache ----
var (
	jwksMu    sync.Mutex
	jwksTID   string
	jwksAt    time.Time
	jwksKeys  []jwkKey
	httpCl    = &http.Client{Timeout: 10 * time.Second}
)

type jwkKey struct {
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
	Kty string `json:"kty"`
}

func fetchJWKS(ctx context.Context, tenant string) ([]jwkKey, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", jwksURI(tenant), nil)
	r, err := httpCl.Do(req)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, fmt.Errorf("Không lấy được khoá công khai của Microsoft (JWKS)")
	}
	var j struct {
		Keys []jwkKey `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&j); err != nil {
		return nil, err
	}
	return j.Keys, nil
}

func (m *Manager) signingKey(ctx context.Context, tenant, kid string) (*rsa.PublicKey, error) {
	jwksMu.Lock()
	fresh := jwksTID == tenant && time.Since(jwksAt) < time.Hour
	keys := jwksKeys
	jwksMu.Unlock()
	find := func(ks []jwkKey) *jwkKey {
		for i := range ks {
			if ks[i].Kid == kid {
				return &ks[i]
			}
		}
		return nil
	}
	var jwk *jwkKey
	if fresh {
		jwk = find(keys)
	}
	if jwk == nil { // hết hạn hoặc xoay khoá -> nạp lại
		ks, err := fetchJWKS(ctx, tenant)
		if err != nil {
			return nil, err
		}
		jwksMu.Lock()
		jwksTID, jwksAt, jwksKeys = tenant, time.Now(), ks
		jwksMu.Unlock()
		jwk = find(ks)
	}
	if jwk == nil {
		return nil, fmt.Errorf("Không tìm thấy khoá ký khớp id_token")
	}
	return jwkToRSA(jwk)
}

func jwkToRSA(k *jwkKey) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, err
	}
	e := 0
	for _, b := range eb {
		e = e<<8 | int(b)
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: e}, nil
}

// ExchangeAndVerify: đổi code lấy id_token rồi KIỂM. server/sso.js:98-163
func (m *Manager) ExchangeAndVerify(ctx context.Context, ssoCookie, code, state string) (Identity, error) {
	cfg := m.Config(ctx)
	if !cfg.Enabled {
		return Identity{}, &HTTPError{503, "Đăng nhập Microsoft chưa được cấu hình"}
	}
	if ssoCookie == "" {
		return Identity{}, &HTTPError{400, "Phiên đăng nhập Microsoft đã hết hạn. Vui lòng thử lại."}
	}
	var st stateClaims
	_, err := jwt.ParseWithClaims(ssoCookie, &st, func(t *jwt.Token) (interface{}, error) { return m.secret, nil }, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return Identity{}, &HTTPError{400, "Phiên đăng nhập Microsoft không hợp lệ hoặc đã hết hạn."}
	}
	if subtle.ConstantTimeCompare([]byte(state), []byte(st.State)) != 1 {
		return Identity{}, &HTTPError{400, "Yêu cầu đăng nhập không khớp (state). Vui lòng thử lại."}
	}

	form := url.Values{
		"client_id":  {cfg.ClientID},
		"grant_type": {"authorization_code"}, "code": {code},
		"redirect_uri": {st.URI}, "code_verifier": {st.CV}, "scope": {"openid profile email"},
	}
	// Có secret -> gửi kèm (confidential). Bỏ trống -> KHÔNG gửi, chỉ dựa PKCE (public client).
	if cfg.ClientSecret != "" {
		form.Set("client_secret", cfg.ClientSecret)
	}
	req, _ := http.NewRequestWithContext(ctx, "POST", tokenEP(cfg.TenantID), strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r, err := httpCl.Do(req)
	if err != nil {
		return Identity{}, &HTTPError{502, "Không đổi được mã đăng nhập với Microsoft."}
	}
	defer r.Body.Close()
	body, _ := io.ReadAll(r.Body)
	var tok struct {
		IDToken string `json:"id_token"`
	}
	_ = json.Unmarshal(body, &tok)
	if r.StatusCode != 200 || tok.IDToken == "" {
		// NÊU RÕ lý do Microsoft từ chối (vd AADSTS7000218 = app kiểu Web bắt buộc client_secret) để
		// admin biết đường sửa, thay vì thông báo chung chung.
		var e struct {
			Error string `json:"error"`
			Desc  string `json:"error_description"`
		}
		_ = json.Unmarshal(body, &e)
		reason := e.Desc
		if reason == "" {
			reason = e.Error
		}
		if i := strings.IndexAny(reason, "\r\n"); i > 0 { // Microsoft trả nhiều dòng -> lấy dòng đầu
			reason = reason[:i]
		}
		if len(reason) > 220 {
			reason = reason[:220]
		}
		msg := "Microsoft từ chối đổi mã đăng nhập."
		if reason != "" {
			msg += " Lý do: " + reason
		}
		return Identity{}, &HTTPError{502, msg}
	}

	return m.VerifyIDToken(ctx, tok.IDToken, st.Nonce)
}

// VerifyIDToken: KIỂM id_token (chữ ký JWKS RS256 + iss + aud=client_id + tid + tên miền cho phép).
// Dùng chung cho: (1) luồng server-side ExchangeAndVerify (truyền nonce từ state cookie), và (2) luồng
// SPA — trình duyệt tự đổi mã rồi gửi id_token về /sso/verify (nonce đã kiểm phía trình duyệt -> "").
// KHÔNG đổi mã, KHÔNG cần client_secret: chỉ tin token do Microsoft ký cho ĐÚNG app + ĐÚNG tenant.
func (m *Manager) VerifyIDToken(ctx context.Context, idToken, expectedNonce string) (Identity, error) {
	cfg := m.Config(ctx)
	if !cfg.Enabled {
		return Identity{}, &HTTPError{503, "Đăng nhập Microsoft chưa được cấu hình"}
	}
	var claims jwt.MapClaims
	_, err := jwt.ParseWithClaims(idToken, &claims, func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, fmt.Errorf("id_token không hợp lệ")
		}
		return m.signingKey(ctx, cfg.TenantID, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(issuerOf(cfg.TenantID)),
		jwt.WithAudience(cfg.ClientID), jwt.WithLeeway(60*time.Second))
	if err != nil {
		return Identity{}, &HTTPError{401, "Chữ ký id_token không hợp lệ: " + err.Error()}
	}
	if expectedNonce != "" {
		if nonce, _ := claims["nonce"].(string); nonce != expectedNonce {
			return Identity{}, &HTTPError{401, "id_token không khớp yêu cầu (nonce)."}
		}
	}
	if tid, _ := claims["tid"].(string); tid != "" && tid != cfg.TenantID {
		return Identity{}, &HTTPError{403, "Tài khoản không thuộc tổ chức được phép."}
	}
	email := strings.ToLower(strings.TrimSpace(claimStr(claims, "email", "preferred_username")))
	if email == "" {
		return Identity{}, &HTTPError{400, "Tài khoản Microsoft không có email — không liên kết được."}
	}
	if len(cfg.AllowedDomains) > 0 {
		dom := ""
		if i := strings.LastIndex(email, "@"); i >= 0 {
			dom = email[i+1:]
		}
		ok := false
		for _, d := range cfg.AllowedDomains {
			if d == dom {
				ok = true
				break
			}
		}
		if !ok {
			return Identity{}, &HTTPError{403, `Email "` + email + `" không thuộc tên miền được phép đăng nhập.`}
		}
	}
	subject := claimStr(claims, "oid", "sub")
	return Identity{Subject: subject, Email: email, FullName: strings.TrimSpace(claimStr(claims, "name"))}, nil
}

func claimStr(c jwt.MapClaims, keys ...string) string {
	for _, k := range keys {
		if v, ok := c[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}
