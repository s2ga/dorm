// Package chores — lịch trực nhật xoay vòng theo NGÀY, tính thẳng không cần bảng.
package chores

import (
	"sort"

	"ktx/internal/billing"
)

// NeoGoc: ngày bắt đầu xoay vòng. Đổi mốc là đổi thứ tự lịch của mọi phòng.
const NeoGoc = "2026-01-01"

// tranMoPhong: chặn trên số ngày phải đi qua khi dựng lại chuỗi.
const tranMoPhong = 4000

type Member struct {
	ID           int
	Name         string
	CheckInDate  string
	CheckOutDate string
}

// Slot: MỘT NGÀY trực.
type Slot struct {
	Date      string `json:"date"`
	StudentID int    `json:"student_id"`
	Name      string `json:"name"`
}

// truocHon: thứ tự cố định của phòng — theo NGÀY VÀO Ở rồi tới id (đừng bao giờ sắp theo tên).
func truocHon(a, b Member) bool {
	if a.CheckInDate != b.CheckInDate {
		return a.CheckInDate < b.CheckInDate
	}
	return a.ID < b.ID
}

// keTiep: người kế sau `truoc` trong nhóm đang có mặt, hết thì vòng lại đầu.
// `truoc` có thể đã rời phòng — vẫn tra được chỗ đứng nên chuỗi không đứt.
func keTiep(comat []Member, truoc *Member) Member {
	if truoc != nil {
		for _, m := range comat {
			if truocHon(*truoc, m) {
				return m
			}
		}
	}
	return comat[0]
}

// Schedule: lịch trực từ ngày `from`, `days` ngày liên tiếp. Đi tuần tự từ NeoGoc nên ngày X hỏi
// hôm nay hay hỏi tuần sau đều ra cùng một người; phòng từ 2 người trở lên thì không ai trực 2
// ngày liên tiếp (còn đúng 1 người thì bạn đó trực mỗi ngày, không còn ai để xoay).
func Schedule(members []Member, from string, days int) []Slot {
	if days <= 0 {
		days = 14
	}
	order := make([]Member, len(members))
	copy(order, members)
	sort.SliceStable(order, func(i, j int) bool { return truocHon(order[i], order[j]) })
	if len(order) == 0 {
		return []Slot{}
	}

	batDau := NeoGoc
	if from < batDau {
		batDau = from
	}
	het := billing.AddDays(from, days-1)

	out := make([]Slot, 0, days)
	var truoc *Member
	comat := make([]Member, 0, len(order))
	for ngay, i := batDau, 0; ngay <= het && i < tranMoPhong; ngay, i = billing.AddDays(ngay, 1), i+1 {
		comat = comat[:0]
		for _, m := range order {
			if billing.DaysStayedInRange(m.CheckInDate, m.CheckOutDate, ngay, ngay) > 0 {
				comat = append(comat, m)
			}
		}
		// Phòng trống hôm đó: giữ nguyên người trực gần nhất để chuỗi không đứt.
		if len(comat) == 0 {
			continue
		}
		nguoi := keTiep(comat, truoc)
		giu := nguoi
		truoc = &giu
		if ngay >= from {
			out = append(out, Slot{Date: ngay, StudentID: nguoi.ID, Name: nguoi.Name})
		}
	}
	return out
}
