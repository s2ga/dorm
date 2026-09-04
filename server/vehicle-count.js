const { query } = require('./db');

// Đếm số xe ĐANG hiệu lực trong THÁNG (YYYY-MM) của một học viên — dùng chung cho MỌI đường
// tính hoá đơn, để tính lại tháng cũ không lấy số xe hôm nay (V2-23).
// Xe được tính cho tháng M nếu: đăng ký từ trước/khi trong M (from_date <= cuối M) VÀ chưa gỡ
// trước M (to_date rỗng hoặc >= đầu M). KHÔNG lọc deleted_at: xe đã gỡ vẫn tính cho các tháng
// nó còn hiệu lực (to_date lo ranh giới đó).
const WHERE_MONTH = `
  COALESCE(from_date, created_at::date) <= (date_trunc('month',$MONTH::date) + interval '1 month - 1 day')::date
  AND (to_date IS NULL OR to_date >= $MONTH::date)`;

async function countForMonth(studentId, month, q = query) {
  const sql = `SELECT COUNT(*)::int c FROM vehicles WHERE student_id=$1 AND ` + WHERE_MONTH.replace(/\$MONTH/g, '$2');
  return (await q(sql, [studentId, month + '-01'])).rows[0].c;
}

// Bản gộp cho lập hoá đơn hàng loạt: trả map student_id -> số xe của tháng.
async function countByStudentForMonth(month, q = query) {
  const sql = `SELECT student_id, COUNT(*)::int c FROM vehicles WHERE ` + WHERE_MONTH.replace(/\$MONTH/g, '$1') + ` GROUP BY student_id`;
  const map = {};
  for (const r of (await q(sql, [month + '-01'])).rows) map[r.student_id] = r.c;
  return map;
}

module.exports = { countForMonth, countByStudentForMonth };
