---
description: Tự phản biện PRD — tìm lỗ hổng nghiệp vụ, bảo mật/RLS/leo quyền, và ca biên
argument-hint: <để trống nếu nối tiếp /write-prd, hoặc dán/đường dẫn PRD>
---

Đọc `@.claude/pm-context.md` và `CLAUDE.md`.

# Nhiệm vụ: RED-TEAM PRD (đóng vai kẻ phá)

Đối tượng: PRD vừa viết ở `/write-prd`, hoặc: **$ARGUMENTS**

Bạn KHÔNG bênh vực PRD. Nhiệm vụ là ĐÁNH SẬP nó trên giấy trước khi nó sập trên production. Với mỗi lỗ hổng, mô tả kịch bản cụ thể (input/trạng thái → hậu quả) và mức độ.

## Các trục tấn công (bám theo pm-context)
1. **Nghiệp vụ:** luồng bỏ sót trạng thái? ai đó bỏ qua được bước duyệt? ngưỡng tính sai (trước/sau thuế, ranh giới `=`)?
2. **Phân quyền / Bảo mật / RLS:** vai trò nào tự leo quyền? tự duyệt đơn của mình? đọc/sửa dữ liệu cơ sở/đơn vị khác? gọi thẳng RPC bỏ qua UI? file/đính kèm lộ công khai?
3. **Đồng thời & Thời gian:** hai người thao tác cùng lúc (race)? sinh mã trùng khi chèn nhiều dòng? sai múi giờ (Asia/Ho_Chi_Minh)? mốc ngày/cửa sổ thời gian lệch?
4. **Đa cơ sở / Đa đơn vị:** người cơ sở này thấy dữ liệu cơ sở kia? quản lý cơ sở làm được việc của điều hành?
5. **Migration & Dữ liệu cũ:** migration phá tương thích ngược? backfill sai? dữ liệu rỗng lúc chạy?
6. **Tiến độ:** phạm vi này có kịp deadline không, hay nên cắt?

## Kết quả (xếp theo mức độ, nặng nhất trước)
Bảng: **# | Lỗ hổng | Kịch bản cụ thể | Mức độ (Chặn/Cao/TB/Thấp) | Đề xuất vá**.
Kết lại: PRD này **NÊN / CHƯA NÊN** đem code, và cần sửa gì trước.

> Nếu PRD sống sót thì bắt tay code. Trước khi ship, chạy **`/no-hardcode`** rồi **`/ship-check`**.
