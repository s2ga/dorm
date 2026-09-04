# 🏠 Quản lý Ký túc xá (PWA + API + PostgreSQL)

Ứng dụng web (cài được như app – PWA) để quản lý **check-in / check-out** và **tiền phòng** cho học viên ở ký túc xá. Toàn bộ server và cơ sở dữ liệu được **đóng gói trong Docker**, chạy bằng 1 lệnh.

## Tính năng
- **Cơ sở & phòng**: nhiều cơ sở; phòng theo **tầng** và **giới tính** (Nữ tầng 1–2 → pháp nhân *E2*, Nam tầng 3–4 → *S2*, tự gán).
- **Học viên**: hồ sơ, giới tính, dịch vụ đăng ký (máy giặt, gửi xe), **check-in / check-out** kèm lịch sử.
- **Tiền cọc**: ghi nhận cọc khi nhận phòng; khi trả phòng app **tự xét điều kiện hoàn cọc** (báo trước ≥1 tháng, hoặc xuất cảnh đột xuất).
- **Hóa đơn tiền phòng** hàng tháng, tách khoản: tiền phòng, **điện (theo kWh, chia đều)**, nước, dịch vụ, máy giặt, gửi xe.
- **Phiếu thu QR**: trạng thái *Chưa gửi → Đã gửi QR → Đã đóng* (mã QR tạo ở Bravo, gửi Zalo). Xuất Excel (CSV).
- **Cài đặt đơn giá**: chỉnh mọi mức phí và quy tắc ngay trong app.
- **Đăng nhập & phân quyền**: quản lý (admin) và học viên (xem phòng/tiền phòng của mình, tự điểm danh).
- **PWA**: cài lên máy tính / điện thoại, chạy offline phần giao diện.

## Quy tắc tính tiền (mặc định — chỉnh được trong *Cài đặt*)
| Khoản | Mức | Ghi chú |
|---|---|---|
| Tiền phòng | 1.200.000đ/người/tháng | Tháng lẻ: chia theo **số ngày ở thực tế** |
| Cọc | 1.200.000đ | Đóng khi nhận phòng |
| Điện | 3.000đ/kWh | Nhập tổng kWh của phòng → **chia đều** theo số người |
| Nước | 100.000đ/người/tháng | Phí cố định |
| Dịch vụ | 50.000đ/người/tháng | Phí cố định |
| Máy giặt | 70.000đ/tháng | Chỉ khi đăng ký |
| Gửi xe | 100.000đ/tháng | Chỉ khi đăng ký |

**Tháng lẻ (mới vào / sắp rời)** áp dụng cho các phí cố định: ở **≤10 ngày = miễn**, **>10 ngày = 50%**, **>15 ngày = 100%**. Riêng tiền phòng luôn theo số ngày ở; tiền điện luôn theo kWh thực tế.

## Yêu cầu
Chỉ cần cài **Docker Desktop** (Windows/Mac) hoặc Docker Engine + Compose (Linux). Không cần cài Node hay PostgreSQL trên máy.

## Chạy ứng dụng

```bash
# 1. Vào thư mục dự án
cd quan-ly-ktx

# 2. Tạo file cấu hình từ mẫu và chỉnh mật khẩu, chuỗi bí mật
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. Khởi động (lần đầu sẽ build, hơi lâu)
docker compose up -d --build
```

Mở trình duyệt: **http://localhost:3000**

Đăng nhập lần đầu bằng tài khoản trong `.env`:
- Tài khoản: `ADMIN_USERNAME` (mặc định `admin`)
- Mật khẩu: `ADMIN_PASSWORD` (mặc định `admin123`) — **hãy đổi ngay sau khi đăng nhập.**

### Các lệnh thường dùng
```bash
docker compose logs -f app      # xem log ứng dụng
docker compose down             # dừng (dữ liệu vẫn giữ trong volume)
docker compose up -d --build    # cập nhật sau khi sửa code
```

## Cài như một App (PWA)
Mở http://localhost:3000 bằng Chrome/Edge → biểu tượng **Cài đặt** trên thanh địa chỉ → *Cài đặt*. App sẽ có icon riêng, mở như phần mềm.

> Trên điện thoại cần truy cập qua **HTTPS** hoặc địa chỉ IP nội bộ; xem phần "Triển khai" bên dưới.

## Sao lưu dữ liệu
Dữ liệu nằm trong volume `ktx_pgdata`. Sao lưu / phục hồi:
```bash
# Sao lưu ra file
docker exec ktx-db pg_dump -U ktx ktx > backup.sql

# Phục hồi
cat backup.sql | docker exec -i ktx-db psql -U ktx -d ktx
```

## Triển khai cho nhiều thiết bị (LAN / Internet)
- **Trong mạng nội bộ (Wi-Fi công ty):** các máy khác mở `http://<IP-máy-chủ>:3000`.
- **Ra Internet + HTTPS:** đặt sau reverse proxy (Nginx/Caddy) có SSL để PWA cài được trên điện thoại.

## Cấu trúc dự án
```
quan-ly-ktx/
├─ docker-compose.yml      # 2 dịch vụ: app (Node) + db (PostgreSQL)
├─ Dockerfile              # đóng gói server
├─ .env.example            # cấu hình mẫu
├─ server/                 # backend Express + API
│  ├─ index.js  db.js  auth.js  billing.js  schema.sql  gen-icons.js
│  └─ routes/              # auth, settings, facilities, rooms, students,
│                          #   electric, invoices, logs, me
└─ public/                 # frontend PWA
   ├─ index.html  manifest.webmanifest  sw.js
   ├─ css/  js/  icons/
```

## Tài khoản học viên
Khi thêm học viên, tích **"Tạo tài khoản đăng nhập"** (hoặc vào *Chi tiết học viên → Tạo tài khoản*). Học viên đăng nhập tại cùng trang, thấy phòng, tiền phòng và tự điểm danh.
