-- Chốt lại 2 số lẻ cho số kWh: hệ thống tài chính bên đối tác chỉ nhận tới 2 số lẻ, giữ 4 bên này
-- là hai bên lệch số. Đổi kiểu cột cũng làm tròn luôn các giá trị 4 số lẻ đã ghi ở migration 0003.
ALTER TABLE invoices ALTER COLUMN electric_kwh TYPE NUMERIC(12,2);
