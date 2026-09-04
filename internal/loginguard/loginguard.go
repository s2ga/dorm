// Package loginguard — chống dò mật khẩu theo TÀI KHOẢN (không chỉ theo IP).
// Trạng thái nằm ở bảng login_guard: khoá là lớp BẢO VỆ, không được bay hơi khi tiến trình
// khởi động lại (Render ngủ dậy, deploy) hay khi chạy nhiều instance.
package loginguard

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MaxFail = 10             // số lần sai liên tiếp trước khi khoá
	CuaSoMs = 15 * 60 * 1000 // đếm trong cửa sổ 15 phút
	KhoaMs  = 15 * 60 * 1000 // khoá 15 phút
)

type Guard struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Guard { return &Guard{pool: pool} }

func key(username string) string { return strings.ToLower(strings.TrimSpace(username)) }

// TruocKhiThu: gọi TRƯỚC khi thử mật khẩu. Trả (đang khoá?, số giây còn lại).
func (g *Guard) TruocKhiThu(ctx context.Context, username string, now int64) (bool, int) {
	k := key(username)
	if k == "" || g.pool == nil {
		return false, 0
	}
	var khoaDen int64
	err := g.pool.QueryRow(ctx, "SELECT locked_until_ms FROM login_guard WHERE username=$1", k).Scan(&khoaDen)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			println("[login-guard] không đọc được trạng thái khoá:", err.Error())
		}
		return false, 0
	}
	if khoaDen > now {
		return true, int((khoaDen - now + 999) / 1000) // Math.ceil
	}
	return false, 0
}

// GhiNhanKetQua: gọi SAU khi thử. success -> xoá lịch sử; sai -> cộng 1, đủ ngưỡng thì khoá.
// Trả khoaMoi = true nếu vừa CHUYỂN sang trạng thái khoá.
func (g *Guard) GhiNhanKetQua(ctx context.Context, username string, success bool, now int64) bool {
	k := key(username)
	if k == "" || g.pool == nil {
		return false
	}
	if success {
		// Dọn luôn hàng nguội của tài khoản khác — bảng này không cần giữ lịch sử.
		if _, err := g.pool.Exec(ctx,
			"DELETE FROM login_guard WHERE username=$1 OR updated_at < now() - interval '1 day'", k); err != nil {
			println("[login-guard] không xoá được lịch sử sai:", err.Error())
		}
		return false
	}
	// Lọc mốc quá cửa sổ rồi thêm mốc mới trong MỘT câu: hai request đồng thời không ghi đè nhau.
	var soLan int
	err := g.pool.QueryRow(ctx, `
		INSERT INTO login_guard (username, fails_ms, locked_until_ms, updated_at)
		VALUES ($1, ARRAY[$2::bigint], 0, now())
		ON CONFLICT (username) DO UPDATE SET
		  fails_ms = (SELECT COALESCE(array_agg(x), '{}'::bigint[])
		              FROM unnest(login_guard.fails_ms) x WHERE $2::bigint - x < $3::bigint) || $2::bigint,
		  updated_at = now()
		RETURNING cardinality(fails_ms)`, k, now, int64(CuaSoMs)).Scan(&soLan)
	if err != nil {
		println("[login-guard] không ghi được lần sai:", err.Error())
		return false
	}
	if soLan < MaxFail {
		return false
	}
	if _, err := g.pool.Exec(ctx,
		"UPDATE login_guard SET locked_until_ms=$2, fails_ms='{}'::bigint[], updated_at=now() WHERE username=$1",
		k, now+int64(KhoaMs)); err != nil {
		println("[login-guard] không đặt được mốc khoá:", err.Error())
		return false
	}
	return true
}

// LogEntry: dữ liệu ghi nhật ký đăng nhập.
type LogEntry struct {
	UserID   *int
	Username string
	Role     string
	IP       string
	UA       string
	KetQua   string
}

// GhiNhatKyDangNhap: ghi audit_log cho MỌI lần đăng nhập (kể cả thất bại). server/login-guard.js:56-65
// Nhật ký hỏng KHÔNG được chặn đăng nhập — chỉ log ra server.
func GhiNhatKyDangNhap(ctx context.Context, pool *pgxpool.Pool, e LogEntry) {
	ua := e.UA
	if len(ua) > 120 {
		ua = ua[:120]
	}
	detailBytes, _ := json.Marshal(map[string]string{"ip": e.IP, "ketQua": e.KetQua, "ua": ua})
	detail := string(detailBytes)
	if len(detail) > 460 {
		detail = detail[:460]
	}
	_, err := pool.Exec(ctx,
		"INSERT INTO audit_log (user_id, username, role, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)",
		e.UserID, e.Username, e.Role, "LOGIN", "/api/auth/login", detail)
	if err != nil {
		// không chặn đăng nhập; chỉ để lại dấu vết ở log server
		println("[login-guard] không ghi được nhật ký đăng nhập:", err.Error())
	}
}
