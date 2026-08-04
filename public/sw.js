// Service worker: ưu tiên MẠNG cho giao diện (luôn có bản mới nhất khi online),
// dùng cache làm dự phòng khi offline. API luôn lấy trực tiếp từ mạng.
const CACHE = 'ktx-shell-v236';
// Số phiên bản SUY RA TỪ TÊN CACHE — không ghi tay lần thứ hai (lệch với index.html là tải sẵn nguyên
// bộ asset cũ mà không dùng tới). tests/unit/version.test.js canh việc này.
const V = (CACHE.match(/-v(\d+)$/) || [, '1'])[1];
const SHELL = [
  '/', '/index.html',
  `/css/styles.css?v=${V}`,
  `/js/icons.js?v=${V}`, `/js/api.js?v=${V}`, `/js/ui.js?v=${V}`, `/js/app-actions.js?v=${V}`,
  `/js/app-public-auth.js?v=${V}`, `/js/app-admin-core.js?v=${V}`, `/js/app-exec-dashboard.js?v=${V}`,
  `/js/app-rooms-students.js?v=${V}`, `/js/app-services-revenue-audit.js?v=${V}`, `/js/app-requests-checkin.js?v=${V}`,
  `/js/app-invoices-settings.js?v=${V}`, `/js/app-portals-boot.js?v=${V}`, `/js/sw-register.js?v=${V}`,
  '/manifest.webmanifest', '/icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // API: luôn qua mạng

  // Giao diện: network-first → luôn cập nhật khi online, cache khi offline
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      // BL-14: request ĐIỀU HƯỚNG (mở /students, /dang-ky, /?view=... khi offline) — cache chỉ có '/'
      // và '/index.html', tra theo URL đầy đủ nên mọi đường dẫn/khác query đều trượt → trang trắng.
      // App là SPA: mọi đường dẫn đều phải trả index.html (giống SPA fallback của máy chủ ở index.js),
      // để định tuyến (BL-10) chạy được cả khi mất mạng. Request tài nguyên (js/css/ảnh) thì tra bình thường.
      e.request.mode === 'navigate'
        ? caches.match('/index.html').then(r => r || caches.match('/'))
        : caches.match(e.request))
  );
});
