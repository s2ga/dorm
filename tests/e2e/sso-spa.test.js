// SSO luồng SPA (không secret): /config trả tenantId+clientId cho trình duyệt tự dựng luồng; /verify
// nhận id_token trình duyệt gửi về, KIỂM chữ ký JWKS rồi mới cấp cookie (id_token rác -> từ chối).
const { BASE } = require('../lib/harness');
const KEYS = ['sso_enabled', 'sso_tenant_id', 'sso_client_id', 'sso_client_secret', 'sso_allowed_domains'];
const setS = (db, k, v) => db.query(
  `INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [k, v]);

module.exports = {
  name: 'SSO — /config CHỈ trả cờ enabled (không lộ tenant/client) + /verify kiểm id_token',
  needsServer: true,

  async run(t) {
    const old = {};
    for (const k of KEYS) { const r = await t.db.query('SELECT value FROM settings WHERE key=$1', [k]); old[k] = r.rows[0] ? r.rows[0].value : null; }
    try {
      await setS(t.db, 'sso_client_secret', '');
      await setS(t.db, 'sso_tenant_id', 'test-tenant-id');
      await setS(t.db, 'sso_client_id', 'test-client-id');
      await setS(t.db, 'sso_allowed_domains', '');
      await setS(t.db, 'sso_enabled', 'true');

      // Owner chốt 29/07/2026: endpoint này mở cho KHÁCH CHƯA ĐĂNG NHẬP, nên chỉ được trả cờ bật/tắt.
      // Trả kèm tenantId/clientId là ai cũng đọc được danh tính Azure của công ty bằng một request.
      // Trình duyệt không cần chúng nữa: yêu cầu uỷ quyền do máy chủ dựng (GET /api/auth/sso/start).
      const cfg = await t.api('GET', '/api/auth/sso/config');
      t.eq('/config chỉ trả cờ enabled — KHÔNG kèm tenantId/clientId',
        Object.keys(cfg.json || {}).sort(), ['enabled'], JSON.stringify(cfg.json));
      t.ok('/config KHÔNG lộ client_secret', cfg.json && !('clientSecret' in cfg.json) && !('client_secret' in cfg.json), JSON.stringify(cfg.json));
      // Chốt chặn thật: quét CẢ THÂN phản hồi, không chỉ tên trường — giá trị lọt ra dưới tên khác
      // cũng là lộ. Dùng chính giá trị test vừa đặt vào settings làm mồi.
      const tho = JSON.stringify(cfg.json || {});
      t.ok('… và không lọt giá trị tenant/client dưới bất kỳ tên trường nào',
        !tho.includes('test-tenant-id') && !tho.includes('test-client-id'), tho);

      // id_token rác -> server phải TỪ CHỐI ở bước kiểm chữ ký (không cấp cookie bừa).
      const bad = await t.api('POST', '/api/auth/sso/verify', null, { id_token: 'khong-phai-jwt-hop-le' });
      t.eq('/verify từ chối id_token rác (kiểm chữ ký JWKS) → 401', bad.status, 401, `HTTP ${bad.status} ${JSON.stringify(bad.json)}`);
      t.ok('/verify KHÔNG cấp cookie khi token sai', bad.status === 401, 'phải 401');

      const empty = await t.api('POST', '/api/auth/sso/verify', null, {});
      t.eq('/verify thiếu id_token → 400', empty.status, 400, `HTTP ${empty.status}`);
    } finally {
      for (const k of KEYS) { if (old[k] !== null) await setS(t.db, k, old[k]); }
      if (old['sso_enabled'] === null) await setS(t.db, 'sso_enabled', 'false');
    }
  },
};
