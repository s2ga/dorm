// Package invoicecalc — lớp truy vấn DB + gọi billing để tính điện/hoá đơn. Port từ server/invoice-calc.js.
// Luôn chạy trên pool (giống Node dùng query trực tiếp, kể cả khi được gọi trong luồng có transaction).
package invoicecalc

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/billing"
	"ktx/internal/db"
	"ktx/internal/roomleaders"
	"ktx/internal/vehiclecount"
)

func dateStr(d pgtype.Date) string {
	if d.Valid {
		return d.Time.Format("2006-01-02")
	}
	return ""
}

// RoomRoster: người ở 1 phòng trong kỳ + số ngày ở. server/invoice-calc.js:8-18
func RoomRoster(ctx context.Context, database *db.DB, roomID int, month string) ([]billing.RosterEntry, error) {
	rows, err := database.Pool.Query(ctx,
		`SELECT id, check_in_date, check_out_date FROM students
		  WHERE room_id=$1 AND deleted_at IS NULL
		    AND check_in_date <= $2 AND (check_out_date IS NULL OR check_out_date >= $3)`,
		roomID, billing.LastDay(month), billing.FirstDay(month))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []billing.RosterEntry{}
	for rows.Next() {
		var id int
		var ci, co pgtype.Date
		if err := rows.Scan(&id, &ci, &co); err != nil {
			return nil, err
		}
		days := billing.DaysStayedInMonth(dateStr(ci), dateStr(co), month)
		if days > 0 {
			out = append(out, billing.RosterEntry{StudentID: id, Days: days})
		}
	}
	return out, rows.Err()
}

// RoomSegments: các chặng tính điện của 1 phòng, cắt theo lần chốt giữa kỳ. nil = chưa có dữ liệu.
// server/invoice-calc.js:23-43
func RoomSegments(ctx context.Context, database *db.DB, roomID int, month string) ([]billing.BuiltSegment, error) {
	var rs, re float64
	err := database.Pool.QueryRow(ctx, "SELECT reading_start, reading_end FROM electric_readings WHERE room_id=$1 AND month=$2", roomID, month).Scan(&rs, &re)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	readRows, err := database.Pool.Query(ctx,
		"SELECT read_date, reading FROM meter_reads WHERE room_id=$1 AND read_date >= $2 AND read_date <= $3 ORDER BY read_date",
		roomID, billing.FirstDay(month), billing.LastDay(month))
	if err != nil {
		return nil, err
	}
	var reads []billing.MeterRead
	for readRows.Next() {
		var rd pgtype.Date
		var reading float64
		if err := readRows.Scan(&rd, &reading); err != nil {
			readRows.Close()
			return nil, err
		}
		reads = append(reads, billing.MeterRead{Date: dateStr(rd), Reading: reading})
	}
	readRows.Close()
	if err := readRows.Err(); err != nil {
		return nil, err
	}

	stayRows, err := database.Pool.Query(ctx,
		`SELECT rs.student_id, rs.from_date, rs.to_date
		   FROM room_stays rs JOIN students s ON s.id = rs.student_id
		  WHERE rs.room_id=$1 AND s.deleted_at IS NULL
		    AND rs.from_date <= $2 AND (rs.to_date IS NULL OR rs.to_date >= $3)`,
		roomID, billing.LastDay(month), billing.FirstDay(month))
	if err != nil {
		return nil, err
	}
	var stays []billing.Stay
	for stayRows.Next() {
		var sid int
		var from, to pgtype.Date
		if err := stayRows.Scan(&sid, &from, &to); err != nil {
			stayRows.Close()
			return nil, err
		}
		stays = append(stays, billing.Stay{StudentID: sid, From: dateStr(from), To: dateStr(to)})
	}
	stayRows.Close()
	if err := stayRows.Err(); err != nil {
		return nil, err
	}
	if len(stays) == 0 {
		return nil, nil
	}
	return billing.BuildSegments(month, rs, re, reads, stays), nil
}

// StudentElectric: tiền điện 1 HV = tổng phần ở MỌI phòng họ ở trong tháng, làm tròn TỪNG PHÒNG.
// nil = chưa có dữ liệu chỉ số (bên gọi dùng cách cũ). server/invoice-calc.js:54-68
func StudentElectric(ctx context.Context, database *db.DB, studentID int, month string, unit float64) (*float64, error) {
	rows, err := database.Pool.Query(ctx,
		`SELECT DISTINCT room_id FROM room_stays
		  WHERE student_id=$1 AND from_date <= $2 AND (to_date IS NULL OR to_date >= $3)`,
		studentID, billing.LastDay(month), billing.FirstDay(month))
	if err != nil {
		return nil, err
	}
	var roomIDs []int
	for rows.Next() {
		var rid *int
		if err := rows.Scan(&rid); err != nil {
			rows.Close()
			return nil, err
		}
		if rid != nil {
			roomIDs = append(roomIDs, *rid)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sum := 0.0
	found := false
	for _, rid := range roomIDs {
		segs, err := RoomSegments(ctx, database, rid, month)
		if err != nil {
			return nil, err
		}
		if segs == nil {
			continue
		}
		found = true
		bs := make([]billing.Segment, len(segs))
		for i, s := range segs {
			bs[i] = billing.Segment{Electric: s.Kwh * unit, Roster: s.Roster}
		}
		share := billing.SplitElectricExact(bs)
		sum += float64(share[studentID])
	}
	if !found {
		return nil, nil
	}
	return &sum, nil
}

// StudentElectricProvisional: điện của HV ĐÃ TRẢ PHÒNG khi phòng CHƯA chốt chỉ số cuối tháng
// (electric_readings tháng này chưa có). Dùng chỉ số bàn giao (meter_reads mới nhất trong tháng)
// làm mốc CUỐI tạm, chỉ số ĐẦU = reading_end tháng trước; chỉ tính phần tới ngày bàn giao.
// Khớp tuyệt đối: khi phòng chốt cuối tháng, đường thường (StudentElectric) ra ĐÚNG cùng số cho HV
// này (cùng các chặng trước ngày rời). nil nếu thiếu dữ liệu -> bên gọi giữ 0/đường cũ. — BL-62 GĐ3 (phương án A).
func StudentElectricProvisional(ctx context.Context, database *db.DB, studentID int, month string, unit float64) (*float64, error) {
	rows, err := database.Pool.Query(ctx,
		`SELECT DISTINCT room_id FROM room_stays
		  WHERE student_id=$1 AND from_date <= $2 AND (to_date IS NULL OR to_date >= $3)`,
		studentID, billing.LastDay(month), billing.FirstDay(month))
	if err != nil {
		return nil, err
	}
	var roomIDs []int
	for rows.Next() {
		var rid *int
		if err := rows.Scan(&rid); err != nil {
			rows.Close()
			return nil, err
		}
		if rid != nil {
			roomIDs = append(roomIDs, *rid)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Tháng trước = ngày trước ngày đầu tháng này, cắt 7 ký tự (YYYY-MM).
	prevM := billing.AddDays(billing.FirstDay(month), -1)
	if len(prevM) >= 7 {
		prevM = prevM[:7]
	}

	sum := 0.0
	found := false
	for _, rid := range roomIDs {
		// Phòng ĐÃ có chỉ số cuối tháng -> đường thường (RoomSegments) lo, KHÔNG tạm tính.
		var one int
		if e := database.Pool.QueryRow(ctx, "SELECT 1 FROM electric_readings WHERE room_id=$1 AND month=$2", rid, month).Scan(&one); e == nil {
			continue
		}
		// Chỉ số ĐẦU tháng = reading_end tháng trước.
		var opening *float64
		if e := database.Pool.QueryRow(ctx, "SELECT reading_end FROM electric_readings WHERE room_id=$1 AND month=$2", rid, prevM).Scan(&opening); e != nil || opening == nil {
			continue // không biết mốc đầu -> bỏ (giữ 0)
		}
		// meter_reads trong tháng (gồm chốt bàn giao). read mới nhất = mốc cuối tạm.
		readRows, err := database.Pool.Query(ctx,
			"SELECT read_date, reading FROM meter_reads WHERE room_id=$1 AND read_date >= $2 AND read_date <= $3 ORDER BY read_date",
			rid, billing.FirstDay(month), billing.LastDay(month))
		if err != nil {
			return nil, err
		}
		var reads []billing.MeterRead
		var lastReading float64
		for readRows.Next() {
			var rd pgtype.Date
			var reading float64
			if err := readRows.Scan(&rd, &reading); err != nil {
				readRows.Close()
				return nil, err
			}
			reads = append(reads, billing.MeterRead{Date: dateStr(rd), Reading: reading})
			lastReading = reading
		}
		readRows.Close()
		if err := readRows.Err(); err != nil {
			return nil, err
		}
		if len(reads) == 0 {
			continue // chưa có chốt bàn giao -> bỏ
		}
		// stays trong tháng.
		stayRows, err := database.Pool.Query(ctx,
			`SELECT rs.student_id, rs.from_date, rs.to_date
			   FROM room_stays rs JOIN students s ON s.id = rs.student_id
			  WHERE rs.room_id=$1 AND s.deleted_at IS NULL
			    AND rs.from_date <= $2 AND (rs.to_date IS NULL OR rs.to_date >= $3)`,
			rid, billing.LastDay(month), billing.FirstDay(month))
		if err != nil {
			return nil, err
		}
		var stays []billing.Stay
		for stayRows.Next() {
			var sid int
			var from, to pgtype.Date
			if err := stayRows.Scan(&sid, &from, &to); err != nil {
				stayRows.Close()
				return nil, err
			}
			stays = append(stays, billing.Stay{StudentID: sid, From: dateStr(from), To: dateStr(to)})
		}
		stayRows.Close()
		if err := stayRows.Err(); err != nil {
			return nil, err
		}
		if len(stays) == 0 {
			continue
		}
		segs := billing.BuildSegments(month, *opening, lastReading, reads, stays)
		found = true
		bs := make([]billing.Segment, len(segs))
		for i, s := range segs {
			bs[i] = billing.Segment{Electric: s.Kwh * unit, Roster: s.Roster}
		}
		share := billing.SplitElectricExact(bs)
		sum += float64(share[studentID])
	}
	if !found {
		return nil, nil
	}
	return &sum, nil
}

func icInt(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}
func icFloat(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}
func icStr(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// RecalcInvoice: tính lại 1 hoá đơn theo dữ liệu hiện tại. Bỏ qua nếu 'paid'. server/invoice-calc.js:72-111
func RecalcInvoice(ctx context.Context, database *db.DB, studentID int, month string) (map[string]interface{}, error) {
	invRows, err := database.Pool.Query(ctx, "SELECT * FROM invoices WHERE student_id=$1 AND month=$2", studentID, month)
	if err != nil {
		return nil, err
	}
	inv, err := db.RowToMap(invRows)
	if err != nil || inv == nil {
		return nil, err
	}
	if icStr(inv["status"]) == "paid" {
		return inv, nil
	}

	// Học viên (các field billing cần)
	var (
		sID         int
		rentalType  *string
		ci, co      pgtype.Date
		discountPct *float64
		usesWashing bool
		usesParking bool
		roomID      *int
	)
	var giam billing.GiamPct
	err = database.Pool.QueryRow(ctx,
		"SELECT id, rental_type, check_in_date, check_out_date, room_fee_discount_pct, uses_washing, uses_parking, room_id, "+billing.CotSQL+" FROM students WHERE id=$1", studentID).
		Scan(append([]interface{}{&sID, &rentalType, &ci, &co, &discountPct, &usesWashing, &usesParking, &roomID}, giam.Ptr()...)...)
	if err != nil {
		return nil, nil // không có HV -> null (server/invoice-calc.js:81)
	}

	var room *billing.Room
	if roomID != nil {
		var hang *string
		var monthlyFee *float64
		var roomType *string
		if e := database.Pool.QueryRow(ctx, "SELECT hang, monthly_fee, room_type FROM rooms WHERE id=$1", *roomID).Scan(&hang, &monthlyFee, &roomType); e == nil {
			r := billing.Room{}
			if hang != nil {
				r.Hang = *hang
			}
			if monthlyFee != nil {
				r.MonthlyFee = *monthlyFee
			}
			if roomType != nil {
				r.RoomType = *roomType
			}
			room = &r
		}
	}

	fees, err := database.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	veh, err := vehiclecount.CountForMonth(ctx, database.Pool, studentID, month)
	if err != nil {
		return nil, err
	}

	kwh := 0.0
	roster := []billing.RosterEntry{}
	if roomID != nil {
		var k *float64
		if e := database.Pool.QueryRow(ctx, "SELECT kwh FROM electric_readings WHERE room_id=$1 AND month=$2", *roomID, month).Scan(&k); e == nil && k != nil {
			kwh = *k
		}
		roster, err = RoomRoster(ctx, database, *roomID, month)
		if err != nil {
			return nil, err
		}
	}
	electricCharge, err := StudentElectric(ctx, database, studentID, month, billing.Fees(fees).Num("electric_unit"))
	if err != nil {
		return nil, err
	}
	leaderDays, err := roomleaders.LeaderDaysInMonth(ctx, database.Pool, studentID, month)
	if err != nil {
		return nil, err
	}

	rt := ""
	if rentalType != nil {
		rt = *rentalType
	}
	pct := 0.0
	if discountPct != nil {
		pct = *discountPct
	}
	hv := billing.Student{
		ID: sID, RentalType: rt, CheckInDate: dateStr(ci), CheckOutDate: dateStr(co),
		RoomFeeDiscountPct: pct, UsesWashing: usesWashing, UsesParking: usesParking,
	}
	giam.GanVao(&hv)
	c := billing.ComputeInvoice(billing.ComputeInput{
		Student: hv,
		Room:    room, Month: month, Fees: billing.Fees(fees),
		Roster: roster, ElectricCharge: electricCharge, LeaderDays: leaderDays, Kwh: kwh, VehicleCount: &veh,
	})

	other := icFloat(inv["other_charge"])
	total := billing.InvoiceTotal(map[string]float64{
		"room_charge": float64(c.RoomCharge), "electric_charge": float64(c.ElectricCharge),
		"water_charge": float64(c.WaterCharge), "service_charge": float64(c.ServiceCharge),
		"washing_charge": float64(c.WashingCharge), "parking_charge": float64(c.ParkingCharge),
		"other_charge": other, "leader_discount": float64(c.LeaderDiscount), "room_discount": float64(c.RoomDiscount),
		"fee_discount": float64(c.FeeDiscount),
	})

	updRows, err := database.Pool.Query(ctx,
		`UPDATE invoices SET days_stayed=$1, room_charge=$2, electric_kwh=$3, electric_charge=$4, water_charge=$5,
		   service_charge=$6, washing_charge=$7, parking_charge=$8, leader_discount=$9, room_discount=$10,
		   fee_discount=$11, total=$12
		 WHERE id=$13 RETURNING *`,
		c.DaysStayed, c.RoomCharge, c.ElectricKwh, c.ElectricCharge, c.WaterCharge, c.ServiceCharge, c.WashingCharge,
		c.ParkingCharge, c.LeaderDiscount, c.RoomDiscount, c.FeeDiscount, total, icInt(inv["id"]))
	if err != nil {
		return nil, err
	}
	return db.RowToMap(updRows)
}
