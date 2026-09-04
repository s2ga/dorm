package handlers

// Một định nghĩa SQL cho "đang ở / sắp vào / sắp ra" tại mốc `moc` (biểu thức date: CURRENT_DATE, $n::date,
// d.ngay). Hôm nay/quá khứ chỉ tin ngày THẬT (check_in/out_date); tương lai coi DỰ KIẾN (planned_*) sẽ xảy ra.

func roomsDangO(moc string) string {
	return `((s.check_in_date IS NOT NULL AND s.check_in_date <= ` + moc + `
	      AND (s.check_out_date IS NULL OR s.check_out_date > ` + moc + `)
	      AND (` + moc + ` <= CURRENT_DATE OR s.planned_check_out IS NULL OR s.planned_check_out > ` + moc + `))
	   OR (s.check_in_date IS NULL AND s.check_out_date IS NULL
	      AND s.planned_check_in IS NOT NULL AND s.planned_check_in <= ` + moc + ` AND ` + moc + ` > CURRENT_DATE
	      AND (s.planned_check_out IS NULL OR s.planned_check_out > ` + moc + `)))`
}

// Đã đặt chỗ mà chưa được tính là đang ở tại mốc: lịch vào còn ở sau mốc, hoặc mốc là hôm nay/quá khứ
// và người đó chưa xác nhận (kể cả đã quá ngày dự kiến — "chờ xác nhận vào" vẫn giữ giường).
func roomsSapVao(moc string) string {
	return `(s.check_in_date IS NULL AND s.check_out_date IS NULL AND s.planned_check_in IS NOT NULL
	      AND (s.planned_check_in > ` + moc + ` OR ` + moc + ` <= CURRENT_DATE))`
}

// Đang ở tại mốc và đã có lịch ra (sau mốc, hoặc mốc là hôm nay/quá khứ thì kể cả lịch đã qua mà chưa
// xác nhận — "chờ xác nhận trả").
func roomsSapRa(moc string) string {
	return `(` + roomsDangO(moc) + ` AND s.check_out_date IS NULL AND s.planned_check_out IS NOT NULL
	      AND (s.planned_check_out > ` + moc + ` OR ` + moc + ` <= CURRENT_DATE))`
}
