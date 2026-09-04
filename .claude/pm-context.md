# PM-CONTEXT — quan-ly-ktx (App Quản lý Ký túc xá Nội trú Esuhai)

> Bối cảnh cho bộ lệnh PM (`/discover`, `/write-prd`, `/red-team-prd`, `/no-hardcode`, `/ship-check`).
> Chi tiết kỹ thuật đầy đủ ở `CLAUDE.md` (đã tự nạp mỗi phiên) — file này chỉ thêm lăng kính PM.

## Một câu
PWA + Express + PostgreSQL quản lý ký túc xá nội trú: check-in/out, tiền phòng, tiền điện, đơn từ, vi phạm, bảo trì, xe, trực nhật. UI 100% tiếng Việt.

## Đang ở đâu (cập nhật 2026-07-18)
- **Chuẩn bị GO-LIVE production, mục tiêu trước 06/08/2026.**
- Mảng tài chính (QR/phiếu thu) = **Giai đoạn 2**, đã gỡ khỏi app (nhánh `feature/finance-qr`).
- `npm test` hiện **256 PASS**.

## ⚠️ RỦI RO SỐ 1
- **Đa cơ sở** — BẮT BUỘC có trong bản go-live nhưng chưa hoàn tất: mỗi cơ sở 1 quản lý; học viên chỉ thấy cơ sở mình; chỉ điều hành thấy tổng. Mọi `/write-prd` và `/red-team-prd` phải soi kỹ trục **"rò rỉ chéo cơ sở"** và **"quản lý cơ sở có làm được việc điều hành không"**.
- BLK-6 backup CSDL (Supabase PITR + cron) do **system admin** lo khi lên prod — KHÔNG phải lỗi chặn của dev app.

## Vai trò
Học viên · Quản lý cơ sở · Điều hành (thấy tổng) · Admin.

## Nơi đặt cấu hình (để KHÔNG hard-code)
- Ngưỡng nghiệp vụ (đơn giá điện, hạn ngày, giới hạn…) phải nằm trong **settings/DB**, KHÔNG viết cứng trong logic.
- Schema: `server/schema.sql` (boot tự áp — **không có migration đánh số**; đổi schema phải ADDITIVE, tương thích DB staging đang chạy).
- Logic dùng chung ở `server/` (`billing.js`, `invoice-calc.js`, `valid.js`, `auth.js`…); routes ở `server/routes/*.routes.js`.

## Lệnh kiểm tra (dùng trong /ship-check)
- Test: `npm test` (= `node tests/run.js`) — **PHẢI PASS** trước khi coi là xong.
- Chạy local: `npm run services` → `npm run dev` → http://localhost:3000.

## Ràng buộc an toàn (dùng trong /ship-check)
- **PHẢI HỎI user trước khi `git push`** — Render `autoDeploy: true`, push = lên staging NGAY.
- Test phá hoại chỉ chạy LOCAL, không bắn request vào `ktx-tnh.onrender.com`.
- **KHÔNG đụng** Supabase project TTB `jaktkfycrgjhjusdgnhc` (khác dự án). DB của KTX là `sceuwqrpyungzkhohmvj`.

## Nguồn tiến độ (tracker)
`docs/PM-TRACKER.md` — cập nhật khi có thay đổi lớn.
