// Package config nạp .env (godotenv, không ghi đè biến sẵn có — giống server/load-env.js)
// và validate các biến bắt buộc theo đúng ràng buộc fail-fast của bản Node.
package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL string
	PGSSL       string // "disable" = tắt SSL (Postgres nội bộ)

	JWTSecret    string
	CookieSecure bool

	AdminUsername string
	AdminPassword string
	DormName      string

	Port      string
	SchemaDir string // thư mục chứa schema.sql + migrations/ (mặc định "server")

	// Object storage (S3 / Supabase Storage)
	S3Endpoint    string
	S3Region      string
	S3AccessKey   string
	S3SecretKey   string
	S3CccdBucket  string
	S3IntroBucket string

	// SSO Microsoft (tuỳ chọn — cấu hình nằm ở bảng settings + AZURE_* ; KHÔNG có công tắc ENV,
	// xem internal/sso/sso.go Config())
	SSORedirectURI string
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// Load đọc .env rồi build Config. Fail-fast đúng như server/db.js + server/auth.js:
//   - thiếu DATABASE_URL  -> lỗi
//   - JWT_SECRET thiếu / < 16 ký tự -> lỗi
// ADMIN_PASSWORD chỉ được kiểm khi seed (lúc chưa có tài khoản admin), giống bản Node.
func Load() (*Config, error) {
	_ = godotenv.Load() // nạp .env nếu có; không có cũng không sao (dùng ENV thật)

	c := &Config{
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		PGSSL:         os.Getenv("PGSSL"),
		JWTSecret:     os.Getenv("JWT_SECRET"),
		CookieSecure:  os.Getenv("COOKIE_SECURE") == "true",
		AdminUsername: envOr("ADMIN_USERNAME", "admin"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"),
		DormName:      envOr("DORM_NAME", "Ký túc xá Nội trú Esuhai"),
		Port:          envOr("PORT", "3000"),
		SchemaDir:     envOr("SCHEMA_DIR", "server"),

		S3Endpoint:    os.Getenv("S3_ENDPOINT"),
		S3Region:      os.Getenv("S3_REGION"),
		S3AccessKey:   os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:   os.Getenv("S3_SECRET_KEY"),
		S3CccdBucket:  os.Getenv("S3_CCCD_BUCKET"),
		S3IntroBucket: os.Getenv("S3_INTRO_BUCKET"),

		SSORedirectURI: os.Getenv("SSO_REDIRECT_URI"),
	}

	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("Thiếu DATABASE_URL. Local: chạy \"docker compose up -d\" rồi đặt DATABASE_URL trong .env.")
	}
	if len(c.JWTSecret) < 16 {
		return nil, fmt.Errorf("Thiếu JWT_SECRET (hoặc quá ngắn < 16). Sinh chuỗi ngẫu nhiên rồi đặt vào ENV/.env.")
	}
	return c, nil
}
