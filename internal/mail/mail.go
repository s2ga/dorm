// Package mail — gửi email cho nhà trường khi HV vi phạm. Port từ server/mailer.js (nodemailer -> gomail).
package mail

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"gopkg.in/gomail.v2"
	"ktx/internal/db"
	"ktx/internal/valid"
)

var sevVN = map[string]string{"minor": "Nhẹ", "major": "Nặng", "severe": "Nghiêm trọng"}

func fmtDate(d string) string {
	if d == "" {
		return "—"
	}
	p := strings.Split(d[:min10(d)], "-")
	if len(p) < 3 {
		return d
	}
	return p[2] + "/" + p[1] + "/" + p[0]
}
func min10(s string) int {
	if len(s) < 10 {
		return len(s)
	}
	return 10
}

// SmtpReady: đủ host+user+pass + school_email hợp lệ. server/mailer.js:13-18
func SmtpReady(s map[string]string) bool {
	return s["smtp_host"] != "" && s["smtp_user"] != "" && s["smtp_pass"] != "" && valid.IsValidEmail(s["school_email"])
}

func dialer(s map[string]string) *gomail.Dialer {
	port := 587
	if p, err := strconv.Atoi(strings.TrimSpace(s["smtp_port"])); err == nil && p > 0 {
		port = p
	}
	d := gomail.NewDialer(s["smtp_host"], port, s["smtp_user"], s["smtp_pass"])
	d.SSL = valid.NormalizeBool(s["smtp_secure"])
	return d
}

// MailStatus: có gửi được không (hiển thị cảnh báo UI). server/mailer.js:34-39
func MailStatus(ctx context.Context, database *db.DB) (bool, string) {
	s, err := database.GetSettings(ctx)
	if err != nil {
		return false, "Lỗi đọc cấu hình"
	}
	if !SmtpReady(s) {
		return false, "Chưa cấu hình SMTP / email nhà trường trong Cài đặt"
	}
	return true, ""
}

// Override cho nút test SMTP (nil = không gửi field đó -> dùng giá trị đã lưu).
type Override struct {
	Host, User, Pass, Port, Secure *string
}

func coalesce(o *string, saved string) string {
	if o != nil {
		return *o
	}
	return saved
}

// TestConnection: nút "Kiểm tra kết nối" ở Cài đặt. server/mailer.js:43-85
func TestConnection(ctx context.Context, database *db.DB, o Override) (bool, string) {
	saved, err := database.GetSettings(ctx)
	if err != nil {
		return false, "Lỗi đọc cấu hình"
	}
	host := coalesce(o.Host, saved["smtp_host"])
	user := coalesce(o.User, saved["smtp_user"])
	var overridePass string
	if o.Pass != nil && strings.TrimSpace(*o.Pass) != "" {
		overridePass = *o.Pass
	}
	// V2-12: chỉ mượn mật khẩu đã lưu khi test ĐÚNG host+user đã lưu.
	sameTarget := host == saved["smtp_host"] && user == saved["smtp_user"]
	pass := overridePass
	if pass == "" && sameTarget {
		pass = saved["smtp_pass"]
	}
	if pass == "" {
		return false, "Đổi máy chủ hoặc tài khoản SMTP thì phải nhập lại mật khẩu (không dùng lại mật khẩu đã lưu cho máy chủ khác)."
	}
	if valid.IsPrivateHost(host) {
		return false, "Máy chủ SMTP không hợp lệ (không nhận địa chỉ nội bộ/loopback)."
	}
	port := coalesce(o.Port, saved["smtp_port"])
	if strings.TrimSpace(port) != "" && !valid.IsValidPort(port) {
		return false, "Cổng SMTP không hợp lệ (1–65535)."
	}
	s := map[string]string{
		"smtp_host": host, "smtp_port": port, "smtp_secure": coalesce(o.Secure, saved["smtp_secure"]),
		"smtp_user": user, "smtp_pass": pass,
	}
	if s["smtp_host"] == "" || s["smtp_user"] == "" || s["smtp_pass"] == "" {
		return false, "Thiếu host / tài khoản / mật khẩu SMTP"
	}
	sc, err := dialer(s).Dial()
	if err != nil {
		return false, smtpErrMsg(err)
	}
	_ = sc.Close()
	return true, ""
}

// smtpErrMsg: NÊU RÕ lý do thật (thay vì báo chung chung) + gợi ý sửa theo lỗi thường gặp.
func smtpErrMsg(err error) string {
	e := err.Error()
	le := strings.ToLower(e)
	hint := ""
	switch {
	case strings.Contains(le, "timeout") || strings.Contains(le, "connection refused") || strings.Contains(le, "no such host") || strings.Contains(le, "network is unreachable"):
		hint = " → Sai host/cổng, HOẶC nhà cung cấp máy chủ (vd Render gói free) đang CHẶN cổng SMTP. Thử cổng 587; nếu vẫn timeout thì nhà cung cấp chặn SMTP — phải dùng dịch vụ gửi mail qua HTTP API (SendGrid/Resend…) hoặc nâng gói."
	case strings.Contains(le, "authentication") || strings.Contains(le, "535") || strings.Contains(le, "username and password") || strings.Contains(le, "5.7."):
		hint = " → Sai tài khoản/mật khẩu. Gmail & Outlook KHÔNG nhận mật khẩu thường — phải tạo 'App Password' (mật khẩu ứng dụng) và dán vào đây."
	case strings.Contains(le, "tls") || strings.Contains(le, "certificate") || strings.Contains(le, "handshake") || strings.Contains(le, "first record does not look like"):
		hint = " → Sai kiểu mã hoá: cổng 465 phải BẬT bảo mật (SSL), cổng 587 phải TẮT bảo mật (dùng STARTTLS). Đổi lại rồi thử."
	}
	return "Không kết nối được máy chủ SMTP. Lý do: " + e + hint
}

// Student + Violation cho mail.
type Student struct {
	Name      string
	Code      string
	ClassName string
	Phone     string
}
type Violation struct {
	Date     string
	TypeName string
	Severity string
	Note     string
}

func escHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

// SendViolationMail: gửi thông báo vi phạm cho nhà trường. server/mailer.js:89-132
func SendViolationMail(ctx context.Context, database *db.DB, student Student, violations []Violation) (bool, string, string) {
	s, err := database.GetSettings(ctx)
	if err != nil {
		return false, "Lỗi đọc cấu hình", ""
	}
	if !SmtpReady(s) {
		return false, "Chưa cấu hình SMTP / email nhà trường", ""
	}
	lines := make([]string, len(violations))
	for i, v := range violations {
		sev := sevVN[v.Severity]
		if sev == "" {
			sev = v.Severity
		}
		tn := v.TypeName
		if tn == "" {
			tn = "Vi phạm"
		}
		note := ""
		if v.Note != "" {
			note = ": " + v.Note
		}
		lines[i] = fmt.Sprintf("%d. %s — %s [%s]%s", i+1, fmtDate(v.Date), tn, sev, note)
	}
	dorm := s["dorm_name"]
	if dorm == "" {
		dorm = "Ký túc xá"
	}
	schoolName := s["school_name"]
	if schoolName == "" {
		schoolName = "Nhà trường"
	}
	subject := fmt.Sprintf("[%s] Thông báo vi phạm nội trú — Học viên %s", dorm, student.Name)
	code := ""
	if student.Code != "" {
		code = " (MSHV " + student.Code + ")"
	}
	cls := ""
	if student.ClassName != "" {
		cls = ", lớp " + student.ClassName
	}
	hotline := ""
	if s["hotline"] != "" {
		hotline = "\nHotline: " + s["hotline"]
	}
	text := fmt.Sprintf(`Kính gửi %s,

Ban quản lý %s xin thông báo: học viên %s%s%s đã vi phạm nội quy ký túc xá %d lần:

%s

Kính đề nghị Nhà trường phối hợp nhắc nhở, xử lý. Trân trọng cảm ơn.

--
Ban quản lý %s%s`, schoolName, dorm, student.Name, code, cls, len(violations), strings.Join(lines, "\n"), dorm, hotline)

	html := strings.ReplaceAll(escHTML(text), "\n", "<br>")
	from := s["smtp_from"]
	if from == "" {
		from = s["smtp_user"]
	}
	m := gomail.NewMessage()
	m.SetHeader("From", from)
	m.SetHeader("To", s["school_email"])
	m.SetHeader("Subject", subject)
	m.SetBody("text/plain", text)
	m.AddAlternative("text/html", html)
	if err := dialer(s).DialAndSend(m); err != nil {
		return false, "Lỗi gửi mail: " + err.Error(), ""
	}
	return true, "", s["school_email"]
}
