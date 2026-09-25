// Package buildinfo: bản dựng nào đang chạy. Giá trị ghi lúc biên dịch bằng -ldflags -X
// (xem Dockerfile + .github/workflows/), thiếu thì lùi về biến môi trường rồi mới tới mặc định.
package buildinfo

import (
	"os"
	"strings"
)

// Ghi lúc build: go build -ldflags "-X ktx/internal/buildinfo.Version=v311 ..."
var (
	Version string // tag phát hành, vd v311
	Commit  string // SHA commit đầy đủ
	BuiltAt string // thời điểm build, RFC3339
)

type Info struct {
	Version     string `json:"version"`
	Commit      string `json:"commit"`
	CommitShort string `json:"commit_short"`
	BuiltAt     string `json:"built_at"`
	Nguon       string `json:"nguon"` // ldflags | env | khong-ro — biết ngay bản dựng có được truyền tham số không
}

func dau(giaTri ...string) string {
	for _, v := range giaTri {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

// Get: hợp nhất ldflags + biến môi trường. RENDER_GIT_COMMIT do Render tự đặt (staging build từ
// nguồn, không truyền được build-arg); APP_VERSION/APP_COMMIT để k8s hoặc compose ghi đè khi cần.
func Get() Info {
	version := dau(Version, os.Getenv("APP_VERSION"))
	commit := dau(Commit, os.Getenv("APP_COMMIT"), os.Getenv("RENDER_GIT_COMMIT"))
	builtAt := dau(BuiltAt, os.Getenv("APP_BUILT_AT"))

	nguon := "khong-ro"
	switch {
	case strings.TrimSpace(Version) != "" || strings.TrimSpace(Commit) != "":
		nguon = "ldflags"
	case version != "" || commit != "":
		nguon = "env"
	}
	if version == "" {
		version = "dev"
	}
	if commit == "" {
		commit = "khong-ro"
	}
	ngan := commit
	if len(ngan) > 7 && ngan != "khong-ro" {
		ngan = ngan[:7]
	}
	return Info{Version: version, Commit: commit, CommitShort: ngan, BuiltAt: builtAt, Nguon: nguon}
}
