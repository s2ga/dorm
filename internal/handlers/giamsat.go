package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"ktx/internal/mail"
)

// Giới hạn thân báo cáo: /api/admin đã bị BodyLimit chặn ở 2MB, đây là chốt thứ hai để một lượt
// quét lỗi không biến thành mail khổng lồ.
const giamSatToiDa = 200000

var giamSatMucHopLe = map[string]bool{"p1": true, "p2": true, "p3": true, "tuan": true}

type giamSatMailBody struct {
	Muc     string `json:"muc"`
	NoiDung string `json:"noi_dung"`
	P1      int    `json:"p1"`
	P2      int    `json:"p2"`
	P3      int    `json:"p3"`
}

// giamSatEmailNhan: Cài đặt giam_sat_email; trống thì lùi về email của các tài khoản quản trị.
func (h *Handlers) giamSatEmailNhan(ctx context.Context, s map[string]string) []string {
	if to := parkingTachEmail(s["giam_sat_email"]); len(to) > 0 {
		return to
	}
	rows, err := h.pool().Query(ctx,
		"SELECT COALESCE(email,'') FROM users WHERE role='admin' AND deleted_at IS NULL AND COALESCE(email,'') <> '' ORDER BY id")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var raw []string
	for rows.Next() {
		var e string
		if rows.Scan(&e) == nil {
			raw = append(raw, e)
		}
	}
	return parkingTachEmail(strings.Join(raw, ","))
}

// GiamSatMail: POST /api/admin/giam-sat/mail (admin) — cmd/giam-sat đẩy báo cáo lên, máy chủ gửi
// mail bằng SMTP trong Cài đặt. Người nhận do máy chủ quyết, không nhận từ thân yêu cầu.
func (h *Handlers) GiamSatMail(c *gin.Context) {
	var b giamSatMailBody
	if err := c.ShouldBindJSON(&b); err != nil {
		badRequest(c, "Thân yêu cầu không phải JSON hợp lệ")
		return
	}
	b.Muc = strings.ToLower(strings.TrimSpace(b.Muc))
	if !giamSatMucHopLe[b.Muc] {
		badRequest(c, `"muc" phải là p1, p2, p3 hoặc tuan (đang nhận: "`+b.Muc+`")`)
		return
	}
	if strings.TrimSpace(b.NoiDung) == "" {
		badRequest(c, `"noi_dung" không được rỗng`)
		return
	}
	if len(b.NoiDung) > giamSatToiDa {
		badRequest(c, "Nội dung báo cáo quá dài — hãy giảm -so-doi-tuong rồi quét lại")
		return
	}

	ctx := c.Request.Context()
	s, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c)
		return
	}
	to := h.giamSatEmailNhan(ctx, s)
	ok, loi := mail.SendGiamSat(ctx, h.DB, to, mail.GiamSatBaoCao{
		Muc: b.Muc, NoiDung: b.NoiDung,
		P1: giamSatKhongAm(b.P1), P2: giamSatKhongAm(b.P2), P3: giamSatKhongAm(b.P3),
	})
	if !ok {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": loi})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "da_gui": len(to)})
}

func giamSatKhongAm(n int) int {
	if n < 0 {
		return 0
	}
	return n
}
