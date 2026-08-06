package server

import (
	"io/fs"
	"os"
	"testing"
)

// Bản nhúng phải KHỚP thư mục trên đĩa. Đổi tên/thêm file mà pattern go:embed không bắt được thì
// bản Vercel thiếu migration trong im lặng — ở đó không có đĩa để đối chiếu.
func TestNhungKhopDia(t *testing.T) {
	onDisk, err := os.ReadFile("schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if SchemaSQL != string(onDisk) {
		t.Errorf("SchemaSQL lệch với schema.sql trên đĩa (%d byte nhúng, %d byte đĩa)",
			len(SchemaSQL), len(onDisk))
	}

	sub, err := fs.Sub(MigrationsFS, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	nhung := map[string]bool{}
	entries, err := fs.ReadDir(sub, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		nhung[e.Name()] = true
	}

	dia, err := os.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range dia {
		if e.IsDir() || filepathExt(e.Name()) != ".sql" {
			continue
		}
		if !nhung[e.Name()] {
			t.Errorf("migration %s có trên đĩa nhưng KHÔNG được nhúng", e.Name())
		}
		delete(nhung, e.Name())
	}
	for ten := range nhung {
		t.Errorf("migration %s được nhúng nhưng không có trên đĩa", ten)
	}
}

func filepathExt(ten string) string {
	for i := len(ten) - 1; i >= 0 && ten[i] != '/'; i-- {
		if ten[i] == '.' {
			return ten[i:]
		}
	}
	return ""
}
