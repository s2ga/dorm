// Đợt 3 — ngưỡng nghiệp vụ ĐƯA VÀO Cài đặt: lưu được giá trị hợp lệ, chặn ngoài khoảng. CHỈ LOCAL.
const KEYS = ['overdue_remind_days', 'shortterm_max_days', 'deposit_notice_min_days', 'partial_half_factor',
  'room_cap_A', 'room_cap_B', 'room_cap_C', 'room_cap_D', 'checkout_max_future_days', 'max_cccd_mb'];

module.exports = {
  name: 'Đợt 3 — ngưỡng nghiệp vụ trong Cài đặt (lưu/validate)',
  needsServer: true,

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    // Chụp giá trị hiện tại để trả về
    const snap = {};
    (await t.db.query(`SELECT key,value FROM settings WHERE key = ANY($1)`, [KEYS])).rows.forEach(r => snap[r.key] = r.value);

    // Hợp lệ: đổi overdue_remind_days 7 -> 5, partial_half_factor -> 0.6
    const rOk = await t.api('PUT', '/api/settings', T, { overdue_remind_days: '5', partial_half_factor: '0.6' });
    t.ok('Lưu overdue_remind_days=5 + partial_half_factor=0.6 → 200', rOk.status === 200, `HTTP ${rOk.status}`);
    const back = {};
    (await t.db.query(`SELECT key,value FROM settings WHERE key IN ('overdue_remind_days','partial_half_factor')`)).rows.forEach(r => back[r.key] = r.value);
    t.eq('overdue_remind_days lưu đúng = 5', back.overdue_remind_days, '5');
    t.eq('partial_half_factor lưu đúng = 0.6', back.partial_half_factor, '0.6');

    // Ngoài khoảng → 400 (không lưu)
    const bad1 = await t.api('PUT', '/api/settings', T, { overdue_remind_days: '0' });       // min 1
    t.ok('overdue_remind_days=0 → 400 (min 1)', bad1.status === 400, `HTTP ${bad1.status}`);
    const bad2 = await t.api('PUT', '/api/settings', T, { partial_half_factor: '1.5' });      // max 1
    t.ok('partial_half_factor=1.5 → 400 (max 1)', bad2.status === 400, `HTTP ${bad2.status}`);
    const bad3 = await t.api('PUT', '/api/settings', T, { max_cccd_mb: '20' });               // max 15 (<= body parser)
    t.ok('max_cccd_mb=20 → 400 (max 15)', bad3.status === 400, `HTTP ${bad3.status}`);
    const bad4 = await t.api('PUT', '/api/settings', T, { room_cap_A: 'abc' });               // phải là số
    t.ok('room_cap_A="abc" → 400 (phải là số)', bad4.status === 400, `HTTP ${bad4.status}`);

    // Trả lại giá trị cũ
    for (const k of KEYS) if (snap[k] != null) await t.db.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [k, snap[k]]);
  },
};
