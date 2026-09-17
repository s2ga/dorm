-- BL-123: owner chốt 17/09/2026 — hồ sơ có bản scan HĐ + số HĐ + ngày ký thì hợp đồng là "Đã hoàn tất".
-- Trước đây "đã ký" chỉ đọc từ cột contract_status do người nhập tay, nên có hồ sơ đủ cả ba thứ mà vẫn
-- báo "Chưa ký HĐ". Từ nay lúc lưu hồ sơ và lúc tải scan máy chủ tự nâng (hopDongDuBaThuLaHoanTat);
-- migration này dọn một lần các hồ sơ cũ, kể cả hồ sơ đã khoá. Cùng điều kiện với studentsSQLHopDongDuBaThu.
UPDATE students
   SET contract_status = 'done'
 WHERE contract_scan IS NOT NULL AND btrim(contract_scan) <> ''
   AND btrim(COALESCE(contract_no, '')) <> '' AND lower(btrim(contract_no)) <> 'x'
   AND contract_date IS NOT NULL
   AND contract_status IS DISTINCT FROM 'done';
