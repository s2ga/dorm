// SSO Microsoft phải BẬT được chỉ với Tenant ID + Client ID (KHÔNG cần Client Secret) — chế độ
// public client dựa PKCE. Client Secret là credential của app; PKCE (đã có) thay được nó ở bước đổi
// mã. (Điều kiện Azure: bật "Allow public client flows" — không kiểm được từ đây.)
const { BASE } = require('../lib/harness');
const KEYS = ['sso_enabled', 'sso_tenant_id', 'sso_client_id', 'sso_client_secret', 'sso_allowed_domains'];
const setS = (db, k, v) => db.query(
  `INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [k, v]);

module.exports = {
  name: 'SSO Microsoft — bật chỉ với Tenant + Client (không cần Secret · public client PKCE)',
  needsServer: true,

  async run(t) {
    // Lưu trạng thái cũ để phục hồi (đây là settings TOÀN CỤC)
    const old = {};
    for (const k of KEYS) { const r = await t.db.query('SELECT value FROM settings WHERE key=$1', [k]); old[k] = r.rows[0] ? r.rows[0].value : null; }
    try {
      await setS(t.db, 'sso_client_secret', '');      // KHÔNG có secret
      await setS(t.db, 'sso_tenant_id', 'test-tenant-id');
      await setS(t.db, 'sso_client_id', 'test-client-id');
      await setS(t.db, 'sso_allowed_domains', '');
      await setS(t.db, 'sso_enabled', 'true');

      const cfg = await t.api('GET', '/api/auth/sso/config');
      t.ok('SSO bật được KHÔNG cần secret (config.enabled=true)', cfg.json && cfg.json.enabled === true, JSON.stringify(cfg.json));
      t.ok('… /config vẫn KHÔNG lộ secret/clientId', cfg.json && !('clientSecret' in cfg.json) && !('client_secret' in cfg.json), JSON.stringify(cfg.json));

      // /start phải 302 sang Microsoft với PKCE, KHÔNG kèm client_secret trong URL uỷ quyền
      const r = await fetch(BASE + '/api/auth/sso/start', { redirect: 'manual' });
      const loc = r.headers.get('location') || '';
      t.eq('/auth/sso/start → 302 (dựng được yêu cầu dù thiếu secret)', r.status, 302, `HTTP ${r.status}`);
      t.ok('… URL sang login.microsoftonline.com', /login\.microsoftonline\.com/.test(loc), loc.slice(0, 80));
      t.ok('… có PKCE code_challenge + method S256', /code_challenge=/.test(loc) && /code_challenge_method=S256/.test(loc), loc.slice(0, 160));
      t.ok('… có response_type=code + client_id', /response_type=code/.test(loc) && /client_id=/.test(loc), loc.slice(0, 160));
      t.ok('… authorize URL KHÔNG chứa client_secret', !/client_secret/.test(loc), 'lộ secret trong URL!');
    } finally {
      for (const k of KEYS) { if (old[k] !== null) await setS(t.db, k, old[k]); }
      if (old['sso_enabled'] === null) await setS(t.db, 'sso_enabled', 'false'); // mặc định TẮT
    }
  },
};
