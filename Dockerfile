# ---- Ứng dụng quản lý ký túc xá (Go + Gin + PWA) ----
# Multi-stage: build binary tĩnh rồi bỏ vào image tối giản.
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
# Binary tĩnh (CGO tắt) — tzdata đã nhúng qua import _ "time/tzdata".
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/ktx ./cmd/server

FROM alpine:3.20
# CỐ Ý KHÔNG có lệnh RUN nào ở stage này.
# Mọi RUN ở stage ĐÍCH phải chạy bằng CPU đích, tức phải qua QEMU khi build chéo — đó đúng là chỗ
# "exec format error" nổ ra (kernel không hiểu định dạng /bin/sh của kiến trúc khác).
# Trước đây ở đây có `apk add --no-cache ca-certificates`, mà dòng đó VỐN DĨ THỪA: image alpine gốc
# đã kèm sẵn /etc/ssl/certs/ca-certificates.crt (gói ca-certificates-bundle) — đủ cho Go gọi HTTPS
# tới Supabase Storage (S3) và Microsoft. Bỏ đi: build nhanh hơn, và hết phụ thuộc vào QEMU.
WORKDIR /app
COPY --from=build /out/ktx /app/ktx
# Frontend tĩnh + schema/migrations (db.Init đọc lúc boot).
COPY public ./public
COPY server/schema.sql ./server/schema.sql
COPY server/migrations ./server/migrations

ENV PORT=3000
EXPOSE 3000
USER nobody
CMD ["/app/ktx"]
