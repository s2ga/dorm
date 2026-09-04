// Golden fixtures cho parity chores (lịch trực nhật) Node↔Go.
//   node .runtime/node/node.exe tests/golden/gen_chores_golden.js tests/golden/chores_golden.json
const path = require('path');
const fs = require('fs');
const ch = require(path.join('c:/Users/thuyhien/quan-ly-ktx', 'server/chores'));

const out = { schedule: [], mondayOf: [] };
const sc = (name, members, today, weeks) =>
  out.schedule.push({ name, in: { members, today, weeks }, out: ch.schedule({ members, today, weeks }) });

const M = [
  { id: 3, name: 'C', check_in_date: '2026-07-01', check_out_date: null },
  { id: 1, name: 'A', check_in_date: '2026-06-15', check_out_date: null },
  { id: 2, name: 'B', check_in_date: '2026-06-15', check_out_date: null },
];
sc('3 người xoay 6 tuần (sắp theo ngày vào rồi id)', M, '2026-07-06', 6);
sc('người rời giữa chừng bị loại khỏi tuần sau', [
  { id: 1, name: 'A', check_in_date: '2026-07-01', check_out_date: '2026-07-12' },
  { id: 2, name: 'B', check_in_date: '2026-07-01', check_out_date: null },
], '2026-07-06', 4);
sc('người vào muộn chỉ xuất hiện từ tuần họ ở', [
  { id: 1, name: 'A', check_in_date: '2026-07-01', check_out_date: null },
  { id: 2, name: 'B', check_in_date: '2026-07-20', check_out_date: null },
], '2026-07-06', 5);
sc('phòng trống -> lịch rỗng', [], '2026-07-06', 4);
sc('1 người -> luôn là họ', [{ id: 9, name: 'Z', check_in_date: '2026-01-01', check_out_date: null }], '2026-07-15', 3);

const mo = (name, ymd) => out.mondayOf.push({ name, in: ymd, out: ch.mondayOf(ymd) });
mo('thứ Hai giữ nguyên', '2026-07-06');
mo('Chủ nhật -> lùi về thứ Hai', '2026-07-12');
mo('thứ Tư -> thứ Hai cùng tuần', '2026-07-08');
mo('đầu tháng vắt qua tháng trước', '2026-07-01');

const dest = process.argv[2];
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`✅ Ghi ${out.schedule.length + out.mondayOf.length} case chores -> ${dest}`);
