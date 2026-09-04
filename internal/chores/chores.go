// Package chores — lịch trực nhật xoay vòng theo tuần, tính thẳng không cần bảng.
// Port từ server/chores.js. Tuần bắt đầu THỨ HAI; mốc 05/01/1970 là một thứ Hai.
package chores

import (
	"math"
	"sort"
	"time"

	"ktx/internal/billing"
)

const epochMonday = "1970-01-05"

// MondayOf: thứ Hai của tuần chứa ngày ymd. server/chores.js:18-24
func MondayOf(ymd string) string {
	s := ymd
	if len(s) > 10 {
		s = s[:10]
	}
	t, err := time.ParseInLocation("2006-01-02", s, time.UTC)
	if err != nil {
		return s
	}
	dow := (int(t.Weekday()) + 6) % 7 // 0 = thứ Hai ... 6 = Chủ nhật
	return t.AddDate(0, 0, -dow).Format("2006-01-02")
}

// weeksSinceEpoch: số tuần trọn giữa 2 thứ Hai. server/chores.js:26
func weeksSinceEpoch(monday string) int {
	tm, err1 := time.ParseInLocation("2006-01-02", monday, time.UTC)
	te, err2 := time.ParseInLocation("2006-01-02", epochMonday, time.UTC)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(math.Round(tm.Sub(te).Hours() / (7 * 24)))
}

type Member struct {
	ID           int
	Name         string
	CheckInDate  string
	CheckOutDate string
}

type Slot struct {
	From      string `json:"from"`
	To        string `json:"to"`
	StudentID int    `json:"student_id"`
	Name      string `json:"name"`
}

// Schedule: lịch trực nhật của một phòng. server/chores.js:34-52
func Schedule(members []Member, today string, weeks int) []Slot {
	if weeks <= 0 {
		weeks = 4
	}
	order := make([]Member, len(members))
	copy(order, members)
	// theo NGÀY VÀO Ở rồi tới id (đừng bao giờ sắp theo tên)
	sort.SliceStable(order, func(i, j int) bool {
		if order[i].CheckInDate != order[j].CheckInDate {
			return order[i].CheckInDate < order[j].CheckInDate
		}
		return order[i].ID < order[j].ID
	})
	if len(order) == 0 {
		return []Slot{}
	}

	out := []Slot{}
	m0 := MondayOf(today)
	for i := 0; i < weeks; i++ {
		from := billing.AddDays(m0, i*7)
		to := billing.AddDays(from, 6)
		here := make([]Member, 0, len(order))
		for _, s := range order {
			if billing.DaysStayedInRange(s.CheckInDate, s.CheckOutDate, from, to) > 0 {
				here = append(here, s)
			}
		}
		if len(here) == 0 {
			continue
		}
		n := len(here)
		idx := ((weeksSinceEpoch(from) % n) + n) % n
		out = append(out, Slot{From: from, To: to, StudentID: here[idx].ID, Name: here[idx].Name})
	}
	return out
}
