package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/chores"
	"ktx/internal/db"
	"ktx/internal/timeutil"
)

// Chuông cổng học viên: thông báo SUY RA từ dữ liệu nghiệp vụ sẵn có, không có bảng sự kiện riêng.
// Đã đọc tính theo mốc users.notif_seen_at, không đọc lẻ từng cái.
// Máy chủ trả dữ liệu có cấu trúc; câu chữ do client dựng (đã sẵn monthLabel/money/fmtDate).

const notifNgayLui = 60 // chỉ lấy việc trong 60 ngày gần nhất
const notifTranSo = 50  // trần số dòng trả về

// notifSQL: gom mọi mốc đáng báo của MỘT học viên. Mỗi nhánh phải trả đúng 5 cột cùng kiểu.
const notifSQL = `
WITH ev AS (
  SELECT i.created_at AS ts, 'invoice_new' AS kind, i.id AS ref, i.month AS txt, i.total AS amount
    FROM invoices i WHERE i.student_id=$1 AND i.deleted_at IS NULL
  UNION ALL
  SELECT COALESCE(i.paid_at, i.paid_date::timestamptz), 'invoice_paid', i.id, i.month, i.total
    FROM invoices i WHERE i.student_id=$1 AND i.deleted_at IS NULL AND i.status='paid'
  UNION ALL
  SELECT COALESCE(c.approved_at, c.handled_at), 'checkout_' || c.status, c.id,
         COALESCE(to_char(c.desired_date,'YYYY-MM-DD'),''), NULL::numeric
    FROM checkout_requests c WHERE c.student_id=$1 AND c.status IN ('done','rejected')
  UNION ALL
  SELECT c.handover_at, 'handover', c.id, '', NULL::numeric
    FROM checkout_requests c WHERE c.student_id=$1
  UNION ALL
  SELECT c.deposit_refunded_at, 'deposit_refunded', c.id, '', NULL::numeric
    FROM checkout_requests c WHERE c.student_id=$1
  UNION ALL
  SELECT d.assigned_at, 'damage_assigned', d.id, d.title, NULL::numeric
    FROM damage_reports d WHERE d.student_id=$1
  UNION ALL
  SELECT d.resolved_at, 'damage_done', d.id, d.title, NULL::numeric
    FROM damage_reports d WHERE d.student_id=$1 AND d.status='done'
  UNION ALL
  SELECT v.created_at, 'violation', v.id, v.type_name, NULL::numeric
    FROM violations v WHERE v.student_id=$1 AND v.deleted_at IS NULL
  UNION ALL
  SELECT rl.created_at, 'leader', rl.id, '', NULL::numeric
    FROM room_leaders rl WHERE rl.student_id=$1 AND rl.to_date IS NULL
  UNION ALL
  SELECT m.updated_at, 'rules', 0, '', NULL::numeric
    FROM media m WHERE m.key='noi-quy' AND m.path IS NOT NULL
)
SELECT ts, kind, ref, txt, amount FROM ev
 WHERE ts IS NOT NULL AND ts > now() - make_interval(days => $2)
 ORDER BY ts DESC LIMIT $3`

// meChoreEvent: "tuần này đến lượt trực nhật" — việc duy nhất không có mốc trong CSDL vì lịch do app
// tự xoay. Mốc = thứ Hai đầu tuần, nên mỗi tuần đến lượt là một thông báo mới.
func (h *Handlers) meChoreEvent(c *gin.Context, sid int) map[string]interface{} {
	ctx := c.Request.Context()
	var roomID *int
	if h.pool().QueryRow(ctx, "SELECT room_id FROM students WHERE id=$1 AND deleted_at IS NULL", sid).Scan(&roomID) != nil || roomID == nil {
		return nil
	}
	rows, err := h.pool().Query(ctx,
		`SELECT id, name, check_in_date, check_out_date FROM students
		  WHERE room_id=$1 AND deleted_at IS NULL AND check_in_date IS NOT NULL
		    AND (check_out_date IS NULL OR check_out_date >= CURRENT_DATE)`, *roomID)
	if err != nil {
		return nil
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		return nil
	}
	members := make([]chores.Member, 0, len(list))
	for _, m := range list {
		ci, _ := m["check_in_date"].(string)
		co, _ := m["check_out_date"].(string)
		name, _ := m["name"].(string)
		members = append(members, chores.Member{ID: meIntOf(m["id"]), Name: name, CheckInDate: ci, CheckOutDate: co})
	}
	sched := chores.Schedule(members, timeutil.Today(), 1)
	if len(sched) == 0 || sched[0].StudentID != sid {
		return nil
	}
	thuHai, err := time.ParseInLocation("2006-01-02", sched[0].From, timeutil.Loc)
	if err != nil {
		return nil
	}
	return map[string]interface{}{
		"ts": thuHai.Format(time.RFC3339), "kind": "chore", "ref": 0,
		"txt": sched[0].To, "amount": nil,
	}
}

// MeNotifications: GET /api/me/notifications — danh sách việc + số chưa đọc.
func (h *Handlers) MeNotifications(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	u := auth.CurrentUser(c)

	var seen *time.Time
	if err := h.pool().QueryRow(ctx, "SELECT notif_seen_at FROM users WHERE id=$1", u.ID).Scan(&seen); err != nil {
		serverErr(c)
		return
	}
	rows, err := h.pool().Query(ctx, notifSQL, sid, notifNgayLui, notifTranSo)
	if err != nil {
		serverErr(c)
		return
	}
	items, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	if ev := h.meChoreEvent(c, sid); ev != nil {
		items = append(items, ev)
	}

	// Chưa có mốc (dữ liệu cũ) coi như đã đọc hết — đừng dội một đống việc cũ ngay lần mở đầu tiên.
	chuaDoc := 0
	out := make([]gin.H, 0, len(items))
	for _, it := range items {
		ts, _ := it["ts"].(string)
		moi := false
		if seen != nil && ts != "" {
			if t, e := time.Parse(time.RFC3339, ts); e == nil && t.After(*seen) {
				moi = true
				chuaDoc++
			}
		}
		out = append(out, gin.H{
			"ts": it["ts"], "kind": it["kind"], "ref": it["ref"],
			"txt": it["txt"], "amount": it["amount"], "unread": moi,
		})
	}
	sortNotifDesc(out) // nhánh trực nhật nối vào cuối -> xếp lại theo thời gian giảm dần
	c.JSON(http.StatusOK, gin.H{"unread": chuaDoc, "items": out})
}

// sortNotifDesc: mới nhất lên đầu. Tối đa 51 dòng nên chèn đơn giản là đủ.
func sortNotifDesc(list []gin.H) {
	for i := 1; i < len(list); i++ {
		for j := i; j > 0; j-- {
			a, _ := list[j]["ts"].(string)
			b, _ := list[j-1]["ts"].(string)
			if a <= b {
				break
			}
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
}

// MeNotificationsSeen: POST /api/me/notifications/seen — đánh dấu đã xem tới BÂY GIỜ.
func (h *Handlers) MeNotificationsSeen(c *gin.Context) {
	if _, ok := meStudentID(c); !ok {
		return
	}
	u := auth.CurrentUser(c)
	if _, err := h.pool().Exec(c.Request.Context(), "UPDATE users SET notif_seen_at=now() WHERE id=$1", u.ID); err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
