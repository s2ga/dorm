# Ứng dụng quản lý ký túc xá (Go + Gin + PWA). Multi-stage: build binary tĩnh -> image scratch.

# --platform=$BUILDPLATFORM + GOARCH=$TARGETARCH: biên dịch chéo bằng CPU máy build, không cần QEMU.
FROM --platform=$BUILDPLATFORM golang:1.26.5-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/ktx ./cmd/server

FROM scratch

# Bó chứng chỉ gốc cho HTTPS tới Supabase Storage và Microsoft. Tệp văn bản, không phụ thuộc kiến trúc.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# /tmp cho biểu mẫu nhiều phần vượt ngưỡng bộ nhớ (tải ảnh CCCD). chmod 777 vì chạy bằng UID 65534.
COPY --from=build --chmod=777 /tmp /tmp

WORKDIR /app
COPY --from=build /out/ktx /app/ktx
COPY public ./public
COPY server/schema.sql ./server/schema.sql
COPY server/migrations ./server/migrations

ENV PORT=3000
ENV TZ=Asia/Ho_Chi_Minh
# Gin mặc định chạy debug: in cả bảng định tuyến ra log lúc boot.
ENV GIN_MODE=release
EXPOSE 3000
# UID bằng SỐ: scratch không có /etc/passwd nên tên "nobody" không tra ra được.
USER 65534:65534
ENTRYPOINT ["/app/ktx"]
