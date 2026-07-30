// Package httpx dựng gin.Engine: middleware bảo mật/body-limit/rate-limit, nhóm route /api,
// phục vụ tĩnh public/ + SPA fallback, /api/health.
package httpx

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/config"
	"ktx/internal/db"
	"ktx/internal/handlers"
	"ktx/internal/httpx/middleware"
	"ktx/internal/loginguard"
	"ktx/internal/storage"
)

type Server struct {
	Pub string
}

// NewRouter dựng engine đầy đủ.
func NewRouter(database *db.DB, cfg *config.Config) *gin.Engine {
	a := auth.New(cfg.JWTSecret, cfg.CookieSecure, database.Pool)
	guard := loginguard.New()
	// S3 tuỳ chọn: thiếu cấu hình -> nil, các endpoint ảnh/CCCD trả 501 thay vì chặn boot.
	store, err := storage.New(context.Background(), cfg)
	if err != nil {
		fmt.Println("⚠️  S3 chưa cấu hình:", err, "— các chức năng ảnh/CCCD sẽ trả 501.")
		store = nil
	}
	h := handlers.New(database, cfg, a, guard, store)
	s := &Server{Pub: envOr("PUBLIC_DIR", "public")}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.RequestLog())  // log mỗi request /api (+ thông điệp lỗi) ra stderr -> Render/Docker
	r.Use(middleware.Security()) // helmet/CSP cho MỌI response (kể cả index.html)
	r.Use(middleware.BodyLimit())

	authLim := middleware.AuthLimiter() // chung buckets cho login + change-password (như Node)

	api := r.Group("/api")
	api.Use(middleware.APILimiter())
	api.Use(middleware.Audit(database.Pool)) // nhật ký thao tác (write + GET nhạy cảm)
	// MON-01: health check PHẢI chạm DB. Trước đây trả {ok:true} vô điều kiện → Supabase chết mà
	// Render vẫn tưởng app khỏe (không restart, không cảnh báo) → app 500 hàng loạt trong im lặng.
	// Ping DB (timeout ngắn) → DB hỏng thì trả 503 để Render/monitor bên ngoài phát hiện.
	api.GET("/health", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := database.Pool.Ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "db": "down"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "db": "ok"})
	})

	ag := api.Group("/auth")
	ag.POST("/login", authLim, h.Login)
	ag.POST("/logout", h.Logout)
	ag.GET("/me", a.RequireAuth(), h.Me)
	ag.POST("/change-password", authLim, a.RequireAuth(), h.ChangePassword)
	ag.GET("/sso/config", h.SSOConfig)
	ssoLim := middleware.NewLimiter(15*60*1000, 30, "Bạn đã thử đăng nhập Microsoft quá nhiều lần. Vui lòng đợi vài phút.").Handler()
	ag.GET("/sso/start", ssoLim, h.SSOStart)
	ag.GET("/sso/callback", ssoLim, h.SSOCallback)
	ag.POST("/sso/exchange-params", ssoLim, h.SSOExchangeParams) // tham số đổi mã, gác bằng cookie state
	ag.POST("/sso/verify", ssoLim, h.SSOVerify)                  // luồng SPA: trình duyệt đổi mã, gửi id_token về đây

	set := api.Group("/settings", a.RequireAuth())
	set.GET("", a.RequireRole("admin", "staff"), h.GetSettings)
	set.PUT("", a.RequireRole("admin"), h.UpdateSettings)
	set.POST("/smtp/test", a.RequireRole("admin"), h.SmtpTest)

	// Cơ sở (facilities)
	fac := api.Group("/facilities", a.RequireAuth())
	fac.GET("", a.RequireRole("admin", "staff"), h.ListFacilities)
	fac.POST("", a.RequireRole("admin"), h.CreateFacility)
	fac.PUT("/:id", a.RequireRole("admin"), h.UpdateFacility)
	fac.DELETE("/:id", a.RequireRole("admin"), h.DeleteFacility)

	// Danh mục tài sản (assets)
	as := api.Group("/assets", a.RequireAuth())
	as.GET("", a.RequireRole("admin", "staff"), h.ListAssets)
	as.POST("", a.RequireRole("admin"), h.CreateAsset)
	as.PUT("/:id", a.RequireRole("admin"), h.UpdateAsset)
	as.DELETE("/:id", a.RequireRole("admin"), h.DeleteAsset)
	as.POST("/:id/restore", a.RequireRole("admin"), h.RestoreAsset)

	// Nhật ký check-in/out (logs)
	api.GET("/logs", a.RequireAuth(), a.RequireRole("admin", "staff"), h.ListLogs)

	// Báo cáo doanh thu (reports) — chỉ admin
	rep := api.Group("/reports", a.RequireAuth(), a.RequireRole("admin"))
	rep.GET("/revenue", h.RevenueReport)
	rep.GET("/years", h.RevenueYears)

	// Xe (vehicles)
	veh := api.Group("/vehicles", a.RequireAuth(), a.RequireRole("admin", "staff"))
	veh.GET("", h.ListVehicles)
	veh.POST("", h.CreateVehicle)
	veh.PUT("/:id", h.UpdateVehicle)
	veh.DELETE("/:id", h.DeleteVehicle)

	// Cổng học viên (me) — role student
	me := api.Group("/me", a.RequireAuth(), a.RequireRole("student"))
	me.GET("/profile", h.MeProfile)
	me.GET("/roommates", h.MeRoommates)
	me.GET("/assets", h.MeAssets)
	me.GET("/chores", h.MeChores)
	me.POST("/washing", h.MeWashing)
	me.GET("/invoices", h.MeInvoices)
	me.GET("/logs", h.MeLogs)
	me.GET("/violations", h.MeViolations)
	me.GET("/damage", h.MeDamageList)
	me.POST("/damage", h.MeDamageCreate)
	me.GET("/checkout-request", h.MeCheckoutRequestList)
	me.POST("/checkout-request", h.MeCheckoutRequestCreate)

	// Phòng (rooms) + phòng trưởng
	rm := api.Group("/rooms", a.RequireAuth())
	rm.GET("", a.RequireRole("admin", "staff"), h.ListRooms)
	rm.POST("", a.RequireRole("admin", "staff"), h.CreateRoom)
	rm.PUT("/:id", a.RequireRole("admin", "staff"), h.UpdateRoom)
	rm.DELETE("/:id", a.RequireRole("admin", "staff"), h.DeleteRoom)
	rm.POST("/:id/restore", a.RequireRole("admin", "staff"), h.RestoreRoom)
	rm.GET("/:id/leader", h.GetRoomLeader) // mọi user đăng nhập
	rm.POST("/:id/leader", a.RequireRole("admin", "staff"), h.SetRoomLeader)
	rm.DELETE("/:id/leader", a.RequireRole("admin", "staff"), h.UnsetRoomLeader)

	// Điện (electric)
	el := api.Group("/electric", a.RequireAuth(), a.RequireRole("admin", "staff"))
	el.GET("", h.ListElectric)
	el.GET("/history", h.ElectricHistory)
	el.POST("/bulk", h.SaveElectricBulk)

	// Admin
	adm := api.Group("/admin", a.RequireAuth(), a.RequireRole("admin"))
	adm.GET("/data-health", h.DataHealth)
	adm.GET("/audit", h.ListAudit)
	adm.GET("/pending-count", h.AdminPendingCount)
	adm.GET("/student-accounts", h.AdminStudentAccounts)
	adm.POST("/student-accounts/:id/revoke", h.AdminRevokeStudentSession)
	adm.GET("/users", h.ListUsers)
	adm.POST("/users", h.CreateUser)
	adm.PUT("/users/:id", h.UpdateUser)
	adm.POST("/users/:id/password", h.ResetPassword)
	adm.POST("/users/:id/unlock", h.UnlockUser) // mở khoá (DELETE = khoá, không xoá dữ liệu)
	adm.DELETE("/users/:id", h.DeleteUser)

	// Công khai (không cần đăng nhập)
	pub := api.Group("/public")
	pub.GET("/info", h.PublicInfo)
	pub.GET("/stats", h.PublicStats)
	pub.GET("/available-rooms", h.PublicAvailableRooms)
	pub.POST("/apply", middleware.ApplyLimiter(), h.PublicApply)
	pub.GET("/image/:key", h.PublicImage)
	pub.GET("/doc/noi-quy", h.PublicDocNoiQuy)

	// Đơn từ (requests)
	req := api.Group("/requests", a.RequireAuth(), a.RequireRole("admin", "staff"))
	req.GET("/damage", h.ListDamageReports)
	req.PUT("/damage/:id", h.UpdateDamageReport)
	req.POST("/damage/:id/assign", h.AssignDamageReport)
	req.GET("/checkout", h.ListCheckoutRequests)
	req.POST("/checkout/:id/confirm", h.ConfirmCheckout)
	req.POST("/checkout/:id/approve", h.ApproveCheckout) // BL-62: duyệt -> chờ bàn giao (không trả phòng ở bước này)
	req.PUT("/checkout/:id/note", h.NoteCheckout)
	req.POST("/checkout/:id/reject", h.RejectCheckout)
	req.POST("/checkout/:id/bill", h.BillCheckout)               // BL-62 GĐ2d: lập phiếu thu (handed_over -> billed)
	req.POST("/checkout/:id/refund-done", h.RefundDoneCheckout)  // BL-62 GĐ2e: đánh dấu đã hoàn cọc (billed -> done)
	req.POST("/checkout/create", h.AdminCreateCheckout)          // BL-62 GĐ2f: BQL tạo đơn hộ + duyệt luôn
	// BL-62 GĐ2c: an ninh bàn giao — role maintenance CŨNG được, nên đăng ký riêng ngoài group admin/staff.
	api.POST("/requests/checkout/:id/handover", a.RequireAuth(), a.RequireRole("admin", "staff", "maintenance"), h.HandoverCheckout)

	// Bảo trì (maintenance)
	mnt := api.Group("/maintenance", a.RequireAuth(), a.RequireRole("maintenance", "admin"))
	mnt.GET("/handovers", h.MaintHandovers)
	mnt.GET("/handovers/summary", h.MaintHandoversSummary)
	mnt.POST("/handovers/:id/checkin", h.MaintHandoverCheckin)
	mnt.POST("/handovers/:id/checkout", h.MaintHandoverCheckout)
	mnt.GET("/tasks", h.MaintTasks)
	mnt.GET("/summary", h.MaintSummary)
	mnt.POST("/tasks/:id/status", h.MaintTaskStatus)

	// Ảnh giới thiệu + nội quy (media) — chỉ admin
	med := api.Group("/media", a.RequireAuth(), a.RequireRole("admin"))
	med.GET("", h.ListMedia)
	med.POST("/doc/:key", h.UploadDoc)
	med.POST("/:key", h.UploadMedia)
	med.DELETE("/:key", h.DeleteMedia)

	// Học viên (students)
	st := api.Group("/students", a.RequireAuth())
	st.GET("/:id/cccd/:side", h.StudentCccdImage) // chỉ requireAuth (nay 501 stub)
	rs := st.Group("", a.RequireRole("admin", "staff"))
	rs.GET("", h.ListStudents)
	rs.GET("/contract-no/next", h.ContractNoNext)
	rs.POST("/contract-no/renumber", h.ContractNoRenumber)
	rs.GET("/:id", h.GetStudent)
	rs.POST("", h.CreateStudent)
	rs.PUT("/:id", h.UpdateStudent)
	rs.DELETE("/:id", h.DeleteStudent)
	rs.POST("/:id/restore", h.RestoreStudent)
	rs.POST("/:id/washing", h.StudentWashing)
	rs.POST("/:id/checkin", h.StudentCheckin)
	rs.POST("/:id/checkout", h.StudentCheckout)
	rs.POST("/:id/transfer", h.StudentTransfer)
	rs.POST("/:id/deposit", h.StudentDeposit)
	rs.POST("/:id/deposit-settle", h.StudentDepositSettle)
	rs.POST("/:id/account", h.StudentAccount)

	// Hoá đơn (invoices)
	inv := api.Group("/invoices", a.RequireAuth(), a.RequireRole("admin", "staff"))
	inv.POST("/generate", h.GenerateInvoices)
	inv.POST("/generate-one", h.GenerateOneInvoice)
	inv.GET("", h.ListInvoices)
	inv.GET("/months", h.InvoiceMonths)
	inv.POST("", h.CreateInvoice)
	inv.PUT("/:id", h.UpdateInvoice)
	inv.POST("/:id/status", h.InvoiceStatus)
	inv.POST("/:id/recalc", h.RecalcInvoice)
	inv.POST("/mark-paid", a.RequireRole("admin"), h.MarkPaidInvoices)
	inv.DELETE("/:id", h.DeleteInvoice)

	// Vi phạm (violations) + loại vi phạm
	vio := api.Group("/violations", a.RequireAuth(), a.RequireRole("admin", "staff"))
	vio.GET("", h.ListViolations)
	vio.GET("/stats", h.ViolationStats)
	vio.GET("/mail-status", h.ViolationMailStatus)
	vio.GET("/types", h.ListViolationTypes)
	vio.POST("/types", a.RequireRole("admin"), h.CreateViolationType)
	vio.PUT("/types/:id", a.RequireRole("admin"), h.UpdateViolationType)
	vio.DELETE("/types/:id", a.RequireRole("admin"), h.DeleteViolationType)
	vio.GET("/student/:id", h.ViolationsByStudent)
	vio.POST("/student/:id/notify", h.NotifyStudentSchool)
	vio.POST("", h.CreateViolation)
	vio.PUT("/:id", h.UpdateViolation)
	vio.DELETE("/:id", h.DeleteViolation)

	// Đơn đăng ký (applications)
	app := api.Group("/applications", a.RequireAuth(), a.RequireRole("admin", "staff"))
	app.GET("", h.ListApplications)
	app.PUT("/:id/note", h.NoteApplication)
	app.POST("/:id/approve", h.ApproveApplication)
	app.POST("/:id/reject", h.RejectApplication)
	app.DELETE("/:id", h.DeleteApplication)

	// Tĩnh + SPA fallback.
	r.NoRoute(s.serveStaticOrSPA)
	return r
}

func (s *Server) serveStaticOrSPA(c *gin.Context) {
	p := c.Request.URL.Path
	if strings.HasPrefix(p, "/api") {
		c.JSON(http.StatusNotFound, gin.H{"error": "Không tìm thấy"})
		return
	}
	index := filepath.Join(s.Pub, "index.html")
	if p == "/" || p == "" {
		c.File(index)
		return
	}
	clean := filepath.Clean(p)
	full := filepath.Join(s.Pub, clean)
	absPub, _ := filepath.Abs(s.Pub)
	absFull, _ := filepath.Abs(full)
	if strings.HasPrefix(absFull, absPub) {
		if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
			c.File(full)
			return
		}
	}
	c.File(index)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
