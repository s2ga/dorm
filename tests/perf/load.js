#!/usr/bin/env node
/* ============================================================================
 * HARNESS ĐO HIỆU NĂNG / TẢI — App Quản lý KTX
 *
 * Mục tiêu: bắn N request đồng thời vào một kịch bản, đo p50/p95/p99, đếm lỗi,
 * và LÒI RA chỗ gục (timeout pool, statement_timeout 15s, rate-limit 429).
 * Không phải để "chứng minh app nhanh" — để tìm ngưỡng gãy.
 *
 * ---- AN TOÀN ----
 * Harness CHỈ bắn vào máy chủ localhost. Nhưng máy chủ đó lấy CSDL từ DATABASE_URL
 * của chính nó — NẾU server local đang trỏ vào Supabase staging/prod thì bắn tải
 * localhost VẪN cày nát CSDL thật. Trước khi chạy PHẢI chắc server đang trỏ vào
 * một CSDL DÙNG-RỒI-BỎ (Docker Postgres local, hoặc một Supabase BRANCH tạm).
 * Đặt LOAD_ACK=1 để xác nhận đã kiểm điều này.
 *
 * ---- CHẠY ----
 *   # 1) server chạy ở cửa khác, trỏ vào CSDL dùng-rồi-bỏ
 *   # 2) đăng nhập được bằng admin:
 *   ADMIN_P=... LOAD_ACK=1 node tests/perf/load.js <kịch bản> [--n=200] [--c=50] [--dur=20]
 *
 *   Kịch bản:
 *     read-heavy   GET /api/students        (đọc nặng, danh sách ~240 HV)
 *     dashboard    GET /api/rooms           (trang đầu ai cũng tải)
 *     data-health  GET /api/admin/data-health   (4 truy vấn quét toàn bảng, không LIMIT SQL)
 *     revenue      GET /api/reports/revenue     (GROUP BY toàn bộ hóa đơn)
 *     me-invoices  GET /api/me/invoices     (cổng học viên — cần LOAD_STUDENT=user:pass)
 *     login        POST /api/auth/login     (đo bcrypt + authLimiter)
 *     mixed        pha trộn read-heavy 70% + dashboard 20% + data-health 10%
 *
 *   Cờ:
 *     --n=200    tổng số request (mặc định 200)
 *     --c=50     số request ĐỒNG THỜI tối đa (mặc định 50) — đây là "N người cùng lúc"
 *     --dur=0    nếu >0: chạy theo GIÂY thay vì theo --n (tải bền)
 * ========================================================================== */
'use strict';

const BASE = process.env.LOAD_BASE || 'http://localhost:3000';

// CHẶN CỨNG: chỉ localhost (giống tests/lib/harness.js — đừng thêm cờ tắt).
if (!/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE.replace(/\/$/, ''))) {
  console.error(`\n  DỪNG. Harness tải chỉ được bắn vào localhost. Đang trỏ: ${BASE}\n`);
  process.exit(2);
}
if (process.env.LOAD_ACK !== '1') {
  console.error(`\n  DỪNG. Đặt LOAD_ACK=1 SAU KHI đã chắc server local KHÔNG trỏ vào staging/prod.` +
    `\n     Server ở ${BASE} lấy CSDL từ DATABASE_URL của nó — kiểm tra .env của server trước.\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const scenario = args.find(a => !a.startsWith('--')) || 'read-heavy';
const flag = (name, def) => {
  const m = args.find(a => a.startsWith(`--${name}=`));
  return m ? Number(m.split('=')[1]) : def;
};
const N = flag('n', 200);
const C = flag('c', 50);
const DUR = flag('dur', 0); // giây; >0 => chạy theo thời gian

async function login(username, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const m = (r.headers.get('set-cookie') || '').match(/ktx_token=([^;]+)/);
  if (!m) throw new Error(`Không đăng nhập được "${username}" (HTTP ${r.status}). Đặt ADMIN_P?`);
  return m[1];
}

// Một "phát bắn" trả về { ms, status, ok, err }
function makeShot(token, studentToken) {
  const hit = (method, path, tok, body) => async () => {
    const t0 = process.hrtime.bigint();
    try {
      const r = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      await r.text(); // đọc hết body để tính đúng thời gian truyền
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      return { ms, status: r.status, ok: r.status < 400, err: r.status >= 400 ? `HTTP ${r.status}` : null };
    } catch (e) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      return { ms, status: 0, ok: false, err: e.code || e.message };
    }
  };

  const S = {
    'read-heavy': hit('GET', '/api/students', token),
    'dashboard': hit('GET', '/api/rooms', token),
    'data-health': hit('GET', '/api/admin/data-health', token),
    'revenue': hit('GET', '/api/reports/revenue', token),
    'me-invoices': hit('GET', '/api/me/invoices', studentToken),
    'login': () => (async () => {
      const t0 = process.hrtime.bigint();
      const r = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '__load_nobody__', password: 'x' }),
      }).catch(e => ({ status: 0, _e: e }));
      if (r.text) await r.text().catch(() => {});
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const status = r.status || 0;
      return { ms, status, ok: status < 500 && status !== 0, err: status >= 400 ? `HTTP ${status}` : (r._e && r._e.code) };
    })(),
  };

  if (scenario === 'mixed') {
    return () => {
      const x = Math.random();
      const pick = x < 0.7 ? 'read-heavy' : x < 0.9 ? 'dashboard' : 'data-health';
      return S[pick]();
    };
  }
  const fn = S[scenario];
  if (!fn) { console.error(`Kịch bản lạ: ${scenario}`); process.exit(2); }
  return fn;
}

// Bể công việc: giữ tối đa C phát đang bay cùng lúc.
async function run(shot) {
  const results = [];
  let inFlight = 0, launched = 0;
  const deadline = DUR > 0 ? Date.now() + DUR * 1000 : null;
  const more = () => DUR > 0 ? Date.now() < deadline : launched < N;

  await new Promise(resolve => {
    const pump = () => {
      while (inFlight < C && more()) {
        launched++; inFlight++;
        Promise.resolve(shot()).then(r => {
          results.push(r); inFlight--;
          if (!more() && inFlight === 0) resolve(); else pump();
        });
      }
      if (!more() && inFlight === 0) resolve();
    };
    pump();
  });
  return results;
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const f = n => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

(async () => {
  console.log(`\n  KỊCH BẢN: ${scenario}  ·  BASE: ${BASE}`);
  console.log(`  ${DUR > 0 ? `Chạy bền ${DUR}s` : `Tổng ${N} request`} · Đồng thời tối đa: ${C}\n`);

  let token = null, studentToken = null;
  if (scenario !== 'login') {
    token = await login('admin', process.env.ADMIN_P || '');
  }
  if (scenario === 'me-invoices') {
    const [u, p] = (process.env.LOAD_STUDENT || '').split(':');
    if (!u) { console.error('Cần LOAD_STUDENT=username:password cho kịch bản me-invoices'); process.exit(2); }
    studentToken = await login(u, p);
  }

  const shot = makeShot(token, studentToken);
  const t0 = Date.now();
  const res = await run(shot);
  const wall = (Date.now() - t0) / 1000;

  const lat = res.map(r => r.ms);
  const okN = res.filter(r => r.ok).length;
  const errs = res.filter(r => !r.ok);
  const byErr = {};
  errs.forEach(e => { byErr[e.err || '???'] = (byErr[e.err || '???'] || 0) + 1; });

  console.log(`  ── Kết quả ──────────────────────────────────`);
  console.log(`  Request  : ${res.length}  ·  OK: ${okN}  ·  Lỗi: ${errs.length} (${f(errs.length / res.length * 100)}%)`);
  console.log(`  Thời lượng: ${f(wall)}s  ·  Thông lượng: ${f(res.length / wall)} req/s`);
  console.log(`  Độ trễ   : p50 ${f(pct(lat, 50))}ms · p95 ${f(pct(lat, 95))}ms · p99 ${f(pct(lat, 99))}ms · max ${f(Math.max(...lat, 0))}ms`);
  if (errs.length) {
    console.log(`  Lỗi phân loại:`);
    Object.entries(byErr).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`     ${v.toString().padStart(5)}  ${k}`));
    if (byErr['HTTP 429']) console.log(`     ↑ 429 = đụng rate-limit 600/phút/IP. Tải từ 1 IP không vượt được ngưỡng này.`);
    if (byErr['HTTP 500'] || byErr['UND_ERR_HEADERS_TIMEOUT']) console.log(`     ↑ 500/timeout = có thể statement_timeout 15s hoặc pool (max 10) cạn.`);
    if (byErr['ECONNREFUSED']) console.log(`     ↑ ECONNREFUSED = server chưa chạy hoặc đã sập.`);
  }
  console.log(`  ─────────────────────────────────────────────\n`);
  console.log(`  Đọc kèm docs/TEST-PLAN-PERFORMANCE.md để biết con số này NÓI LÊN điều gì.\n`);
})().catch(e => { console.error('\n  Lỗi harness:', e.message, '\n'); process.exit(1); });
