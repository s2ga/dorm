# Ảnh trang giới thiệu khu nội trú

## Cách 1 (khuyến nghị): Upload ngay trong app
Đăng nhập quản lý → **Cài đặt** → mục **"Ảnh khu nội trú (trang giới thiệu)"** →
bấm **Chọn ảnh** cho từng vị trí. Ảnh lưu trong CSDL, **bền vững qua deploy**, không cần sửa code.

## Cách 2: Đặt file vào thư mục này
Đặt ảnh **đúng tên file** bên dưới. Trang giới thiệu (`/dang-ky`) sẽ tự hiển thị.
Nếu thiếu file nào, chỗ đó hiện ô placeholder (không lỗi). Lưu ý: trên Render, file đặt tay
có thể **mất khi deploy lại** — nên ưu tiên Cách 1.

| Tên file | Vị trí hiển thị | Kích thước khuyên dùng |
|---|---|---|
| `hero.jpg` | Ảnh nền lớn đầu trang (toàn cảnh khu nội trú) | ngang, ~1600×900 |
| `khuon-vien-1.jpg` | Khuôn viên | ~800×600 |
| `khuon-vien-2.jpg` | Sảnh sinh hoạt chung | ~800×600 |
| `khuon-vien-3.jpg` | Khu tự học | ~800×600 |
| `phong-1.jpg` | Phòng ghép | ~800×600 |
| `phong-2.jpg` | Nội thất phòng | ~800×600 |
| `phong-3.jpg` | Khu vệ sinh | ~800×600 |

Gợi ý:
- Dùng ảnh `.jpg` (nhẹ) đã nén, mỗi ảnh nên < 400KB để trang tải nhanh.
- Muốn đổi nhãn/thứ tự ảnh: sửa hàm `renderPublicRegister` trong `public/js/app.js`.
- Ảnh CCCD học viên upload khi đăng ký KHÔNG lưu vào đây (lưu trong CSDL).
