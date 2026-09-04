-- BL-73: users.username mang HAI ràng buộc duy nhất chồng nhau.
--   users_username_key   UNIQUE (username)                                  <- không loại trừ hàng xoá mềm
--   uq_users_username_ci UNIQUE (lower(username)) WHERE deleted_at IS NULL  <- đúng nghiệp vụ
-- Xoá tài khoản là xoá MỀM, nên ràng buộc trần giữ chỗ tên đăng nhập vĩnh viễn:
-- tạo lại cùng tên -> app kiểm trùng (có loại trừ) cho qua rồi vỡ ở CSDL, trả 500 trần.
-- Gỡ cái trần, giữ cái có điều kiện.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
