package handlers

// Học viên đăng nhập bằng Microsoft, hai đường:
//   · email hồ sơ học viên khớp email Microsoft -> vào thẳng, bỏ qua duyệt (ssoResolveUser)
//   · không khớp -> chờ duyệt, admin bấm Duyệt rồi ghép hồ sơ (ApproveUserAsStudent)
//   go test ./internal/handlers/ -run "HocVien|Duyet" -v   (cần Postgres local; không có DB -> t.Skip)

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/sso"
)

const hvTestPrefix = "__test_hv"

// hvHandlers: Handlers có đủ DB + Auth (ApproveUserAsStudent gọi RevokeTokens), tự dọn sau test.
func hvHandlers(t *testing.T) (*Handlers, context.Context) {
	t.Helper()
	url := "postgres://ktx:ktx_local_secret@localhost:5432/ktx"
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skipf("không mở được CSDL local (%v) — bỏ qua", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("CSDL local chưa chạy (%v) — bỏ qua (chạy `npm run services` trước)", err)
	}
	don := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE username LIKE $1 OR email LIKE $1`, hvTestPrefix+"%")
		_, _ = pool.Exec(ctx, `DELETE FROM students WHERE name LIKE $1 OR email LIKE $1`, hvTestPrefix+"%")
	}
	don()
	t.Cleanup(func() { don(); pool.Close() })
	return &Handlers{DB: &db.DB{Pool: pool}, Auth: auth.New("test-secret-du-dai-16-ky-tu", false, pool)}, ctx
}

// taoHoSoHV: hồ sơ học viên mẫu, trả id.
func taoHoSoHV(t *testing.T, h *Handlers, ctx context.Context, ten, email string) int {
	t.Helper()
	var id int
	if err := h.pool().QueryRow(ctx,
		`INSERT INTO students (name, gender, email) VALUES ($1,'male',$2) RETURNING id`, ten, email).Scan(&id); err != nil {
		t.Fatalf("không tạo được hồ sơ học viên: %v", err)
	}
	return id
}

// goiDuyet: gọi handler ApproveUserAsStudent như một request thật.
func goiDuyet(t *testing.T, h *Handlers, userID int, body interface{}) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(userID)}}
	b, _ := json.Marshal(body)
	c.Request = httptest.NewRequest("POST", "/", strings.NewReader(string(b)))
	c.Request.Header.Set("Content-Type", "application/json")
	h.ApproveUserAsStudent(c)
	return w
}

// Email Microsoft trùng email hồ sơ -> vào THẲNG cổng học viên, không nằm hàng chờ.
func TestSSOHocVienTrungEmailThiVaoThang(t *testing.T) {
	h, ctx := hvHandlers(t)
	email := hvTestPrefix + "_a@esuhai.com"
	stID := taoHoSoHV(t, h, ctx, hvTestPrefix+" Nguyễn Văn A", email)

	u, err := h.ssoResolveUser(ctx, sso.Identity{Subject: hvTestPrefix + "_sub_a", Email: email, FullName: "Nguyễn Văn A"})
	if err != nil || u == nil {
		t.Fatalf("học viên có email khớp phải vào được: (user=%v, err=%v)", u, err)
	}
	if u.Role != "student" {
		t.Errorf("vai phải là student, nhận %q — người này sẽ vào cổng nhân viên", u.Role)
	}
	if u.StudentID == nil || *u.StudentID != stID {
		t.Errorf("không ghép đúng hồ sơ: student_id=%v, muốn %d — vào trong sẽ trống trơn", u.StudentID, stID)
	}
	if !u.Approved {
		t.Error("approved=false — vẫn kẹt ở màn chờ duyệt, đúng cái đang muốn bỏ")
	}
}

// Email không khớp hồ sơ nào -> vẫn phải chờ duyệt (không được đoán bừa là học viên).
func TestSSOEmailKhongKhopThiVanChoDuyet(t *testing.T) {
	h, ctx := hvHandlers(t)
	u, err := h.ssoResolveUser(ctx, sso.Identity{
		Subject: hvTestPrefix + "_sub_la", Email: hvTestPrefix + "_la@esuhai.com", FullName: "Người Lạ"})
	if err != nil || u == nil {
		t.Fatalf("phải tạo được tài khoản chờ duyệt: (user=%v, err=%v)", u, err)
	}
	if u.Role != "pending" || u.Approved {
		t.Errorf("phải là pending/chưa duyệt, nhận role=%q approved=%v", u.Role, u.Approved)
	}
}

// Hồ sơ ĐÃ có tài khoản (admin cấp mật khẩu trước) -> LIÊN KẾT vào tài khoản đó, KHÔNG tạo bản thứ hai.
func TestSSOHocVienDaCoTaiKhoanThiLienKet(t *testing.T) {
	h, ctx := hvHandlers(t)
	email := hvTestPrefix + "_b@esuhai.com"
	stID := taoHoSoHV(t, h, ctx, hvTestPrefix+" Trần Thị B", email)
	var accID int
	if err := h.pool().QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, student_id, approved)
		 VALUES ($1,'x','student','Trần Thị B',$2,true) RETURNING id`, hvTestPrefix+"_b_cu", stID).Scan(&accID); err != nil {
		t.Fatalf("không tạo được tài khoản cũ: %v", err)
	}

	u, err := h.ssoResolveUser(ctx, sso.Identity{Subject: hvTestPrefix + "_sub_b", Email: email, FullName: "Trần Thị B"})
	if err != nil || u == nil {
		t.Fatalf("phải liên kết được: (user=%v, err=%v)", u, err)
	}
	if u.ID != accID {
		t.Errorf("trả về tài khoản id=%d, muốn %d — đã tạo bản trùng", u.ID, accID)
	}
	var n int
	if err := h.pool().QueryRow(ctx, "SELECT COUNT(*)::int FROM users WHERE student_id=$1", stID).Scan(&n); err != nil {
		t.Fatalf("đếm lỗi: %v", err)
	}
	if n != 1 {
		t.Errorf("có %d tài khoản cho một hồ sơ — thu hồi một cái vẫn còn lối vào kia", n)
	}
}

// Duyệt tài khoản chờ -> ghép vào hồ sơ CÓ SẴN; email được ghi vào hồ sơ cho lần sau vào thẳng.
func TestDuyetThanhHocVienGhepHoSoCoSan(t *testing.T) {
	h, ctx := hvHandlers(t)
	stID := taoHoSoHV(t, h, ctx, hvTestPrefix+" Lê Văn C", "") // hồ sơ CHƯA có email
	var uID int
	if err := h.pool().QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, email, approved)
		 VALUES ($1,NULL,'pending','Lê Văn C',$2,false) RETURNING id`,
		hvTestPrefix+"_c@esuhai.com", hvTestPrefix+"_c@esuhai.com").Scan(&uID); err != nil {
		t.Fatalf("không tạo được tài khoản chờ: %v", err)
	}

	if w := goiDuyet(t, h, uID, map[string]interface{}{"student_id": stID}); w.Code != 200 {
		t.Fatalf("duyệt hỏng: HTTP %d — %s", w.Code, w.Body.String())
	}
	var role string
	var sid *int
	var approved bool
	if err := h.pool().QueryRow(ctx,
		"SELECT role, student_id, approved FROM users WHERE id=$1", uID).Scan(&role, &sid, &approved); err != nil {
		t.Fatalf("đọc lại lỗi: %v", err)
	}
	if role != "student" || sid == nil || *sid != stID || !approved {
		t.Fatalf("sau duyệt: role=%q student_id=%v approved=%v — muốn student/%d/true", role, sid, approved, stID)
	}
	var emailHoSo string
	if err := h.pool().QueryRow(ctx, "SELECT COALESCE(email,'') FROM students WHERE id=$1", stID).Scan(&emailHoSo); err != nil {
		t.Fatalf("đọc hồ sơ lỗi: %v", err)
	}
	if emailHoSo != hvTestPrefix+"_c@esuhai.com" {
		t.Errorf("email chưa ghi vào hồ sơ (đang là %q) — lần sau vẫn phải duyệt tay", emailHoSo)
	}
}

// Duyệt tài khoản chờ -> TẠO hồ sơ học viên mới rồi ghép.
func TestDuyetThanhHocVienTaoHoSoMoi(t *testing.T) {
	h, ctx := hvHandlers(t)
	var uID int
	if err := h.pool().QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, email, approved)
		 VALUES ($1,NULL,'pending','Phạm Thị D',$2,false) RETURNING id`,
		hvTestPrefix+"_d@esuhai.com", hvTestPrefix+"_d@esuhai.com").Scan(&uID); err != nil {
		t.Fatalf("không tạo được tài khoản chờ: %v", err)
	}

	w := goiDuyet(t, h, uID, map[string]interface{}{
		"new_student": map[string]string{"name": hvTestPrefix + " Phạm Thị D", "code": hvTestPrefix + "-01", "gender": "female"},
	})
	if w.Code != 200 {
		t.Fatalf("duyệt hỏng: HTTP %d — %s", w.Code, w.Body.String())
	}
	var sid *int
	var role string
	if err := h.pool().QueryRow(ctx, "SELECT role, student_id FROM users WHERE id=$1", uID).Scan(&role, &sid); err != nil {
		t.Fatalf("đọc lại lỗi: %v", err)
	}
	if role != "student" || sid == nil {
		t.Fatalf("sau duyệt: role=%q student_id=%v", role, sid)
	}
	var ten, gioi, emailHoSo string
	var phong *int
	if err := h.pool().QueryRow(ctx,
		"SELECT name, gender, COALESCE(email,''), room_id FROM students WHERE id=$1", *sid).Scan(&ten, &gioi, &emailHoSo, &phong); err != nil {
		t.Fatalf("hồ sơ mới không đọc được: %v", err)
	}
	if gioi != "female" || emailHoSo != hvTestPrefix+"_d@esuhai.com" {
		t.Errorf("hồ sơ mới sai: gender=%q email=%q", gioi, emailHoSo)
	}
	if phong != nil {
		t.Error("hồ sơ mới bị gán phòng — duyệt tài khoản không phải check-in, gán phòng là phát sinh tiền oan")
	}
}

// Hồ sơ đã có tài khoản rồi thì KHÔNG cho ghép thêm tài khoản thứ hai.
func TestDuyetChanHoSoDaCoTaiKhoan(t *testing.T) {
	h, ctx := hvHandlers(t)
	stID := taoHoSoHV(t, h, ctx, hvTestPrefix+" Võ Văn E", "")
	if _, err := h.pool().Exec(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, student_id, approved)
		 VALUES ($1,'x','student','Võ Văn E',$2,true)`, hvTestPrefix+"_e_cu", stID); err != nil {
		t.Fatalf("không tạo được tài khoản cũ: %v", err)
	}
	var uID int
	if err := h.pool().QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, approved)
		 VALUES ($1,NULL,'pending','Kẻ trùng tên',false) RETURNING id`, hvTestPrefix+"_e_moi").Scan(&uID); err != nil {
		t.Fatalf("không tạo được tài khoản chờ: %v", err)
	}

	w := goiDuyet(t, h, uID, map[string]interface{}{"student_id": stID})
	if w.Code == 200 {
		t.Fatalf("cho ghép tài khoản thứ hai vào cùng hồ sơ — HTTP 200: %s", w.Body.String())
	}
	var role string
	if err := h.pool().QueryRow(ctx, "SELECT role FROM users WHERE id=$1", uID).Scan(&role); err != nil {
		t.Fatalf("đọc lại lỗi: %v", err)
	}
	if role != "pending" {
		t.Errorf("bị từ chối mà vai vẫn đổi thành %q", role)
	}
}
