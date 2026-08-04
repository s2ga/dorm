package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/mail"
	"ktx/internal/valid"
)

// SmtpTest: POST /api/settings/smtp/test (admin) — kiểm kết nối SMTP. server/routes/settings.routes.js:40-49
func (h *Handlers) SmtpTest(c *gin.Context) {
	var raw map[string]json.RawMessage
	_ = c.ShouldBindJSON(&raw)
	get := func(k string) *string {
		v, ok := raw[k]
		if !ok || string(v) == "null" {
			return nil
		}
		var s string
		if json.Unmarshal(v, &s) == nil {
			return &s
		}
		lit := strings.Trim(string(v), `"`) // số (port) / bool (secure) -> literal
		return &lit
	}
	ok, reason := mail.TestConnection(c.Request.Context(), h.DB, mail.Override{
		Host: get("smtp_host"), User: get("smtp_user"), Pass: get("smtp_pass"),
		Port: get("smtp_port"), Secure: get("smtp_secure"),
	})
	res := gin.H{"ok": ok}
	if !ok {
		res["reason"] = reason
	}
	c.JSON(http.StatusOK, res)
}

// server/routes/settings.routes.js:11-16
var secretKeys = []string{"smtp_pass", "sso_client_secret"}
var adminOnlyKeys = []string{
	"smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_from", "school_email", "school_name",
	"violation_mail_threshold", "sso_enabled", "sso_tenant_id", "sso_client_id", "sso_allowed_domains",
}

// sanitize: bỏ secret + thêm cờ <key>_set; staff bị ẩn khoá admin. server/routes/settings.routes.js:20-25
func sanitizeSettings(s map[string]string, isAdmin bool) gin.H {
	out := gin.H{}
	for k, v := range s {
		out[k] = v
	}
	for _, k := range secretKeys {
		out[k+"_set"] = strings.TrimSpace(s[k]) != ""
		delete(out, k)
	}
	if !isAdmin {
		for _, k := range adminOnlyKeys {
			delete(out, k)
		}
	}
	return out
}

// GetSettings: GET /api/settings — mọi người đăng nhập xem được đơn giá; ẩn secret + khoá admin với staff.
// server/routes/settings.routes.js:28-30
func (h *Handlers) GetSettings(c *gin.Context) {
	s, err := h.DB.GetSettings(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi máy chủ"})
		return
	}
	u := auth.CurrentUser(c)
	isAdmin := u != nil && u.Role == "admin"
	out := sanitizeSettings(s, isAdmin)
	if isAdmin {
		// Trạng thái SSO THẬT (chỉ đọc, không lưu được). Giao diện chỉ thấy giá trị trong CSDL, không
		// thấy ENV AZURE_* — tự suy từ sso_tenant_id/sso_client_id sẽ báo "Đang tắt" trong khi SSO
		// đang chạy bằng ENV.
		cfg := h.SSO.Config(c.Request.Context())
		out["sso_effective"] = cfg.Enabled
		out["sso_from_env"] = cfg.FromEnv
	}
	c.JSON(http.StatusOK, out)
}

// Danh sách khoá được phép cập nhật. server/routes/settings.routes.js:54-68
var settingsAllowed = []string{
	"dorm_name", "hotline", "room_fee", "water_fee", "electric_unit", "service_fee",
	"washing_fee", "parking_fee", "deposit_fee", "partial_half_min", "partial_full_min",
	"legal_female", "legal_male", "due_day_from", "due_day_to",
	"overdue_remind_days", "shortterm_max_days", "deposit_notice_min_days", "partial_half_factor",
	"room_cap_A", "room_cap_B", "room_cap_C", "room_cap_D", "checkout_max_future_days", "max_cccd_mb",
	"room_price_A", "room_price_B", "room_price_C", "room_price_D",
	"room_area_A", "room_area_B", "room_area_C", "room_area_D",
	"security_day_phone", "security_night_phone", "security_day_from", "security_day_to",
	"wifi_ssid", "wifi_password",
	"bravo_fee_type", "bravo_room", "bravo_water", "bravo_service", "bravo_electric", "bravo_parking", "bravo_washing", "bravo_other", "bravo_deposit",
	"school_name", "school_email", "violation_mail_threshold",
	"smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_pass", "smtp_from",
	"sso_enabled", "sso_tenant_id", "sso_client_id", "sso_client_secret", "sso_allowed_domains",
	"intro_hero_title", "intro_hero_desc", "intro_about_eyebrow", "intro_about_title", "intro_about_desc",
	"intro_rooms_eyebrow", "intro_rooms_title", "intro_rooms_desc", "intro_amenities_title",
	"intro_price_title", "intro_price_desc", "intro_contact_title", "intro_contact_desc",
	"contact_person",
	"imgcap_khuon-vien-1", "imgcap_khuon-vien-2", "imgcap_khuon-vien-3",
	"imgcap_phong-1", "imgcap_phong-2", "imgcap_phong-3",
}

func inList(s string, list []string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// settingVal: giá trị chuỗi giống String(req.body[key]) của Node (chuỗi giữ nguyên; số/bool -> literal).
func settingVal(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(raw))
}

// UpdateSettings: PUT /api/settings (admin). server/routes/settings.routes.js:52-105
func (h *Handlers) UpdateSettings(c *gin.Context) {
	var body map[string]json.RawMessage
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "Dữ liệu không hợp lệ")
		return
	}
	// V2-18: khoá lạ -> báo lỗi rõ (không âm thầm "đã lưu" mà không lưu gì).
	var unknown []string
	for k := range body {
		if k != "preview" && !inList(k, settingsAllowed) {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		badRequest(c, "Tên cài đặt không hợp lệ: "+strings.Join(unknown, ", "))
		return
	}
	// Kiểm KIỂU trước khi ghi.
	var errs []string
	for _, key := range settingsAllowed {
		raw, ok := body[key]
		if !ok {
			continue
		}
		if e := valid.CheckSetting(key, settingVal(raw)); e != "" {
			errs = append(errs, e)
		}
	}
	for _, key := range []string{"school_email", "smtp_from"} {
		if raw, ok := body[key]; ok {
			v := settingVal(raw)
			if strings.TrimSpace(v) != "" && !valid.IsValidEmail(v) {
				errs = append(errs, `"`+key+`" phải là email hợp lệ (đang nhận: "`+v+`")`)
			}
		}
	}
	if len(errs) > 0 {
		badRequest(c, strings.Join(errs, " · "))
		return
	}

	ctx := c.Request.Context()
	for _, key := range settingsAllowed {
		raw, ok := body[key]
		if !ok {
			continue
		}
		v := settingVal(raw)
		// Không ghi đè secret bằng chuỗi rỗng (form ẩn pass, để trống = giữ nguyên).
		if inList(key, secretKeys) && strings.TrimSpace(v) == "" {
			continue
		}
		// sso_enabled rỗng = TỰ ĐỘNG (bật khi đủ tham số) — giữ nguyên rỗng, đừng ép thành "false".
		if key == "smtp_secure" || (key == "sso_enabled" && strings.TrimSpace(v) != "") {
			if valid.NormalizeBool(v) {
				v = "true"
			} else {
				v = "false"
			}
		}
		if _, err := h.pool().Exec(ctx,
			"INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", key, v); err != nil {
			serverErr(c)
			return
		}
	}
	s, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, sanitizeSettings(s, true))
}
