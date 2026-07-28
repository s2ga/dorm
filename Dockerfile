# ---- Ứng dụng quản lý ký túc xá (Go + Gin + PWA) ----
# Multi-stage: build binary tĩnh rồi bỏ vào image RỖNG (scratch).
#
# BUILD ĐA KIẾN TRÚC KHÔNG CẦN GIẢ LẬP (QEMU):
#   --platform=$BUILDPLATFORM  -> stage build luôn chạy bằng CPU THẬT của máy build.
#   GOARCH=$TARGETARCH         -> Go tự biên dịch chéo ra kiến trúc đích.
# Không có hai thứ này thì khi build cho máy khác kiến trúc (vd máy amd64 build image arm64),
# BuildKit phải chạy cả trình biên dịch Go dưới QEMU: chậm gấp nhiều lần, và máy/CI nào chưa cài
# binfmt thì vỡ ngay với "exec format error".
# Ghim tới bản vá cụ thể, không dùng tag trôi (golang:1.26-alpine). Tag trôi nghĩa là hôm nay và
# tháng sau build ra hai binary khác nhau mà không ai đổi một dòng mã — hỏng thì không biết tại code
# hay tại trình biên dịch vừa nhảy phiên bản. Nâng phiên bản là một commit có chủ đích.
FROM --platform=$BUILDPLATFORM golang:1.26.5-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# TARGETOS/TARGETARCH: BuildKit tự truyền vào theo --platform (bỏ trống = giống máy đang build).
ARG TARGETOS
ARG TARGETARCH
# Binary TĨNH: CGO tắt nên không cần libc trong image cuối; tzdata nhúng sẵn qua
# import _ "time/tzdata" (internal/timeutil) nên không cần /usr/share/zoneinfo.
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/ktx ./cmd/server

# ---- Image cuối: RỖNG HOÀN TOÀN ----
# Không shell, không trình quản lý gói, không tiện ích nào. Có gì trong đây là do ta COPY vào, nên
# bề mặt tấn công gần như bằng không và cũng không còn CVE của distro để vá.
# Đánh đổi phải biết trước: KHÔNG `docker exec`/`kubectl exec` vào xem được nữa (không có sh).
# Chẩn đoán bằng: nhật ký (RequestLog + serverErr đã in ra stdout), /api/health, và
# `kubectl debug -it <pod> --image=alpine --target=ktx` khi thật sự cần soi bên trong.
FROM scratch

# Bó chứng chỉ gốc — Go cần để xác thực HTTPS tới Supabase Storage (S3) và Microsoft (JWKS/SSO).
# Lấy từ stage build (chạy trên máy build): đây là tệp VĂN BẢN, không phụ thuộc kiến trúc.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# /tmp: scratch không có sẵn thư mục nào. Go ghi tạm vào đây khi biểu mẫu nhiều phần vượt ngưỡng bộ
# nhớ (tải ảnh CCCD). Mở quyền ghi cho mọi UID vì tiến trình chạy bằng 65534, không phải root.
# (Đã kiểm bằng `docker export`: thư mục ra đúng drwxrwxrwx. Bit sticky không được giữ qua COPY —
# không sao, container này chỉ có MỘT UID nên sticky chẳng bảo vệ ai.)
COPY --from=build --chmod=777 /tmp /tmp

WORKDIR /app
COPY --from=build /out/ktx /app/ktx
# Frontend tĩnh + schema/migrations (db.Init đọc lúc boot).
COPY public ./public
COPY server/schema.sql ./server/schema.sql
COPY server/migrations ./server/migrations

ENV PORT=3000
# TZ ngay trong image, không trông chờ nơi triển khai truyền vào. BLK-5: container mặc định chạy UTC,
# mà nghiệp vụ tính theo NGÀY giờ Việt Nam (chốt công-tơ, số ngày ở, hạn hợp đồng) — quên đặt là
# lệch ngày, tức lệch tiền, và sai kiểu đó rất khó thấy. Có mặc định đúng thì nơi nào cần khác vẫn
# ghi đè được bằng ENV. Chạy được trên scratch vì tzdata đã nhúng trong binary (internal/timeutil).
ENV TZ=Asia/Ho_Chi_Minh
EXPOSE 3000
# UID bằng SỐ, không phải tên: scratch không có /etc/passwd nên "nobody" không tra ra được.
# 65534 đúng bằng nobody của alpine và khớp runAsUser trong k8s/helm.
USER 65534:65534

# ENTRYPOINT chứ không phải CMD. Khác nhau ở chỗ:
#   CMD        = lệnh mặc định, `docker run image <gì đó>` THAY LUÔN nó.
#   ENTRYPOINT = chương trình cố định, phần thêm vào trở thành THAM SỐ của chương trình đó.
# Image này chỉ có đúng một việc, và là scratch nên bên trong chẳng còn gì khác để chạy: lỡ tay
# `docker run image sh` thì với CMD sẽ chết khó hiểu ("exec: sh: not found"), còn với ENTRYPOINT thì
# "sh" chỉ là tham số dư của app. App không đọc cờ dòng lệnh nào (chỉ cấu hình qua ENV) nên không
# cần CMD đi kèm để làm tham số mặc định.
# Trong Kubernetes: `command:` mới ghi đè ENTRYPOINT, `args:` ghi đè CMD — manifest ở k8s/ và
# helm/ đều không đặt cái nào, nên vẫn chạy đúng lệnh này.
ENTRYPOINT ["/app/ktx"]
