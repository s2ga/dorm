-- BL-117: tách NGÀY DỰ KIẾN khỏi NGÀY THẬT. Trước đây một cột check_in_date/check_out_date gánh cả hai
-- nghĩa: duyệt đơn ghi ngày dự kiến vào đó, và mọi chỗ đọc coi nó là sự thật (người chưa đến vẫn
-- "đang ở", đã chia tiền điện, đã lập phiếu). Nay: check_in_date/check_out_date = ngày THẬT (chỉ ghi khi
-- xác nhận), planned_check_in/planned_check_out = dự kiến. Migration này nắn dữ liệu đã có.

-- 1. Ngày vào còn ở TƯƠNG LAI = mới là lịch hẹn, chưa ai xác nhận đã vào.
UPDATE students
   SET planned_check_in = check_in_date, check_in_date = NULL
 WHERE deleted_at IS NULL AND check_in_date > CURRENT_DATE;

-- Lượt ở mở sẵn cho ngày hẹn đó (duyệt đơn cũ mở lượt theo ngày dự kiến) -> xoá, xác nhận thật mới mở lại.
DELETE FROM room_stays rs
 USING students s
 WHERE rs.student_id = s.id AND s.deleted_at IS NULL
   AND s.check_in_date IS NULL AND s.planned_check_in IS NOT NULL
   AND rs.from_date >= s.planned_check_in;

-- 2. Ngày ra CHƯA được xác nhận (hồ sơ còn status='in' và không có dấu bàn giao) = lịch dự kiến,
--    dù ngày đó đã qua hay chưa. Ai đã bàn giao thật (checkout_confirmed_at) thì là đã rời.
UPDATE students
   SET status = 'out'
 WHERE deleted_at IS NULL AND status = 'in'
   AND check_out_date IS NOT NULL AND check_out_date <= CURRENT_DATE
   AND checkout_confirmed_at IS NOT NULL;

UPDATE students
   SET planned_check_out = check_out_date, check_out_date = NULL
 WHERE deleted_at IS NULL AND status = 'in' AND check_out_date IS NOT NULL;

-- Hồ sơ cũ bị đặt 'out' ngay lúc duyệt đơn dù ngày rời còn ở tương lai (trước bản vá 24/08): người
-- vẫn đang ở, đưa về đúng nghĩa.
UPDATE students
   SET planned_check_out = check_out_date, check_out_date = NULL, status = 'in'
 WHERE deleted_at IS NULL AND status = 'out'
   AND check_out_date IS NOT NULL AND check_out_date > CURRENT_DATE;

-- Lượt ở / nhiệm kỳ phòng trưởng bị đóng sẵn ở ngày dự kiến -> mở lại, chỉ đóng khi xác nhận thật.
UPDATE room_stays rs
   SET to_date = NULL
  FROM students s
 WHERE rs.student_id = s.id AND s.deleted_at IS NULL
   AND s.check_out_date IS NULL AND s.planned_check_out IS NOT NULL
   AND rs.to_date IS NOT NULL AND rs.to_date >= s.planned_check_out
   AND rs.id = (SELECT id FROM room_stays x WHERE x.student_id = s.id ORDER BY from_date DESC, id DESC LIMIT 1);

UPDATE room_leaders rl
   SET to_date = NULL
  FROM students s
 WHERE rl.student_id = s.id AND s.deleted_at IS NULL
   AND s.check_out_date IS NULL AND s.planned_check_out IS NOT NULL
   AND rl.to_date IS NOT NULL AND rl.to_date >= s.planned_check_out
   AND rl.id = (SELECT id FROM room_leaders x WHERE x.student_id = s.id ORDER BY from_date DESC, id DESC LIMIT 1);

-- Mốc công-tơ "chốt lúc trả phòng" ghi ở ngày CHƯA tới (số đoán lúc duyệt đơn) -> xoá, chốt thật mới ghi.
DELETE FROM meter_reads
 WHERE reason = 'checkout' AND read_date > CURRENT_DATE;
