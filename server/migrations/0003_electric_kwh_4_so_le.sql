-- Số kWh trên phiếu phải là phần chia THẬT, không làm tròn về số nguyên.
-- NUMERIC(10,1) chỉ giữ 1 số lẻ nên nhân ngược ra vẫn lệch: 41,2 × 3.000 = 123.600 ≠ 123.730.
-- 4 số lẻ đủ để kWh × đơn giá làm tròn ra ĐÚNG số tiền đang thu.
-- Nới rộng kiểu số, không mất dữ liệu cũ.
ALTER TABLE invoices ALTER COLUMN electric_kwh TYPE NUMERIC(12,4);
