package db

// Dữ liệu seed mặc định — port nguyên văn từ server/db.js:159-274 (seedDefaults).
// Giữ đúng key/giá trị vì tests/e2e + tính tiền phụ thuộc các ngưỡng này.

// defaultSettings trả cặp [key, value] theo thứ tự; DormName thay cho biến động dorm_name.
func defaultSettings(dormName string) [][2]string {
	return [][2]string{
		{"dorm_name", dormName},
		{"room_fee", "1200000"}, {"water_fee", "100000"}, {"electric_unit", "3000"}, {"service_fee", "50000"},
		{"washing_fee", "70000"}, {"parking_fee", "100000"}, {"deposit_fee", "1200000"},
		{"partial_half_min", "10"}, {"partial_full_min", "15"},
		{"overdue_remind_days", "7"},
		{"shortterm_max_days", "60"},
		{"deposit_notice_min_days", "30"},
		{"partial_half_factor", "0.5"},
		{"room_cap_A", "5"}, {"room_cap_B", "4"}, {"room_cap_C", "4"}, {"room_cap_D", "3"},
		{"checkout_max_future_days", "365"},
		{"max_cccd_mb", "12"},
		// Rỗng = TỰ ĐỘNG: đủ Tenant ID + Client ID là SSO bật. Chỉ 'false' (admin bấm Tắt) mới chặn.
		{"sso_enabled", ""},
		{"sso_tenant_id", ""},
		{"sso_client_id", ""},
		{"sso_client_secret", ""},
		{"sso_allowed_domains", ""},
		{"legal_female", "E2"}, {"legal_male", "S2"}, {"due_day_from", "1"}, {"due_day_to", "5"}, {"hotline", ""},
		{"room_price_A", "5500000"}, {"room_price_B", "4800000"}, {"room_price_C", "4200000"}, {"room_price_D", "3600000"},
		// Diện tích đi theo HẠNG chứ không theo từng phòng. Là CHUỖI vì hạng A ghi khoảng "24~26".
		{"room_area_A", "24~26"}, {"room_area_B", "23"}, {"room_area_C", "22"}, {"room_area_D", "19"},
		// Số trực an ninh + khung giờ ca ngày (ca đêm là phần còn lại: day_to -> day_from).
		{"security_day_phone", ""}, {"security_night_phone", ""},
		{"security_day_from", "06:00"}, {"security_day_to", "18:00"},
		// Wifi dùng chung toàn KTX. Mật khẩu chỉ trả cho HV ĐANG Ở (me.go), không lọt ra /api/public.
		{"wifi_ssid", ""}, {"wifi_password", ""},
		{"bravo_fee_type", "T0704"},
		{"bravo_room", "GP00180"}, {"bravo_water", "GP00181"}, {"bravo_service", "GP00183"},
		{"bravo_electric", "GP00184"}, {"bravo_parking", "GP00182"}, {"bravo_washing", ""}, {"bravo_other", ""},
		{"bravo_deposit", ""},
		{"intro_hero_title", "Không gian nội trú\nan tâm & nề nếp"},
		{"intro_hero_desc", "chỗ ở tiện nghi, kỷ luật, đồng hành cùng học viên trên hành trình sang Nhật."},
		{"intro_about_eyebrow", "Về khu nội trú"},
		{"intro_about_title", "Khuôn viên ngăn nắp, an ninh, gần trường"},
		{"intro_about_desc", "Khu nội trú bố trí gọn gàng với khu tự học, sinh hoạt chung và bảo vệ 24/7 — nơi học viên rèn nếp sống kỷ luật kiểu Nhật."},
		{"intro_rooms_eyebrow", "Phòng ở"},
		{"intro_rooms_title", "Phòng ở tiện nghi, sạch sẽ"},
		{"intro_rooms_desc", "Phòng ghép đầy đủ nội thất: giường tầng, tủ locker riêng, máy lạnh, kệ đồ — vệ sinh định kỳ."},
		{"intro_amenities_title", "Tiện ích & dịch vụ"},
		{"intro_price_title", "Bảng giá chi phí"},
		{"intro_price_desc", "Minh bạch theo từng khoản. Tiền điện tính theo công-tơ, chia đều số người ở phòng."},
		{"intro_contact_title", "Liên hệ & đường đến"},
		{"intro_contact_desc", "Ghé thăm hoặc gọi cho ban quản lý để được tư vấn xếp phòng."},
		{"imgcap_khuon-vien-1", "Khuôn viên"}, {"imgcap_khuon-vien-2", "Sảnh sinh hoạt chung"}, {"imgcap_khuon-vien-3", "Khu tự học"},
		{"imgcap_phong-1", "Phòng ghép"}, {"imgcap_phong-2", "Nội thất phòng"}, {"imgcap_phong-3", "Khu vệ sinh"},
		{"school_name", "Nhà trường"}, {"school_email", ""}, {"violation_mail_threshold", "3"},
		{"smtp_host", ""}, {"smtp_port", "587"}, {"smtp_secure", "false"},
		{"smtp_user", ""}, {"smtp_pass", ""}, {"smtp_from", ""},
	}
}

type assetSeed struct {
	name, unit, category string
	quantity, fee        int
}

var seedAssets = []assetSeed{
	{"Chìa khoá tủ locker", "Cái", "person", 1, 50000},
	{"Chìa khoá phòng", "Cái", "person", 1, 50000},
	{"Remote máy lạnh", "Cái", "person", 1, 200000},
	{"Vệ sinh phòng ở", "Lần", "person", 1, 200000},
	{"Giường tầng sắt", "Cái", "fixed", 1, 0},
	{"Tủ locker", "Cái", "fixed", 1, 0},
	{"Máy lạnh 1 HP", "Cái", "fixed", 1, 0},
	{"Kệ dép gỗ 3 tầng", "Cái", "fixed", 1, 0},
	{"Thùng rác", "Cái", "fixed", 2, 0},
	{"Kệ nhà tắm", "Cái", "fixed", 1, 0},
}

var seedViolationTypes = [][2]string{
	{"Về ký túc xá trễ giờ quy định", "minor"},
	{"Gây ồn ào, mất trật tự", "minor"},
	{"Không giữ vệ sinh chung", "minor"},
	{"Không tham gia sinh hoạt / điểm danh", "minor"},
	{"Hút thuốc / uống rượu bia trong KTX", "major"},
	{"Tự ý cho người lạ vào ở lại", "major"},
	{"Nấu ăn / dùng thiết bị gây cháy nổ", "major"},
	{"Đánh nhau, gây gổ", "severe"},
	{"Trộm cắp tài sản", "severe"},
	{"Vi phạm nghiêm trọng khác", "severe"},
}
