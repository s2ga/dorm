# Helm chart — ứng dụng quản lý ký túc xá

Chart nằm ở [`ktx/`](ktx). Dùng chart khi cần nhiều môi trường (dev/staging/prod) hoặc muốn
`helm rollback`; muốn xem YAML trần thì đọc [`../k8s/`](../k8s).

## Cài

```bash
# Bí mật để NGOÀI git — truyền bằng --set-string hoặc file values riêng
helm upgrade --install ktx ./helm/ktx \
  --namespace ktx --create-namespace \
  --set image.tag=v164 \
  --set-string secret.DATABASE_URL='postgres://user:pass@host:5432/db' \
  --set-string secret.JWT_SECRET="$(openssl rand -hex 32)" \
  --set-string secret.ADMIN_PASSWORD='mat-khau-khoi-tao'
```

Cách sạch hơn — tạo Secret ngoài chart rồi trỏ tên vào, bí mật không nằm trong values cũng không
nằm trong lịch sử release của Helm:

```bash
kubectl -n ktx create secret generic ktx-secret \
  --from-literal=DATABASE_URL='...' \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=ADMIN_PASSWORD='...' \
  --from-literal=S3_ACCESS_KEY='...' --from-literal=S3_SECRET_KEY='...'

helm upgrade --install ktx ./helm/ktx -n ktx --set existingSecret=ktx-secret
```

Mở ra Internet:

```bash
helm upgrade --install ktx ./helm/ktx -n ktx \
  --set existingSecret=ktx-secret \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=ktx.congty.vn \
  --set ingress.tls[0].secretName=ktx-tls \
  --set ingress.tls[0].hosts[0]=ktx.congty.vn
```

Kiểm tra trước khi cài thật:

```bash
helm lint ./helm/ktx
helm template ktx ./helm/ktx --set existingSecret=ktx-secret | kubectl apply --dry-run=client -f -
```

## Những chỗ chart cố ý làm khác mặc định

| Chỗ | Làm gì | Vì sao |
|---|---|---|
| `replicaCount: 1` + `Recreate` | chỉ một pod, pod cũ chết hẳn rồi mới bật pod mới | app tự áp `schema.sql` + `migrations/*.sql` lúc khởi động; hai pod bật cùng lúc là hai tiến trình cùng vá lược đồ trên một CSDL |
| liveness dùng **TCP** | không dùng `/api/health` | endpoint đó cố ý trả **503** khi CSDL chết (MON-01). Lấy làm liveness thì CSDL sập là cả cụm CrashLoop, mà restart không cứu được CSDL |
| readiness dùng `/api/health` | có chạm CSDL | CSDL sập thì rút pod khỏi Service — đúng, vì nó không phục vụ nổi |
| `startupProbe` 12×5s | cho boot tối đa 60s | boot phải áp schema + chạy migration |
| `TZ=Asia/Ho_Chi_Minh` | ép múi giờ VN | container mặc định UTC, mà nghiệp vụ tính theo NGÀY (chốt công-tơ, số ngày ở) — lệch giờ là lệch tiền |
| không đặt `limits.cpu` | chỉ giới hạn bộ nhớ | bóp CPU của Go chỉ kéo dài đuôi độ trễ, không bảo vệ được gì |
| `readOnlyRootFilesystem: true` | gắn thêm emptyDir `/tmp` | app không ghi xuống đĩa, ảnh tải lên đi thẳng S3 |
| `automountServiceAccountToken: false` | không gắn token vào pod | app không gọi API của Kubernetes |

## Biến bắt buộc

`DATABASE_URL` và `JWT_SECRET` (≥16 ký tự). Thiếu là app **thoát ngay lúc khởi động** chứ không chạy
nửa vời — xem `internal/config/config.go`. Danh sách đầy đủ ở `values.yaml` (mục `config` và `secret`).
