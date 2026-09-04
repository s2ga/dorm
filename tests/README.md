# Bộ test đối kháng

## Bộ test này để làm gì

Tìm **lỗi**, không phải xác nhận code chạy đúng như code được viết.

Mỗi case so sánh với **nghiệp vụ ĐÚNG PHẢI LÀ**, không phải với việc code hiện đang làm gì.
Code làm khác → đó là lỗi, kể cả khi code "chạy đúng ý người viết".

Bộ này ra đời sau vòng test 15/07/2026: 69 test cũ đều xanh trong khi **13 lỗi thật đang nằm trong app**,
vì các test đó viết dựa theo code nên pass bằng chính lỗi của nó.

## Chạy

```bash
npm run services          # mở PostgreSQL + MinIO (Docker)
npm start                 # chạy máy chủ ở cửa khác
npm test                  # chạy hết
npm run test:unit         # chỉ phần không cần máy chủ/CSDL (nhanh, ~1 giây)
npm test -- dien          # chỉ bộ có tên/đường dẫn chứa "dien"
```

Cần biến môi trường `ADMIN_P` = mật khẩu tài khoản `admin` (lấy từ `ADMIN_PASSWORD` trong `.env`):

```bash
ADMIN_P=... PGPASSWORD=ktx_local_secret npm test
```

## CHỈ CHẠY TRÊN MÁY LOCAL

Bộ test **tạo và xoá dữ liệu thật**. Chạy nhầm lên bản demo/thật là **mất sạch, không hoàn tác được**.

`tests/lib/harness.js` chặn cứng: máy chủ và CSDL đều phải là `localhost`, nếu không sẽ thoát ngay.
**Không có cờ nào để tắt kiểm tra này** — đừng thêm vào.

Mọi dữ liệu test đều mang tiền tố `__test_*` và được dọn trong khối `finally`, kể cả khi bộ test vỡ giữa chừng.

## Các bộ

| Tệp | Nội dung | Cần máy chủ |
|---|---|---|
| `unit/billing.test.js` | Lõi tính tiền: chia điện theo ngày ở, cắt chặng theo lần chốt chỉ số, làm tròn, biên ngày tháng | không |
| `e2e/electric.test.js` | TC-10: chuyển phòng / trả phòng giữa tháng — tiền điện có đi đúng người, tổng có rơi mất đồng nào | có |
| `e2e/rooms-validate.test.js` | Luật xếp phòng (giới tính, quá tải, nguyên phòng), kiểm dữ liệu đầu vào, N-01 | có |
| `e2e/security.test.js` | Thu hồi quyền (giáng chức / xoá / đăng xuất), chặn thao tác phá sổ, N-05 | có |

## Hai điều bất biến — hỏng cái nào là mất tiền thật

1. **Tổng khớp tuyệt đối.** Cộng tiền điện của mọi người trong một phòng phải **đúng bằng** tiền điện
   của phòng đó. Không dư, không hụt, kể cả 1 đồng, kể cả khi đơn giá không chia hết.
2. **Không ai rơi khỏi lưới.** Người chuyển phòng giữa tháng vẫn phải trả phần điện đã dùng ở **phòng cũ**.
   Đây chính là lỗi TC-10: trước đây họ trả 0đ và người ở lại gánh thay.

## Nghiệp vụ đã chốt — đừng "sửa" ngược lại

- **Xếp quá tải LÀ ĐƯỢC PHÉP** (chốt 15/07/2026). Học viên vào ở chờ bạn cùng phòng xuất cảnh là
  chuyện bình thường. App phải **cảnh báo + bắt xác nhận + ghi vết ai xếp**, **tuyệt đối không chặn**.
  Từng có người thêm chặn cứng vào đây một lần rồi.
- **Trùng mã học viên KHÔNG phải lỗi.** Mã `Nhân viên` dùng chung cho nhiều người là cố ý.
  Đừng thêm ràng buộc `UNIQUE(code)` — thêm là gãy nghiệp vụ.
- **Chốt chỉ số điện KHÔNG bắt buộc.** Quên nhập thì quay về chia đều cả tháng theo số ngày ở.

## Có một case phải bật riêng

```bash
TEST_BRUTE=1 npm test
```

Case N-05 (đăng nhập sai liên tục phải bị khoá) **cố tình làm khoá IP 15 phút**. Chạy xong thì
chính bộ test cũng không đăng nhập lại được. Khởi động lại máy chủ để xoá bộ đếm.

## Viết thêm case

```js
module.exports = {
  name: 'Tên hiện khi chạy',
  needsServer: true,          // false = lõi thuần, không cần máy chủ/CSDL
  cleanup: t => clean(t.db),  // gọi khi bộ test vỡ giữa chừng
  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    const r = await t.api('POST', '/api/...', T, { ... });
    t.ok('Điều PHẢI đúng về nghiệp vụ', r.status === 400, `HTTP ${r.status} — ${r.json?.error}`);
    t.eq('So khớp chính xác', got, want);
    t.near('Cho lệch vì làm tròn', got, want, 1);
  },
};
```

Đặt tên case theo **nghiệp vụ**, đừng theo hàm: viết *"Người trả phòng 15/07 chỉ trả nửa chặng đầu"*,
đừng viết *"splitElectricExact trả về đúng"*. Người đọc kết quả test là người quản lý, không phải lập trình viên.

Luôn truyền tham số chi tiết cho `t.ok` — nó **in ra cả khi đúng**, để đọc được con số thật thay vì
chỉ thấy một dấu tích xanh vô nghĩa.
