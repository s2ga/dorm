# ---- Ứng dụng quản lý ký túc xá (Go + Gin + PWA) ----
# Multi-stage: build binary tĩnh rồi bỏ vào image RỖNG (scratch).
#
# BUILD ĐA KIẾN TRÚC KHÔNG CẦN GIẢ LẬP (QEMU):
#   --platform=$BUILDPLATFORM  -> stage build luôn chạy bằng CPU THẬT của máy build.
#   GOARCH=$TARGETARCH         -> Go tự biên dịch chéo ra kiến trúc đích.
# Không có hai thứ này thì khi build cho máy khác kiến trúc (vd máy amd64 build image arm64),
# BuildKit phải chạy cả trình biên dịch Go dưới QEMU: chậm gấp nhiều lần, và máy/CI nào chưa cài
# binfmt thì vỡ ngay với "exec format error".
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
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
EXPOSE 3000
# UID bằng SỐ, không phải tên: scratch không có /etc/passwd nên "nobody" không tra ra được.
# 65534 đúng bằng nobody của alpine và khớp runAsUser trong k8s/helm.
USER 65534:65534
CMD ["/app/ktx"]
