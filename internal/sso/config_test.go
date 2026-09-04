package sso

// Quy tắc bật/tắt SSO: KHÔNG có công tắc ENV — đủ Tenant ID + Client ID là tự bật, tắt bằng WebUI.
//   go test ./internal/sso/ -v   (cần Postgres local; không có DB -> t.Skip)

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"ktx/internal/db"
)

var ssoKeys = []string{"sso_enabled", "sso_tenant_id", "sso_client_id", "sso_client_secret", "sso_allowed_domains"}

// newTestManager mở CSDL local và tự phục hồi settings sau khi test xong (settings là TOÀN CỤC).
func newTestManager(t *testing.T) (*Manager, context.Context) {
	t.Helper()
	url := os.Getenv("TEST_DB")
	if url == "" {
		url = "postgres://ktx:ktx_local_secret@localhost:5432/ktx"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skipf("không mở được CSDL local (%v) — bỏ qua", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("CSDL local chưa chạy (%v) — bỏ qua (chạy `npm run services` trước)", err)
	}

	type snap struct {
		val    string
		exists bool
	}
	old := map[string]snap{}
	for _, k := range ssoKeys {
		var v *string
		err := pool.QueryRow(ctx, "SELECT value FROM settings WHERE key=$1", k).Scan(&v)
		if err != nil {
			old[k] = snap{}
			continue
		}
		s := snap{exists: true}
		if v != nil {
			s.val = *v
		}
		old[k] = s
	}
	t.Cleanup(func() {
		for _, k := range ssoKeys {
			if old[k].exists {
				_, _ = pool.Exec(ctx, `INSERT INTO settings(key,value) VALUES($1,$2)
					ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, k, old[k].val)
			} else {
				_, _ = pool.Exec(ctx, "DELETE FROM settings WHERE key=$1", k)
			}
		}
		pool.Close()
	})
	return NewManager("test-secret-khong-dung-that", &db.DB{Pool: pool}), ctx
}

func setS(t *testing.T, m *Manager, ctx context.Context, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		if _, err := m.db.Pool.Exec(ctx, `INSERT INTO settings(key,value) VALUES($1,$2)
			ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, k, v); err != nil {
			t.Fatalf("không ghi được settings %s: %v", k, err)
		}
	}
}

// Đủ Tenant + Client là TỰ BẬT — không cần ai bấm "Bật", không cần ENV.
func TestConfigDuThamSoLaTuBat(t *testing.T) {
	m, ctx := newTestManager(t)
	setS(t, m, ctx, map[string]string{
		"sso_enabled": "", "sso_tenant_id": "tenant-thu", "sso_client_id": "client-thu",
		"sso_client_secret": "", "sso_allowed_domains": "",
	})
	if cfg := m.Config(ctx); !cfg.Enabled {
		t.Fatalf("đủ Tenant + Client mà vẫn tắt: %+v", cfg)
	}
}

// Admin bấm Tắt trong WebUI -> phải tắt thật, dù tham số vẫn còn đó.
func TestConfigAdminTatTuongMinh(t *testing.T) {
	m, ctx := newTestManager(t)
	setS(t, m, ctx, map[string]string{
		"sso_enabled": "false", "sso_tenant_id": "tenant-thu", "sso_client_id": "client-thu",
	})
	if cfg := m.Config(ctx); cfg.Enabled {
		t.Fatalf("admin đã bấm Tắt mà SSO vẫn bật: %+v", cfg)
	}
}

// Thiếu Client ID thì bấm Bật cũng không lên — tránh đẩy người dùng sang Microsoft với cấu hình hỏng.
func TestConfigThieuThamSoThiKhongBat(t *testing.T) {
	m, ctx := newTestManager(t)
	setS(t, m, ctx, map[string]string{
		"sso_enabled": "true", "sso_tenant_id": "tenant-thu", "sso_client_id": "",
	})
	if cfg := m.Config(ctx); cfg.Enabled {
		t.Fatalf("thiếu Client ID mà vẫn báo bật: %+v", cfg)
	}
}

// LỖI CŨ: SSO_ENABLED=false đè chết cấu hình trong CSDL. Nay ENV đó không còn ý nghĩa gì.
func TestConfigEnvSSOEnabledKhongConDeDuocWebUI(t *testing.T) {
	m, ctx := newTestManager(t)
	t.Setenv("SSO_ENABLED", "false")
	setS(t, m, ctx, map[string]string{
		"sso_enabled": "true", "sso_tenant_id": "tenant-thu", "sso_client_id": "client-thu",
	})
	if cfg := m.Config(ctx); !cfg.Enabled {
		t.Fatalf("ENV SSO_ENABLED=false vẫn khoá được cấu hình của admin — đúng lỗi cũ: %+v", cfg)
	}
}

// Hạ tầng cấp AZURE_TENANT_ID/AZURE_CLIENT_ID -> tự bật dù CSDL trống, và phải báo FromEnv để giao
// diện không hiển thị "Đang tắt" trong khi SSO đang chạy.
func TestConfigThamSoTuEnvThiTuBat(t *testing.T) {
	m, ctx := newTestManager(t)
	setS(t, m, ctx, map[string]string{
		"sso_enabled": "", "sso_tenant_id": "", "sso_client_id": "",
	})
	t.Setenv("AZURE_TENANT_ID", "tenant-tu-env")
	t.Setenv("AZURE_CLIENT_ID", "client-tu-env")
	cfg := m.Config(ctx)
	if !cfg.Enabled {
		t.Fatalf("có AZURE_* ở ENV mà không tự bật: %+v", cfg)
	}
	if !cfg.FromEnv {
		t.Error("FromEnv=false — giao diện sẽ báo \"Đang tắt\" dù SSO đang chạy bằng ENV")
	}
	if cfg.TenantID != "tenant-tu-env" || cfg.ClientID != "client-tu-env" {
		t.Errorf("tham số không lấy từ ENV: tenant=%q client=%q", cfg.TenantID, cfg.ClientID)
	}
}

// Admin tắt thì tắt, kể cả khi tham số đến từ ENV (nếu không thì không còn cách nào tắt).
func TestConfigAdminTatDeDuocThamSoTuEnv(t *testing.T) {
	m, ctx := newTestManager(t)
	setS(t, m, ctx, map[string]string{"sso_enabled": "false", "sso_tenant_id": "", "sso_client_id": ""})
	t.Setenv("AZURE_TENANT_ID", "tenant-tu-env")
	t.Setenv("AZURE_CLIENT_ID", "client-tu-env")
	if cfg := m.Config(ctx); cfg.Enabled {
		t.Fatalf("admin bấm Tắt mà tham số ENV vẫn ép bật: %+v", cfg)
	}
}
