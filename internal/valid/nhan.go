package valid

// NhanTruong: tên hiển thị (khớp nhãn trên giao diện) của khoá cài đặt và trường dữ liệu, dùng trong câu lỗi
// trả về giao diện thay cho tên cột.
var NhanTruong = map[string]string{
	"room_fee": "Tiền phòng", "deposit_fee": "Tiền cọc", "water_fee": "Tiền nước", "electric_unit": "Đơn giá điện (/kWh)",
	"service_fee": "Phí dịch vụ", "washing_fee": "Máy giặt", "parking_fee": "Gửi xe",
	"room_price_A": "Giá thuê nguyên phòng hạng A", "room_price_B": "Giá thuê nguyên phòng hạng B",
	"room_price_C": "Giá thuê nguyên phòng hạng C", "room_price_D": "Giá thuê nguyên phòng hạng D",
	"room_cap_A": "Trần giường hạng A", "room_cap_B": "Trần giường hạng B", "room_cap_C": "Trần giường hạng C", "room_cap_D": "Trần giường hạng D",
	"partial_half_min": "Tháng lẻ: ở trên (ngày) → tính 50%", "partial_full_min": "Tháng lẻ: ở trên (ngày) → tính 100%",
	"partial_half_factor": `Hệ số phí tháng lẻ mức "nửa"`,
	"due_day_from":        "Hạn đóng tiền — từ ngày", "due_day_to": "Hạn đóng tiền — đến ngày",
	"violation_mail_threshold": "Gửi email khi vi phạm đủ (số lần)", "smtp_port": "Cổng SMTP",
	"overdue_remind_days": "Nhắc khi ở quá (ngày)", "shortterm_max_days": "Ngưỡng thuê ghép ngắn hạn (ngày)",
	"deposit_notice_min_days": "Hoàn cọc: báo trước tối thiểu (ngày)", "checkout_max_future_days": "Học viên tự xin trả phòng: xa nhất (ngày)",
	"max_cccd_mb": "Dung lượng ảnh CCCD tối đa (MB)", "parking_absent_alert_days": `Báo "xe bỏ gửi" khi vắng liên tiếp (ngày)`,
	"tuoi_toi_thieu": "Tuổi tối thiểu", "tuoi_toi_da": "Tuổi tối đa",
	"security_day_from": "Ca ngày bắt đầu", "security_day_to": "Ca ngày kết thúc",
	"parking_close_alert_time": "Nhắc nếu an ninh chưa chốt bãi xe sau",

	"name": "Họ tên", "phone": "Số điện thoại", "code": "Mã học viên", "class_name": "Lớp", "pref": "Nguyện vọng",
	"note": "Ghi chú", "plate": "Biển số xe", "deposit_bank": "Ngân hàng", "deposit_account": "Số tài khoản",
	"checkout_reason": "Lý do trả phòng", "reason": "Lý do",
	"birth_date": "Ngày sinh", "check_in_date": "Ngày nhận phòng", "check_out_date": "Ngày trả phòng",
	"planned_check_in": "Ngày nhận phòng dự kiến", "planned_check_out": "Ngày trả phòng dự kiến",
	"contract_date": "Ngày ký hợp đồng", "deposit_date": "Ngày đóng cọc", "class_start_date": "Ngày khai giảng",
	"expected_departure": "Dự kiến xuất cảnh", "checkout_notice_date": "Ngày báo trả phòng",

	"room_charge": "Tiền phòng", "electric_charge": "Tiền điện", "water_charge": "Tiền nước", "service_charge": "Phí dịch vụ",
	"washing_charge": "Máy giặt", "parking_charge": "Gửi xe", "other_charge": "Khoản khác", "deposit_charge": "Tiền cọc",
	"electric_kwh": "Số điện (kWh)", "days_stayed": "Số ngày ở",
}

// Nhan: nhãn tiếng Việt của khoá; khoá chưa có trong bảng thì trả nguyên khoá.
func Nhan(k string) string {
	if n, ok := NhanTruong[k]; ok {
		return n
	}
	return k
}
