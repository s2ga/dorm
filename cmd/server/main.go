// Điểm vào máy chủ Go — tương đương server/index.js. Nạp env, ghim TZ, init DB, dựng router,
// listen + graceful shutdown (SIGTERM/SIGINT).
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ktx/internal/config"
	"ktx/internal/db"
	"ktx/internal/httpx"
	_ "ktx/internal/timeutil" // ghim múi giờ VN (init)
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Println("Không khởi động được:", err)
		os.Exit(1)
	}

	ctx := context.Background()
	database, err := db.New(ctx, cfg)
	if err != nil {
		fmt.Println("Không khởi động được:", err)
		os.Exit(1)
	}
	if err := database.Init(ctx); err != nil {
		fmt.Println("Không khởi động được:", err)
		os.Exit(1)
	}

	r := httpx.NewRouter(database, cfg)
	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r}

	// Tiện ích chỉ dành cho môi trường thử phải NÓI RA lúc khởi động. Quên đặt APP_ENV=production là
	// nó chạy thật trên production mà không ai biết — in ra đây để lộ ngay ở dòng log đầu tiên.
	if !cfg.LaProduction() {
		fmt.Printf("⚠️  APP_ENV=%s (không phải production) → BẬT tự ghép hồ sơ học viên khi đăng nhập\n"+
			"    Microsoft lần đầu nếu mã học viên trùng email VÀ họ tên trùng, bỏ qua bước admin duyệt.\n"+
			"    Bản production PHẢI đặt APP_ENV=production để tắt.\n", cfg.AppEnv)
	}

	go func() {
		fmt.Printf("🚀 Ứng dụng chạy tại http://localhost:%s\n", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Println("Lỗi máy chủ:", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown: ngừng nhận request mới, đóng pool, thoát sạch.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	fmt.Println("\n— đang tắt máy chủ...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
	database.Pool.Close()
}
