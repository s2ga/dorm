-- Đưa cột fee_discount vào ràng buộc ck_invoices_no_negative.
--
-- Vì sao cần migration riêng: ràng buộc đó được tạo bằng `ALTER TABLE ... ADD CONSTRAINT` trong khối
-- DO $ktx$ của schema.sql. Trên CSDL ĐÃ CÓ ràng buộc, câu ADD sẽ ném duplicate_object và khối DO bắt
-- rồi bỏ qua — nghĩa là định nghĩa MỚI (có fee_discount >= 0) sẽ KHÔNG bao giờ được áp. CSDL rỗng thì
-- áp đúng ngay, CSDL đang chạy thì mãi giữ định nghĩa cũ. Phải gỡ rồi tạo lại, và đó là thao tác một
-- chiều nên thuộc về migrations chứ không phải file baseline.
--
-- An toàn: chỉ đụng vào ràng buộc, không đụng dữ liệu. Nếu đang có dòng fee_discount âm thì câu ADD
-- sẽ vỡ và migration dừng — đúng ý: thà dừng còn hơn chạy tiếp mà thiếu chốt chặn tiền âm.

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_no_negative;

ALTER TABLE invoices ADD CONSTRAINT ck_invoices_no_negative CHECK (
  room_charge >= 0 AND electric_charge >= 0 AND water_charge >= 0 AND service_charge >= 0
  AND washing_charge >= 0 AND parking_charge >= 0 AND other_charge >= 0
  AND leader_discount >= 0 AND room_discount >= 0 AND fee_discount >= 0
  AND electric_kwh >= 0 AND days_stayed >= 0 AND total >= 0);
