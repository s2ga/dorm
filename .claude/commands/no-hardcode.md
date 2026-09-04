---
description: Quét diff hiện tại, tố cáo mọi ngưỡng/giá trị nghiệp vụ bị hard-code lẽ ra phải là setting
argument-hint: <để trống để quét git diff, hoặc nêu file/thư mục>
allowed-tools: Bash(git diff:*), Bash(git status:*)
---

Đọc `@.claude/pm-context.md` và `CLAUDE.md` để biết nơi đặt cấu hình của dự án này.

# Nhiệm vụ: SĂN HARD-CODE

Phạm vi quét: **$ARGUMENTS** (nếu trống, quét thay đổi chưa commit).

Tóm tắt thay đổi:
!`git diff --stat`

Chi tiết:
!`git diff`

## Việc cần làm
Rà phần code trên, chỉ ra mọi giá trị NGHIỆP VỤ bị nhét cứng lẽ ra phải nằm trong settings/constants/DB:
- ngưỡng tiền, hạn mức, số ngày, tỉ lệ %, giới hạn, SLA
- vai trò/quyền viết thẳng trong logic thay vì tra cấu hình
- chuỗi hiển thị/nhãn lẽ ra ở nơi tập trung (theo quy ước repo)
- URL/khóa/định danh môi trường nhét cứng

Với mỗi phát hiện: `file:dòng` → giá trị gì → vì sao nên tách → tách vào đâu (đúng nơi cấu hình của repo trong pm-context).

Bỏ qua hằng số kỹ thuật thật sự cố định (mã HTTP, hằng toán học). Chỉ nhắm giá trị NGHIỆP VỤ dễ đổi.
Nếu sạch, nói rõ "không thấy hard-code nghiệp vụ".

> Xong, gợi ý chạy **`/ship-check`** để kiểm tra trước khi phát hành.
