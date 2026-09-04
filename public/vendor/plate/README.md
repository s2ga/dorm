# Bộ đọc biển số xe — chạy trên máy người dùng

Các tệp trong thư mục này là **thư viện bên thứ ba**, không phải mã của dự án. Chúng chỉ được tải
khi an ninh mở màn "Quét camera" ở Điểm danh bãi xe, và được service worker giữ lại sau lần đầu
(xem nhánh `/vendor/` trong `public/sw.js`).

| Tệp | Dung lượng | Nguồn | Giấy phép |
|---|---|---|---|
| `ort.wasm.min.js` | 0,05 MB | [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) v1.27.0 | MIT |
| `ort-wasm-simd-threaded.mjs` | 0,02 MB | onnxruntime-web v1.27.0 | MIT |
| `ort-wasm-simd-threaded.wasm` | 12,86 MB | onnxruntime-web v1.27.0 | MIT |
| `plate-ocr.onnx` | 2,02 MB | [fast-plate-ocr](https://github.com/ankandrew/fast-plate-ocr) — model `cct-xs-v1-global` | MIT |

## Vì sao chọn model này

Đo trên 5 ảnh biển xe máy Việt Nam thật (biển 2 dòng), chụp bằng điện thoại:

| Bộ đọc | Đọc đúng nguyên chuỗi | Tốc độ |
|---|---|---|
| Tesseract | 0/5 | 142 ms |
| RapidOCR (PaddleOCR ONNX) | 4/5 | 975 ms |
| **fast-plate-ocr `cct-xs`** | **5/5** | **26 ms** |

## Vài điều cần biết trước khi sửa

- Dùng bản **chỉ-WASM** (`ort.wasm.min.js`), KHÔNG dùng bundle `ort.min.js`: bundle đó đòi thêm tệp
  `*.jsep.wasm` 25 MB cho WebGPU mà ta không dùng tới.
- Đường dẫn `.mjs`/`.wasm` được **ghim tường minh** trong `pkNapOrt()`; để ORT tự đoán là nó đi tìm
  biến thể không có ở đây.
- Model nhận ảnh **uint8** kích thước 128×64, thứ tự NHWC; trả về 9 ô × 37 lớp
  (bảng chữ `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_`).
- CSP phải có `'wasm-unsafe-eval'` trong `script-src`, nếu không trình duyệt chặn thẳng.
  `tests/unit/quet-bien-so.test.js` canh cả ba thứ này.

Nâng cấp phiên bản thì nhớ bump `?v=NN` trong `index.html` + `ktx-shell-vNN` trong `sw.js`.
