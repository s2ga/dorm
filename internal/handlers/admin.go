package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/valid"
)

// Handler quản trị (admin). Port từ server/routes/admin.routes.js.
// Router gốc: requireAuth + requireRole('admin') (admin.routes.js:8) — người điều phối wire ngoài.

// ---- TÌNH TRẠNG DỮ LIỆU ---- admin.routes.js:11-48
// Ràng buộc CSDL chỉ áp được khi dữ liệu sạch; cái nào chưa áp nằm trong schema_guard. Nhưng chị
// quản lý không đọc nhật ký máy chủ nên phải bày ra đây kèm ĐÍCH DANH bản ghi cần sửa.
type adminKiemTra struct {
	ma, ten, viSao, cachSua, sql string
}

var adminKiemTraList = []adminKiemTra{
	{
		ma: "ma_hv_trung", ten: "Học viên trùng mã",
		viSao:   "Một người có 2 hồ sơ → nhận 2 phiếu → bị thu tiền 2 lần.",
		cachSua: `Giữ 1 hồ sơ, xoá hồ sơ thừa. Nếu bạn ấy chuyển phòng, dùng nút "Chuyển phòng" trên hồ sơ giữ lại.`,
		sql: `SELECT s.code AS khoa, string_agg(s.name || ' (#' || s.id || COALESCE(' · ' || r.name, '') || ')', ' + ' ORDER BY s.id) AS chi_tiet
            FROM students s LEFT JOIN rooms r ON r.id = s.room_id
           WHERE s.deleted_at IS NULL AND COALESCE(btrim(s.code),'') <> ''
           GROUP BY s.code HAVING COUNT(*) > 1 ORDER BY s.code`,
	},
	{
		ma: "ngay_ra_truoc_ngay_vao", ten: "Ngày trả phòng trước ngày nhận phòng",
		viSao:   "Thường là gõ nhầm NĂM. Số ngày ở tính ra 0 → phiếu sai.",
		cachSua: "Mở hồ sơ, sửa lại năm cho đúng.",
		sql: `SELECT name AS khoa, 'vào ' || check_in_date || ' · ra ' || check_out_date || ' (#' || id || ')' AS chi_tiet
            FROM students WHERE deleted_at IS NULL AND check_out_date < check_in_date ORDER BY check_out_date - check_in_date`,
	},
	{
		ma: "cccd_trung", ten: "Học viên trùng CCCD",
		viSao:   "Hai người không thể chung một CCCD → chắc chắn có hồ sơ thừa.",
		cachSua: "Giữ 1 hồ sơ, xoá hồ sơ thừa.",
		sql: `SELECT id_card AS khoa, string_agg(name || ' (#' || id || ')', ' + ' ORDER BY id) AS chi_tiet
            FROM students WHERE deleted_at IS NULL AND COALESCE(btrim(id_card),'') <> ''
            GROUP BY id_card HAVING COUNT(*) > 1`,
	},
	{
		ma: "so_hd_trung", ten: "Trùng số hợp đồng",
		viSao:   "Hai người cầm cùng một số hợp đồng.",
		cachSua: "Đối chiếu hợp đồng giấy, sửa lại số cho đúng người.",
		sql: `SELECT contract_no AS khoa, string_agg(name || ' (#' || id || ')', ' + ' ORDER BY id) AS chi_tiet
            FROM students WHERE deleted_at IS NULL AND COALESCE(btrim(contract_no),'') <> ''
            GROUP BY contract_no HAVING COUNT(*) > 1 ORDER BY contract_no`,
	},
}

// DataHealth: GET /api/admin/data-health — chạy các SQL kiểm trùng + đọc schema_guard. admin.routes.js:50-60
func (h *Handlers) DataHealth(c *gin.Context) {
	ctx := c.Request.Context()
	gRows, err := h.pool().Query(ctx, "SELECT ten, loi FROM schema_guard ORDER BY ten")
	if err != nil {
		serverErr(c)
		return
	}
	guards, err := db.RowsToMaps(gRows)
	if err != nil {
		serverErr(c)
		return
	}
	out := make([]gin.H, 0, len(adminKiemTraList))
	sach := len(guards) == 0
	for _, k := range adminKiemTraList {
		rows, err := h.pool().Query(ctx, k.sql)
		if err != nil {
			serverErr(c)
			return
		}
		list, err := db.RowsToMaps(rows)
		if err != nil {
			serverErr(c)
			return
		}
		soLuong := len(list)
		if soLuong != 0 {
			sach = false
		}
		shown := list
		if len(shown) > 30 {
			shown = shown[:30]
		}
		out = append(out, gin.H{
			"ma": k.ma, "ten": k.ten, "vi_sao": k.viSao, "cach_sua": k.cachSua,
			"so_luong": soLuong, "rows": shown,
		})
	}
	c.JSON(http.StatusOK, gin.H{"guards": guards, "checks": out, "sach": sach})
}

// adminYmdFmt: kiểm ĐỊNH DẠNG 'YYYY-MM-DD' (không xét ngày có thật, khớp regex của Node). admin.routes.js:72-73
var adminYmdFmt = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ListAudit: GET /api/admin/audit — nhật ký thao tác, lọc + phân trang. admin.routes.js:64-83
func (h *Handlers) ListAudit(c *gin.Context) {
	// limit = min(500, max(1, +limit || 200)); offset = max(0, +offset || 0). admin.routes.js:66-67
	limit := 200
	if v := c.Query("limit"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f != 0 {
			limit = int(f)
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}
	offset := 0
	if v := c.Query("offset"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			offset = int(f)
		}
	}
	if offset < 0 {
		offset = 0
	}

	cond := []string{}
	params := []interface{}{}
	if u := c.Query("user"); u != "" {
		params = append(params, "%"+u+"%")
		cond = append(cond, "username ILIKE $"+itoa(len(params)))
	}
	if m := c.Query("method"); m != "" {
		params = append(params, strings.ToUpper(m))
		cond = append(cond, "method = $"+itoa(len(params)))
	}
	// Lọc theo khoảng ngày (from/to là YYYY-MM-DD). to là trọn ngày -> so < to + 1 ngày. admin.routes.js:72-73
	if f := c.Query("from"); adminYmdFmt.MatchString(f) {
		params = append(params, f)
		cond = append(cond, "at >= $"+itoa(len(params))+"::date")
	}
	if t := c.Query("to"); adminYmdFmt.MatchString(t) {
		params = append(params, t)
		cond = append(cond, "at < ($"+itoa(len(params))+"::date + 1)")
	}
	if p := c.Query("path"); p != "" {
		params = append(params, "%"+p+"%")
		cond = append(cond, "path ILIKE $"+itoa(len(params)))
	}
	sqlWhere := ""
	if len(cond) > 0 {
		sqlWhere = "WHERE " + joinAnd(cond)
	}

	ctx := c.Request.Context()
	var total int
	if err := h.pool().QueryRow(ctx, "SELECT COUNT(*)::int c FROM audit_log "+sqlWhere, params...).Scan(&total); err != nil {
		serverErr(c)
		return
	}
	params = append(params, limit)
	pLimit := len(params)
	params = append(params, offset)
	pOffset := len(params)
	rows, err := h.pool().Query(ctx,
		"SELECT * FROM audit_log "+sqlWhere+" ORDER BY at DESC LIMIT $"+itoa(pLimit)+" OFFSET $"+itoa(pOffset), params...)
	if err != nil {
		serverErr(c)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"total": total, "limit": limit, "offset": offset, "rows": list})
}

/* ---------- Quản lý tài khoản nhân viên ---------- */
// Chỉ 3 vai này được tạo/sửa qua trang quản trị. KHÔNG ép thầm lặng vai lạ thành 'staff'. admin.routes.js:89
var adminValidRoles = map[string]bool{"admin": true, "staff": true, "maintenance": true}

// MANAGEABLE_ROLES = VALID_ROLES + 'pending' (tài khoản SSO chờ duyệt phải quản lý được). admin.routes.js:95-96
const adminManagedRolesSQL = "'admin','staff','maintenance','pending'"

// adminBodyStr: đọc field chuỗi từ body (giống `req.body[key] || ”`; non-string/null/absent -> "").
func adminBodyStr(body map[string]json.RawMessage, key string) string {
	raw, ok := body[key]
	if !ok {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return ""
}

// adminCheckFacilityExists: cơ sở phải tồn tại + chưa xoá. admin.routes.js:117-118
func (h *Handlers) adminCheckFacilityExists(ctx context.Context, id int) (*int, bool, string) {
	var one int
	if h.pool().QueryRow(ctx, "SELECT 1 FROM facilities WHERE id=$1 AND deleted_at IS NULL", id).Scan(&one) != nil {
		return nil, false, "Cơ sở không tồn tại (hoặc đã bị xoá)"
	}
	v := id
	return &v, true, ""
}

// adminParseFacilityID: chuẩn hoá + kiểm facility_id. admin.routes.js:113-120
//
//	absent/null/'' -> NULL (điều hành). Có giá trị -> phải là số nguyên > 0 và cơ sở tồn tại.
//	Trả (value, ok, errMsg): value nil = NULL; ok=false kèm errMsg khi sai.
func (h *Handlers) adminParseFacilityID(ctx context.Context, raw json.RawMessage) (*int, bool, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, true, ""
	}
	// Dạng chuỗi: '' -> NULL; ngược lại Number(raw) phải là số nguyên > 0.
	var s string
	if json.Unmarshal(raw, &s) == nil {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil, true, ""
		}
		n, err := strconv.ParseFloat(s, 64)
		if err != nil || n != float64(int(n)) || n <= 0 {
			return nil, false, "Cơ sở không hợp lệ"
		}
		return h.adminCheckFacilityExists(ctx, int(n))
	}
	// Dạng số.
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		if f != float64(int(f)) || f <= 0 {
			return nil, false, "Cơ sở không hợp lệ"
		}
		return h.adminCheckFacilityExists(ctx, int(f))
	}
	return nil, false, "Cơ sở không hợp lệ"
}

// ListUsers: GET /api/admin/users — tài khoản nhân viên (kèm cơ sở). admin.routes.js:98-109
// AdminPendingCount: GET /admin/pending-count — số tài khoản đang chờ duyệt (SSO tự tạo role='pending').
// Dùng để BÁO cho admin (chuông + badge) rằng có người cần duyệt.
func (h *Handlers) AdminPendingCount(c *gin.Context) {
	var n int
	if err := h.pool().QueryRow(c.Request.Context(),
		"SELECT COUNT(*)::int FROM users WHERE role='pending' AND deleted_at IS NULL").Scan(&n); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"pending": n})
}

// UnlockUser: POST /admin/users/:id/unlock — MỞ KHOÁ tài khoản đã khoá (cho đăng nhập lại).
// Bản ghi bị khoá bởi phiên bản CŨ có username dạng 'ten#da-xoa-12' -> cắt hậu tố để trả lại tên gốc;
// nếu tên gốc đã có người khác đang dùng thì báo rõ thay vì để vỡ khoá UNIQUE (500).
func (h *Handlers) UnlockUser(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy tài khoản")
		return
	}
	ctx := c.Request.Context()
	var uname string
	var locked bool
	if h.pool().QueryRow(ctx,
		"SELECT username, (deleted_at IS NOT NULL) FROM users WHERE id=$1 AND role IN ("+adminManagedRolesSQL+")",
		id).Scan(&uname, &locked) != nil {
		notFound(c, "Không tìm thấy tài khoản")
		return
	}
	if !locked {
		badRequest(c, "Tài khoản đang hoạt động — không cần mở khoá")
		return
	}
	orig := uname
	if i := strings.LastIndex(uname, "#da-xoa-"); i > 0 { // di sản bản cũ
		orig = uname[:i]
		var one int
		if h.pool().QueryRow(ctx,
			"SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL AND id<>$2", orig, id).Scan(&one) == nil {
			badRequest(c, `Tên đăng nhập "`+orig+`" hiện đã có người khác dùng — không mở khoá lại được. Hãy đổi tên tài khoản kia trước.`)
			return
		}
	}
	// approved: chỉ vai 'pending' mới có nghĩa "chờ duyệt". Vai thật mà approved=false là DI SẢN của lỗi
	// cũ (đăng nhập Microsoft lại sau khi bị khoá thì tự hạ approved=false) — mở khoá xong người ta vẫn
	// kẹt ở màn "Tài khoản đang chờ duyệt". Mở khoá là trả lại nguyên trạng nên bật lại luôn.
	if _, err := h.pool().Exec(ctx,
		`UPDATE users SET deleted_at=NULL, username=$2,
		   approved = CASE WHEN role <> 'pending' THEN true ELSE approved END
		 WHERE id=$1`, id, orig); err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "username": orig})
}

// AdminStudentAccounts: GET /admin/student-accounts — tài khoản ĐĂNG NHẬP của học viên.
// /admin/users cố tình chỉ trả nhân viên (adminManagedRolesSQL) nên admin không thấy được ai trong
// số học viên đăng nhập được. Đây là danh sách CHỈ ĐỌC cho tab "Người dùng"; đổi vai/xoá vẫn KHÔNG
// cho phép từ đây (tránh nâng nhầm học viên lên quyền quản trị) — tạo tài khoản vẫn ở hồ sơ HV.
func (h *Handlers) AdminStudentAccounts(c *gin.Context) {
	rows, err := h.pool().Query(c.Request.Context(),
		`SELECT u.id, u.username, u.full_name, u.email, u.auth_provider, u.must_change_password,
		        u.student_id, s.name AS student_name, s.code AS student_code, s.status AS student_status,
		        r.name AS room_name, (s.deleted_at IS NOT NULL) AS student_deleted
		   FROM users u
		   JOIN students s ON s.id = u.student_id
		   LEFT JOIN rooms r ON r.id = s.room_id
		  WHERE u.role = 'student' AND u.deleted_at IS NULL
		  ORDER BY s.name`)
	if err != nil {
		serverErr(c, err)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

// AdminRevokeStudentSession: POST /admin/student-accounts/:id/revoke — đá MỌI phiên đang mở của một
// tài khoản học viên (mất điện thoại / nghi lộ mật khẩu) mà KHÔNG đổi mật khẩu. Chỉ nhận role='student'
// để endpoint này không thành đường vòng tác động lên tài khoản quản trị.
func (h *Handlers) AdminRevokeStudentSession(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy tài khoản")
		return
	}
	ctx := c.Request.Context()
	var role string
	if h.pool().QueryRow(ctx, "SELECT role FROM users WHERE id=$1 AND deleted_at IS NULL", id).Scan(&role) != nil {
		notFound(c, "Không tìm thấy tài khoản")
		return
	}
	if role != "student" {
		forbidden(c, "Chỉ áp dụng cho tài khoản học viên")
		return
	}
	if err := h.Auth.RevokeTokens(ctx, id); err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) ListUsers(c *gin.Context) {
	rows, err := h.pool().Query(c.Request.Context(),
		// Trả CẢ tài khoản đã khoá (cờ locked) — trước đây lọc bỏ nên admin khoá xong là mất dấu,
		// không còn đường mở khoá. Đang hoạt động xếp trước, đã khoá xuống cuối.
		`SELECT u.id, u.username, u.role, u.full_name, u.facility_id, f.name AS facility_name, u.created_at,
                u.email, u.auth_provider, u.approved, (u.deleted_at IS NOT NULL) AS locked
           FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
          WHERE u.role IN (`+adminManagedRolesSQL+`)
          ORDER BY (u.deleted_at IS NOT NULL), u.role, u.username`)
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

// CreateUser: POST /api/admin/users. admin.routes.js:122-147
func (h *Handlers) CreateUser(c *gin.Context) {
	var body map[string]json.RawMessage
	_ = c.ShouldBindJSON(&body)
	username := strings.TrimSpace(adminBodyStr(body, "username"))
	password := strings.TrimSpace(adminBodyStr(body, "password"))
	if username == "" {
		badRequest(c, "Nhập tên đăng nhập")
		return
	}
	// role: absent/null/'' -> 'staff'; ngược lại giữ nguyên để kiểm. admin.routes.js:127
	rawRole := adminBodyStr(body, "role")
	role := rawRole
	if role == "" {
		role = "staff"
	}
	if !adminValidRoles[role] {
		badRequest(c, `Vai trò không hợp lệ: "`+rawRole+`". Chỉ nhận: nhân viên, bảo trì, quản trị.`)
		return
	}
	fullNameRaw := adminBodyStr(body, "full_name")
	if loiMk := valid.CheckPassword(password, []string{username, fullNameRaw}); loiMk != "" {
		badRequest(c, loiMk)
		return
	}
	ctx := c.Request.Context()
	// Đa cơ sở: NULL = điều hành; có id = quản lý đúng cơ sở đó. admin.routes.js:132-133
	facVal, ok, errMsg := h.adminParseFacilityID(ctx, body["facility_id"])
	if !ok {
		badRequest(c, errMsg)
		return
	}
	// ADMIN LUÔN là điều hành: không gán cơ sở cho admin (chốt 18/07). admin.routes.js:135
	var facValue interface{}
	if role != "admin" && facVal != nil {
		facValue = *facVal
	}
	// Trùng tên: chỉ tính tài khoản CÒN HIỆU LỰC. admin.routes.js:138-139
	var one int
	if h.pool().QueryRow(ctx, "SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL", username).Scan(&one) == nil {
		badRequest(c, `Tên đăng nhập "`+username+`" đã tồn tại`)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		serverErr(c)
		return
	}
	// Tài khoản do quản trị tạo -> buộc đổi mật khẩu lần đăng nhập đầu. admin.routes.js:141-144
	rows, err := h.pool().Query(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, facility_id, must_change_password)
         VALUES ($1,$2,$3,$4,$5,true) RETURNING id, username, role, full_name, facility_id`,
		username, string(hash), role, strings.TrimSpace(fullNameRaw), facValue)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil || row == nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusCreated, row)
}

// UpdateUser: PUT /api/admin/users/:id. admin.routes.js:149-195
func (h *Handlers) UpdateUser(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> câu lệnh SQL vỡ như Node (500)
		return
	}
	var body map[string]json.RawMessage
	_ = c.ShouldBindJSON(&body)
	// hasRole = role có gửi & khác ''. admin.routes.js:152
	rawRole := adminBodyStr(body, "role")
	hasRole := rawRole != ""
	if hasRole && !adminValidRoles[rawRole] {
		badRequest(c, `Vai trò không hợp lệ: "`+rawRole+`".`)
		return
	}
	ctx := c.Request.Context()
	// cur = vai hiện tại (chỉ tài khoản quản lý được, chưa xoá). admin.routes.js:155-156
	var curRole string
	if h.pool().QueryRow(ctx,
		"SELECT role FROM users WHERE id=$1 AND role IN ("+adminManagedRolesSQL+") AND deleted_at IS NULL", id).Scan(&curRole) != nil {
		notFound(c, "Không tìm thấy tài khoản")
		return
	}
	// Vai MỚI = vai gửi lên (nếu có) hoặc GIỮ NGUYÊN vai cũ. admin.routes.js:160
	newRole := curRole
	if hasRole {
		newRole = rawRole
	}
	u := auth.CurrentUser(c)
	if u != nil && id == u.ID && newRole != "admin" {
		badRequest(c, "Không thể tự hạ quyền chính mình.")
		return
	}
	// Giữ ít nhất 1 quản trị. admin.routes.js:164-167
	if curRole == "admin" && newRole != "admin" {
		var admins int
		if h.pool().QueryRow(ctx, "SELECT COUNT(*)::int c FROM users WHERE role='admin' AND deleted_at IS NULL").Scan(&admins) != nil {
			serverErr(c)
			return
		}
		if admins <= 1 {
			badRequest(c, "Phải còn ít nhất 1 quản trị viên — không thể hạ quyền người cuối cùng.")
			return
		}
	}
	// full_name: chỉ đổi khi CÓ gửi (`!= null` -> present & khác null). admin.routes.js:169
	rawName, namePresent := body["full_name"]
	hasName := namePresent && string(rawName) != "null"
	nameVal := strings.TrimSpace(adminBodyStr(body, "full_name"))
	// facility_id: chỉ đổi khi CÓ gửi field (`!== undefined`). admin.routes.js:172-178
	rawFac, hasFac := body["facility_id"]
	var facVal interface{}
	if hasFac {
		fv, ok2, errMsg := h.adminParseFacilityID(ctx, rawFac)
		if !ok2 {
			badRequest(c, errMsg)
			return
		}
		if fv != nil {
			facVal = *fv
		}
	}
	// ADMIN LUÔN là điều hành: ÉP facility_id=null kể cả khi caller không gửi. admin.routes.js:181
	if newRole == "admin" {
		hasFac = true
		facVal = nil
	}
	// Gán vai THẬT = DUYỆT tài khoản. admin.routes.js:184
	// KHÔNG còn đòi `curRole == "pending"`: hàng có VAI THẬT mà approved=false (di sản lỗi cũ — xem
	// UnlockUser) thì trước đây admin bấm "Duyệt / gán vai" bao nhiêu lần cũng không bật được approved,
	// người kia kẹt vĩnh viễn ở màn "Tài khoản đang chờ duyệt". Nay gán vai thật là duyệt, luôn đúng.
	duyet := newRole != "pending"
	if _, err := h.pool().Exec(ctx,
		`UPDATE users SET full_name = CASE WHEN $1 THEN $2 ELSE full_name END, role=$3,
           facility_id = CASE WHEN $5 THEN $6 ELSE facility_id END,
           approved = CASE WHEN $7 THEN true ELSE approved END
         WHERE id=$4 AND role IN (`+adminManagedRolesSQL+`) AND deleted_at IS NULL`,
		hasName, nameVal, newRole, id, hasFac, facVal, duyet); err != nil {
		serverErr(c)
		return
	}
	// Đổi vai -> THU HỒI vé cũ ngay. admin.routes.js:192
	if newRole != curRole {
		if err := h.Auth.RevokeTokens(ctx, id); err != nil {
			serverErr(c)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ResetPassword: POST /api/admin/users/:id/password. admin.routes.js:197-208
func (h *Handlers) ResetPassword(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> câu lệnh SQL vỡ như Node (500)
		return
	}
	var body map[string]json.RawMessage
	_ = c.ShouldBindJSON(&body)
	password := strings.TrimSpace(adminBodyStr(body, "password"))
	ctx := c.Request.Context()
	// uNow: dùng username/full_name làm ngữ cảnh kiểm mật khẩu; không có hàng -> {} (chuỗi rỗng). admin.routes.js:200
	var uName, uFull string
	_ = h.pool().QueryRow(ctx, "SELECT username, full_name FROM users WHERE id=$1", id).Scan(&uName, &uFull)
	if loiMk := valid.CheckPassword(password, []string{uName, uFull}); loiMk != "" {
		badRequest(c, loiMk)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		serverErr(c)
		return
	}
	// Đặt lại mật khẩu -> buộc đổi lại lần đăng nhập kế tiếp. admin.routes.js:204
	if _, err := h.pool().Exec(ctx, "UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2", string(hash), id); err != nil {
		serverErr(c)
		return
	}
	if err := h.Auth.RevokeTokens(ctx, id); err != nil { // đá mọi phiên đang mở. admin.routes.js:205
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DeleteUser: DELETE /api/admin/users/:id — xoá mềm + nhả tên gốc. admin.routes.js:210-228
func (h *Handlers) DeleteUser(c *gin.Context) {
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id không phải số -> câu lệnh SQL vỡ như Node (500)
		return
	}
	u := auth.CurrentUser(c)
	if u != nil && id == u.ID {
		badRequest(c, "Không thể tự khoá chính mình")
		return
	}
	ctx := c.Request.Context()
	var admins int
	if h.pool().QueryRow(ctx, "SELECT COUNT(*)::int c FROM users WHERE role='admin' AND deleted_at IS NULL").Scan(&admins) != nil {
		serverErr(c)
		return
	}
	var targetRole string
	targetFound := h.pool().QueryRow(ctx, "SELECT role FROM users WHERE id=$1", id).Scan(&targetRole) == nil
	if targetFound && targetRole == "admin" && admins <= 1 {
		badRequest(c, "Phải còn ít nhất 1 quản trị viên")
		return
	}
	// KHOÁ tài khoản (không xoá dữ liệu): chặn đăng nhập (login lọc deleted_at IS NULL) + đá mọi phiên.
	// Trước đây còn ĐỔI TÊN username thành 'ten#da-xoa-<id>' để nhả tên gốc -> mở khoá lại thì tên đã
	// méo, coi như một chiều. Nay GIỮ NGUYÊN username (tên vẫn thuộc về người đó) để mở khoá là trả về
	// đúng nguyên trạng; muốn nhả tên hẳn thì đó là việc "xoá thật", không phải khoá.
	if _, err := h.pool().Exec(ctx,
		`UPDATE users SET deleted_at=now()
           WHERE id=$1 AND role IN (`+adminManagedRolesSQL+`)`, id); err != nil {
		serverErr(c, err)
		return
	}
	if err := h.Auth.RevokeTokens(ctx, id); err != nil { // đá ngay mọi phiên đang mở. admin.routes.js:225
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
