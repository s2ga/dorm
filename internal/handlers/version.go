package handlers

import (
	"net/http"
	"os"
	"regexp"
	"sync"

	"github.com/gin-gonic/gin"
	"ktx/internal/buildinfo"
)

var (
	assetOnce sync.Once
	assetVer  string
)

var assetVerRe = regexp.MustCompile(`\?v=(\d+)`)

// assetVersion: số ?v= trong public/index.html — phiên bản GIAO DIỆN thực sự đang được phục vụ.
// Đọc một lần: index.html chỉ đổi khi phát hành bản mới, mà phát hành là khởi động lại tiến trình.
func assetVersion() string {
	assetOnce.Do(func() {
		pub := os.Getenv("PUBLIC_DIR")
		if pub == "" {
			pub = "public"
		}
		b, err := os.ReadFile(pub + "/index.html")
		if err != nil {
			return
		}
		if m := assetVerRe.FindSubmatch(b); m != nil {
			assetVer = string(m[1])
		}
	})
	return assetVer
}

// AppVersion: GET /api/version — bản dựng nào đang chạy. Không cần đăng nhập, cùng lý do với
// /api/health: phải kiểm được từ ngoài (staging, UAT) khi chưa có tài khoản hay chưa vào được app.
// Không trả gì bí mật: tag, commit và thời điểm build đều là thông tin công khai của repo.
func (h *Handlers) AppVersion(c *gin.Context) {
	info := buildinfo.Get()
	c.JSON(http.StatusOK, gin.H{
		"version":       info.Version,
		"commit":        info.Commit,
		"commit_short":  info.CommitShort,
		"built_at":      info.BuiltAt,
		"nguon":         info.Nguon,
		"asset_version": assetVersion(),
		"app_env":       h.Cfg.AppEnv,
	})
}
