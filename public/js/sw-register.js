// Đăng ký service worker (PWA). Tách khỏi index.html để CSP script-src KHÔNG cần 'unsafe-inline'.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then(r => r.update()).catch(() => {}));
}
