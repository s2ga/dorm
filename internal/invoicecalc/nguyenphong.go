package invoicecalc

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/billing"
	"ktx/internal/db"
)

// NguyenPhongThang: gói tham số thuê-nguyên-phòng của MỘT phòng trong MỘT tháng.
// nil = phòng không phải loại thuê trọn, mọi thứ tính như thuê ghép.
type NguyenPhongThang struct {
	PhongTruongID int // học viên ký hợp đồng, người đứng phiếu; 0 = chưa cử
	Suat          billing.NguyenPhong
}

// Cua: dựng tham số cho một học viên cụ thể trong phòng đó.
func (n *NguyenPhongThang) Cua(studentID int) *billing.NguyenPhong {
	if n == nil {
		return nil
	}
	np := n.Suat
	np.DungHoaDon = studentID == n.PhongTruongID
	return &np
}

// NguyenPhongCuaPhong: cộng Σ suất-người / máy giặt / xe của cả phòng trong tháng, và tìm người ký
// hợp đồng. Trả nil khi phòng không phải loại thuê trọn — chỗ gọi cứ truyền thẳng vào ComputeInput.
func NguyenPhongCuaPhong(ctx context.Context, database *db.DB, roomID int, month string, fees billing.Fees) (*NguyenPhongThang, error) {
	var roomType *string
	err := database.Pool.QueryRow(ctx, "SELECT room_type FROM rooms WHERE id=$1 AND deleted_at IS NULL", roomID).Scan(&roomType)
	if err != nil || roomType == nil || *roomType != "whole" {
		return nil, nil
	}

	dim := billing.DaysInMonth(month)
	halfFactor := 0.5
	if v, ok := fees["partial_half_factor"]; ok && v != "" {
		halfFactor = fees.Num("partial_half_factor")
	}
	halfMin := int(fees.Num("partial_half_min"))
	fullMin := int(fees.Num("partial_full_min"))

	rows, err := database.Pool.Query(ctx,
		`SELECT s.id, s.check_in_date, s.check_out_date, s.uses_washing,
		        (SELECT COUNT(*)::int FROM vehicles v WHERE v.student_id=s.id AND v.deleted_at IS NULL) AS so_xe
		   FROM students s
		  WHERE s.room_id=$1
		    AND s.check_in_date <= $2 AND (s.check_out_date IS NULL OR s.check_out_date >= $3)`,
		roomID, billing.LastDay(month), billing.FirstDay(month))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := &NguyenPhongThang{}
	for rows.Next() {
		var id, soXe int
		var ci, co pgtype.Date
		var giat bool
		if err := rows.Scan(&id, &ci, &co, &giat, &soXe); err != nil {
			return nil, err
		}
		days := billing.DaysStayedInMonth(dateStr(ci), dateStr(co), month)
		if days <= 0 {
			continue
		}
		f := billing.PartialFactor(days, dim, halfMin, fullMin, halfFactor)
		out.Suat.SuatNguoi += f
		if giat {
			out.Suat.SuatMayGiat += f
		}
		out.Suat.SuatXe += f * float64(soXe)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Ai CÓ hợp đồng thì người đó chịu tiền phòng. Người ở cùng để trống hoặc ghi "x" (ở theo hợp
	// đồng của người ký) nên không tính là chủ hợp đồng.
	var chuHD *int
	_ = database.Pool.QueryRow(ctx,
		`SELECT id FROM students
		  WHERE room_id=$1 AND deleted_at IS NULL
		    AND contract_no IS NOT NULL AND btrim(contract_no) <> '' AND lower(btrim(contract_no)) <> 'x'
		    AND check_in_date <= $2 AND (check_out_date IS NULL OR check_out_date >= $3)
		  ORDER BY check_in_date, id LIMIT 1`,
		roomID, billing.LastDay(month), billing.FirstDay(month)).Scan(&chuHD)
	if chuHD == nil {
		// Chưa nhập số hợp đồng -> lùi về phòng trưởng để phiếu vẫn ra, không bỏ sót tiền phòng.
		_ = database.Pool.QueryRow(ctx,
			`SELECT student_id FROM room_leaders
			  WHERE room_id=$1 AND from_date <= $2 AND (to_date IS NULL OR to_date >= $3)
			  ORDER BY from_date DESC LIMIT 1`,
			roomID, billing.LastDay(month), billing.FirstDay(month)).Scan(&chuHD)
	}
	if chuHD == nil {
		// Chưa có cả số HĐ lẫn phòng trưởng: vẫn phải có NGƯỜI đứng phiếu, không thì cả phòng
		// thành "thành viên" và tiền phòng biến mất im lặng. Lấy người vào sớm nhất.
		_ = database.Pool.QueryRow(ctx,
			`SELECT id FROM students
			  WHERE room_id=$1 AND deleted_at IS NULL
			    AND check_in_date <= $2 AND (check_out_date IS NULL OR check_out_date >= $3)
			  ORDER BY check_in_date, id LIMIT 1`,
			roomID, billing.LastDay(month), billing.FirstDay(month)).Scan(&chuHD)
	}
	if chuHD != nil {
		out.PhongTruongID = *chuHD
	}
	return out, nil
}
