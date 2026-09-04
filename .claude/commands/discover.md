---
description: Đào nhu cầu thô thành bài toán rõ ràng (ai dùng, vấn đề gì, "xong" nghĩa là gì) trước khi viết PRD
argument-hint: <mô tả tính năng/vấn đề cần làm>
---

Đọc `@.claude/pm-context.md` và `CLAUDE.md` để nắm bối cảnh dự án trước khi bắt đầu.

# Nhiệm vụ: KHÁM PHÁ (Discover)

Yêu cầu thô từ người dùng: **$ARGUMENTS**

Bạn đang đóng vai Product Manager. KHÔNG viết giải pháp hay PRD vội — nhiệm vụ bây giờ là làm rõ BÀI TOÁN.

## Cách làm
1. Diễn giải lại yêu cầu bằng 1–2 câu để chắc chắn hiểu đúng.
2. Nếu còn mơ hồ, HỎI TỐI ĐA 3 câu quan trọng nhất — ưu tiên câu mà câu trả lời làm THAY ĐỔI thiết kế (ai dùng, cơ sở/đơn vị nào, ràng buộc quyền, mốc thời gian). Đừng hỏi cho có.
3. Đối chiếu bối cảnh dự án: tính năng chạm vai trò nào? cơ sở/đơn vị nào? có đụng ngưỡng nghiệp vụ, phân quyền/RLS, hay migration không?

## Kết quả trả về (ngắn gọn, tiếng Việt)
- **Bài toán:** vấn đề thực sự cần giải (không phải giải pháp)
- **Ai dùng / vai trò:** …
- **Phạm vi cơ sở/đơn vị:** …
- **Tiêu chí "XONG":** 3–5 gạch đầu dòng có thể kiểm chứng
- **Chưa rõ / giả định:** liệt kê thẳng
- **Rủi ro sớm:** đụng phân quyền? migration? deadline?

> Xong bước này, gợi ý người dùng chạy tiếp **`/write-prd`** để biến bài toán thành PRD.
