package sso

// Cổng phát tham số đổi mã: chỉ ra khỏi máy chủ khi cookie ktx_sso hợp lệ VÀ state khớp — tenant và
// client không được phát cho khách chưa đăng nhập.
//   go test ./internal/sso/ -v   (cần Postgres local; không có DB -> t.Skip)

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

// dungMotVongUyQuyen: chạy đúng bước máy chủ dựng yêu cầu, trả về (cookie, state) như thật.
func dungMotVongUyQuyen(t *testing.T, m *Manager, ctx context.Context) (string, string) {
	t.Helper()
	authURL, cookie, err := m.BuildAuthRequest(ctx, "https://ktx.test/")
	if err != nil {
		t.Fatalf("không dựng được yêu cầu uỷ quyền: %v", err)
	}
	u, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("URL uỷ quyền hỏng: %v", err)
	}
	state := u.Query().Get("state")
	if state == "" {
		t.Fatal("URL uỷ quyền không có state")
	}
	return cookie, state
}

func mgrDaCauHinh(t *testing.T) (*Manager, context.Context) {
	t.Helper()
	m, ctx := newTestManager(t)
	setS(t, m, ctx, map[string]string{
		"sso_enabled": "", "sso_tenant_id": "tenant-thu", "sso_client_id": "client-thu",
		"sso_client_secret": "bi-mat-khong-duoc-lot-ra", "sso_allowed_domains": "",
	})
	return m, ctx
}

// Đi hết một vòng thì lấy được tham số, và tham số phải khớp cái đã dùng để dựng yêu cầu.
func TestExchangeParamsDungVongThiLayDuoc(t *testing.T) {
	m, ctx := mgrDaCauHinh(t)
	cookie, state := dungMotVongUyQuyen(t, m, ctx)

	p, err := m.ParamsForBrowserExchange(ctx, cookie, state)
	if err != nil {
		t.Fatalf("đi đúng vòng mà không lấy được tham số: %v", err)
	}
	if p.TenantID != "tenant-thu" || p.ClientID != "client-thu" {
		t.Errorf("tham số sai: tenant=%q client=%q", p.TenantID, p.ClientID)
	}
	if p.CodeVerifier == "" {
		t.Error("thiếu code_verifier — trình duyệt không đổi mã được (PKCE là chỗ dựa duy nhất khi không có secret)")
	}
	if p.RedirectURI != "https://ktx.test/" {
		t.Errorf("redirect_uri lệch với lúc dựng yêu cầu: %q — Microsoft sẽ từ chối", p.RedirectURI)
	}
}

// client_secret TUYỆT ĐỐI không được đi ra trình duyệt.
func TestExchangeParamsKhongBaoGioLoSecret(t *testing.T) {
	m, ctx := mgrDaCauHinh(t)
	cookie, state := dungMotVongUyQuyen(t, m, ctx)

	p, err := m.ParamsForBrowserExchange(ctx, cookie, state)
	if err != nil {
		t.Fatalf("không lấy được tham số: %v", err)
	}
	b, _ := json.Marshal(p)
	if strings.Contains(string(b), "bi-mat-khong-duoc-lot-ra") {
		t.Fatalf("client_secret lọt ra trình duyệt: %s", b)
	}
	if strings.Contains(strings.ToLower(string(b)), "secret") {
		t.Errorf("thân phản hồi có trường tên kiểu secret: %s", b)
	}
}

// Không có cookie = khách gõ tay -> không phát gì.
func TestExchangeParamsKhongCookieThiTuChoi(t *testing.T) {
	m, ctx := mgrDaCauHinh(t)
	_, state := dungMotVongUyQuyen(t, m, ctx)

	if _, err := m.ParamsForBrowserExchange(ctx, "", state); err == nil {
		t.Fatal("không có cookie mà vẫn phát tham số — khách ẩn danh moi được tenant/client")
	}
}

// Cookie giả/hỏng chữ ký -> không phát gì.
func TestExchangeParamsCookieRacThiTuChoi(t *testing.T) {
	m, ctx := mgrDaCauHinh(t)
	_, state := dungMotVongUyQuyen(t, m, ctx)

	if _, err := m.ParamsForBrowserExchange(ctx, "khong-phai-jwt", state); err == nil {
		t.Fatal("cookie rác mà vẫn phát tham số")
	}
}

// Có cookie thật nhưng state không khớp (mã của người khác) -> không phát gì.
func TestExchangeParamsStateKhongKhopThiTuChoi(t *testing.T) {
	m, ctx := mgrDaCauHinh(t)
	cookie, _ := dungMotVongUyQuyen(t, m, ctx)

	if _, err := m.ParamsForBrowserExchange(ctx, cookie, "state-cua-nguoi-khac"); err == nil {
		t.Fatal("state không khớp mà vẫn phát tham số")
	}
}

// Admin tắt SSO thì cổng này cũng phải đóng, kể cả cookie còn hạn.
func TestExchangeParamsSSOTatThiDong(t *testing.T) {
	m, ctx := mgrDaCauHinh(t)
	cookie, state := dungMotVongUyQuyen(t, m, ctx)
	setS(t, m, ctx, map[string]string{"sso_enabled": "false"})

	if _, err := m.ParamsForBrowserExchange(ctx, cookie, state); err == nil {
		t.Fatal("SSO đã tắt mà cổng vẫn phát tham số")
	}
}
