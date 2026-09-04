---
description: Checklist trước khi ship — test/build, migration, RLS, cập nhật tracker; HỎI trước khi push
argument-hint: <mô tả ngắn thay đổi sắp ship>
allowed-tools: Bash(git status:*), Bash(git diff:*)
---

Đọc `@.claude/pm-context.md` và `CLAUDE.md` — đặc biệt phần RÀNG BUỘC AN TOÀN.

# Nhiệm vụ: KIỂM TRA TRƯỚC KHI SHIP

Thay đổi sắp ship: **$ARGUMENTS**

Trạng thái git:
!`git status --short`

Chạy checklist dưới đây, mỗi mục đánh ✅/❌/⚠️ kèm BẰNG CHỨNG (đừng đoán):

1. **Build/Test:** chạy lệnh kiểm tra của repo (xem pm-context). Dán kết quả thật, PASS/FAIL.
2. **Không còn hard-code nghiệp vụ:** nếu chưa chạy `/no-hardcode`, nhắc chạy.
3. **Migration:** có migration mới không? có ADDITIVE (không phá tương thích)? đã áp đúng cách của repo chưa?
4. **Phân quyền / RLS:** thay đổi có nới lỏng quyền ngoài ý muốn? có tự duyệt / rò rỉ chéo cơ sở/đơn vị?
5. **Múi giờ / đồng thời:** nếu đụng ngày giờ hoặc ghi đồng thời — đã xử lý chưa?
6. **Tài liệu/Tracker:** cập nhật tracker tiến độ + `CLAUDE.md` nếu là thay đổi lớn.
7. **Bí mật:** không lộ khóa/mật khẩu trong diff.

## Kết luận
- **SẴN SÀNG SHIP** hay **CHƯA** — nêu lý do.
- Nếu sẵn sàng: **DỪNG LẠI và HỎI người dùng** trước khi `git push` / áp migration (theo ràng buộc an toàn của repo — push = deploy thẳng). Nêu rõ câu lệnh sẽ chạy để người dùng xác nhận.
