package db

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Querier: giao diện chung cho *pgxpool.Pool VÀ pgx.Tx — tương đương helper run(db,...) của Node
// (cho các module chạy được cả trong transaction lẫn trực tiếp trên pool).
type Querier interface {
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
}
