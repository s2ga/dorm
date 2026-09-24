-- BL-137: owner chốt 24/09/2026 — tên người viết hoa chữ cái đầu mỗi từ, phần còn lại thường, ở MỌI
-- nơi kể cả giấy tờ in ra. Từ nay máy chủ tự chuẩn khi lưu (valid.TenChuan); migration này dọn một lần
-- dữ liệu cũ đang lẫn IN HOA / viết thường. Tách từ theo KHOẢNG TRẮNG giống hệt valid.TenChuan —
-- KHÔNG dùng initcap() vì nó còn cắt từ ở dấu gạch/gạch dưới, ra kết quả khác phía Go.
UPDATE students
   SET name = (SELECT string_agg(upper(left(w, 1)) || lower(substr(w, 2)), ' ' ORDER BY i)
                 FROM unnest(regexp_split_to_array(btrim(name), '\s+')) WITH ORDINALITY AS t(w, i))
 WHERE btrim(COALESCE(name, '')) <> ''
   AND name IS DISTINCT FROM (SELECT string_agg(upper(left(w, 1)) || lower(substr(w, 2)), ' ' ORDER BY i)
                                FROM unnest(regexp_split_to_array(btrim(name), '\s+')) WITH ORDINALITY AS t(w, i));

UPDATE applications
   SET name = (SELECT string_agg(upper(left(w, 1)) || lower(substr(w, 2)), ' ' ORDER BY i)
                 FROM unnest(regexp_split_to_array(btrim(name), '\s+')) WITH ORDINALITY AS t(w, i))
 WHERE btrim(COALESCE(name, '')) <> ''
   AND name IS DISTINCT FROM (SELECT string_agg(upper(left(w, 1)) || lower(substr(w, 2)), ' ' ORDER BY i)
                                FROM unnest(regexp_split_to_array(btrim(name), '\s+')) WITH ORDINALITY AS t(w, i));

-- users.full_name của học viên bám theo hồ sơ (BL-09), chuẩn lại cho khớp.
UPDATE users u
   SET full_name = s.name
  FROM students s
 WHERE u.student_id = s.id
   AND u.full_name IS DISTINCT FROM s.name;
