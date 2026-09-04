// Map cột CCCD (đang lưu S3 KEY) -> URL proxy qua app, để client hiển thị được.
// Dùng chung cho students.routes + me.routes -> mọi nơi cùng 1 dạng URL, không rẽ nhánh.
const SIDES = [['cccd_front', 'front'], ['cccd_back', 'back'], ['cccd_image', 'image']];

function cccdUrls(row) {
  if (!row || row.id == null) return row;
  for (const [field, side] of SIDES) {
    const v = row[field];
    // Có key (không phải data:/http) -> URL proxy; ngược lại giữ nguyên (thường là null)
    row[field] = (v && !/^data:/.test(v) && !/^https?:/.test(v))
      ? `/api/students/${row.id}/cccd/${side}`
      : (v || null);
  }
  return row;
}

// Ánh xạ side (front/back/image) -> tên cột (whitelist, chống SQL injection)
const SIDE_COL = { front: 'cccd_front', back: 'cccd_back', image: 'cccd_image' };

module.exports = { cccdUrls, SIDE_COL };
