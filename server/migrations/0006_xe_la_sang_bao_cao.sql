-- BL-120: xe lạ trước đây ghi ở parking_checks(status='stranger'). Nay mọi BÁO CÁO của an ninh
-- (xe lạ / vắng nhiều ngày / khác) nằm chung bảng parking_reports để quản trị viên theo dõi trạng thái
-- đã xem / đã xử lý. Chép dòng cũ sang (đánh dấu 'seen' để không dội lên chuông như báo cáo mới),
-- rồi xoá khỏi parking_checks — bảng đó từ nay chỉ còn có mặt / vắng của xe đã đăng ký.
INSERT INTO parking_reports (report_date, facility_id, vehicle_id, plate, plate_norm, kind, note, photo_key,
                             reported_by, status, created_at)
SELECT pc.check_date, pc.facility_id, NULL, pc.plate, pc.plate_norm, 'stranger', COALESCE(pc.note, ''),
       pc.photo_key, COALESCE(pc.checked_by, ''), 'seen', pc.created_at
  FROM parking_checks pc
 WHERE pc.status = 'stranger' AND btrim(pc.plate) <> '';

DELETE FROM parking_checks WHERE status = 'stranger';
