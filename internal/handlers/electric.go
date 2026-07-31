package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"ktx/internal/auth"
	"ktx/internal/db"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Handler điện. Port từ server/routes/electric.routes.js. Toàn bộ: requireAuth + requireRole('admin','staff').

// prevMonth: tháng liền trước 'YYYY-MM'. server/routes/electric.routes.js:11-15
func prevMonth(month string) string {
	t, err := time.ParseInLocation("2006-01", month, time.UTC)
	if err != nil {
		return month
	}
	return t.AddDate(0, -1, 0).Format("2006-01")
}

// electricFacilityFilter: điều hành lọc tuỳ chọn ?facility; quản lý cơ sở bị ép. Trả cond đã nối AND vào slice.
func electricFacilityFilter(c *gin.Context, u *auth.User, cond *[]string, params *[]interface{}) {
	if scope.IsExecutive(u) {
		if f := c.Query("facility"); f != "" {
			if n, ok := jsNum(json.RawMessage(f)); ok {
				*params = append(*params, int(n))
				*cond = append(*cond, "r.facility_id = $"+itoa(len(*params)))
			}
		}
		return
	}
	scope.ApplyFacilityFilter(u, "r.facility_id", cond, params)
}

// ListElectric: GET /api/electric?month= server/routes/electric.routes.js:18-45
func (h *Handlers) ListElectric(c *gin.Context) {
	month := c.Query("month")
	if !valid.IsValidMonth(month) {
		badRequest(c, "Thiếu hoặc sai kỳ (tháng) — dạng YYYY-MM.")
		return
	}
	pm := prevMonth(month)
	cond := []string{"r.deleted_at IS NULL"}
	params := []interface{}{month, pm}
	electricFacilityFilter(c, auth.CurrentUser(c), &cond, &params)
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT r.id AS room_id, r.name AS room_name, r.floor, r.gender,
		  COALESCE(e.reading_end, 0) AS reading_end,
		  COALESCE(e.reading_start, prev.reading_end, 0) AS reading_start,
		  COALESCE(e.kwh, 0) AS kwh,
		  (SELECT COUNT(*) FROM students s WHERE s.room_id=r.id AND s.deleted_at IS NULL
		     AND s.check_in_date <= CURRENT_DATE AND (s.check_out_date IS NULL OR s.check_out_date > CURRENT_DATE))::int AS occupancy
		FROM rooms r
		LEFT JOIN electric_readings e ON e.room_id=r.id AND e.month=$1
		LEFT JOIN electric_readings prev ON prev.room_id=r.id AND prev.month=$2
		WHERE `+joinAnd(cond)+`
		ORDER BY r.floor, r.name`, params...)
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

// ElectricHistory: GET /api/electric/history?month=&n= server/routes/electric.routes.js:48-70
func (h *Handlers) ElectricHistory(c *gin.Context) {
	month := c.Query("month")
	if month == "" {
		month = timeutil.Now().Format("2006-01")
	}
	n := queryIntDefault(c, "n", 6)
	if n < 2 {
		n = 2
	}
	if n > 12 {
		n = 12
	}
	base, err := time.ParseInLocation("2006-01", month, time.UTC)
	if err != nil {
		badRequest(c, "Kỳ không hợp lệ")
		return
	}
	months := make([]string, 0, n)
	for i := n - 1; i >= 0; i-- {
		months = append(months, base.AddDate(0, -i, 0).Format("2006-01"))
	}
	rows, err := h.pool().Query(c.Request.Context(),
		`SELECT er.room_id, er.month, er.kwh, r.name AS room_name, r.floor
		   FROM electric_readings er JOIN rooms r ON r.id=er.room_id
		  WHERE er.month = ANY($1) AND r.deleted_at IS NULL
		  ORDER BY r.floor, r.name`, months)
	if err != nil {
		serverErr(c)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c)
		return
	}
	type roomAgg struct {
		roomID   int
		roomName string
		kwh      map[string]float64
		order    int
	}
	byRoom := map[int]*roomAgg{}
	var order []int
	for _, x := range list {
		rid := intFromDB(x["room_id"])
		b := byRoom[rid]
		if b == nil {
			b = &roomAgg{roomID: rid, roomName: strOf(x["room_name"]), kwh: map[string]float64{}}
			byRoom[rid] = b
			order = append(order, rid)
		}
		b.kwh[strOf(x["month"])] = toFloat(x["kwh"])
	}
	roomsOut := []gin.H{}
	for _, rid := range order {
		b := byRoom[rid]
		series := make([]gin.H, 0, len(months))
		any := false
		for _, mo := range months {
			v := b.kwh[mo]
			if v > 0 {
				any = true
			}
			series = append(series, gin.H{"month": mo, "kwh": v})
		}
		if any {
			roomsOut = append(roomsOut, gin.H{"room_id": b.roomID, "room_name": b.roomName, "series": series})
		}
	}
	c.JSON(http.StatusOK, gin.H{"months": months, "rooms": roomsOut})
}

func strOf(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// electricTrong: ô nhập bỏ trống? (không gửi, null, "" hoặc chuỗi toàn khoảng trắng)
// Trống KHÁC 0: 0 là "công-tơ chỉ 0", trống là "chưa đọc".
func electricTrong(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return true
	}
	if len(s) >= 2 && s[0] == '"' {
		var v string
		if json.Unmarshal(raw, &v) == nil {
			return strings.TrimSpace(v) == ""
		}
	}
	return false
}

type electricReadingItem struct {
	RoomID       json.RawMessage `json:"room_id"`
	ReadingEnd   json.RawMessage `json:"reading_end"`
	ReadingStart json.RawMessage `json:"reading_start"`
}

// SaveElectricBulk: POST /api/electric/bulk server/routes/electric.routes.js:73-116
func (h *Handlers) SaveElectricBulk(c *gin.Context) {
	var body struct {
		Month    string                `json:"month"`
		Readings []electricReadingItem `json:"readings"`
	}
	bindErr := c.ShouldBindJSON(&body)
	if bindErr != nil || !valid.IsValidMonth(body.Month) || body.Readings == nil {
		badRequest(c, "Thiếu hoặc sai dữ liệu (kỳ YYYY-MM + danh sách chỉ số).")
		return
	}
	ctx := c.Request.Context()
	u := auth.CurrentUser(c)

	// Đa cơ sở: quản lý cơ sở chỉ ghi chỉ số cho phòng CƠ SỞ MÌNH.
	if !scope.IsExecutive(u) && len(body.Readings) > 0 {
		fid := scope.UserFacility(u)
		ids := make([]int, 0, len(body.Readings))
		for _, r := range body.Readings {
			n, _ := jsNum(r.RoomID)
			ids = append(ids, int(n))
		}
		rows, err := h.pool().Query(ctx, "SELECT id, facility_id FROM rooms WHERE id = ANY($1)", ids)
		if err != nil {
			serverErr(c)
			return
		}
		var outside []string
		for rows.Next() {
			var id int
			var rf *int
			if err := rows.Scan(&id, &rf); err != nil {
				rows.Close()
				serverErr(c)
				return
			}
			if !(rf != nil && fid != nil && *rf == *fid) {
				outside = append(outside, "#"+itoa(id))
			}
		}
		rows.Close()
		if len(outside) > 0 {
			forbidden(c, "Có phòng không thuộc cơ sở bạn phụ trách (phòng "+strings.Join(outside, ", ")+") — không lưu.")
			return
		}
	}
	pm := prevMonth(body.Month)

	type chuanItem struct {
		roomID     int
		start, end float64
		kwh        float64
	}
	var chuan []chuanItem
	var loi []string
	var xoa []int // phòng để trống ô Số cuối -> xoá bản ghi kỳ này (chưa đọc công-tơ)
	for _, r := range body.Readings {
		ridNum, _ := jsNum(r.RoomID)
		rid := int(ridNum)
		// Ô "Số cuối" để TRỐNG = kỳ này CHƯA ĐỌC công-tơ -> xoá bản ghi, không ghi 0.
		// Ghi 0 thì server chặn "cuối < đầu"; ghi bằng số đầu thì màn hình hiện một con số ở ô
		// Số cuối, người xem tưởng đã chốt số trong khi kỳ chưa hết.
		if electricTrong(r.ReadingEnd) {
			xoa = append(xoa, rid)
			continue
		}
		end, endOK := jsNum(r.ReadingEnd)
		if !endOK || end < 0 {
			loi = append(loi, "phòng #"+itoa(rid)+`: chỉ số "`+string(r.ReadingEnd)+`" không hợp lệ`)
			continue
		}
		var start float64
		if sv, ok := jsNum(r.ReadingStart); ok && string(r.ReadingStart) != `""` && len(r.ReadingStart) > 0 && string(r.ReadingStart) != "null" {
			start = sv
		} else {
			var pe *float64
			_ = h.pool().QueryRow(ctx, "SELECT reading_end FROM electric_readings WHERE room_id=$1 AND month=$2", rid, pm).Scan(&pe)
			if pe != nil {
				start = *pe
			}
		}
		if start < 0 {
			loi = append(loi, "phòng #"+itoa(rid)+": số đầu kỳ không hợp lệ")
			continue
		}
		if end < start {
			loi = append(loi, "phòng #"+itoa(rid)+": chỉ số cuối ("+numDisp(end)+") NHỎ HƠN đầu kỳ ("+numDisp(start)+") — công-tơ mới thay? kiểm lại")
			continue
		}
		chuan = append(chuan, chuanItem{roomID: rid, start: start, end: end, kwh: end - start})
	}
	if len(loi) > 0 {
		// Kèm tên phòng
		ids := make([]int, 0, len(body.Readings))
		for _, r := range body.Readings {
			n, _ := jsNum(r.RoomID)
			ids = append(ids, int(n))
		}
		names := map[int]string{}
		if rows, err := h.pool().Query(ctx, "SELECT id, name FROM rooms WHERE id = ANY($1)", ids); err == nil {
			for rows.Next() {
				var id int
				var name string
				if rows.Scan(&id, &name) == nil {
					names[id] = name
				}
			}
			rows.Close()
		}
		out := make([]string, len(loi))
		for i, l := range loi {
			out[i] = replacePhong(l, names)
		}
		badRequest(c, "Không lưu — có chỉ số chưa hợp lệ, vui lòng sửa rồi lưu lại:\n"+strings.Join(out, "\n"))
		return
	}

	err := h.DB.WithTx(ctx, func(tx pgx.Tx) error {
		for _, r := range chuan {
			if _, err := tx.Exec(ctx,
				`INSERT INTO electric_readings (room_id, month, reading_start, reading_end, kwh) VALUES ($1,$2,$3,$4,$5)
				 ON CONFLICT (room_id, month) DO UPDATE SET reading_start=EXCLUDED.reading_start, reading_end=EXCLUDED.reading_end, kwh=EXCLUDED.kwh`,
				r.roomID, body.Month, r.start, r.end, r.kwh); err != nil {
				return err
			}
		}
		// Để trống = chưa đọc: xoá hẳn bản ghi. Màn hình sẽ tự lấy số đầu = số cuối kỳ trước
		// (ListElectric COALESCE prev.reading_end) và để ô Số cuối TRỐNG — đúng sự thật.
		for _, rid := range xoa {
			if _, err := tx.Exec(ctx, `DELETE FROM electric_readings WHERE room_id=$1 AND month=$2`, rid, body.Month); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		serverErr(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "saved": len(chuan), "cleared": len(xoa)})
}

// replacePhong: thay "phòng #id" bằng "phòng <tên>" như Node (regex thay thế).
func replacePhong(l string, names map[int]string) string {
	idx := strings.Index(l, "phòng #")
	if idx < 0 {
		return l
	}
	j := idx + len("phòng #")
	k := j
	for k < len(l) && l[k] >= '0' && l[k] <= '9' {
		k++
	}
	if k == j {
		return l
	}
	id := 0
	for _, ch := range l[j:k] {
		id = id*10 + int(ch-'0')
	}
	name := names[id]
	if name == "" {
		name = "#" + itoa(id)
	}
	return l[:idx] + "phòng " + name + l[k:]
}
