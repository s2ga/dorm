// ĐĂNG NHẬP MICROSOFT (OpenID Connect — Authorization Code + PKCE)
//
// Vì sao tự viết thay vì thêm thư viện: luồng này chỉ cần 2 request HTTP + 1 lần verify JWT.
// Node 20 đã có sẵn `fetch` và `crypto` (đọc được JWK trực tiếp), `jsonwebtoken` thì repo đã dùng.
// Thêm @azure/msal-node kéo theo hàng chục phụ thuộc vào một app đang giữ nguyên tắc "vanilla, ít dep".
//
// 4 lớp chống giả mạo, THIẾU MỘT LÀ THỦNG:
//   state         — chống CSRF: kẻ khác không ép được trình duyệt bạn "đăng nhập" bằng mã của hắn
//   nonce         — chống phát lại: id_token cũ bắt được không dùng lại được
//   PKCE (S256)   — chống cướp mã: bắt được `code` cũng vô dụng nếu không có code_verifier
//   verify chữ ký — id_token phải do CHÍNH tenant đó ký (JWKS), đúng iss/aud/exp/tid
//
// state + nonce + code_verifier KHÔNG lưu ở server (app stateless) mà gói trong một JWT ngắn hạn
// đặt ở cookie httpOnly riêng — hết luồng là xoá.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getSettings } = require('./db');
const { JWT_SECRET } = require('./auth');

const STATE_COOKIE = 'ktx_sso';
const STATE_TTL_SEC = 600;                 // 10 phút: đủ cho người dùng gõ mật khẩu + 2FA, không hơn
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Cấu hình: THAM SỐ lấy ENV trước, thiếu thì lấy CSDL. Môi trường thật nên giữ bí mật ở ENV; ô trong
// màn Cài đặt là để chạy thử/khi công ty chưa cấp được ENV. Không đủ tham số -> TẮT (nút Microsoft tự ẩn).
//
// BẬT/TẮT KHÔNG CÓ ENV: đủ Tenant ID + Client ID là tự bật, muốn tắt thì admin bấm Tắt trong Cài đặt
// (ghi sso_enabled='false'). ENV SSO_ENABLED cũ đi chung đường pick() nên chuỗi 'false' — truthy trong
// JS — luôn thắng CSDL: admin điền đủ tham số, bấm Bật mà vẫn không đăng nhập được. Một công tắc, một nơi.
async function ssoConfig() {
  let s = {};
  try { s = await getSettings(); } catch (e) { s = {}; }
  const pick = (env, key) => (process.env[env] || s[key] || '').trim();
  const tenantId = pick('AZURE_TENANT_ID', 'sso_tenant_id');
  const clientId = pick('AZURE_CLIENT_ID', 'sso_client_id');
  const clientSecret = pick('AZURE_CLIENT_SECRET', 'sso_client_secret');
  const domains = pick('SSO_ALLOWED_DOMAINS', 'sso_allowed_domains')
    .split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  // Chỉ 'false' TƯỜNG MINH mới chặn; rỗng/chưa đặt = tự động theo tham số.
  const off = String(s.sso_enabled || '').trim() === 'false';
  // Secret KHÔNG bắt buộc (khớp bản Go): có secret -> confidential client; bỏ trống -> public client
  // dựa PKCE, khi đó app trên Azure phải bật "Allow public client flows".
  return { enabled: !!(!off && tenantId && clientId), tenantId, clientId, clientSecret, allowedDomains: domains };
}

const issuerOf = tenantId => `https://login.microsoftonline.com/${tenantId}/v2.0`;
const authorizeEndpoint = tenantId => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
const tokenEndpoint = tenantId => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const jwksUri = tenantId => `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

// Địa chỉ quay về sau khi Microsoft xác thực xong. PHẢI trùng tuyệt đối với Redirect URI
// đã khai trong Azure. Cho phép ép bằng ENV vì sau proxy (Render) đôi khi đoán sai scheme/host.
function redirectUri(req) {
  if (process.env.SSO_REDIRECT_URI) return process.env.SSO_REDIRECT_URI.trim();
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${req.get('host')}/api/auth/sso/callback`;
}

// ---- JWKS: khoá công khai của Microsoft để kiểm chữ ký id_token (cache 1 giờ) ----
let _jwksCache = { tenantId: null, at: 0, keys: [] };
async function getSigningKey(tenantId, kid) {
  const fresh = _jwksCache.tenantId === tenantId && (Date.now() - _jwksCache.at) < 3600e3;
  if (!fresh) {
    const r = await fetch(jwksUri(tenantId));
    if (!r.ok) throw new Error('Không lấy được khoá công khai của Microsoft (JWKS)');
    const j = await r.json();
    _jwksCache = { tenantId, at: Date.now(), keys: j.keys || [] };
  }
  let jwk = _jwksCache.keys.find(k => k.kid === kid);
  if (!jwk) {                                  // Microsoft xoay khoá -> nạp lại đúng một lần
    const r = await fetch(jwksUri(tenantId));
    if (r.ok) { const j = await r.json(); _jwksCache = { tenantId, at: Date.now(), keys: j.keys || [] }; }
    jwk = _jwksCache.keys.find(k => k.kid === kid);
  }
  if (!jwk) throw new Error('Không tìm thấy khoá ký khớp id_token');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

// ---- Bước 1: dựng URL đẩy người dùng sang Microsoft ----
async function buildAuthRequest(req) {
  const cfg = await ssoConfig();
  if (!cfg.enabled) throw Object.assign(new Error('Đăng nhập Microsoft chưa được cấu hình'), { status: 503 });
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const codeVerifier = b64url(crypto.randomBytes(48));
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const uri = redirectUri(req);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: uri,
    response_mode: 'query',
    scope: 'openid profile email',
    state, nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  // Gói bí mật của luồng vào JWT ngắn hạn -> cookie httpOnly. Không lưu gì ở server.
  const stateToken = jwt.sign({ state, nonce, cv: codeVerifier, uri }, JWT_SECRET, { expiresIn: STATE_TTL_SEC });
  return { url: `${authorizeEndpoint(cfg.tenantId)}?${params}`, stateToken };
}

// ---- Bước 2: đổi `code` lấy id_token, rồi KIỂM id_token ----
async function exchangeAndVerify(req, { code, state }) {
  const cfg = await ssoConfig();
  if (!cfg.enabled) throw Object.assign(new Error('Đăng nhập Microsoft chưa được cấu hình'), { status: 503 });

  const raw = (req.headers.cookie || '').match(/(?:^|;\s*)ktx_sso=([^;]+)/);
  if (!raw) throw Object.assign(new Error('Phiên đăng nhập Microsoft đã hết hạn. Vui lòng thử lại.'), { status: 400 });
  let st;
  try { st = jwt.verify(decodeURIComponent(raw[1]), JWT_SECRET); }
  catch (e) { throw Object.assign(new Error('Phiên đăng nhập Microsoft không hợp lệ hoặc đã hết hạn.'), { status: 400 }); }
  // So state bằng hàm chống dò thời gian (timing-safe)
  const a = Buffer.from(String(state || '')), b = Buffer.from(String(st.state || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Yêu cầu đăng nhập không khớp (state). Vui lòng thử lại.'), { status: 400 });
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: st.uri,
    code_verifier: st.cv,
    scope: 'openid profile email',
  });
  // Public client (không secret): TUYỆT ĐỐI không gửi client_secret rỗng — Microsoft trả lỗi
  // invalid_client thay vì hiểu là public client.
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  const r = await fetch(tokenEndpoint(cfg.tenantId), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.id_token) {
    // KHÔNG ném nguyên lỗi của Microsoft ra người dùng (có thể chứa chi tiết cấu hình nội bộ)
    console.error('[SSO] đổi mã thất bại:', r.status, tok.error, tok.error_description);
    throw Object.assign(new Error('Không đổi được mã đăng nhập với Microsoft.'), { status: 502 });
  }

  const decoded = jwt.decode(tok.id_token, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) throw Object.assign(new Error('id_token không hợp lệ'), { status: 400 });
  const key = await getSigningKey(cfg.tenantId, decoded.header.kid);
  let claims;
  try {
    claims = jwt.verify(tok.id_token, key, {
      algorithms: ['RS256'],                    // KHOÁ thuật toán — chặn tấn công đổi alg sang HS256/none
      issuer: issuerOf(cfg.tenantId),
      audience: cfg.clientId,
      clockTolerance: 60,
    });
  } catch (e) {
    throw Object.assign(new Error('Chữ ký id_token không hợp lệ: ' + e.message), { status: 401 });
  }
  if (claims.nonce !== st.nonce) throw Object.assign(new Error('id_token không khớp yêu cầu (nonce).'), { status: 401 });
  // Chặn tài khoản Microsoft NGOÀI tenant công ty (dù iss đã ràng, kiểm thêm tid cho chắc)
  if (claims.tid && claims.tid !== cfg.tenantId) throw Object.assign(new Error('Tài khoản không thuộc tổ chức được phép.'), { status: 403 });

  const email = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
  if (!email) throw Object.assign(new Error('Tài khoản Microsoft không có email — không liên kết được.'), { status: 400 });
  if (cfg.allowedDomains.length) {
    const dom = email.split('@')[1] || '';
    if (!cfg.allowedDomains.includes(dom)) {
      throw Object.assign(new Error(`Email "${email}" không thuộc tên miền được phép đăng nhập.`), { status: 403 });
    }
  }
  return {
    subject: String(claims.oid || claims.sub),  // oid = ổn định theo người trong tenant; email đổi được
    email,
    fullName: String(claims.name || '').trim(),
  };
}

module.exports = { ssoConfig, buildAuthRequest, exchangeAndVerify, redirectUri, STATE_COOKIE, STATE_TTL_SEC };
