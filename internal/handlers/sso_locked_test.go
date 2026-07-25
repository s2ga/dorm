package handlers

// Tài khoản BỊ KHOÁ đăng nhập lại bằng Microsoft thì KHÔNG được sống lại.
//
// Lỗi thật đã gặp trên staging: ssoResolveUser tự `deleted_at = NULL` + hạ `approved = false`, nên khoá
// một nhân viên xong họ bấm "Đăng nhập bằng Microsoft" là tài khoản mở lại ở trạng thái chờ duyệt —
// khoá bị vô hiệu hoá, admin còn bị gọi đi duyệt lại đúng người mình vừa khoá, và vì vai vẫn là 'staff'
// nên nút "Duyệt / gán vai" cũng không bật được approved -> kẹt vĩnh viễn ở màn "Tài khoản đang chờ duyệt".
//
// Không kiểm được qua HTTP: /auth/sso/verify đòi id_token có chữ ký Microsoft thật (JWKS), không giả
// được ở test. Nên gọi thẳng ssoResolveUser với CSDL thật — đây mới là chỗ ra quyết định.
//
// Chạy:  go test ./internal/handlers/ -run TestSSOResolve -v
// Cần Postgres local (npm run services). Không có DB -> t.Skip, không báo đỏ oan.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"ktx/internal/db"
	"ktx/internal/sso"
)

const ssoTestPrefix = "__test_sso_locked"

func ssoTestHandlers(t *testing.T) (*Handlers, context.Context) {
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
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE username LIKE $1`, ssoTestPrefix+"%")
		pool.Close()
	})
	_, _ = pool.Exec(ctx, `DELETE FROM users WHERE username LIKE $1`, ssoTestPrefix+"%")
	return &Handlers{DB: &db.DB{Pool: pool}}, ctx
}

// Khoá tài khoản ĐÃ liên kết Microsoft (khớp sso_subject) -> chặn, giữ nguyên trạng thái khoá.
func TestSSOResolveKhongHoiSinhTaiKhoanDaKhoa(t *testing.T) {
	h, ctx := ssoTestHandlers(t)
	uname := ssoTestPrefix + "_nv"
	sub := ssoTestPrefix + "_subject"
	var id int
	if err := h.pool().QueryRow(ctx,
		`INSERT INTO users (username,password_hash,role,full_name,email,sso_subject,auth_provider,approved,deleted_at)
		 VALUES ($1,NULL,'staff','NV bị khoá',$2,$3,'sso',true,now()) RETURNING id`,
		uname, uname+"@esuhai.com", sub).Scan(&id); err != nil {
		t.Fatalf("không tạo được dữ liệu mẫu: %v", err)
	}

	u, err := h.ssoResolveUser(ctx, sso.Identity{Subject: sub, Email: uname + "@esuhai.com", FullName: "NV bị khoá"})
	if !errors.Is(err, errTaiKhoanBiKhoa) {
		t.Fatalf("tài khoản đã khoá đăng nhập Microsoft lại: muốn errTaiKhoanBiKhoa, nhận (user=%v, err=%v)", u, err)
	}
	if u != nil {
		t.Fatalf("không được trả user cho tài khoản đã khoá (nếu trả, handler sẽ cấp cookie phiên): %+v", u)
	}

	var locked, approved bool
	if err := h.pool().QueryRow(ctx,
		"SELECT (deleted_at IS NOT NULL), approved FROM users WHERE id=$1", id).Scan(&locked, &approved); err != nil {
		t.Fatalf("đọc lại bản ghi lỗi: %v", err)
	}
	if !locked {
		t.Error("bản ghi bị MỞ KHOÁ (deleted_at=NULL) — khoá coi như vô nghĩa; mở khoá là việc của admin")
	}
	if !approved {
		t.Error("approved bị hạ xuống false — người bị khoá sẽ kẹt ở màn \"chờ duyệt\" sau khi admin mở khoá")
	}
}

// Khoá tài khoản CHƯA từng liên kết Microsoft (chỉ khớp email) -> cũng phải chặn, và tuyệt đối không
// tạo tài khoản 'pending' MỚI cho đúng con người vừa bị khoá.
func TestSSOResolveKhongTaoTaiKhoanMoiKhiEmailDaBiKhoa(t *testing.T) {
	h, ctx := ssoTestHandlers(t)
	uname := ssoTestPrefix + "_email"
	email := uname + "@esuhai.com"
	if _, err := h.pool().Exec(ctx,
		`INSERT INTO users (username,password_hash,role,full_name,email,auth_provider,approved,deleted_at)
		 VALUES ($1,'x','staff','NV bị khoá',$2,'local',true,now())`, uname, email); err != nil {
		t.Fatalf("không tạo được dữ liệu mẫu: %v", err)
	}

	u, err := h.ssoResolveUser(ctx, sso.Identity{Subject: ssoTestPrefix + "_sub2", Email: email, FullName: "NV bị khoá"})
	if !errors.Is(err, errTaiKhoanBiKhoa) {
		t.Fatalf("email của người đã bị khoá: muốn errTaiKhoanBiKhoa, nhận (user=%v, err=%v)", u, err)
	}
	var n int
	if err := h.pool().QueryRow(ctx,
		"SELECT COUNT(*)::int FROM users WHERE lower(email)=lower($1)", email).Scan(&n); err != nil {
		t.Fatalf("đếm lỗi: %v", err)
	}
	if n != 1 {
		t.Errorf("có %d tài khoản cho email đã bị khoá — không được tạo thêm bản 'pending' mới", n)
	}
}

// Tài khoản BÌNH THƯỜNG (chưa khoá) vẫn phải đăng nhập Microsoft được — chốt chặn trên không chặn oan.
func TestSSOResolveTaiKhoanBinhThuongVanVao(t *testing.T) {
	h, ctx := ssoTestHandlers(t)
	uname := ssoTestPrefix + "_ok"
	sub := ssoTestPrefix + "_sub_ok"
	if _, err := h.pool().Exec(ctx,
		`INSERT INTO users (username,password_hash,role,full_name,email,sso_subject,auth_provider,approved)
		 VALUES ($1,NULL,'staff','NV bình thường',$2,$3,'sso',true)`, uname, uname+"@esuhai.com", sub); err != nil {
		t.Fatalf("không tạo được dữ liệu mẫu: %v", err)
	}
	u, err := h.ssoResolveUser(ctx, sso.Identity{Subject: sub, Email: uname + "@esuhai.com", FullName: "NV bình thường"})
	if err != nil || u == nil {
		t.Fatalf("tài khoản chưa khoá phải vào được: (user=%v, err=%v)", u, err)
	}
	if !u.Approved || u.Role != "staff" {
		t.Errorf("trạng thái bị đổi sai: role=%q approved=%v", u.Role, u.Approved)
	}
}
