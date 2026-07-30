package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// BL-15: khoá rate-limit phải gộp IPv6 về /64 (xoay hậu tố trong dải KHÔNG ra khoá mới),
// còn IPv4 giữ nguyên từng địa chỉ.
func TestNormIP(t *testing.T) {
	cases := []struct{ in, want string }{
		// IPv4 giữ nguyên
		{"127.0.0.1", "127.0.0.1"},
		{"203.0.113.9", "203.0.113.9"},
		// IPv6 gộp /64
		{"2001:db8:abcd:1234:1:2:3:4", "2001:db8:abcd:1234::/64"},
		{"2001:db8:abcd:1234:ff:ee:dd:cc", "2001:db8:abcd:1234::/64"},
		// Không parse được -> nguyên chuỗi
		{"", ""},
		{"garbage", "garbage"},
	}
	for _, c := range cases {
		if got := normIP(c.in); got != c.want {
			t.Errorf("normIP(%q) = %q; muốn %q", c.in, got, c.want)
		}
	}

	// Hai địa chỉ IPv6 KHÁC hậu tố nhưng CÙNG /64 -> CÙNG khoá (không lách được).
	a := normIP("2001:db8:abcd:1234:aaaa:bbbb:cccc:dddd")
	b := normIP("2001:db8:abcd:1234:1111:2222:3333:4444")
	if a != b {
		t.Errorf("cùng /64 phải cùng khoá: %q vs %q", a, b)
	}
	// Khác /64 -> khoá khác.
	d := normIP("2001:db8:abcd:9999:1111:2222:3333:4444")
	if a == d {
		t.Errorf("khác /64 phải khác khoá: %q == %q", a, d)
	}
}

// Đăng nhập Microsoft trót lọt đi qua 3 endpoint (start + exchange-params + verify) và cả 3 đều
// chung một rổ đếm theo IP — mà ký túc xá thì NAT cả toà nhà sau một IP. Lượt THÀNH CÔNG không
// được tính, nếu không vài chục người đăng nhập đúng cũng đủ khoá cả mạng.
func TestSSOLimiterBoDemLuotThanhCong(t *testing.T) {
	gin.SetMode(gin.TestMode)
	goi := func(r *gin.Engine, path string) int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "203.0.113.9:5000"
		r.ServeHTTP(w, req)
		return w.Code
	}

	r := gin.New()
	r.Use(SSOLimiter())
	r.GET("/ok", func(c *gin.Context) { c.Redirect(http.StatusFound, "https://login.microsoftonline.com/") })
	r.GET("/hong", func(c *gin.Context) { c.JSON(http.StatusBadRequest, gin.H{"error": "state sai"}) })

	// 1000 lượt thành công từ CÙNG một IP — không lượt nào được bị chặn.
	for i := 0; i < 1000; i++ {
		if code := goi(r, "/ok"); code != http.StatusFound {
			t.Fatalf("lượt thành công thứ %d bị chặn: %d (phải 302)", i+1, code)
		}
	}

	// Chỉ lượt HỎNG mới tích: đúng 300 lượt đầu lọt, lượt 301 bị chặn.
	for i := 0; i < 300; i++ {
		if code := goi(r, "/hong"); code != http.StatusBadRequest {
			t.Fatalf("lượt hỏng thứ %d trả %d, chưa tới trần mà đã chặn", i+1, code)
		}
	}
	if code := goi(r, "/hong"); code != http.StatusTooManyRequests {
		t.Fatalf("quá trần vẫn lọt: %d (phải 429)", code)
	}

	// IP khác có rổ riêng — người trong ký túc xá bị chặn không kéo theo người ngoài.
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/hong", nil)
	req.RemoteAddr = "198.51.100.7:5000"
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("IP khác bị vạ lây: %d", w.Code)
	}
}
