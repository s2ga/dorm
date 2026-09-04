# Đưa app KTX TNH lên đám mây (Render – miễn phí)

Mục tiêu: có một link **https://…** luôn truy cập được để gửi sếp/đồng nghiệp, không cần bật máy cá nhân.

> ⚠️ **Lưu ý dữ liệu:** app chứa thông tin thật của học viên (tên, SĐT, CCCD). Đưa lên máy chủ nước ngoài (Render) nên **được công ty/IT đồng ý** trước. Có thể deploy với dữ liệu mẫu để demo, rồi nhập dữ liệu thật sau khi được duyệt.

## Các bước (khoảng 15–20 phút)

**1. Tạo tài khoản GitHub** (nếu chưa có) tại github.com → tạo 1 repository mới (Private), ví dụ tên `ktx-tnh`.

**2. Đưa code lên GitHub**
Trong thư mục `quan-ly-ktx` (đã có sẵn Git), chạy:
```
git remote add origin https://github.com/<tên-bạn>/ktx-tnh.git
git branch -M main
git push -u origin main
```
(Bước này AI có thể làm giúp nếu bạn tạo repo và đăng nhập GitHub.)

**3. Tạo tài khoản Render** tại render.com → đăng nhập bằng chính GitHub (1 cú bấm).

**4. Deploy**
- Bấm **New +** → **Blueprint**.
- Chọn repo `ktx-tnh`. Render tự đọc file `render.yaml` → tạo **web service + PostgreSQL**.
- Ở phần biến môi trường, đặt **ADMIN_PASSWORD** = mật khẩu quản trị bạn muốn.
- Bấm **Apply** → đợi ~5–10 phút build xong.

**5. Nhận link** dạng `https://ktx-tnh.onrender.com` → đăng nhập `admin` + mật khẩu vừa đặt.

**6. Nhập dữ liệu** (AI làm giúp): trỏ công cụ nhập vào link cloud để tạo phòng + học viên + điện + hóa đơn từ file Excel.

## Lưu ý gói miễn phí
- Web service “ngủ” khi không dùng → lần mở đầu chờ ~50 giây rồi chạy bình thường.
- PostgreSQL miễn phí của Render có hạn (hết hạn sau ~90 ngày) → khi dùng thật nên nâng gói trả phí (khoảng vài USD/tháng) để có sao lưu tự động.
