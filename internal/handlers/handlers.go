// Package handlers — các HTTP handler gin cho /api/*. Port từ server/routes/*.routes.js.
package handlers

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"ktx/internal/auth"
	"ktx/internal/config"
	"ktx/internal/db"
	"ktx/internal/loginguard"
	"ktx/internal/sso"
	"ktx/internal/storage"
)

type Handlers struct {
	DB    *db.DB
	Cfg   *config.Config
	Auth  *auth.Auth
	Guard *loginguard.Guard
	Store *storage.Storage // nil nếu S3 chưa cấu hình
	SSO   *sso.Manager
}

func New(database *db.DB, cfg *config.Config, a *auth.Auth, g *loginguard.Guard, store *storage.Storage) *Handlers {
	return &Handlers{DB: database, Cfg: cfg, Auth: a, Guard: g, Store: store, SSO: sso.NewManager(cfg.JWTSecret, database)}
}

func (h *Handlers) pool() *pgxpool.Pool { return h.DB.Pool }

// clientIP: IP client, bỏ tiền tố ::ffff: (giống ipCua của Node).
func clientIP(c *gin.Context) string {
	ip := c.ClientIP()
	ip = strings.TrimPrefix(ip, "::ffff:")
	if ip == "" {
		return "?"
	}
	return ip
}

// lowerFirst: hạ chữ cái đầu (dùng ghép câu lỗi mật khẩu như Node).
func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = []rune(strings.ToLower(string(r[0])))[0]
	return string(r)
}

func loginLog(h *Handlers, c *gin.Context, userID *int, username, role, ketQua string) {
	loginguard.GhiNhatKyDangNhap(c.Request.Context(), h.pool(), loginguard.LogEntry{
		UserID: userID, Username: username, Role: role,
		IP: clientIP(c), UA: c.GetHeader("User-Agent"), KetQua: ketQua,
	})
}
