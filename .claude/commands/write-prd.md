---
description: Viết PRD song ngữ ngắn gọn, có acceptance criteria, đúng bối cảnh dự án
argument-hint: <tên tính năng — để trống nếu nối tiếp /discover>
---

Đọc `@.claude/pm-context.md` và `CLAUDE.md` để nắm bối cảnh.

# Nhiệm vụ: VIẾT PRD

Chủ đề: **$ARGUMENTS** (nếu trống, dùng bài toán vừa chốt ở `/discover`).

Viết một PRD NGẮN, dùng được ngay cho dự án này — không phải PRD mẫu chung chung. Tôn trọng mọi ràng buộc trong pm-context (không hard-code, phân quyền, migration additive, deadline).

## Cấu trúc PRD (tiếng Việt, tiêu đề mục kèm tiếng Anh)
1. **Bối cảnh & Vấn đề (Context & Problem)** — 2–3 câu, vì sao cần làm.
2. **Mục tiêu / Ngoài phạm vi (Goals / Non-goals)** — nói rõ cái KHÔNG làm.
3. **Người dùng & Vai trò (Users & Roles)** — ai làm gì, cơ sở/đơn vị nào thấy gì.
4. **Luồng chính (Main flow)** — các bước; nêu trạng thái nếu có máy trạng thái.
5. **Yêu cầu chức năng (Functional requirements)** — đánh số R1, R2…
6. **Tiêu chí chấp nhận (Acceptance criteria)** — dạng Cho/Khi/Thì (Given/When/Then), kiểm chứng được.
7. **Dữ liệu & Ảnh hưởng kỹ thuật** — bảng/cột/RPC đụng tới; **có cần migration không** (phải additive); **có đụng RLS/phân quyền không**.
8. **Cấu hình (Settings)** — mọi ngưỡng/giá trị nghiệp vụ phải là setting, KHÔNG hard-code. Liệt kê chúng ở đây.
9. **Rủi ro & Câu hỏi mở** — kể cả rủi ro tiến độ so với deadline.

Ưu tiên rõ ràng hơn dài dòng. Mặc định chỉ in ra để duyệt; nếu người dùng muốn lưu vào `docs/` thì hỏi tên file.

> Xong PRD, gợi ý chạy **`/red-team-prd`** để tự phản biện trước khi code.
