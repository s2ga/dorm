package buildinfo

import "testing"

func datLai(v, c, b string) {
	Version, Commit, BuiltAt = v, c, b
}

func TestGetLuiVeMacDinhKhiKhongCoGi(t *testing.T) {
	datLai("", "", "")
	t.Setenv("APP_VERSION", "")
	t.Setenv("APP_COMMIT", "")
	t.Setenv("RENDER_GIT_COMMIT", "")
	got := Get()
	if got.Version != "dev" || got.Commit != "khong-ro" || got.Nguon != "khong-ro" {
		t.Fatalf("bản dựng không truyền tham số phải nói rõ là không rõ, được %+v", got)
	}
}

func TestGetUuTienLdflags(t *testing.T) {
	datLai("v311", "0123456789abcdef", "2026-09-25T10:00:00Z")
	t.Setenv("APP_VERSION", "v999")
	t.Setenv("APP_COMMIT", "deadbeef")
	got := Get()
	if got.Version != "v311" || got.Commit != "0123456789abcdef" {
		t.Fatalf("ldflags phải thắng biến môi trường, được %+v", got)
	}
	if got.CommitShort != "0123456" {
		t.Fatalf("commit ngắn phải là 7 ký tự đầu, được %q", got.CommitShort)
	}
	if got.Nguon != "ldflags" {
		t.Fatalf("nguồn phải là ldflags, được %q", got.Nguon)
	}
}

func TestGetLuiVeBienMoiTruong(t *testing.T) {
	datLai("", "", "")
	t.Setenv("APP_VERSION", "")
	t.Setenv("APP_COMMIT", "")
	// Render build từ nguồn nên không truyền được build-arg; chỉ có biến này.
	t.Setenv("RENDER_GIT_COMMIT", "abcdef1234567890")
	got := Get()
	if got.Commit != "abcdef1234567890" || got.CommitShort != "abcdef1" {
		t.Fatalf("phải lấy commit từ RENDER_GIT_COMMIT, được %+v", got)
	}
	if got.Nguon != "env" {
		t.Fatalf("nguồn phải là env, được %q", got.Nguon)
	}
	if got.Version != "dev" {
		t.Fatalf("không có tag thì version là dev, được %q", got.Version)
	}
}
