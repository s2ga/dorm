package handlers

import (
	"context"
	"strings"

	"ktx/internal/timeutil"
	"ktx/internal/valid"
)

// Luật tuổi học viên nội trú (BL-128, owner chốt 15/09/2026): ngưỡng lấy từ Cài đặt, mặc định 17–39.
// Phòng an ninh và phòng nhân viên không phải chỗ ở học viên nên được miễn.

func phongMienLuatTuoi(loai string) bool { return loai == "security" || loai == "staff" }

// loaiPhong: room_type của phòng đích; không có phòng thì coi như phòng ở thường.
func (h *Handlers) loaiPhong(ctx context.Context, roomID *int) string {
	if roomID == nil {
		return "shared"
	}
	var lp string
	if h.pool().QueryRow(ctx, "SELECT COALESCE(room_type,'shared') FROM rooms WHERE id=$1", *roomID).Scan(&lp) != nil {
		return "shared"
	}
	return lp
}

// kiemNgaySinh: "" = đi tiếp. batBuoc = true thì thiếu ngày sinh cũng bị chặn.
func (h *Handlers) kiemNgaySinh(ctx context.Context, ngaySinh string, roomID *int, batBuoc bool) string {
	if phongMienLuatTuoi(h.loaiPhong(ctx, roomID)) {
		return ""
	}
	ns := studentsSlice10(strings.TrimSpace(ngaySinh))
	if ns == "" {
		if batBuoc {
			return "Chưa có ngày sinh trong hồ sơ. Bấm Sửa hồ sơ để bổ sung rồi làm lại bước này."
		}
		return ""
	}
	min, max := valid.TuoiToiThieuMacDinh, valid.TuoiToiDaMacDinh
	if s, err := h.DB.GetSettings(ctx); err == nil {
		min, max = valid.KhoangTuoi(s["tuoi_toi_thieu"], s["tuoi_toi_da"])
	}
	return valid.LoiNgaySinh(ns, timeutil.Today(), min, max)
}
