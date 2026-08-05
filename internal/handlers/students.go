package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"ktx/internal/auth"
	"ktx/internal/billing"
	"ktx/internal/checkout"
	"ktx/internal/db"
	"ktx/internal/invoicecalc"
	"ktx/internal/meter"
	"ktx/internal/roomleaders"
	"ktx/internal/roomrules"
	"ktx/internal/roomstays"
	"ktx/internal/scope"
	"ktx/internal/storage"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// studentsIsCccdKey: giá trị đã là S3 KEY hợp lệ (không phải data URL). cccd-url.js isCccdKey.
func studentsIsCccdKey(v string) bool {
	return strings.HasPrefix(v, "students/") || strings.HasPrefix(v, "applications/")
}

// studentsUploadCccd: resolveCccd cho tạo/sửa — trả (key mới hoặc giữ, có set cột không, xoá key cũ nào).
// value: data:image/ -> upload; key cũ -> giữ; ” -> xoá (set NULL); khác -> bỏ qua (không đổi).
// server/routes/students.routes.js:43-57
func (h *Handlers) studentsResolveCccd(ctx context.Context, sid int, field, value, oldKey string) (setNull bool, key string, changed bool) {
	if value == "" {
		if studentsIsCccdKey(oldKey) {
			_ = h.Store.DeleteObject(ctx, h.Store.CccdBucket, oldKey)
		}
		return true, "", true // set NULL
	}
	if studentsIsCccdKey(value) {
		return false, value, true // giữ key
	}
	if !strings.HasPrefix(value, "data:image/") {
		return false, "", false // giá trị lạ -> không đổi
	}
	p := storage.ParseDataUrl(value)
	if p == nil {
		return false, "", false // đã validate trước, không tới đây
	}
	k := "students/" + itoa(sid) + "/" + field + "." + p.Ext
	if _, e := h.Store.PutDataUrl(ctx, h.Store.CccdBucket, k, value); e != nil {
		return false, "", false // lỗi kho -> giữ nguyên (không chặn nghiệp vụ)
	}
	if studentsIsCccdKey(oldKey) && oldKey != k {
		_ = h.Store.DeleteObject(ctx, h.Store.CccdBucket, oldKey)
	}
	return false, k, true
}

// studentsValidateCccd: 400 nếu có data:image/ nhưng sai chữ ký. Gọi TRƯỚC khi ghi.
func (h *Handlers) studentsValidateCccd(c *gin.Context, b map[string]interface{}) bool {
	if h.Store == nil {
		return true
	}
	for _, f := range []string{"cccd_image", "cccd_front", "cccd_back"} {
		v := studentsJSString(b[f])
		if strings.HasPrefix(v, "data:image/") && storage.ParseDataUrl(v) == nil {
			badRequest(c, "Ảnh CCCD không hợp lệ (chỉ nhận JPG/PNG/WEBP/GIF)")
			return false
		}
	}
	return true
}

// Handler học viên. requireAuth + role admin|staff; mỗi handler /:id gọi studentsFacilityGuard đầu tiên.
// CHƯA port S3: POST/PUT bỏ phần upload ảnh CCCD (vẫn tạo/sửa bản ghi); GET /:id/cccd/:side -> 501.

// LIST_SELECT — danh sách (không kèm ảnh CCCD). students.routes.js:78-94
// BL-78: KHÔNG trả CCCD, ngày sinh, SĐT phụ huynh, số tài khoản ngân hàng, ghi chú. Bảng danh sách
// không cần tới chúng, mà danh sách thì về trình duyệt sau mỗi thao tác và nằm thường trực trong bộ
// nhớ JS suốt phiên. Cần đủ trường thì mở GET /students/:id.
const studentsListSelect = `
  SELECT s.id, s.code, s.name, s.gender, s.phone, s.room_id, s.check_in_date, s.check_out_date,
    s.status, s.uses_washing, s.deposit_amount, s.deposit_status, s.deposit_date, s.deposit_refund_date,
    s.checkout_notice_date, s.checkout_reason, s.class_name, s.email, s.rental_type, s.residency_status,
    s.contract_no, s.contract_date, s.contract_status,
    s.class_start_date, s.expected_departure, s.room_fee_discount_pct, s.facility_id, s.lock_reason,
    s.water_discount_pct, s.electric_discount_pct, s.service_discount_pct, s.washing_discount_pct, s.parking_discount_pct,
    EXISTS (SELECT 1 FROM room_leaders rl WHERE rl.student_id=s.id AND rl.to_date IS NULL) AS is_leader,
    (s.cccd_front IS NOT NULL OR s.cccd_back IS NOT NULL OR s.cccd_image IS NOT NULL) AS has_cccd,
    (s.cccd_front IS NOT NULL) AS has_cccd_front,
    (s.cccd_back IS NOT NULL) AS has_cccd_back,
    r.name AS room_name, r.floor AS room_floor, r.gender AS room_gender, r.hang AS room_hang,
    u.username AS login_username,
    (SELECT COUNT(*) FROM vehicles v WHERE v.student_id=s.id AND v.deleted_at IS NULL)::int AS vehicle_count,
    (SELECT COUNT(*) FROM violations vi WHERE vi.student_id=s.id AND vi.deleted_at IS NULL)::int AS violation_count,
    cref.student_id  AS contract_ref_id,
    cref.name        AS contract_ref_name,
    cref.contract_no AS contract_ref_no
  FROM students s
  LEFT JOIN rooms r ON r.id = s.room_id
  LEFT JOIN users u ON u.student_id = s.id
  -- THAM CHIẾU HỢP ĐỒNG (owner chốt 29/07/2026): phòng thuê trọn chỉ có MỘT hợp đồng, ký với phòng
  -- trưởng; thành viên còn lại KHÔNG ký riêng. Suy ra tại chỗ từ room_leaders thay vì chép số HĐ vào
  -- từng hồ sơ: chép là gán cứng — đổi phòng trưởng hay sửa số HĐ thì các bản chép thành sai lặng lẽ.
  -- Chỉ áp cho người CHƯA có số HĐ của riêng mình; ai có HĐ riêng thì không tham chiếu ai cả.
  LEFT JOIN LATERAL (
    SELECT ls.id AS student_id, ls.name, ls.contract_no
      FROM room_leaders rl
      JOIN students ls ON ls.id = rl.student_id AND ls.deleted_at IS NULL
     WHERE rl.room_id = s.room_id
       AND r.room_type = 'whole'
       AND rl.to_date IS NULL
       AND ls.id <> s.id
       AND COALESCE(btrim(ls.contract_no), '') <> ''
       AND lower(btrim(ls.contract_no)) <> 'x'
       AND COALESCE(btrim(s.contract_no), '') = ''
     LIMIT 1
  ) cref ON TRUE`

// DATE_FIELDS — students.routes.js:17
var studentsDateFields = []string{"birth_date", "check_in_date", "check_out_date", "contract_date", "deposit_date", "class_start_date", "expected_departure", "checkout_notice_date"}

// Lý do trả phòng hợp lệ. students.routes.js:314,489
var studentsCheckoutReasons = map[string]bool{
	"departure": true, "personal": true, "facility": true, "dropout": true, "reserve": true, "other": true,
}

/* ---------- Helper: mô phỏng ngữ nghĩa JS trên body đã decode thành map[string]interface{} ---------- */

// studentsJSTruthy: `!!v` của JS (nil/""/0/false -> false). Giá trị cur từ RowToMap có thể là int32/int64/float64.
func studentsJSTruthy(v interface{}) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	case float32:
		return x != 0
	case int:
		return x != 0
	case int32:
		return x != 0
	case int64:
		return x != 0
	default:
		return true
	}
}

// studentsJSString: `String(v)` của JS (nil -> "", số -> dạng ngắn, bool -> "true"/"false").
func studentsJSString(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return numDisp(x)
	case float32:
		return numDisp(float64(x))
	case int:
		return strconv.Itoa(x)
	case int32:
		return strconv.Itoa(int(x))
	case int64:
		return strconv.FormatInt(x, 10)
	default:
		return fmt.Sprintf("%v", x)
	}
}

// studentsStrOr: `v || ”` cho các field chuỗi (falsy -> "").
func studentsStrOr(v interface{}) string {
	if !studentsJSTruthy(v) {
		return ""
	}
	return studentsJSString(v)
}

// studentsNumberJS: `Number(v)` của JS + cờ hữu hạn. ”->0(finite); chuỗi phi số/NaN->(0,false); nil->(0,false).
func studentsNumberJS(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case nil:
		return 0, false
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0, true
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

// studentsDateOrNull: `D(v) = v ? v : null` — chuỗi ngày nếu truthy, else nil (lưu NULL). students.routes.js:99
func studentsDateOrNull(v interface{}) interface{} {
	if studentsJSTruthy(v) {
		return studentsJSString(v)
	}
	return nil
}

// studentsIntPtr: số/chuỗi-số (kể cả 0) -> *int; nil/rỗng/phi-số -> nil. Dùng cho facility_id (ngữ nghĩa ??).
func studentsIntPtr(v interface{}) *int {
	switch x := v.(type) {
	case float64:
		n := int(x)
		return &n
	case float32:
		n := int(x)
		return &n
	case int:
		return &x
	case int32:
		n := int(x)
		return &n
	case int64:
		n := int(x)
		return &n
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return nil
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			n := int(f)
			return &n
		}
		return nil
	}
	return nil
}

// studentsRoomIDPtr: `b.room_id || null` -> *int (0/falsy -> nil).
func studentsRoomIDPtr(v interface{}) *int {
	if !studentsJSTruthy(v) {
		return nil
	}
	return studentsIntPtr(v)
}

// studentsPtrArg: *int -> tham số query (nil nếu con trỏ nil).
func studentsPtrArg(p *int) interface{} {
	if p == nil {
		return nil
	}
	return *p
}

// studentsRental: `t === 'phong' ? 'phong' : 'ghep'`. students.routes.js:97
func studentsRental(v interface{}) string {
	if studentsJSString(v) == "phong" {
		return "phong"
	}
	return "ghep"
}

// studentsResidency: `['registered','processing'].includes(r) ? r : 'unregistered'`. students.routes.js:98
func studentsResidency(v interface{}) string {
	s := studentsJSString(v)
	if s == "registered" || s == "processing" {
		return s
	}
	return "unregistered"
}

// studentsContract: whitelist trạng thái HĐ, else 'unsigned'. students.routes.js:96
func studentsContract(v interface{}) string {
	switch studentsJSString(v) {
	case "done", "scanned", "unsigned", "none", "handover":
		return studentsJSString(v)
	}
	return "unsigned"
}

// studentsPct: % giảm tiền phòng, làm tròn + kẹp 0..100, phi số -> 0. students.routes.js:102
func studentsPct(v interface{}) int {
	f, ok := studentsNumberJS(v)
	if !ok {
		return 0
	}
	n := int(math.Floor(f + 0.5)) // Math.round
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

// studentsSettingNum: `+settings[key] || 0` (giá trị cài đặt là chuỗi).
func studentsSettingNum(s map[string]string, key string) float64 {
	f, ok := studentsNumberJS(s[key])
	if !ok || f == 0 {
		return 0
	}
	return f
}

func studentsSlice10(s string) string {
	if len(s) > 10 {
		return s[:10]
	}
	return s
}

// studentsThangBiCham: các tháng "YYYY-MM" mà việc đổi ngày trả phòng từ a sang b chạm tới.
// Chuỗi rỗng = không có ngày trả. Chặn 24 tháng cho khỏi lặp vô hạn nếu gặp ngày rác.
func studentsThangBiCham(a, b string) []string {
	moc := []string{}
	for _, d := range []string{a, b} {
		if len(d) >= 7 {
			moc = append(moc, d[:7])
		}
	}
	if len(moc) == 0 {
		return nil
	}
	dau, cuoi := moc[0], moc[0]
	for _, m := range moc {
		if m < dau {
			dau = m
		}
		if m > cuoi {
			cuoi = m
		}
	}
	t, err := time.Parse("2006-01", dau)
	if err != nil {
		return nil
	}
	out := []string{}
	for i := 0; i < 24; i++ {
		mo := t.Format("2006-01")
		out = append(out, mo)
		if mo >= cuoi {
			break
		}
		t = t.AddDate(0, 1, 0)
	}
	return out
}

// studentsPad2: String(seq).padStart(2,'0'). students.routes.js:172
func studentsPad2(seq int) string {
	s := strconv.Itoa(seq)
	if len(s) < 2 {
		return "0" + s
	}
	return s
}

// studentsFmtContractNo. students.routes.js:172
func studentsFmtContractNo(seq int, year, entity string) string {
	return studentsPad2(seq) + "/" + year + "/HDKTX-" + entity
}

// studentsEntityOf: pháp nhân theo giới tính. students.routes.js:171
func studentsEntityOf(gender string, s map[string]string) string {
	if gender == "female" {
		if v := s["legal_female"]; v != "" {
			return v
		}
		return "E2"
	}
	if v := s["legal_male"]; v != "" {
		return v
	}
	return "S2"
}

// studentsSignCccd: cột CCCD (S3 KEY) -> URL proxy qua app (thuần chuỗi, không gọi S3). cccd-url.js:5-15
func studentsSignCccd(row map[string]interface{}) {
	if row == nil || row["id"] == nil {
		return
	}
	id := studentsJSString(row["id"])
	sides := [][2]string{{"cccd_front", "front"}, {"cccd_back", "back"}, {"cccd_image", "image"}}
	for _, p := range sides {
		field, side := p[0], p[1]
		v, _ := row[field].(string)
		if v != "" && !strings.HasPrefix(v, "data:") && !strings.HasPrefix(v, "http:") && !strings.HasPrefix(v, "https:") {
			row[field] = "/api/students/" + id + "/cccd/" + side
		} else if v == "" {
			row[field] = nil
		} else {
			row[field] = v
		}
	}
	// Bản scan HĐ cũng là khoá S3 -> đổi thành đường xem có kiểm quyền, kèm đuôi tệp để biết ảnh hay PDF.
	if v, _ := row["contract_scan"].(string); v != "" {
		row["contract_scan_ext"] = strings.ToLower(strings.TrimPrefix(filepath.Ext(v), "."))
		row["contract_scan"] = "/api/students/" + id + "/contract-scan"
	} else {
		row["contract_scan"] = nil
	}
}

// studentsMeterVal: mô phỏng Node cho meter_reading trên giá trị đã decode.
// hasMeter = mr != null && String(mr).trim() !== ” (students.routes.js:497);
// finite = Number.isFinite(Number(reading)) (meter.js:14).
func studentsMeterVal(v interface{}) (hasMeter bool, reading float64, finite bool) {
	switch x := v.(type) {
	case nil:
		return false, 0, false
	case float64:
		return true, x, true
	case string:
		if strings.TrimSpace(x) == "" {
			return false, 0, false
		}
		n, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return true, 0, false
		}
		return true, n, true
	default:
		return true, 0, false
	}
}

// studentsLocaleVN: Number.prototype.toLocaleString('vi-VN') — nhóm nghìn bằng '.'.
func studentsLocaleVN(n float64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	intPart := math.Floor(n)
	digits := strconv.FormatFloat(intPart, 'f', 0, 64)
	out := studentsGroupThousands(digits)
	if frac := n - intPart; frac > 1e-9 {
		fs := strconv.FormatFloat(frac, 'f', 3, 64) // "0.xyz"
		if len(fs) > 2 {
			dec := strings.TrimRight(fs[2:], "0")
			if dec != "" {
				out = out + "," + dec
			}
		}
	}
	if neg {
		out = "-" + out
	}
	return out
}

func studentsGroupThousands(digits string) string {
	n := len(digits)
	if n <= 3 {
		return digits
	}
	var b strings.Builder
	pre := n % 3
	if pre > 0 {
		b.WriteString(digits[:pre])
		b.WriteByte('.')
	}
	for i := pre; i < n; i += 3 {
		b.WriteString(digits[i : i+3])
		if i+3 < n {
			b.WriteByte('.')
		}
	}
	return b.String()
}

// studentsReadBody đọc body 1 lần -> (bytes gốc, map giá trị). Body rỗng/hỏng -> {} (như express.json).
func studentsReadBody(c *gin.Context) ([]byte, map[string]interface{}) {
	data, _ := c.GetRawData()
	var b map[string]interface{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &b)
	}
	if b == nil {
		b = map[string]interface{}{}
	}
	return data, b
}

// studentsOrderedKeys: khoá cấp cao nhất của object JSON theo THỨ TỰ xuất hiện (như Object.keys).
func studentsOrderedKeys(data []byte) []string {
	dec := json.NewDecoder(bytes.NewReader(data))
	tok, err := dec.Token()
	if err != nil {
		return nil
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '{' {
		return nil
	}
	var keys []string
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			break
		}
		if key, ok := kt.(string); ok {
			keys = append(keys, key)
		}
		if err := studentsSkipJSONValue(dec); err != nil {
			break
		}
	}
	return keys
}

func studentsSkipJSONValue(dec *json.Decoder) error {
	t, err := dec.Token()
	if err != nil {
		return err
	}
	if delim, ok := t.(json.Delim); ok && (delim == '{' || delim == '[') {
		depth := 1
		for depth > 0 {
			tt, err := dec.Token()
			if err != nil {
				return err
			}
			if d, ok := tt.(json.Delim); ok {
				if d == '{' || d == '[' {
					depth++
				} else {
					depth--
				}
			}
		}
	}
	return nil
}

// studentsRejectUnknown: field lạ -> câu lỗi; "" nếu ok. valid.js:68-71
func studentsRejectUnknown(keys, allowed []string) string {
	allow := map[string]bool{}
	for _, a := range allowed {
		allow[a] = true
	}
	var extra []string
	for _, k := range keys {
		if !allow[k] {
			extra = append(extra, k)
		}
	}
	if len(extra) == 0 {
		return ""
	}
	return "Trường không hợp lệ: " + strings.Join(extra, ", ") + ". Chỉ chấp nhận: " + strings.Join(allowed, ", ")
}

// studentsBlockOrConfirm: lỗi CHẶN -> 400; cảnh báo chưa xác nhận -> 409 needs_confirm. room-rules.js:69-80
func studentsBlockOrConfirm(c *gin.Context, res *roomrules.Result, confirmed bool) bool {
	if len(res.Errors) > 0 {
		badRequest(c, strings.Join(res.Errors, " · "))
		return true
	}
	if len(res.Warnings) > 0 && !confirmed {
		msgs := make([]string, len(res.Warnings))
		for i, w := range res.Warnings {
			msgs[i] = w.Message
		}
		conflict(c, gin.H{
			"error":         strings.Join(msgs, " · "),
			"needs_confirm": true,
			"warnings":      res.Warnings,
			"hint":          `Gửi lại kèm "confirm_overload": true để xác nhận vẫn xếp. Việc này sẽ được ghi vào nhật ký.`,
		})
		return true
	}
	return false
}

// studentsLogOverloads: ghi vết mọi cảnh báo QUÁ TẢI. students.routes.js:351,415,454,565
func studentsLogOverloads(ctx context.Context, q db.Querier, c *gin.Context, u *auth.User, sid int, name string, warnings []roomrules.Warning) {
	var uid *int
	uname, role := "", ""
	if u != nil {
		uid = &u.ID
		uname = u.Username
		role = u.Role
	}
	path := c.Request.URL.Path
	for _, w := range warnings {
		roomrules.LogOverload(ctx, q, uid, uname, role, c.Request.Method, path, sid, name, w)
	}
}

// studentsIsDigits: `/^\d+$/`. students.routes.js:28
func studentsIsDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

// studentsFacilityGuard: (router.param 'id') mọi thao tác /:id phải thuộc cơ sở người dùng. students.routes.js:25-35
// Trả true = đi tiếp; false = ĐÃ phản hồi (403/500).
func (h *Handlers) studentsFacilityGuard(c *gin.Context, u *auth.User, idStr string) bool {
	if scope.IsExecutive(u) {
		return true
	}
	if !studentsIsDigits(idStr) {
		return true // id phi số -> để handler xử (students.routes.js:28)
	}
	var fid *int
	err := h.pool().QueryRow(c.Request.Context(), "SELECT facility_id FROM students WHERE id=$1", idStr).Scan(&fid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true // không tồn tại -> để handler trả 404 (students.routes.js:30)
		}
		serverErr(c)
		return false
	}
	if fe := scope.AssertFacility(u, fid); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return false
	}
	return true
}

// studentsFindDuplicate: CHẶN tạo trùng hồ sơ. Trả (existing, errMsg, err); existing nil = không trùng.
// students.routes.js:110-134
func studentsFindDuplicate(ctx context.Context, q db.Querier, code, idCard string, exceptID *int) (map[string]interface{}, string, error) {
	cc := strings.TrimSpace(code)
	ic := strings.TrimSpace(idCard)
	var where []string
	var params []interface{}
	if cc != "" {
		params = append(params, cc)
		where = append(where, fmt.Sprintf("lower(btrim(s.code)) = lower(btrim($%d))", len(params)))
	}
	if ic != "" {
		params = append(params, ic)
		where = append(where, fmt.Sprintf("btrim(s.id_card) = btrim($%d)", len(params)))
	}
	if len(where) == 0 {
		return nil, "", nil
	}
	sql := `SELECT s.id, s.name, s.code, s.id_card, s.status, s.check_out_date, r.name AS room_name
               FROM students s LEFT JOIN rooms r ON r.id = s.room_id
              WHERE s.deleted_at IS NULL AND (` + strings.Join(where, " OR ") + `)`
	if exceptID != nil {
		params = append(params, *exceptID)
		sql += fmt.Sprintf(" AND s.id <> $%d", len(params))
	}
	rows, err := q.Query(ctx, sql+" LIMIT 1", params...)
	if err != nil {
		return nil, "", err
	}
	d, err := db.RowToMap(rows)
	if err != nil || d == nil {
		return nil, "", err
	}
	name := studentsJSString(d["name"])
	dcode := studentsJSString(d["code"])
	trungMa := cc != "" && strings.ToLower(strings.TrimSpace(dcode)) == strings.ToLower(cc)
	dangO := studentsJSString(d["status"]) == "in"
	idPart := `trùng CCCD "` + studentsJSString(d["id_card"]) + `"`
	if trungMa {
		idPart = `trùng mã HV "` + dcode + `"`
	}
	msg := name + " đã có hồ sơ trong hệ thống (" + idPart + ")"
	if dangO {
		rn := studentsJSString(d["room_name"])
		if rn == "" {
			rn = "chưa xếp"
		}
		msg += " — đang ở phòng " + rn + "." +
			` Nếu bạn ấy ĐỔI PHÒNG, hãy dùng chức năng "Chuyển phòng" trên hồ sơ cũ — tạo hồ sơ mới sẽ khiến bạn ấy bị tính tiền 2 lần.`
	} else {
		co := studentsJSString(d["check_out_date"])
		coStr := ""
		if co != "" {
			coStr = " ngày " + studentsSlice10(co)
		}
		msg += " — đã trả phòng" + coStr + "." +
			` Nếu bạn ấy quay lại ở, hãy dùng "Check-in" trên hồ sơ cũ thay vì tạo mới.`
	}
	return d, msg, nil
}

// studentsCoreFields: 16 giá trị $1..$16 (code..contract_status). studentFields(b). students.routes.js:243-250
// checkIn != nil -> ép check_in_date (POST dùng b.check_in_date || today); nil -> D(b.check_in_date) (PUT).
func studentsCoreFields(b map[string]interface{}, checkIn interface{}) []interface{} {
	name := strings.TrimSpace(studentsStrOr(b["name"]))
	gender := "male"
	if studentsJSString(b["gender"]) == "female" {
		gender = "female"
	}
	ci := checkIn
	if ci == nil {
		ci = studentsDateOrNull(b["check_in_date"])
	}
	return []interface{}{
		studentsStrOr(b["code"]),
		name,
		gender,
		studentsStrOr(b["phone"]),
		studentsStrOr(b["id_card"]),
		studentsDateOrNull(b["birth_date"]),
		studentsStrOr(b["class_name"]),
		studentsPtrArg(studentsRoomIDPtr(b["room_id"])),
		ci,
		studentsStrOr(b["note"]),
		studentsJSTruthy(b["uses_washing"]),
		studentsRental(b["rental_type"]),
		studentsResidency(b["residency_status"]),
		studentsStrOr(b["contract_no"]),
		studentsDateOrNull(b["contract_date"]),
		studentsContract(b["contract_status"]),
	}
}

/* ============================ HANDLERS ============================ */

// studentsCccdCol: whitelist side -> cột (chống SQL injection). cccd-url.js SIDE_COL.
var studentsCccdCol = map[string]string{"front": "cccd_front", "back": "cccd_back", "image": "cccd_image"}

// StudentCccdImage: GET /:id/cccd/:side — proxy ảnh CCCD từ S3 (bucket riêng tư). students.routes.js:60-75
func (h *Handlers) StudentCccdImage(c *gin.Context) {
	col, ok := studentsCccdCol[c.Param("side")]
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}
	u := auth.CurrentUser(c)
	id, _ := paramInt(c, "id")
	isStaff := u.Role == "admin" || u.Role == "staff"
	if !isStaff && (u.StudentID == nil || *u.StudentID != id) {
		c.Status(http.StatusForbidden)
		return
	}
	if h.Store == nil {
		c.Status(http.StatusNotFound)
		return
	}
	ctx := c.Request.Context()
	var k *string
	if h.pool().QueryRow(ctx, "SELECT "+col+" AS k FROM students WHERE id=$1 AND deleted_at IS NULL", id).Scan(&k) != nil || k == nil || *k == "" {
		c.Status(http.StatusNotFound)
		return
	}
	obj, err := h.Store.GetObject(ctx, h.Store.CccdBucket, *k)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer obj.Body.Close()
	ct := obj.ContentType
	if ct == "" {
		ct = "image/jpeg"
	}
	c.Header("Content-Type", ct)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, max-age=300")
	_, _ = io.Copy(c.Writer, obj.Body)
}

// studentsXemDuocHoSo: nhân viên xem được mọi hồ sơ; học viên chỉ xem hồ sơ của chính mình.
func studentsXemDuocHoSo(u *auth.User, id int) bool {
	if u == nil {
		return false
	}
	if u.Role == "admin" || u.Role == "staff" {
		return true
	}
	return u.StudentID != nil && *u.StudentID == id
}

// StudentContractScan: GET /:id/contract-scan — proxy bản scan HĐ từ bucket riêng tư.
func (h *Handlers) StudentContractScan(c *gin.Context) {
	id, _ := paramInt(c, "id")
	if !studentsXemDuocHoSo(auth.CurrentUser(c), id) {
		c.Status(http.StatusForbidden)
		return
	}
	if h.Store == nil {
		c.Status(http.StatusNotFound)
		return
	}
	ctx := c.Request.Context()
	var k *string
	if h.pool().QueryRow(ctx, "SELECT contract_scan FROM students WHERE id=$1 AND deleted_at IS NULL", id).Scan(&k) != nil || k == nil || *k == "" {
		c.Status(http.StatusNotFound)
		return
	}
	obj, err := h.Store.GetObject(ctx, h.Store.CccdBucket, *k)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer obj.Body.Close()
	ct := obj.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	c.Header("Content-Type", ct)
	c.Header("X-Content-Type-Options", "nosniff")
	// inline: PDF/ảnh mở thẳng trong tab, không ép tải về.
	c.Header("Content-Disposition", "inline")
	c.Header("Cache-Control", "private, max-age=300")
	_, _ = io.Copy(c.Writer, obj.Body)
}

// UploadContractScan: POST /:id/contract-scan (admin,staff) — nhận ẢNH hoặc PDF dạng data URL.
func (h *Handlers) UploadContractScan(c *gin.Context) {
	if !h.storeOr501(c) {
		return
	}
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	var body struct {
		Data string `json:"data"`
	}
	_ = c.ShouldBindJSON(&body)
	if len(body.Data) > 12*1024*1024 {
		badRequest(c, "Tệp quá lớn (tối đa ~9MB)")
		return
	}
	p := storage.ParseDataUrl(body.Data)
	if p == nil {
		p = storage.ParsePdfDataUrl(body.Data)
	}
	if p == nil {
		badRequest(c, "Chỉ nhận ảnh (JPG, PNG, WEBP, GIF) hoặc PDF — và tệp phải đúng chữ ký, không chỉ đúng đuôi.")
		return
	}
	ctx := c.Request.Context()
	var cu *string
	if h.pool().QueryRow(ctx, "SELECT contract_scan FROM students WHERE id=$1 AND deleted_at IS NULL", id).Scan(&cu) != nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	key := "hopdong/" + itoa(id) + "." + p.Ext
	if _, err := h.Store.PutBuffer(ctx, h.Store.CccdBucket, key, p.Buffer, p.ContentType); err != nil {
		handleStorageErr(c, err)
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE students SET contract_scan=$1 WHERE id=$2", key, id); err != nil {
		serverErr(c)
		return
	}
	// Đổi từ .jpg sang .pdf thì tệp cũ thành rác trong bucket — dọn sau khi đã ghi khoá mới.
	if cu != nil && *cu != "" && *cu != key {
		_ = h.Store.DeleteObject(ctx, h.Store.CccdBucket, *cu)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "ext": p.Ext})
}

// DeleteContractScan: DELETE /:id/contract-scan (admin,staff).
func (h *Handlers) DeleteContractScan(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	ctx := c.Request.Context()
	var cu *string
	if h.pool().QueryRow(ctx, "SELECT contract_scan FROM students WHERE id=$1 AND deleted_at IS NULL", id).Scan(&cu) != nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	if _, err := h.pool().Exec(ctx, "UPDATE students SET contract_scan=NULL WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	if cu != nil && *cu != "" && h.Store != nil {
		_ = h.Store.DeleteObject(ctx, h.Store.CccdBucket, *cu)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListStudents: GET / (admin,staff). ?deleted ?facility ?q ?page ?limit. students.routes.js:136-168
func (h *Handlers) ListStudents(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	del := "s.deleted_at IS NULL"
	if c.Query("deleted") == "1" {
		del = "s.deleted_at IS NOT NULL"
	}
	cond := []string{del}
	params := []interface{}{}
	// Đa cơ sở: điều hành lọc tuỳ chọn ?facility; quản lý cơ sở bị ÉP theo cơ sở của mình.
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			fv, _ := strconv.ParseFloat(f, 64)
			params = append(params, int(fv))
			cond = append(cond, "s.facility_id = $"+itoa(len(params)))
		}
	} else {
		scope.ApplyFacilityFilter(u, "s.facility_id", &cond, &params)
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		params = append(params, "%"+q+"%")
		i := itoa(len(params))
		cond = append(cond, "(s.name ILIKE $"+i+" OR s.code ILIKE $"+i+" OR s.phone ILIKE $"+i+" OR r.name ILIKE $"+i+")")
	}
	where := "WHERE " + joinAnd(cond)

	_, hasPage := c.GetQuery("page")
	_, hasLimit := c.GetQuery("limit")
	if hasPage || hasLimit {
		limit := 50
		if v := c.Query("limit"); v != "" {
			if fv, err := strconv.ParseFloat(v, 64); err == nil && fv != 0 {
				limit = int(fv)
			}
		}
		if limit < 1 {
			limit = 1
		}
		if limit > 200 {
			limit = 200
		}
		page := 1
		if v := c.Query("page"); v != "" {
			if fv, err := strconv.ParseFloat(v, 64); err == nil && fv != 0 {
				page = int(fv)
			}
		}
		if page < 1 {
			page = 1
		}
		var total int
		if err := h.pool().QueryRow(ctx, "SELECT COUNT(*)::int c FROM students s LEFT JOIN rooms r ON r.id = s.room_id "+where, params...).Scan(&total); err != nil {
			serverErr(c)
			return
		}
		params = append(params, limit)
		pL := itoa(len(params))
		params = append(params, (page-1)*limit)
		pO := itoa(len(params))
		rows, err := h.pool().Query(ctx, studentsListSelect+" "+where+" ORDER BY s.name LIMIT $"+pL+" OFFSET $"+pO, params...)
		if err != nil {
			serverErr(c)
			return
		}
		list, err := db.RowsToMaps(rows)
		if err != nil {
			serverErr(c)
			return
		}
		c.JSON(http.StatusOK, gin.H{"rows": list, "total": total, "page": page, "limit": limit})
		return
	}
	rows, err := h.pool().Query(ctx, studentsListSelect+" "+where+" ORDER BY s.name", params...)
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

// ContractNoNext: GET /contract-no/next (admin,staff). students.routes.js:175-189
func (h *Handlers) ContractNoNext(c *gin.Context) {
	ctx := c.Request.Context()
	st, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	gender := "male"
	if c.Query("gender") == "female" {
		gender = "female"
	}
	entity := studentsEntityOf(gender, st)
	date := timeutil.Today()
	if dq := c.Query("date"); dq != "" {
		date = studentsSlice10(dq)
	}
	year := date
	if len(year) > 4 {
		year = year[:4]
	}
	var n int
	// Số kế tiếp = MAX(NN) trong HĐ ĐÃ CÓ cùng năm + pháp nhân (parse từ CHÍNH số HĐ, kể cả HĐ chưa có
	// contract_date) + 1 -> nối tiếp số có sẵn, không đánh lại từ đầu, không trùng số đã cấp.
	// KHÔNG lọc deleted_at: hồ sơ bị khoá vẫn giữ số của mình, số đã cấp thì không cấp lại.
	if err := h.pool().QueryRow(ctx,
		`SELECT COALESCE(MAX((split_part(contract_no,'/',1))::int), 0)::int c FROM students
       WHERE contract_no ~ ('^[0-9]+/' || $1 || '/HDKTX-' || $2 || '$')`,
		year, entity).Scan(&n); err != nil {
		serverErr(c)
		return
	}
	// Có student_id -> cấp số RIÊNG cho hồ sơ đó, không phải số chung của cả pháp nhân: cộng thêm số
	// người chưa có HĐ đứng TRƯỚC họ (theo ngày nhận phòng, rồi id). Mỗi hồ sơ một số khác nhau, và
	// số đó đứng yên khi người trước ký đúng thứ tự.
	if sid := queryIntDefault(c, "student_id", 0); sid > 0 {
		truoc, e := h.contractNoRank(ctx, sid, gender)
		if e != nil {
			serverErr(c)
			return
		}
		if truoc < 0 { // thành viên phòng thuê trọn: dùng chung HĐ của người ký, không cấp số riêng
			c.JSON(http.StatusOK, gin.H{"contract_no": "", "dung_chung": true, "entity": entity, "year": year})
			return
		}
		n += truoc
	}
	c.JSON(http.StatusOK, gin.H{"contract_no": studentsFmtContractNo(n+1, year, entity), "entity": entity, "seq": n + 1, "year": year})
}

// contractNoRank: bao nhiêu hồ sơ CHƯA có số HĐ, cùng pháp nhân, đứng trước hồ sơ này.
// Trả -1 khi hồ sơ này là thành viên phòng thuê trọn (không ký HĐ riêng).
// Thành viên phòng thuê trọn bị loại khỏi phép đếm, nếu không họ chiếm chỗ làm số của người khác nhảy.
func (h *Handlers) contractNoRank(ctx context.Context, studentID int, gender string) (int, error) {
	const chuaCoHD = `(s.contract_no IS NULL OR btrim(s.contract_no) = '' OR lower(btrim(s.contract_no)) = 'x')`
	const thanhVienTron = `(r.room_type = 'whole' AND NOT EXISTS (
	    SELECT 1 FROM room_leaders rl WHERE rl.student_id = s.id AND rl.to_date IS NULL))`

	var laThanhVien bool
	if err := h.pool().QueryRow(ctx,
		`SELECT COALESCE(`+thanhVienTron+`, false) FROM students s
		   LEFT JOIN rooms r ON r.id = s.room_id
		  WHERE s.id = $1`, studentID).Scan(&laThanhVien); err != nil {
		return 0, err
	}
	if laThanhVien {
		return -1, nil
	}
	var truoc int
	err := h.pool().QueryRow(ctx,
		`SELECT COUNT(*)::int FROM students s
		   LEFT JOIN rooms r ON r.id = s.room_id
		  WHERE s.deleted_at IS NULL AND s.gender = $2 AND `+chuaCoHD+`
		    AND NOT COALESCE(`+thanhVienTron+`, false)
		    AND (COALESCE(s.check_in_date, DATE '9999-12-31'), s.id) <
		        (SELECT COALESCE(x.check_in_date, DATE '9999-12-31'), x.id FROM students x WHERE x.id = $1)`,
		studentID, gender).Scan(&truoc)
	return truoc, err
}

// GetStudent: GET /:id (admin,staff). Kèm vehicles, violations, _v (xmin). students.routes.js:219-241
func (h *Handlers) GetStudent(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	ctx := c.Request.Context()
	rows, err := h.pool().Query(ctx, `
      SELECT s.*, r.name AS room_name, r.floor AS room_floor, r.gender AS room_gender, r.hang AS room_hang,
        u.username AS login_username,
        s.xmin::text AS _v
      FROM students s
      LEFT JOIN rooms r ON r.id = s.room_id
      LEFT JOIN users u ON u.student_id = s.id
      WHERE s.id=$1`, id)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	vehRows, err := h.pool().Query(ctx, "SELECT * FROM vehicles WHERE student_id=$1 AND deleted_at IS NULL ORDER BY id", id)
	if err != nil {
		serverErr(c)
		return
	}
	veh, err := db.RowsToMaps(vehRows)
	if err != nil {
		serverErr(c)
		return
	}
	row["vehicles"] = veh
	vioRows, err := h.pool().Query(ctx, "SELECT * FROM violations WHERE student_id=$1 AND deleted_at IS NULL ORDER BY date DESC, id DESC", id)
	if err != nil {
		serverErr(c)
		return
	}
	vio, err := db.RowsToMaps(vioRows)
	if err != nil {
		serverErr(c)
		return
	}
	row["violations"] = vio
	studentsSignCccd(row)
	c.JSON(http.StatusOK, row)
}

// CreateStudent: POST / (admin,staff). students.routes.js:252-355
func (h *Handlers) CreateStudent(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()
	_, b := studentsReadBody(c)

	// ---- KIỂM TRA trước khi mở transaction ----
	if strings.TrimSpace(studentsStrOr(b["name"])) == "" {
		badRequest(c, "Nhập họ tên học viên")
		return
	}
	if pv := b["phone"]; pv != nil {
		ps := studentsJSString(pv)
		if strings.TrimSpace(ps) != "" && !valid.IsValidPhone(ps) {
			badRequest(c, `Số điện thoại không hợp lệ: "`+ps+`" (cần 8–15 chữ số)`)
			return
		}
	}
	if pv := b["parent_phone"]; pv != nil {
		ps := studentsJSString(pv)
		if strings.TrimSpace(ps) != "" && !valid.IsValidPhone(ps) {
			badRequest(c, `SĐT phụ huynh không hợp lệ: "`+ps+`" (cần 8–15 chữ số)`)
			return
		}
	}
	for _, k := range studentsDateFields {
		if v, ok := b[k]; ok && v != nil {
			s := studentsJSString(v)
			if s != "" && !valid.IsValidYmd(s) {
				badRequest(c, "Ngày không hợp lệ ("+k+")")
				return
			}
		}
	}
	// BL-78: lớp chặn XSS thứ hai, ở tầng ghi. esc() phía frontend là lớp duy nhất và nó nằm rải
	// trong hàng trăm template viết tay — sót một chỗ là hút được cả khối dữ liệu.
	if e := valid.KhongChoHTML(func(k string) (string, bool) {
		v, ok := b[k]
		if !ok || v == nil {
			return "", false
		}
		return studentsJSString(v), true
	}, []string{"name", "code", "class_name", "note", "deposit_bank", "deposit_account", "checkout_reason"}); e != "" {
		badRequest(c, e)
		return
	}
	ciCheck := studentsJSString(b["check_in_date"])
	coCheck := studentsJSString(b["check_out_date"])
	if valid.IsValidYmd(ciCheck) && valid.IsValidYmd(coCheck) && coCheck < ciCheck {
		badRequest(c, "Ngày trả phòng không thể trước ngày nhận phòng")
		return
	}
	// Trùng mã HV / CCCD -> 409
	dup, dupMsg, err := studentsFindDuplicate(ctx, h.pool(), studentsJSString(b["code"]), studentsJSString(b["id_card"]), nil)
	if err != nil {
		serverErr(c)
		return
	}
	if dup != nil {
		conflict(c, gin.H{"error": dupMsg, "existing": dup, "duplicate": true})
		return
	}
	// LUẬT XẾP PHÒNG
	roomIDPtr := studentsRoomIDPtr(b["room_id"])
	chk, err := roomrules.CheckRoomAssignment(ctx, h.pool(), nil, studentsJSString(b["gender"]), studentsJSString(b["rental_type"]), roomIDPtr)
	if err != nil {
		serverErr(c)
		return
	}
	if studentsBlockOrConfirm(c, chk, b["confirm_overload"] == true) {
		return
	}
	// Đa cơ sở: HV theo cơ sở của phòng; không xếp phòng -> theo cơ sở người tạo.
	var facIDArg interface{}
	if studentsJSTruthy(b["room_id"]) {
		var rmFac *int
		e := h.pool().QueryRow(ctx, "SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL", studentsPtrArg(roomIDPtr)).Scan(&rmFac)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				badRequest(c, "Phòng không tồn tại")
				return
			}
			serverErr(c)
			return
		}
		if fe := scope.AssertFacility(u, rmFac); fe != nil {
			c.JSON(fe.Status, gin.H{"error": fe.Error})
			return
		}
		facIDArg = studentsPtrArg(rmFac)
	} else {
		facIDArg = studentsPtrArg(scope.ResolveFacilityForCreate(u, studentsIntPtr(b["facility_id"])))
	}
	// Tài khoản đăng nhập (tuỳ chọn)
	createLogin := studentsJSTruthy(b["create_login"])
	var uname, pass string
	if createLogin {
		if studentsJSTruthy(b["login_username"]) {
			uname = studentsJSString(b["login_username"])
		} else if studentsJSTruthy(b["code"]) {
			uname = studentsJSString(b["code"])
		}
		uname = strings.TrimSpace(uname)
		if studentsJSTruthy(b["login_password"]) {
			pass = studentsJSString(b["login_password"])
		}
		pass = strings.TrimSpace(pass)
		if uname == "" {
			badRequest(c, "Cần tên đăng nhập (hoặc mã HV) để tạo tài khoản")
			return
		}
		if len([]rune(pass)) < valid.InitialPasswordMin {
			badRequest(c, "Mật khẩu tài khoản tối thiểu "+itoa(valid.InitialPasswordMin)+" ký tự")
			return
		}
		var one int
		if h.pool().QueryRow(ctx, "SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL", uname).Scan(&one) == nil {
			badRequest(c, `Tên đăng nhập "`+uname+`" đã tồn tại`)
			return
		}
	}

	today := timeutil.Today()
	checkIn := today
	if studentsJSTruthy(b["check_in_date"]) {
		checkIn = studentsJSString(b["check_in_date"])
	}
	checkOut := ""
	if studentsJSTruthy(b["check_out_date"]) {
		checkOut = studentsJSString(b["check_out_date"])
	}
	status := "in"
	if checkOut != "" && checkOut <= today {
		status = "out"
	}
	settings, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	takeDeposit := studentsJSTruthy(b["deposit_paid"])
	depositFee := studentsSettingNum(settings, "deposit_fee")

	// Giá trị theo cột INSERT (students.routes.js:305-316)
	var checkOutArg interface{}
	if checkOut != "" {
		checkOutArg = checkOut
	}
	var depositAmountArg interface{} = 0
	depositStatusArg := "none"
	var depositDateArg interface{}
	if takeDeposit {
		depositAmountArg = depositFee
		depositStatusArg = "held"
		depositDateArg = checkIn
	}
	reasonStr := studentsJSString(b["checkout_reason"])
	var checkoutReasonArg interface{}
	if checkOut != "" && studentsCheckoutReasons[reasonStr] {
		checkoutReasonArg = reasonStr
	} else if checkOut != "" {
		checkoutReasonArg = "other"
	}
	name := strings.TrimSpace(studentsStrOr(b["name"]))

	params := studentsCoreFields(b, checkIn) // $1..$16
	params = append(params,
		nil,               // $17 cccd_image (upload sau — CHƯA port S3)
		status,            // $18
		checkOutArg,       // $19
		depositAmountArg,  // $20
		depositStatusArg,  // $21
		depositDateArg,    // $22
		nil,               // $23 cccd_front
		nil,               // $24 cccd_back
		checkoutReasonArg, // $25
		studentsDateOrNull(b["class_start_date"]),                     // $26
		studentsDateOrNull(b["expected_departure"]),                   // $27
		studentsStrOr(b["parent_phone"]),                              // $28
		studentsPct(b["room_fee_discount_pct"]),                       // $29
		facIDArg,                                                      // $30
		studentsPct(b["water_discount_pct"]),                          // $31
		studentsPct(b["electric_discount_pct"]),                       // $32
		studentsPct(b["service_discount_pct"]),                        // $33
		studentsPct(b["washing_discount_pct"]),                        // $34
		studentsPct(b["parking_discount_pct"]),                        // $35
		strings.ToLower(strings.TrimSpace(studentsStrOr(b["email"]))), // $36 — hạ chữ thường để khớp SSO không phụ thuộc hoa/thường
	)

	if !h.studentsValidateCccd(c, b) { // 400 nếu ảnh CCCD sai chữ ký (trước khi ghi)
		return
	}
	var student map[string]interface{}
	txErr := h.DB.WithTx(ctx, func(tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `INSERT INTO students
          (code, name, gender, phone, id_card, birth_date, class_name, room_id, check_in_date, note,
           uses_washing, rental_type, residency_status, contract_no, contract_date, contract_status, cccd_image,
           status, check_out_date, deposit_amount, deposit_status, deposit_date, cccd_front, cccd_back, checkout_reason,
           class_start_date, expected_departure, parent_phone, room_fee_discount_pct, facility_id,
           water_discount_pct, electric_discount_pct, service_discount_pct, washing_discount_pct, parking_discount_pct,
           email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36) RETURNING *`,
			params...)
		if e != nil {
			return e
		}
		st, e := db.RowToMap(rows)
		if e != nil {
			return e
		}
		student = st
		sid := intFromDB(st["id"])
		// (CCCD upload BỎ — CHƯA port S3; bản ghi vẫn được tạo với cccd_* = null)
		if studentsJSTruthy(b["room_id"]) {
			if e := roomstays.OpenStay(ctx, tx, sid, roomIDPtr, checkIn); e != nil {
				return e
			}
			if checkOut != "" {
				if e := roomstays.CloseStay(ctx, tx, sid, checkOut); e != nil {
					return e
				}
			}
		}
		if _, e := tx.Exec(ctx,
			`INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'in',$2,$3,'Đăng ký & vào ở','admin')`,
			sid, checkIn, studentsPtrArg(roomIDPtr)); e != nil {
			return e
		}
		if createLogin {
			hash, e := bcrypt.GenerateFromPassword([]byte(pass), 10)
			if e != nil {
				return e
			}
			if _, e := tx.Exec(ctx,
				`INSERT INTO users (username, password_hash, role, full_name, student_id, must_change_password) VALUES ($1,$2,'student',$3,$4,true)`,
				uname, string(hash), name, sid); e != nil {
				return e
			}
		}
		return nil
	})
	if txErr != nil {
		serverErr(c)
		return
	}
	// Upload ảnh CCCD -> S3 + cập nhật key (sau commit; lỗi kho không huỷ hồ sơ đã tạo).
	if h.Store != nil {
		sid := intFromDB(student["id"])
		for _, f := range []string{"cccd_image", "cccd_front", "cccd_back"} {
			if _, key, changed := h.studentsResolveCccd(ctx, sid, f, studentsJSString(b[f]), ""); changed && key != "" {
				_, _ = h.pool().Exec(ctx, "UPDATE students SET "+f+"=$1 WHERE id=$2", key, sid)
				student[f] = key
			}
		}
	}
	studentsLogOverloads(ctx, h.pool(), c, u, intFromDB(student["id"]), studentsJSString(student["name"]), chk.Warnings)
	studentsSignCccd(student)
	student["warnings"] = chk.Warnings
	c.JSON(http.StatusCreated, student)
}

// UpdateStudent: PUT /:id (admin,staff). MERGE + khoá lạc quan xmin. students.routes.js:357-418
func (h *Handlers) UpdateStudent(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	ctx := c.Request.Context()
	_, raw := studentsReadBody(c)

	curRows, err := h.pool().Query(ctx, "SELECT * FROM students WHERE id=$1 AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	cur, err := db.RowToMap(curRows)
	if err != nil {
		serverErr(c)
		return
	}
	if cur == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	// MERGE: b = {...cur}, ghi đè bằng field GỬI lên (kể cả null).
	b := map[string]interface{}{}
	for k, v := range cur {
		b[k] = v
	}
	for k, v := range raw {
		b[k] = v
	}
	// Chặn ngày ảo trong dữ liệu GỬI LÊN (raw)
	for _, k := range studentsDateFields {
		if v, ok := raw[k]; ok && v != nil {
			s := studentsJSString(v)
			if s != "" && !valid.IsValidYmd(s) {
				badRequest(c, "Ngày không hợp lệ ("+k+")")
				return
			}
		}
	}
	// BL-78: lớp chặn XSS thứ hai, xét ĐÚNG những trường lần này gửi lên.
	if e := valid.KhongChoHTML(func(k string) (string, bool) {
		v, ok := raw[k]
		if !ok || v == nil {
			return "", false
		}
		return studentsJSString(v), true
	}, []string{"name", "code", "class_name", "note", "deposit_bank", "deposit_account", "checkout_reason"}); e != "" {
		badRequest(c, e)
		return
	}
	ciM := studentsJSString(b["check_in_date"])
	coM := studentsJSString(b["check_out_date"])
	if valid.IsValidYmd(ciM) && valid.IsValidYmd(coM) && studentsSlice10(coM) < studentsSlice10(ciM) {
		badRequest(c, "Ngày trả phòng không thể trước ngày nhận phòng")
		return
	}
	// Ngày trả phòng chỉ ĐẶT/ĐỔI được sang ngày TƯƠNG LAI. Ngày đã qua là việc đã rồi — phiếu tháng
	// đó đã phát, công-tơ đã chốt — sửa ở đây là làm lệch sổ mà không ai thấy.
	homNay := timeutil.Today()
	coCu := studentsSlice10(studentsJSString(cur["check_out_date"]))
	coMoi := studentsSlice10(coM)
	if coMoi != coCu {
		if coCu != "" && coCu <= homNay {
			badRequest(c, "Học viên đã trả phòng ngày "+coCu+". Ngày đã qua không sửa được ở đây.")
			return
		}
		if coMoi != "" && coMoi <= homNay {
			badRequest(c, "Ngày trả phòng phải sau hôm nay ("+homNay+"). Trả phòng hôm nay hoặc đã trả rồi thì dùng nút Check-out.")
			return
		}
		if coMoi != "" {
			msg, e := checkout.BadCheckoutDate(ctx, h.pool(), id, coMoi, studentsSlice10(ciM))
			if e != nil {
				serverErr(c)
				return
			}
			if msg != "" {
				badRequest(c, msg)
				return
			}
		}
	}
	if pv := b["phone"]; pv != nil {
		ps := studentsJSString(pv)
		if strings.TrimSpace(ps) != "" && !valid.IsValidPhone(ps) {
			badRequest(c, `Số điện thoại không hợp lệ: "`+ps+`" (cần 8–15 chữ số)`)
			return
		}
	}
	// Chặn trùng cả ở đường SỬA
	dup, dupMsg, err := studentsFindDuplicate(ctx, h.pool(), studentsJSString(b["code"]), studentsJSString(b["id_card"]), &id)
	if err != nil {
		serverErr(c)
		return
	}
	if dup != nil {
		conflict(c, gin.H{"error": dupMsg, "existing": dup, "duplicate": true})
		return
	}
	// LUẬT XẾP PHÒNG — áp cả ở đường SỬA
	chkU, err := roomrules.CheckRoomAssignment(ctx, h.pool(), &id, studentsJSString(b["gender"]), studentsJSString(b["rental_type"]), studentsRoomIDPtr(b["room_id"]))
	if err != nil {
		serverErr(c)
		return
	}
	if studentsBlockOrConfirm(c, chkU, raw["confirm_overload"] == true) {
		return
	}
	params := studentsCoreFields(b, nil) // $1..$16
	params = append(params,
		studentsDateOrNull(b["class_start_date"]),                     // $17
		studentsDateOrNull(b["expected_departure"]),                   // $18
		studentsStrOr(b["parent_phone"]),                              // $19
		studentsPct(b["room_fee_discount_pct"]),                       // $20
		studentsPct(b["water_discount_pct"]),                          // $21
		studentsPct(b["electric_discount_pct"]),                       // $22
		studentsPct(b["service_discount_pct"]),                        // $23
		studentsPct(b["washing_discount_pct"]),                        // $24
		studentsPct(b["parking_discount_pct"]),                        // $25
		strings.ToLower(strings.TrimSpace(studentsStrOr(b["email"]))), // $26
		studentsDateOrNull(b["check_out_date"]),                       // $27
	)
	cols := `code=$1, name=$2, gender=$3, phone=$4, id_card=$5, birth_date=$6, class_name=$7, room_id=$8,
      check_in_date=$9, note=$10, uses_washing=$11, rental_type=$12, residency_status=$13,
      contract_no=$14, contract_date=$15, contract_status=$16,
      class_start_date=$17, expected_departure=$18, parent_phone=$19, room_fee_discount_pct=$20,
      water_discount_pct=$21, electric_discount_pct=$22, service_discount_pct=$23,
      washing_discount_pct=$24, parking_discount_pct=$25, email=$26, check_out_date=$27`
	// (CCCD extra BỎ — CHƯA port S3; cột cccd_* không đổi ở PUT)
	params = append(params, id) // $28
	sql := "UPDATE students SET " + cols + " WHERE id=$28"
	if studentsJSTruthy(raw["_v"]) {
		params = append(params, studentsJSString(raw["_v"])) // $29
		sql = "UPDATE students SET " + cols + " WHERE id=$28 AND xmin::text = $29"
	}
	sql += " RETURNING *"

	if !h.studentsValidateCccd(c, b) { // 400 nếu ảnh CCCD sai chữ ký (trước khi ghi)
		return
	}
	upRows, err := h.pool().Query(ctx, sql, params...)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(upRows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		var conName string
		if h.pool().QueryRow(ctx, "SELECT name FROM students WHERE id=$1 AND deleted_at IS NULL", id).Scan(&conName) != nil {
			notFound(c, "Không tìm thấy học viên")
			return
		}
		conflict(c, gin.H{
			"conflict": true,
			"error": `Hồ sơ "` + conName + `" vừa được người khác sửa sau khi bạn mở form.` + "\n\n" +
				"Lưu bây giờ sẽ đè mất thay đổi của họ. Hãy đóng form, mở lại để xem bản mới nhất rồi sửa tiếp.",
		})
		return
	}
	// BL-09: đồng bộ tên sang users.full_name (tài khoản đăng nhập của HV). Không có dòng này thì cổng
	// HV vẫn chào bằng tên cũ (/me đọc users.full_name) — lệch DỮ LIỆU trong CSDL, đăng xuất/vào lại
	// KHÔNG cứu được. Không có tài khoản -> 0 dòng bị ảnh hưởng (vô hại).
	_, _ = h.pool().Exec(ctx, "UPDATE users SET full_name=$1 WHERE student_id=$2", studentsJSString(row["name"]), id)
	// Sửa ô Phòng/Ngày = ĐÍNH CHÍNH lượt ở
	ciStr := ""
	if studentsJSTruthy(row["check_in_date"]) {
		ciStr = studentsSlice10(studentsJSString(row["check_in_date"]))
	}
	coStr := ""
	if studentsJSTruthy(row["check_out_date"]) {
		coStr = studentsSlice10(studentsJSString(row["check_out_date"]))
	}
	if err := roomstays.Reconcile(ctx, h.pool(), intFromDB(row["id"]), intPtrFromDB(row["room_id"]), ciStr, coStr); err != nil {
		serverErr(c)
		return
	}
	// Đổi ngày trả phòng = đổi số ngày ở: tiền phòng/nước/dịch vụ của HV và phần điện chia cho CẢ
	// PHÒNG đều lệch theo. RecalcInvoice tự bỏ qua tháng chưa có phiếu và phiếu đã thu.
	if coMoi != coCu {
		roomID := intPtrFromDB(row["room_id"])
		for _, mo := range studentsThangBiCham(coCu, coMoi) {
			_, _ = invoicecalc.RecalcInvoice(ctx, h.DB, id, mo)
			if roomID == nil {
				continue
			}
			roster, e := invoicecalc.RoomRoster(ctx, h.DB, *roomID, mo)
			if e != nil {
				continue
			}
			for _, r := range roster {
				if r.StudentID != id {
					_, _ = invoicecalc.RecalcInvoice(ctx, h.DB, r.StudentID, mo)
				}
			}
		}
	}
	// Upload/đổi/xoá ảnh CCCD (resolveCccd cho sửa: chỉ field CÓ gửi lên).
	if h.Store != nil {
		for _, f := range []string{"cccd_image", "cccd_front", "cccd_back"} {
			rv, sent := raw[f]
			if !sent {
				continue
			}
			setNull, key, changed := h.studentsResolveCccd(ctx, intFromDB(row["id"]), f, studentsJSString(rv), studentsJSString(cur[f]))
			if !changed {
				continue
			}
			if setNull {
				_, _ = h.pool().Exec(ctx, "UPDATE students SET "+f+"=NULL WHERE id=$1", id)
				row[f] = nil
			} else if key != "" {
				_, _ = h.pool().Exec(ctx, "UPDATE students SET "+f+"=$1 WHERE id=$2", key, id)
				row[f] = key
			}
		}
	}
	studentsLogOverloads(ctx, h.pool(), c, u, intFromDB(row["id"]), studentsJSString(row["name"]), chkU.Warnings)
	studentsSignCccd(row)
	row["warnings"] = chkU.Warnings
	c.JSON(http.StatusOK, row)
}

// DeleteStudent: DELETE /:id (admin,staff) — xoá mềm. students.routes.js:421-424
func (h *Handlers) DeleteStudent(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c) // id phi số -> câu lệnh SQL vỡ như Node (500)
		return
	}
	_, b := studentsReadBody(c)
	// Chỉ nhận CHUỖI. studentsJSString biến object/mảng thành chuỗi rác, mà Go với Node còn
	// ra chuỗi rác khác nhau -> hai backend lệch dữ liệu.
	thoRaw, _ := b["reason"].(string)
	if e := valid.KhongChoHTML(func(k string) (string, bool) { return thoRaw, k == "reason" },
		[]string{"reason"}); e != "" {
		badRequest(c, e)
		return
	}
	lyDo := studentsLyDoKhoa(thoRaw)
	tag, err := h.pool().Exec(c.Request.Context(),
		"UPDATE students SET deleted_at=now(), lock_reason=$2 WHERE id=$1", id, lyDo)
	if err != nil {
		serverErr(c)
		return
	}
	if tag.RowsAffected() == 0 {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "lock_reason": lyDo})
}

// studentsLyDoKhoa: lý do khoá hồ sơ. Bỏ trống -> lý do mặc định, không để trống trơn.
// Ký tự vô hình (zero-width, BOM) cũng tính là trống — không thì ô "Lý do khoá" hiện ra trắng trơn.
func studentsLyDoKhoa(s string) string {
	v := strings.TrimSpace(s)
	v = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, v)
	v = strings.TrimSpace(v)
	if v == "" {
		return studentsLyDoKhoaMacDinh
	}
	if len([]rune(v)) > 300 {
		v = string([]rune(v)[:300])
	}
	return v
}

const studentsLyDoKhoaMacDinh = "Ngừng dịch vụ thuê phòng"

// RestoreStudent: POST /:id/restore (admin,staff). students.routes.js:427-430
func (h *Handlers) RestoreStudent(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	// Mở khoá thì lý do hết hiệu lực — để lại sẽ hiện lẫn với hồ sơ đang hoạt động.
	if _, err := h.pool().Exec(c.Request.Context(), "UPDATE students SET deleted_at=NULL, lock_reason='' WHERE id=$1", id); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// StudentWashing: POST /:id/washing (admin,staff). students.routes.js:433-440
func (h *Handlers) StudentWashing(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	_, b := studentsReadBody(c)
	on := studentsJSTruthy(b["on"])
	rows, err := h.pool().Query(c.Request.Context(), "UPDATE students SET uses_washing=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id", on, id)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "on": on})
}

// StudentCheckin: POST /:id/checkin (admin,staff). students.routes.js:443-467
func (h *Handlers) StudentCheckin(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	ctx := c.Request.Context()
	data, b := studentsReadBody(c)
	if bad := studentsRejectUnknown(studentsOrderedKeys(data), []string{"date", "room_id", "note", "confirm_overload"}); bad != "" {
		badRequest(c, bad)
		return
	}
	if dv := b["date"]; dv != nil && !valid.IsValidYmd(studentsJSString(dv)) {
		badRequest(c, "Ngày nhận phòng không hợp lệ")
		return
	}
	meRows, err := h.pool().Query(ctx, "SELECT gender, rental_type, name FROM students WHERE id=$1 AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	me, err := db.RowToMap(meRows)
	if err != nil {
		serverErr(c)
		return
	}
	if me == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	roomIDPtr := studentsRoomIDPtr(b["room_id"])
	chkI, err := roomrules.CheckRoomAssignment(ctx, h.pool(), &id, studentsJSString(me["gender"]), studentsJSString(me["rental_type"]), roomIDPtr)
	if err != nil {
		serverErr(c)
		return
	}
	if studentsBlockOrConfirm(c, chkI, b["confirm_overload"] == true) {
		return
	}
	studentsLogOverloads(ctx, h.pool(), c, u, id, studentsJSString(me["name"]), chkI.Warnings)
	d := timeutil.Today()
	if studentsJSTruthy(b["date"]) {
		d = studentsJSString(b["date"])
	}
	rows, err := h.pool().Query(ctx,
		`UPDATE students SET status='in', room_id=$1, check_in_date=$2, check_out_date=NULL,
         checkout_notice_date=NULL, checkout_reason=NULL WHERE id=$3 RETURNING *`,
		studentsPtrArg(roomIDPtr), d, id)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	if err := roomstays.CheckIn(ctx, h.pool(), id, roomIDPtr, d); err != nil {
		serverErr(c)
		return
	}
	note := studentsStrOr(b["note"])
	if note == "" {
		note = "Check-in"
	}
	if _, err := h.pool().Exec(ctx, `INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'in',$2,$3,$4,'admin')`,
		id, d, studentsPtrArg(roomIDPtr), note); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, row)
}

// StudentCheckout: POST /:id/checkout (admin,staff). students.routes.js:470-530
func (h *Handlers) StudentCheckout(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	ctx := c.Request.Context()
	data, b := studentsReadBody(c)
	if bad := studentsRejectUnknown(studentsOrderedKeys(data), []string{"date", "notice_date", "reason", "note", "meter_reading"}); bad != "" {
		badRequest(c, bad)
		return
	}
	if dv := b["date"]; dv != nil && !valid.IsValidYmd(studentsJSString(dv)) {
		badRequest(c, "Ngày trả phòng không hợp lệ")
		return
	}
	if nv := b["notice_date"]; nv != nil {
		ns := studentsJSString(nv)
		if ns != "" && !valid.IsValidYmd(ns) {
			badRequest(c, "Ngày báo trả phòng không hợp lệ")
			return
		}
	}
	d := timeutil.Today()
	if studentsJSTruthy(b["date"]) {
		d = studentsJSString(b["date"])
	}
	ciRows, err := h.pool().Query(ctx, "SELECT check_in_date, status, check_out_date FROM students WHERE id=$1 AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	ci, err := db.RowToMap(ciRows)
	if err != nil {
		serverErr(c)
		return
	}
	if ci == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	// M-2: chặn check-out LẦN 2
	if studentsJSString(ci["status"]) == "out" {
		coStr := ""
		if studentsJSTruthy(ci["check_out_date"]) {
			coStr = " ngày " + studentsSlice10(studentsJSString(ci["check_out_date"]))
		}
		conflict(c, gin.H{"error": "Học viên đã trả phòng" + coStr + ". Nếu cần đổi ngày trả, hãy nhận phòng lại (check-in) trước."})
		return
	}
	badDate, err := checkout.BadCheckoutDate(ctx, h.pool(), id, d, studentsJSString(ci["check_in_date"]))
	if err != nil {
		serverErr(c)
		return
	}
	if badDate != "" {
		badRequest(c, badDate)
		return
	}
	rs := "other"
	if studentsCheckoutReasons[studentsJSString(b["reason"])] {
		rs = studentsJSString(b["reason"])
	}
	curRows, err := h.pool().Query(ctx, "SELECT room_id FROM students WHERE id=$1", id)
	if err != nil {
		serverErr(c)
		return
	}
	curRow, err := db.RowToMap(curRows)
	if err != nil {
		serverErr(c)
		return
	}
	if curRow == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	roomID := intPtrFromDB(curRow["room_id"]) // room_id || null

	// CHỐT CHỈ SỐ ĐIỆN NGÀY TRẢ — kiểm TRƯỚC khi ghi
	hasMeter, reading, finite := studentsMeterVal(b["meter_reading"])
	if hasMeter {
		if roomID == nil {
			badRequest(c, "Học viên không ở phòng nào — không có công-tơ để chốt chỉ số")
			return
		}
		if !finite {
			badRequest(c, "Chỉ số công-tơ phải là số không âm")
			return
		}
		errMsg, e := meter.CheckRead(ctx, h.pool(), *roomID, d, reading)
		if e != nil {
			serverErr(c)
			return
		}
		if errMsg != "" {
			badRequest(c, errMsg)
			return
		}
	}
	settings, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	noticeArg := ""
	if studentsJSTruthy(b["notice_date"]) {
		noticeArg = studentsJSString(b["notice_date"])
	}
	elig := billing.DepositRefundEligible(noticeArg, d, rs, int(studentsSettingNum(settings, "deposit_notice_min_days")))

	var noticeParam interface{}
	if studentsJSTruthy(b["notice_date"]) {
		noticeParam = studentsJSString(b["notice_date"])
	}
	upRows, err := h.pool().Query(ctx,
		`UPDATE students SET status='out', check_out_date=$1, checkout_notice_date=$2, checkout_reason=$3 WHERE id=$4 RETURNING *`,
		d, noticeParam, rs, id)
	if err != nil {
		serverErr(c)
		return
	}
	student, err := db.RowToMap(upRows)
	if err != nil {
		serverErr(c)
		return
	}
	if hasMeter {
		if _, e := meter.RecordRead(ctx, h.pool(), *roomID, d, reading, "checkout", &id,
			"Chốt chỉ số lúc "+studentsJSString(student["name"])+" trả phòng", u.Username); e != nil {
			serverErr(c)
			return
		}
	}
	note := studentsStrOr(b["note"])
	if note == "" {
		note = "Check-out"
	}
	if _, err := h.pool().Exec(ctx, `INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out',$2,$3,$4,'admin')`,
		id, d, studentsPtrArg(roomID), note); err != nil {
		serverErr(c)
		return
	}
	// BLK-1: đóng lượt ở + phòng trưởng + dọn phiếu kỳ sau + tính lại phiếu tháng trả
	dropped, err := checkout.FinalizeCheckout(ctx, h.pool(), h.DB, id, d)
	if err != nil {
		serverErr(c)
		return
	}
	if dropped == nil {
		dropped = []string{}
	}
	// recalced = phiếu tháng trả sau khi tính lại (FinalizeCheckout đã recalc; đọc lại để trả field — idempotent)
	var recalced interface{}
	if r, e := invoicecalc.RecalcInvoice(ctx, h.DB, id, d[:7]); e == nil && r != nil {
		recalced = r
	}
	recalcedRoommates := []int{}
	if hasMeter {
		aff, e := meter.AffectedStudents(ctx, h.pool(), *roomID, d)
		if e == nil {
			for _, sid := range aff {
				if sid == id {
					continue
				}
				// Điện lùi kỳ: khối điện kỳ d nằm trên phiếu kỳ SAU của người còn ở — phải tính lại cả hai.
				if invoicecalc.RecalcQuanhKy(ctx, h.DB, sid, d[:7]) > 0 {
					recalcedRoommates = append(recalcedRoommates, sid)
				}
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"student":                 student,
		"refund":                  gin.H{"eligible": elig.Eligible, "reason": elig.Reason},
		"recalced":                recalced,
		"recalced_roommates":      recalcedRoommates,
		"dropped_future_invoices": dropped,
	})
}

// UpdateCheckoutDate: PUT /:id/checkout-date (admin,staff). Sửa ngày trả của hồ sơ ĐÃ rời —
// làm lại đúng việc check-out làm nhưng cho ngày mới, tính lại cả tháng cũ lẫn tháng mới.
func (h *Handlers) UpdateCheckoutDate(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	ctx := c.Request.Context()
	data, b := studentsReadBody(c)
	if bad := studentsRejectUnknown(studentsOrderedKeys(data), []string{"date", "notice_date", "reason", "note", "meter_reading"}); bad != "" {
		badRequest(c, bad)
		return
	}
	d := studentsSlice10(studentsJSString(b["date"]))
	if !valid.IsValidYmd(d) {
		badRequest(c, "Ngày trả phòng không hợp lệ")
		return
	}
	if nv := b["notice_date"]; nv != nil {
		ns := studentsJSString(nv)
		if ns != "" && !valid.IsValidYmd(ns) {
			badRequest(c, "Ngày báo trả phòng không hợp lệ")
			return
		}
	}
	curRows, err := h.pool().Query(ctx,
		"SELECT name, status, check_in_date, check_out_date, room_id FROM students WHERE id=$1 AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	cur, err := db.RowToMap(curRows)
	if err != nil {
		serverErr(c)
		return
	}
	if cur == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	if studentsJSString(cur["status"]) != "out" {
		conflict(c, gin.H{"error": "Học viên chưa trả phòng. Dùng nút Check-out để trả phòng lần đầu."})
		return
	}
	cuStr := studentsSlice10(studentsJSString(cur["check_out_date"]))
	badDate, err := checkout.BadCheckoutDate(ctx, h.pool(), id, d, studentsJSString(cur["check_in_date"]))
	if err != nil {
		serverErr(c)
		return
	}
	if badDate != "" {
		badRequest(c, badDate)
		return
	}
	// BadCheckoutDate chỉ soi lượt đang MỞ, mà hồ sơ đã rời thì lượt đã đóng -> nó bỏ qua.
	// Không chặn ở đây thì lùi ngày về trước lần chuyển phòng cuối sẽ XOÁ lượt đó, để hồ sơ ghi một
	// ngày còn lịch sử ở ghi một ngày khác — chênh lệch đó chảy thẳng vào phần chia tiền điện.
	last, err := roomstays.LastStayOf(ctx, h.pool(), id)
	if err != nil {
		serverErr(c)
		return
	}
	if last != nil && d < last.FromDate {
		badRequest(c, "Ngày trả phòng ("+d+") không thể trước ngày bắt đầu lượt ở cuối ("+last.FromDate+
			") — học viên đã chuyển phòng ngày đó. Chọn ngày ≥ ngày chuyển, hoặc sửa lại lịch sử chuyển phòng trước.")
		return
	}
	roomID := intPtrFromDB(cur["room_id"])

	// Chốt lại chỉ số công-tơ theo ngày MỚI — kiểm trước khi ghi, giống check-out.
	hasMeter, reading, finite := studentsMeterVal(b["meter_reading"])
	if hasMeter {
		if roomID == nil {
			badRequest(c, "Học viên không ở phòng nào — không có công-tơ để chốt chỉ số")
			return
		}
		if !finite {
			badRequest(c, "Chỉ số công-tơ phải là số không âm")
			return
		}
		errMsg, e := meter.CheckRead(ctx, h.pool(), *roomID, d, reading)
		if e != nil {
			serverErr(c)
			return
		}
		if errMsg != "" {
			badRequest(c, errMsg)
			return
		}
	}
	sets := []string{"check_out_date=$1"}
	args := []interface{}{d}
	if b["notice_date"] != nil {
		sets = append(sets, "checkout_notice_date=$"+itoa(len(args)+1))
		args = append(args, studentsDateOrNull(b["notice_date"]))
	}
	if studentsCheckoutReasons[studentsJSString(b["reason"])] {
		sets = append(sets, "checkout_reason=$"+itoa(len(args)+1))
		args = append(args, studentsJSString(b["reason"]))
	}
	args = append(args, id)
	upRows, err := h.pool().Query(ctx,
		"UPDATE students SET "+strings.Join(sets, ", ")+" WHERE id=$"+itoa(len(args))+" RETURNING *", args...)
	if err != nil {
		serverErr(c)
		return
	}
	student, err := db.RowToMap(upRows)
	if err != nil {
		serverErr(c)
		return
	}
	// Lượt ở đã ĐÓNG rồi nên CloseStay không chạm tới được — phải dời thẳng ngày kết thúc.
	if err := roomstays.MoveLastToDate(ctx, h.pool(), id, d); err != nil {
		serverErr(c)
		return
	}
	if err := roomleaders.CloseStudent(ctx, h.pool(), id, d); err != nil {
		serverErr(c)
		return
	}
	if hasMeter {
		if _, e := meter.RecordRead(ctx, h.pool(), *roomID, d, reading, "checkout", &id,
			"Sửa ngày trả — chốt lại chỉ số của "+studentsJSString(student["name"]), u.Username); e != nil {
			serverErr(c)
			return
		}
	}
	note := studentsStrOr(b["note"])
	if note == "" {
		note = "Sửa ngày trả phòng: " + cuStr + " -> " + d
	}
	if _, err := h.pool().Exec(ctx, `INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'out',$2,$3,$4,'admin')`,
		id, d, studentsPtrArg(roomID), note); err != nil {
		serverErr(c)
		return
	}
	// Dời ngày làm phiếu của CẢ HAI tháng sai: tháng cũ thừa/thiếu ngày, tháng mới chưa có phiếu.
	// Dọn phiếu sau tháng mới trước, rồi mới tính lại — thứ tự ngược lại là vừa tính vừa xoá.
	dropped := []string{}
	rows, err := h.pool().Query(ctx,
		"UPDATE invoices SET deleted_at=now() WHERE student_id=$1 AND month > $2 AND deleted_at IS NULL RETURNING month", id, d[:7])
	if err != nil {
		serverErr(c)
		return
	}
	for rows.Next() {
		var m string
		if e := rows.Scan(&m); e != nil {
			rows.Close()
			serverErr(c)
			return
		}
		dropped = append(dropped, m)
	}
	rows.Close()
	thang := map[string]bool{d[:7]: true}
	if cuStr != "" {
		thang[cuStr[:7]] = true
	}
	// Kéo ngày trả về SAU: những kỳ mà lần check-out trước đã dọn nay có người ở thật -> trả lại.
	// Chỉ đụng đúng khoảng (kỳ cũ, kỳ mới], không đào lại phiếu bị xoá vì lý do khác.
	restored := []string{}
	if cuStr != "" && cuStr[:7] < d[:7] {
		rRows, e := h.pool().Query(ctx,
			`UPDATE invoices SET deleted_at=NULL WHERE student_id=$1 AND month > $2 AND month <= $3
			   AND deleted_at IS NOT NULL AND status <> 'paid' RETURNING month`, id, cuStr[:7], d[:7])
		if e != nil {
			serverErr(c)
			return
		}
		for rRows.Next() {
			var m string
			if rRows.Scan(&m) == nil {
				restored = append(restored, m)
				thang[m] = true
			}
		}
		rRows.Close()
	}
	for m := range thang {
		_, _ = invoicecalc.RecalcInvoice(ctx, h.DB, id, m)
	}
	// Bạn cùng phòng gánh phần điện của người rời -> đổi ngày rời là phần của họ đổi theo.
	recalcedRoommates := []int{}
	if roomID != nil {
		nguoi := map[int]bool{}
		for m := range thang {
			if aff, e := meter.AffectedStudents(ctx, h.pool(), *roomID, m+"-01"); e == nil {
				for _, sid := range aff {
					if sid != id {
						nguoi[sid] = true
					}
				}
			}
		}
		for sid := range nguoi {
			for m := range thang {
				if invoicecalc.RecalcQuanhKy(ctx, h.DB, sid, m) > 0 {
					recalcedRoommates = append(recalcedRoommates, sid)
					break
				}
			}
		}
	}
	studentsSignCccd(student)
	c.JSON(http.StatusOK, gin.H{
		"student":                 student,
		"cu":                      cuStr,
		"moi":                     d,
		"recalced_roommates":      recalcedRoommates,
		"dropped_future_invoices": dropped,
		"restored_invoices":       restored,
	})
}

// StudentTransfer: POST /:id/transfer (admin,staff). students.routes.js:533-593
func (h *Handlers) StudentTransfer(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	ctx := c.Request.Context()
	data, b := studentsReadBody(c)
	if bad := studentsRejectUnknown(studentsOrderedKeys(data), []string{"room_id", "date", "note", "confirm_overload", "meter_reading"}); bad != "" {
		badRequest(c, bad)
		return
	}
	if !studentsJSTruthy(b["room_id"]) {
		badRequest(c, "Chọn phòng mới")
		return
	}
	if dv := b["date"]; dv != nil && !valid.IsValidYmd(studentsJSString(dv)) {
		badRequest(c, "Ngày chuyển phòng không hợp lệ")
		return
	}
	d := timeutil.Today()
	if studentsJSTruthy(b["date"]) {
		d = studentsJSString(b["date"])
	}
	curRows, err := h.pool().Query(ctx, "SELECT room_id, gender, rental_type, name, facility_id FROM students WHERE id=$1 AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	cur, err := db.RowToMap(curRows)
	if err != nil {
		serverErr(c)
		return
	}
	if cur == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	if fe := scope.AssertFacility(u, intPtrFromDB(cur["facility_id"])); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	oldRoom := intPtrFromDB(cur["room_id"])
	newRoomID := studentsRoomIDPtr(b["room_id"])
	if studentsJSString(cur["room_id"]) == studentsJSString(b["room_id"]) {
		badRequest(c, "Học viên đang ở chính phòng này")
		return
	}
	var newRoomFac *int
	nrErr := h.pool().QueryRow(ctx, "SELECT facility_id FROM rooms WHERE id=$1 AND deleted_at IS NULL", studentsPtrArg(newRoomID)).Scan(&newRoomFac)
	if nrErr != nil {
		if errors.Is(nrErr, pgx.ErrNoRows) {
			badRequest(c, "Phòng mới không tồn tại")
			return
		}
		serverErr(c)
		return
	}
	if fe := scope.AssertFacility(u, newRoomFac); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	chkT, err := roomrules.CheckRoomAssignment(ctx, h.pool(), &id, studentsJSString(cur["gender"]), studentsJSString(cur["rental_type"]), newRoomID)
	if err != nil {
		serverErr(c)
		return
	}
	if studentsBlockOrConfirm(c, chkT, b["confirm_overload"] == true) {
		return
	}
	// CHỐT CHỈ SỐ PHÒNG CŨ ngày chuyển — kiểm trước khi ghi
	hasMeter, reading, finite := studentsMeterVal(b["meter_reading"])
	if hasMeter {
		if oldRoom == nil {
			badRequest(c, "Học viên chưa ở phòng nào — không có công-tơ phòng cũ để chốt")
			return
		}
		if !finite {
			badRequest(c, "Chỉ số công-tơ phải là số không âm")
			return
		}
		errMsg, e := meter.CheckRead(ctx, h.pool(), *oldRoom, d, reading)
		if e != nil {
			serverErr(c)
			return
		}
		if errMsg != "" {
			badRequest(c, errMsg)
			return
		}
	}
	studentsLogOverloads(ctx, h.pool(), c, u, id, studentsJSString(cur["name"]), chkT.Warnings)
	upRows, err := h.pool().Query(ctx, "UPDATE students SET room_id=$1, facility_id=$3 WHERE id=$2 RETURNING *",
		studentsPtrArg(newRoomID), id, studentsPtrArg(newRoomFac))
	if err != nil {
		serverErr(c)
		return
	}
	student, err := db.RowToMap(upRows)
	if err != nil {
		serverErr(c)
		return
	}
	if err := roomstays.Transfer(ctx, h.pool(), id, newRoomID, d); err != nil {
		serverErr(c)
		return
	}
	if err := roomleaders.CloseStudent(ctx, h.pool(), id, billing.AddDays(d, -1)); err != nil {
		serverErr(c)
		return
	}
	oldName := "—"
	if oldRoom != nil {
		var n string
		if h.pool().QueryRow(ctx, "SELECT name FROM rooms WHERE id=$1", *oldRoom).Scan(&n) == nil {
			oldName = n
		} else {
			oldName = ""
		}
	}
	var newName string
	_ = h.pool().QueryRow(ctx, "SELECT name FROM rooms WHERE id=$1", studentsPtrArg(newRoomID)).Scan(&newName)
	if hasMeter {
		if _, e := meter.RecordRead(ctx, h.pool(), *oldRoom, d, reading, "transfer", &id,
			"Chốt chỉ số phòng "+oldName+" lúc "+studentsJSString(cur["name"])+" chuyển đi", u.Username); e != nil {
			serverErr(c)
			return
		}
	}
	note := studentsStrOr(b["note"])
	if note == "" {
		note = "Chuyển phòng " + oldName + " → " + newName
	}
	if _, err := h.pool().Exec(ctx, `INSERT INTO logs (student_id, type, date, room_id, note, source) VALUES ($1,'in',$2,$3,$4,'admin')`,
		id, d, studentsPtrArg(newRoomID), note); err != nil {
		serverErr(c)
		return
	}
	recalced := []int{}
	if hasMeter {
		month := d[:7]
		aff, e := meter.AffectedStudents(ctx, h.pool(), *oldRoom, d)
		if e != nil {
			serverErr(c)
			return
		}
		// Set([...affected, +id]) — giữ thứ tự, thêm id nếu chưa có
		ids := append([]int{}, aff...)
		found := false
		for _, x := range ids {
			if x == id {
				found = true
				break
			}
		}
		if !found {
			ids = append(ids, id)
		}
		for _, sid := range ids {
			// Điện lùi kỳ: chốt chỉ số lúc chuyển phòng đổi khối điện kỳ này -> phiếu kỳ SAU mới mang nó.
			if invoicecalc.RecalcQuanhKy(ctx, h.DB, sid, month) > 0 {
				recalced = append(recalced, sid)
			}
		}
	}
	student["recalced"] = recalced
	c.JSON(http.StatusOK, student)
}

// StudentDeposit: POST /:id/deposit (admin,staff). students.routes.js:596-612
func (h *Handlers) StudentDeposit(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	ctx := c.Request.Context()
	data, b := studentsReadBody(c)
	if bad := studentsRejectUnknown(studentsOrderedKeys(data), []string{"amount", "date", "undo"}); bad != "" {
		badRequest(c, bad)
		return
	}
	// undo: gỡ ghi nhận đóng cọc, đưa hồ sơ về "chưa đóng". Ghi nhầm mà không có đường lùi thì cọc
	// vừa không đòi được (TienCoc thấy 'held' nên trả 0) vừa hiện "đang giữ" ở cổng học viên.
	if b["undo"] == true {
		rows, err := h.pool().Query(ctx,
			`UPDATE students SET deposit_amount=0, deposit_status='none', deposit_date=NULL, deposit_refund_date=NULL
			  WHERE id=$1 AND deleted_at IS NULL AND deposit_status='held' RETURNING *`, id)
		if err != nil {
			serverErr(c)
			return
		}
		row, err := db.RowToMap(rows)
		if err != nil {
			serverErr(c)
			return
		}
		if row == nil {
			badRequest(c, "Chỉ gỡ được hồ sơ đang ở trạng thái ĐANG GIỮ cọc. Cọc đã hoàn / không hoàn thì dùng màn tất toán.")
			return
		}
		c.JSON(http.StatusOK, row)
		return
	}
	settings, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	var amount float64
	var amountFinite bool
	if av := b["amount"]; av != nil {
		amount, amountFinite = studentsNumberJS(av)
	} else {
		amount, amountFinite = studentsSettingNum(settings, "deposit_fee"), true
	}
	if !amountFinite || amount < 0 {
		badRequest(c, "Tiền cọc phải là số không âm (đang nhận: "+studentsJSString(b["amount"])+")")
		return
	}
	if dv := b["date"]; dv != nil && !valid.IsValidYmd(studentsJSString(dv)) {
		badRequest(c, "Ngày đóng cọc không hợp lệ")
		return
	}
	date := timeutil.Today()
	if studentsJSTruthy(b["date"]) {
		date = studentsJSString(b["date"])
	}
	rows, err := h.pool().Query(ctx,
		`UPDATE students SET deposit_amount=$1, deposit_status='held', deposit_date=$2, deposit_refund_date=NULL WHERE id=$3 RETURNING *`,
		amount, date, id)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	c.JSON(http.StatusOK, row)
}

// StudentDepositSettle: POST /:id/deposit-settle (admin,staff).
// ⚠️ action='refund' luôn trả 500 — giữ nguyên hành vi bản Node (biến `settings` chưa định nghĩa ở đó
// nên nhánh xét điều kiện hoàn cọc là code chết). action='forfeited' chạy bình thường.
func (h *Handlers) StudentDepositSettle(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	ctx := c.Request.Context()
	data, b := studentsReadBody(c)
	if bad := studentsRejectUnknown(studentsOrderedKeys(data), []string{"action", "date", "deduction", "deductions", "bank", "account", "deduction_note", "override_reason"}); bad != "" {
		badRequest(c, bad)
		return
	}
	action := "forfeited"
	if studentsJSString(b["action"]) == "refund" {
		action = "refunded"
	}
	if dv := b["date"]; dv != nil && !valid.IsValidYmd(studentsJSString(dv)) {
		badRequest(c, "Ngày hoàn cọc không hợp lệ")
		return
	}
	date := timeutil.Today()
	if studentsJSTruthy(b["date"]) {
		date = studentsJSString(b["date"])
	}

	var deduction float64
	var deductionNote string
	if arr, isArr := b["deductions"].([]interface{}); isArr {
		var sum float64
		var parts []string
		for _, lineAny := range arr {
			line, _ := lineAny.(map[string]interface{})
			qtyVal := interface{}(nil)
			var assetVal interface{}
			if line != nil {
				qtyVal = line["quantity"]
				assetVal = line["asset_id"]
			}
			qty, qFin := studentsNumberJS(qtyVal)
			if !qFin || qty != math.Trunc(qty) || qty < 0 {
				badRequest(c, `Số lượng khấu trừ không hợp lệ: "`+studentsJSString(qtyVal)+`"`)
				return
			}
			if qty == 0 {
				continue
			}
			aRows, err := h.pool().Query(ctx, "SELECT name, fee FROM assets WHERE id=$1 AND deleted_at IS NULL", studentsPtrArg(studentsIntPtr(assetVal)))
			if err != nil {
				serverErr(c)
				return
			}
			a, err := db.RowToMap(aRows)
			if err != nil {
				serverErr(c)
				return
			}
			if a == nil {
				badRequest(c, "Tài sản không tồn tại (id="+studentsJSString(assetVal)+")")
				return
			}
			fee, _ := studentsNumberJS(a["fee"])
			lineTotal := qty * fee
			sum += lineTotal
			parts = append(parts, studentsJSString(a["name"])+" x"+numDisp(qty)+" = "+studentsLocaleVN(lineTotal))
		}
		deduction = sum
		deductionNote = strings.Join(parts, "; ")
	} else {
		f, ok := studentsNumberJS(b["deduction"])
		if ok && f != 0 {
			deduction = f
		} else {
			deduction = 0
		}
		deductionNote = studentsStrOr(b["deduction_note"])
	}

	stuRows, err := h.pool().Query(ctx, "SELECT deposit_amount, deposit_status, checkout_notice_date, check_out_date, checkout_reason FROM students WHERE id=$1 AND deleted_at IS NULL", id)
	if err != nil {
		serverErr(c)
		return
	}
	stu, err := db.RowToMap(stuRows)
	if err != nil {
		serverErr(c)
		return
	}
	if stu == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	coc := toFloat(stu["deposit_amount"])
	ds := studentsJSString(stu["deposit_status"])
	// M-1: MÁY TRẠNG THÁI cọc
	if ds == "refunded" || ds == "forfeited" {
		xuLy := "không hoàn"
		if ds == "refunded" {
			xuLy = "đã hoàn"
		}
		conflict(c, gin.H{"error": "Cọc đã được tất toán (" + xuLy + ") — không tất toán lại. Nếu cần điều chỉnh, liên hệ quản trị viên."})
		return
	}
	if coc <= 0 || ds == "none" {
		badRequest(c, "Học viên không có khoản cọc đang giữ để tất toán.")
		return
	}
	if !studentsJSTruthy(stu["check_out_date"]) {
		badRequest(c, "Học viên chưa trả phòng — tất toán cọc sau khi check-out.")
		return
	}
	if deduction < 0 { // Number.isFinite(deduction) luôn đúng ở đây (đã ép về số hữu hạn)
		badRequest(c, "Khấu trừ hư hao không được âm (đang nhận: "+studentsJSString(b["deduction"])+")")
		return
	}
	if deduction > coc {
		badRequest(c, "Khấu trừ "+studentsLocaleVN(deduction)+" vượt quá số cọc đang giữ "+studentsLocaleVN(coc)+". Nếu cần đòi thêm, lập khoản thu riêng.")
		return
	}
	// Hoàn cọc: nguồn Node dùng biến `settings` không định nghĩa -> ReferenceError -> 500 (xem chú thích handler).
	if action == "refunded" {
		serverErr(c)
		return
	}
	rows, err := h.pool().Query(ctx,
		`UPDATE students SET deposit_status=$1, deposit_refund_date=$2, deposit_bank=$3, deposit_account=$4,
         deposit_deduction=$5, deposit_deduction_note=$6 WHERE id=$7 RETURNING *`,
		action, date, studentsStrOr(b["bank"]), studentsStrOr(b["account"]), deduction, deductionNote, id)
	if err != nil {
		serverErr(c)
		return
	}
	row, err := db.RowToMap(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if row == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	c.JSON(http.StatusOK, row)
}

// StudentAccount: POST /:id/account (admin,staff) — tạo/đặt lại tài khoản đăng nhập. students.routes.js:693-722
func (h *Handlers) StudentAccount(c *gin.Context) {
	u := auth.CurrentUser(c)
	if !h.studentsFacilityGuard(c, u, c.Param("id")) {
		return
	}
	id, ok := paramInt(c, "id")
	if !ok {
		serverErr(c)
		return
	}
	ctx := c.Request.Context()
	_, b := studentsReadBody(c)
	password := studentsStrOr(b["password"])
	if password == "" || len([]rune(password)) < valid.InitialPasswordMin {
		badRequest(c, "Mật khẩu tối thiểu "+itoa(valid.InitialPasswordMin)+" ký tự")
		return
	}
	stRows, err := h.pool().Query(ctx, "SELECT * FROM students WHERE id=$1", id)
	if err != nil {
		serverErr(c)
		return
	}
	st, err := db.RowToMap(stRows)
	if err != nil {
		serverErr(c)
		return
	}
	if st == nil {
		notFound(c, "Không tìm thấy học viên")
		return
	}
	exRows, err := h.pool().Query(ctx, "SELECT * FROM users WHERE student_id=$1", id)
	if err != nil {
		serverErr(c)
		return
	}
	existing, err := db.RowToMap(exRows)
	if err != nil {
		serverErr(c)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		serverErr(c)
		return
	}
	if existing != nil {
		exID := intFromDB(existing["id"])
		if _, err := h.pool().Exec(ctx, "UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2", string(hash), exID); err != nil {
			serverErr(c)
			return
		}
		if err := h.Auth.RevokeTokens(ctx, exID); err != nil {
			serverErr(c)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "username": studentsJSString(existing["username"])})
		return
	}
	// Cùng thứ tự lùi với đường duyệt đơn (applications.go): hồ sơ vào từ đơn đăng ký chưa có mã HV,
	// không lùi về SĐT thì đường này tắc còn đường kia chạy.
	uname := ""
	for _, v := range []interface{}{b["username"], st["code"], st["phone"]} {
		if studentsJSTruthy(v) {
			uname = strings.TrimSpace(studentsJSString(v))
			if uname != "" {
				break
			}
		}
	}
	if uname == "" {
		badRequest(c, "Hồ sơ chưa có mã học viên lẫn số điện thoại — nhập tên đăng nhập để tạo tài khoản.")
		return
	}
	var one int
	if h.pool().QueryRow(ctx, "SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL", uname).Scan(&one) == nil {
		badRequest(c, `Tên đăng nhập "`+uname+`" đã tồn tại`)
		return
	}
	if _, err := h.pool().Exec(ctx,
		`INSERT INTO users (username, password_hash, role, full_name, student_id, must_change_password) VALUES ($1,$2,'student',$3,$4,true)`,
		uname, string(hash), studentsJSString(st["name"]), id); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "username": uname})
}
