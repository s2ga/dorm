-- Đưa fee_discount vào ck_invoices_no_negative. Phải gỡ rồi tạo lại: câu ADD CONSTRAINT trong
-- schema.sql bị bỏ qua khi ràng buộc đã tồn tại, nên định nghĩa mới không tự áp được.

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_no_negative;

ALTER TABLE invoices ADD CONSTRAINT ck_invoices_no_negative CHECK (
  room_charge >= 0 AND electric_charge >= 0 AND water_charge >= 0 AND service_charge >= 0
  AND washing_charge >= 0 AND parking_charge >= 0 AND other_charge >= 0
  AND leader_discount >= 0 AND room_discount >= 0 AND fee_discount >= 0
  AND electric_kwh >= 0 AND days_stayed >= 0 AND total >= 0);
