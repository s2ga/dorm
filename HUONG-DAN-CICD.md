# CI/CD: Push code → tự build & deploy

Luồng: **git push** → GitHub Actions **build Docker image** → đẩy vào **GHCR** (`ghcr.io/thuyhienvo/ktx-tnh`) → gọi **Deploy Hook của Render** → Render kéo image mới và chạy.

File workflow: `.github/workflows/deploy.yml` (đã có sẵn).

## Cấu hình một lần (sau đó tự động mãi)

**1. Để GitHub Action build image**
Không cần làm gì thêm — dùng `GITHUB_TOKEN` sẵn có. Sau lần push đầu, vào **repo → tab Actions** xem build; xong image nằm ở **repo → Packages**.

**2. Cho Render kéo được image từ GHCR**
Vào **repo → Packages → `ktx-tnh` → Package settings → Change visibility → Public**
(Hoặc để Private thì phải khai báo thông tin đăng nhập GHCR trong Render — Public là đơn giản nhất; image chỉ chứa **code**, không chứa dữ liệu/khoá.)

**3. Tạo web service kiểu Image trên Render**
- Render → **New +** → **Web Service** → **Deploy an existing image**.
- Image URL: `ghcr.io/thuyhienvo/ktx-tnh:latest`
- Region: **Singapore**, Plan: **Free**.
- Biến môi trường (Environment):
  - `DATABASE_URL` = internal connection string của Postgres **ktx-db** (lấy ở trang DB đó).
  - `JWT_SECRET` = một chuỗi ngẫu nhiên dài.
  - `ADMIN_USERNAME` = `admin`
  - `ADMIN_PASSWORD` = mật khẩu quản trị bạn chọn.
- Health Check Path: `/api/health`.

**4. Lấy Deploy Hook & gắn vào GitHub**
- Trong service vừa tạo → **Settings → Deploy Hook** → copy URL.
- Vào **repo → Settings → Secrets and variables → Actions → New repository secret**:
  - Name: `RENDER_DEPLOY_HOOK_URL`
  - Value: dán URL vừa copy.

## Xong!
Từ giờ mỗi lần **push lên `main`** (hoặc bấm Run trong tab Actions), hệ thống tự: build → đẩy GHCR → deploy Render. Không cần bấm tay.

---

# Ảnh phát hành: đẩy TAG → build → GHCR

Hai luồng khác nhau, đừng lẫn:

| | Push commit lên `main` | **Đẩy tag `vNN`** |
|---|---|---|
| Workflow | `.github/workflows/deploy.yml` | `.github/workflows/release-image.yml` |
| Tag ảnh | `:latest` + `:<sha>` | `:vNN` + `:sha-<sha>` |
| Kiến trúc | amd64 | **amd64 + arm64** |
| Dùng cho | staging Render (tự deploy) | **UAT / production trên Kubernetes** |

Cách dùng:

```bash
git tag v168
git push origin v168        # CHỈ đẩy tag, không phải push commit
```

Xong, ảnh nằm ở `ghcr.io/thuyhienvo/ktx-tnh:v168`. Tab **Actions** của lần chạy đó in sẵn digest và
lệnh `kubectl set image` để dán.

### Bốn chốt chặn trong workflow này

1. **Cổng test** — `go build` + `go vet` + `go test` chạy trước khi build ảnh. Tag có thể trỏ vào
   commit chưa từng qua CI (nhánh phụ, commit cũ, tag đặt tay), nên phải kiểm lại.
2. **Đối chiếu tag với phiên bản asset** — tag `v168` bắt buộc khớp `?v=168` trong `index.html` và
   `ktx-shell-v168` trong `sw.js`. Lệch là **dừng**: deploy xong trình duyệt vẫn giữ asset cũ trong
   cache service worker → server mới, giao diện cũ, cực khó lần ra. (Tag không theo dạng `vNN` thì
   bỏ qua bước này.)
3. **Chặn ghi đè tag đã có** — GHCR cho phép ghi đè, nhưng k8s đang dùng `imagePullPolicy: IfNotPresent`
   nên node đã cache tag đó sẽ KHÔNG kéo lại: cụm chạy hai phiên bản khác nhau dưới cùng một tên.
   Tag đã tồn tại thì workflow dừng, buộc đặt tag mới.
4. **Ghi nhận tag có nằm trên `main` hay không** — không chặn, chỉ cảnh báo, vì bản không nằm trên
   `main` thì chưa qua cổng DOM smoke.

### Vì sao không có `:latest` ở luồng tag

Tag phát hành phải cố định để rollback biết quay về đâu. `:latest` là tag di động — dùng nó với
`imagePullPolicy: IfNotPresent` là tự tạo ra tình trạng "không biết đang chạy bản nào".

### Lần đầu dùng ảnh trên Kubernetes

Mở **repo → Packages → `ktx-tnh` → đổi visibility sang Public**, hoặc khai `imagePullSecret` cho
namespace `dorm`.

> Ghi chú: service kiểu **git-build** cũ (`ktx-tnh`) có thể xoá đi sau khi service **image** chạy ổn (dùng chung Postgres `ktx-db`).
