package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// Trả về IP mà gin chốt cho request đã dựng sẵn.
func ipThayDuoc(t *testing.T, proxies []string, remoteAddr, xff string) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := r.SetTrustedProxies(proxies); err != nil {
		t.Fatalf("SetTrustedProxies: %v", err)
	}
	var got string
	r.GET("/ip", func(c *gin.Context) { got = c.ClientIP(); c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.RemoteAddr = remoteAddr
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	r.ServeHTTP(httptest.NewRecorder(), req)
	return got
}

// BL-76: không khai proxy tin cậy thì X-Forwarded-For do client tự gửi phải bị BỎ QUA hoàn toàn,
// nếu không kẻ tấn công xoay header là mỗi request một xô đếm mới -> rate-limit vô hiệu.
func TestClientIPBoQuaXFFGiaMao(t *testing.T) {
	got := ipThayDuoc(t, nil, "203.0.113.9:5555", "1.2.3.4")
	if got != "203.0.113.9" {
		t.Fatalf("ClientIP = %q, phải là IP kết nối thật 203.0.113.9 — XFF giả mạo vẫn lọt", got)
	}
}

// Sau proxy tin cậy (Render): lấy mục XFF ngoài cùng bên phải KHÔNG thuộc dải tin cậy —
// đó là IP mà edge nhìn thấy. Phần client tự chèn nằm bên trái, không được tính.
func TestClientIPSauProxyTinCay(t *testing.T) {
	got := ipThayDuoc(t, []string{"10.0.0.0/8"}, "10.1.2.3:443", "1.2.3.4, 203.0.113.9")
	if got != "203.0.113.9" {
		t.Fatalf("ClientIP = %q, phải là 203.0.113.9 (mục phải nhất ngoài dải tin cậy)", got)
	}
}

func TestTrustedProxiesDocEnv(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "")
	if got := trustedProxies(); got != nil {
		t.Fatalf("để trống phải ra nil (không tin proxy nào), nhận %v", got)
	}
	t.Setenv("TRUSTED_PROXIES", " 10.0.0.0/8 , ,172.16.0.0/12 ")
	got := trustedProxies()
	if len(got) != 2 || got[0] != "10.0.0.0/8" || got[1] != "172.16.0.0/12" {
		t.Fatalf("phải cắt khoảng trắng và bỏ mục rỗng, nhận %v", got)
	}
}
