// Package db: pool PostgreSQL (pgx) + khởi tạo lúc boot (áp schema.sql, chạy migration đánh số mỗi
// file 1 transaction, seed mặc định). DATE -> chuỗi 'YYYY-MM-DD' (pgtype.Date), NUMERIC -> float64.
// SET TIME ZONE 'Asia/Ho_Chi_Minh' áp cho mọi kết nối qua RuntimeParams.
package db

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"ktx/internal/config"
	sqlassets "ktx/server"
)

type DB struct {
	Pool *pgxpool.Pool
	cfg  *config.Config
}

// New dựng pool theo cấu hình db.js: max 10, timeout 15s, TZ VN mỗi kết nối.
func New(ctx context.Context, cfg *config.Config) (*DB, error) {
	url := applySSLMode(cfg.DatabaseURL, cfg.PGSSL)
	pc, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	pc.MaxConns = 10
	pc.MaxConnIdleTime = 30 * time.Second
	pc.ConnConfig.ConnectTimeout = 10 * time.Second
	// Giờ VN + hủy query > 15s cho MỌI kết nối của pool (khớp statement_timeout/query_timeout của Node).
	pc.ConnConfig.RuntimeParams["timezone"] = "Asia/Ho_Chi_Minh"
	pc.ConnConfig.RuntimeParams["statement_timeout"] = "15000"

	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, fmt.Errorf("mở pool: %w", err)
	}
	return &DB{Pool: pool, cfg: cfg}, nil
}

// applySSLMode thêm sslmode nếu URL chưa có: PGSSL=disable -> disable (Postgres nội bộ);
// còn lại -> require (mã hoá nhưng KHÔNG verify cert, tương đương rejectUnauthorized:false của Node).
func applySSLMode(url, pgssl string) string {
	if strings.Contains(url, "sslmode=") {
		return url
	}
	mode := "require"
	if pgssl == "disable" {
		mode = "disable"
	}
	sep := "?"
	if strings.Contains(url, "?") {
		sep = "&"
	}
	return url + sep + "sslmode=" + mode
}

// Init: chờ DB sẵn sàng -> áp schema.sql -> báo schema_guard -> migrations -> seed. (server/db.js:55-73)
func (d *DB) Init(ctx context.Context) error {
	// chờ DB (container/pooler có thể lên sau app) — 30 lần x 2s
	var lastErr error
	for i := 0; i < 30; i++ {
		if _, err := d.Pool.Exec(ctx, "SELECT 1"); err == nil {
			lastErr = nil
			break
		} else {
			lastErr = err
			if i == 29 {
				return fmt.Errorf("không kết nối được PostgreSQL: %w", err)
			}
			fmt.Printf("⏳ Chờ PostgreSQL... (%d/30)\n", i+1)
			time.Sleep(2 * time.Second)
		}
	}
	if lastErr != nil {
		return lastErr
	}
	fmt.Println("🐘 Dùng PostgreSQL")

	schema, err := d.schemaSQL()
	if err != nil {
		return err
	}
	if err := d.execScript(ctx, schema); err != nil {
		return fmt.Errorf("áp schema.sql: %w", err)
	}
	if err := d.reportSchemaGuard(ctx); err != nil {
		return err
	}
	if err := d.runMigrations(ctx); err != nil {
		return err
	}
	if err := d.seedDefaults(ctx); err != nil {
		return err
	}
	fmt.Println("✅ CSDL sẵn sàng")
	return nil
}

// schemaSQL/migrationsFS: mặc định lấy bản nhúng trong binary; đặt SCHEMA_DIR để đọc từ đĩa.
func (d *DB) schemaSQL() (string, error) {
	if d.cfg.SchemaDir == "" {
		return sqlassets.SchemaSQL, nil
	}
	p := filepath.Join(d.cfg.SchemaDir, "schema.sql")
	b, err := os.ReadFile(p)
	if err != nil {
		return "", fmt.Errorf("đọc %s: %w", p, err)
	}
	return string(b), nil
}

func (d *DB) migrationsFS() (fs.FS, error) {
	if d.cfg.SchemaDir == "" {
		return fs.Sub(sqlassets.MigrationsFS, "migrations")
	}
	return os.DirFS(filepath.Join(d.cfg.SchemaDir, "migrations")), nil
}

// execScript chạy SQL NHIỀU CÂU LỆNH (schema.sql/migration) qua simple protocol của pgConn.
func (d *DB) execScript(ctx context.Context, sql string) error {
	c, err := d.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer c.Release()
	mrr := c.Conn().PgConn().Exec(ctx, sql)
	_, err = mrr.ReadAll()
	if cerr := mrr.Close(); err == nil {
		err = cerr
	}
	return err
}

func (d *DB) reportSchemaGuard(ctx context.Context) error {
	rows, err := d.Pool.Query(ctx, "SELECT ten, loi FROM schema_guard ORDER BY ten")
	if err != nil {
		return nil // schema_guard có thể chưa tồn tại ở DB rất cũ; không chặn boot
	}
	defer rows.Close()
	var list [][2]string
	for rows.Next() {
		var ten, loi string
		if err := rows.Scan(&ten, &loi); err == nil {
			list = append(list, [2]string{ten, loi})
		}
	}
	if len(list) == 0 {
		return nil
	}
	fmt.Printf("\n⚠️  %d RÀNG BUỘC CHƯA ÁP ĐƯỢC — dữ liệu đang có bản vi phạm:\n", len(list))
	for _, r := range list {
		fmt.Printf("   • %s\n     %s\n", r[0], r[1])
	}
	fmt.Println("   → Dọn dữ liệu rồi khởi động lại. Xem: Cài đặt → Tình trạng dữ liệu.")
	return nil
}

var reMigrationName = regexp.MustCompile(`(?i)^\d+_.*\.sql$`)

// runMigrations: chạy file migrations/NNNN_*.sql đúng 1 lần, mỗi file trong 1 transaction. (server/db.js:93-146)
func (d *DB) runMigrations(ctx context.Context) error {
	if _, err := d.Pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	mfs, err := d.migrationsFS()
	if err != nil {
		return nil // chưa có thư mục migrations -> chưa có migration nào
	}
	entries, err := fs.ReadDir(mfs, ".")
	if err != nil {
		return nil
	}
	var sqlFiles, misnamed, files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".sql") {
			continue
		}
		sqlFiles = append(sqlFiles, e.Name())
		if reMigrationName.MatchString(e.Name()) {
			files = append(files, e.Name())
		} else {
			misnamed = append(misnamed, e.Name())
		}
	}
	if len(misnamed) > 0 {
		fmt.Printf("⚠️  BỎ QUA %d file trong migrations/ SAI QUY ƯỚC tên (cần NNNN_ten.sql): %s\n",
			len(misnamed), strings.Join(misnamed, ", "))
	}
	if len(files) == 0 {
		return nil
	}
	sort.Slice(files, func(i, j int) bool {
		ni, nj := leadingInt(files[i]), leadingInt(files[j])
		if ni != nj {
			return ni < nj
		}
		return files[i] < files[j]
	})

	applied := map[string]bool{}
	rows, err := d.Pool.Query(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return err
	}
	for rows.Next() {
		var v string
		_ = rows.Scan(&v)
		applied[v] = true
	}
	rows.Close()

	type pend struct{ file, sql string }
	var pending []pend
	for _, f := range files {
		if applied[f] {
			continue
		}
		b, err := fs.ReadFile(mfs, f)
		if err != nil {
			return err
		}
		// Chặn TRƯỚC khi chạy: file chứa transaction-control -> fail-fast (nếu không half-apply thầm lặng).
		if hasTxnControl(string(b)) {
			return fmt.Errorf("migration %s chứa lệnh điều khiển transaction (BEGIN/COMMIT/ROLLBACK/END/SAVEPOINT/START TRANSACTION). Bỏ chúng — hệ migration đã tự bọc transaction", f)
		}
		pending = append(pending, pend{f, string(b)})
	}
	if len(pending) == 0 {
		return nil
	}

	// Kết nối RIÊNG, statement_timeout=0: backfill lớn không bị pool 15s giết giữa chừng. (server/db.js:120)
	url := applySSLMode(d.cfg.DatabaseURL, d.cfg.PGSSL)
	mc, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer mc.Close(ctx)
	_, _ = mc.Exec(ctx, "SET TIME ZONE 'Asia/Ho_Chi_Minh'")
	_, _ = mc.Exec(ctx, "SET statement_timeout = 0")

	ran := 0
	for _, p := range pending {
		if err := runOneMigration(ctx, mc, p.file, p.sql); err != nil {
			return fmt.Errorf("migration thất bại: %s — %w", p.file, err)
		}
		fmt.Printf("🗃️  Migration đã áp: %s\n", p.file)
		ran++
	}
	if ran > 0 {
		fmt.Printf("✅ Đã áp %d migration mới\n", ran)
	}
	return nil
}

func runOneMigration(ctx context.Context, mc *pgx.Conn, file, sql string) error {
	if _, err := mc.Exec(ctx, "BEGIN"); err != nil {
		return err
	}
	// chạy toàn bộ file (nhiều câu lệnh) qua simple protocol
	mrr := mc.PgConn().Exec(ctx, sql)
	_, err := mrr.ReadAll()
	if cerr := mrr.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		_, err = mc.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", file)
	}
	if err != nil {
		_, _ = mc.Exec(ctx, "ROLLBACK")
		return err
	}
	_, err = mc.Exec(ctx, "COMMIT")
	return err
}

func leadingInt(s string) int {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	n, _ := strconv.Atoi(s[:i])
	return n
}

// GetSettings nạp toàn bộ bảng settings thành map key->value (chuỗi). (server/db.js:276-281)
func (d *DB) GetSettings(ctx context.Context) (map[string]string, error) {
	rows, err := d.Pool.Query(ctx, "SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k string
		var v *string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		if v != nil {
			out[k] = *v
		} else {
			out[k] = ""
		}
	}
	return out, rows.Err()
}

// WithTx chạy fn trong 1 transaction; tự COMMIT/ROLLBACK. (server/db.js:40-53)
func (d *DB) WithTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// seedDefaults tạo admin (fail-fast nếu thiếu ADMIN_PASSWORD), ~80 settings, danh mục. (server/db.js:159-274)
func (d *DB) seedDefaults(ctx context.Context) error {
	var adminID int
	err := d.Pool.QueryRow(ctx, "SELECT id FROM users WHERE username = $1", d.cfg.AdminUsername).Scan(&adminID)
	if err != nil { // không có admin -> tạo
		pw := d.cfg.AdminPassword
		if len(pw) < 6 {
			return fmt.Errorf("chưa có tài khoản quản trị và ADMIN_PASSWORD thiếu/quá ngắn (≥6). Đặt ADMIN_PASSWORD rồi khởi động lại")
		}
		hash, herr := bcrypt.GenerateFromPassword([]byte(pw), 10)
		if herr != nil {
			return herr
		}
		if _, e := d.Pool.Exec(ctx,
			"INSERT INTO users (username, password_hash, role, full_name, must_change_password) VALUES ($1,$2,'admin',$3,true)",
			d.cfg.AdminUsername, string(hash), "Quản trị viên"); e != nil {
			return e
		}
		fmt.Printf("👤 Đã tạo tài khoản quản trị: %s (bắt buộc đổi mật khẩu lần đầu)\n", d.cfg.AdminUsername)
	}

	for _, kv := range defaultSettings(d.cfg.DormName) {
		if _, e := d.Pool.Exec(ctx,
			"INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING", kv[0], kv[1]); e != nil {
			return e
		}
	}

	var assetC int
	_ = d.Pool.QueryRow(ctx, "SELECT COUNT(*)::int FROM assets").Scan(&assetC)
	if assetC == 0 {
		for i, a := range seedAssets {
			if _, e := d.Pool.Exec(ctx,
				"INSERT INTO assets (name, unit, category, quantity, fee, sort) VALUES ($1,$2,$3,$4,$5,$6)",
				a.name, a.unit, a.category, a.quantity, a.fee, i); e != nil {
				return e
			}
		}
		fmt.Println("🪑 Đã tạo danh mục tài sản mặc định")
	}

	var vtC int
	_ = d.Pool.QueryRow(ctx, "SELECT COUNT(*)::int FROM violation_types").Scan(&vtC)
	if vtC == 0 {
		for i, v := range seedViolationTypes {
			if _, e := d.Pool.Exec(ctx,
				"INSERT INTO violation_types (name, severity, sort) VALUES ($1,$2,$3)", v[0], v[1], i); e != nil {
				return e
			}
		}
		fmt.Println("⚠️  Đã tạo danh mục loại vi phạm mặc định")
	}

	var facID int
	if err := d.Pool.QueryRow(ctx, "SELECT id FROM facilities LIMIT 1").Scan(&facID); err != nil {
		if _, e := d.Pool.Exec(ctx, "INSERT INTO facilities (name, address) VALUES ($1,$2)",
			"Cơ sở 1", "11/9/4 Thoại Ngọc Hầu, Phường Hòa Thạnh, Quận Tân Phú, Thành phố Hồ Chí Minh"); e != nil {
			return e
		}
		fmt.Println("🏢 Đã tạo cơ sở mặc định")
	}
	return nil
}
