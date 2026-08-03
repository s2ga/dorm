package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/scope"
)

// Báo cáo doanh thu. Port từ server/routes/reports.routes.js. Chỉ admin (requireRole('admin') — người điều phối wire).

// reportsFacilityCond: đa cơ sở cho báo cáo doanh thu (qua HV). server/routes/reports.routes.js:11-18
// Điều hành (facility_id null) thấy TỔNG mọi cơ sở, lọc tuỳ chọn ?facility; admin phụ trách một cơ sở
// chỉ thấy số liệu cơ sở mình. Trả điều kiện AND (đã gồm ' AND ' ở đầu, hoặc rỗng).
func reportsFacilityCond(u *auth.User, c *gin.Context, params *[]interface{}) string {
	if scope.IsExecutive(u) {
		// server/routes/reports.routes.js:13 — ?facility tuỳ chọn cho điều hành.
		if f := c.Query("facility"); f != "" {
			*params = append(*params, jsNumber(f))
			return " AND s.facility_id = $" + itoa(len(*params))
		}
		return ""
	}
	// server/routes/reports.routes.js:16 — quản lý cơ sở: ràng buộc theo cơ sở mình.
	cond := []string{}
	scope.ApplyFacilityFilter(u, "s.facility_id", &cond, params)
	if len(cond) == 0 {
		return ""
	}
	return " AND " + joinAnd(cond)
}

// RevenueReport: GET /api/reports/revenue (admin) — doanh thu theo tháng, tách từng dịch vụ. ?year=YYYY.
// server/routes/reports.routes.js:21-51
func (h *Handlers) RevenueReport(c *gin.Context) {
	u := auth.CurrentUser(c)
	params := []interface{}{}
	// Chỉ loại phiếu ĐÃ XOÁ. Phiếu của hồ sơ đã KHOÁ vẫn tính: khoá chặn sửa/đăng nhập chứ không
	// xoá nợ, tiền vẫn phải đi thu nên vẫn là doanh thu.
	where := "WHERE i.deleted_at IS NULL"
	// year phải đúng 4 chữ số; so tiền tố substr thay vì LIKE để tránh "?year=%" khớp mọi tháng (V2-70, js:29-34).
	if year := c.Query("year"); year != "" {
		if !isYyyy(year) {
			badRequest(c, "Năm không hợp lệ (cần 4 chữ số).")
			return
		}
		params = append(params, year)
		where += " AND substr(i.month,1,4) = $" + itoa(len(params))
	}
	where += reportsFacilityCond(u, c, &params)

	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT i.month,
		  COALESCE(SUM(i.room_charge),0) AS room,
		  COALESCE(SUM(i.electric_charge),0) AS electric,
		  COALESCE(SUM(i.water_charge),0) AS water,
		  COALESCE(SUM(i.service_charge),0) AS service,
		  COALESCE(SUM(i.washing_charge),0) AS washing,
		  COALESCE(SUM(i.parking_charge),0) AS parking,
		  COALESCE(SUM(i.other_charge),0) AS other,
		  COALESCE(SUM(i.deposit_charge),0) AS deposit,
		  COALESCE(SUM(i.total),0) AS total,
		  COUNT(*)::int AS count
		FROM invoices i JOIN students s ON s.id = i.student_id `+where+`
		GROUP BY i.month ORDER BY i.month`, params...)
	if err != nil {
		serverErr(c)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, list)
}

// RevenueYears: GET /api/reports/years (admin) — các năm có dữ liệu hoá đơn.
// PHẢI lọc y hệt /revenue — lệch nhau thì năm hiện trong ô chọn mà bấm vào /revenue trả rỗng
// (V2-69b). server/routes/reports.routes.js:56-67
func (h *Handlers) RevenueYears(c *gin.Context) {
	u := auth.CurrentUser(c)
	params := []interface{}{}
	facWhere := reportsFacilityCond(u, c, &params)
	rows, err := h.pool().Query(c.Request.Context(),
		`SELECT DISTINCT substr(i.month,1,4) AS y
		   FROM invoices i JOIN students s ON s.id = i.student_id
		  WHERE i.deleted_at IS NULL`+facWhere+`
		  ORDER BY y DESC`, params...)
	if err != nil {
		serverErr(c)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	// Node trả rows.map(r => r.y): mảng chuỗi năm, KHÔNG phải mảng object (js:65).
	out := make([]interface{}, 0, len(list))
	for _, r := range list {
		out = append(out, r["y"])
	}
	c.JSON(http.StatusOK, out)
}

// isYyyy: khớp /^\d{4}$/ — đúng 4 chữ số ASCII.
func isYyyy(s string) bool {
	if len(s) != 4 {
		return false
	}
	for i := 0; i < 4; i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// jsNumber: mô phỏng +req.query.facility của Node (Number()). facility_id là số nguyên nên chuỗi số
// nguyên hợp lệ -> int; chuỗi rỗng đã bị chặn ở nơi gọi. Chuỗi không phải số -> 0 (không khớp cơ sở nào,
// trả rỗng) thay vì NaN gây lỗi 500 như Node — sai lệch biên duy nhất, không ảnh hưởng đường dùng thật.
func jsNumber(s string) interface{} {
	n := 0
	neg := false
	i := 0
	if i < len(s) && (s[i] == '+' || s[i] == '-') {
		neg = s[i] == '-'
		i++
	}
	if i >= len(s) {
		return 0
	}
	for ; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0
		}
		n = n*10 + int(s[i]-'0')
	}
	if neg {
		n = -n
	}
	return n
}
