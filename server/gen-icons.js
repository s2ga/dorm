// Sinh icon PNG cho PWA (chạy trong Node, không cần công cụ ngoài).
// Vẽ biểu tượng "ngôi nhà" đơn giản rồi mã hóa PNG bằng zlib có sẵn của Node.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Điểm nằm trong tam giác?
function inTri(px, py, a, b, c) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const s = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
  const t = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
  return s >= 0 && t >= 0 && s + t <= 1;
}

function drawIcon(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const u = size;
  const pad = maskable ? 0 : u * 0.02;
  const radius = maskable ? 0 : u * 0.22;
  // Tọa độ ngôi nhà (theo tỉ lệ), thu nhỏ chút cho maskable để nằm trong vùng an toàn
  const k = maskable ? 0.82 : 1;
  const off = (1 - k) / 2;
  const P = (fx, fy) => [u * (off + fx * k), u * (off + fy * k)];
  const roofA = P(0.5, 0.20), roofB = P(0.20, 0.485), roofC = P(0.80, 0.485);
  const body = { x0: u * (off + 0.29 * k), y0: u * (off + 0.465 * k), x1: u * (off + 0.71 * k), y1: u * (off + 0.79 * k) };
  const door = { x0: u * (off + 0.44 * k), y0: u * (off + 0.615 * k), x1: u * (off + 0.56 * k), y1: u * (off + 0.79 * k) };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Nền + bo góc
      let inBg = true;
      if (!maskable) {
        if (x < pad || y < pad || x > u - pad || y > u - pad) inBg = false;
        const corners = [[pad + radius, pad + radius], [u - pad - radius, pad + radius], [pad + radius, u - pad - radius], [u - pad - radius, u - pad - radius]];
        for (const [cx, cy] of corners) {
          const inX = (cx < u / 2 && x < cx) || (cx > u / 2 && x > cx);
          const inY = (cy < u / 2 && y < cy) || (cy > u / 2 && y > cy);
          if (inX && inY && Math.hypot(x - cx, y - cy) > radius) inBg = false;
        }
      }
      if (!inBg) { set(x, y, 0, 0, 0, 0); continue; }
      set(x, y, 232, 114, 44, 255); // cam #e8722c

      // Cửa sổ
      if ((x >= u * (off + 0.345 * k) && x <= u * (off + 0.435 * k) && y >= u * (off + 0.525 * k) && y <= u * (off + 0.615 * k)) ||
          (x >= u * (off + 0.565 * k) && x <= u * (off + 0.655 * k) && y >= u * (off + 0.525 * k) && y <= u * (off + 0.615 * k))) {
        set(x, y, 247, 201, 166, 255); continue;
      }
      // Cửa chính
      if (x >= door.x0 && x <= door.x1 && y >= door.y0 && y <= door.y1) { set(x, y, 232, 114, 44, 255); continue; }
      // Thân nhà
      if (x >= body.x0 && x <= body.x1 && y >= body.y0 && y <= body.y1) { set(x, y, 255, 255, 255, 255); continue; }
      // Mái nhà
      if (inTri(x, y, roofA, roofB, roofC)) { set(x, y, 255, 255, 255, 255); }
    }
  }
  return encodePNG(size, px);
}

function generateIcons() {
  const dir = path.join(__dirname, '..', 'public', 'icons');
  fs.mkdirSync(dir, { recursive: true });
  const targets = [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['maskable-512.png', 512, true],
  ];
  for (const [name, size, maskable] of targets) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, drawIcon(size, maskable));
    console.log('🎨 Tạo icon', name);
  }
}

module.exports = { generateIcons };

if (require.main === module) generateIcons();
