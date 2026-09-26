package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"ktx/internal/auth"
	"ktx/internal/chores"
	"ktx/internal/db"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
)

// RoomsChores: GET /rooms/chores — lịch trực nhật của TỪNG phòng (admin, staff, teacher).
// Dùng đúng công thức xoay vòng của cổng học viên (chores.Schedule) nên hai nơi không lệch nhau.
func (h *Handlers) RoomsChores(c *gin.Context) {
	u := auth.CurrentUser(c)
	ctx := c.Request.Context()

	cond := []string{"r.deleted_at IS NULL"}
	params := []interface{}{}
	scope.ApplyFacilityFilter(u, "r.facility_id", &cond, &params)
	roomRows, err := h.pool().Query(ctx,
		`SELECT r.id, r.name, r.floor, r.gender FROM rooms r
		  WHERE `+joinAnd(cond)+` ORDER BY r.floor, r.name`, params...)
	if err != nil {
		serverErr(c)
		return
	}
	rooms, err := db.RowsToMaps(roomRows)
	if err != nil {
		serverErr(c)
		return
	}
	if len(rooms) == 0 {
		c.JSON(http.StatusOK, []interface{}{})
		return
	}

	// Lấy người đang ở của MỌI phòng trong một lượt rồi gom theo phòng — tránh hỏi CSDL từng phòng một.
	ids := make([]int, 0, len(rooms))
	for _, r := range rooms {
		ids = append(ids, intFromDB(r["id"]))
	}
	stRows, err := h.pool().Query(ctx,
		`SELECT room_id, id, name, check_in_date, check_out_date FROM students
		  WHERE room_id = ANY($1) AND deleted_at IS NULL AND check_in_date IS NOT NULL
		    AND (check_out_date IS NULL OR check_out_date >= CURRENT_DATE)
		  ORDER BY check_in_date, id`, ids)
	if err != nil {
		serverErr(c)
		return
	}
	stList, err := db.RowsToMaps(stRows)
	if err != nil {
		serverErr(c)
		return
	}
	theoPhong := map[int][]chores.Member{}
	for _, m := range stList {
		rid := intFromDB(m["room_id"])
		ci, _ := m["check_in_date"].(string)
		co, _ := m["check_out_date"].(string)
		name, _ := m["name"].(string)
		theoPhong[rid] = append(theoPhong[rid], chores.Member{ID: intFromDB(m["id"]), Name: name, CheckInDate: ci, CheckOutDate: co})
	}

	today := timeutil.Today()
	out := make([]gin.H, 0, len(rooms))
	for _, r := range rooms {
		rid := intFromDB(r["id"])
		mem := theoPhong[rid]
		lich := make([]gin.H, 0, 4)
		for _, w := range chores.Schedule(mem, today, 4) {
			lich = append(lich, gin.H{"from": w.From, "to": w.To, "student_id": w.StudentID, "name": w.Name})
		}
		out = append(out, gin.H{
			"room_id": rid, "room_name": r["name"], "floor": r["floor"], "gender": r["gender"],
			"so_nguoi": len(mem), "lich": lich,
		})
	}
	c.JSON(http.StatusOK, out)
}
