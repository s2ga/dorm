// === app-admin-core.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
function renderAdmin() {
  const isAdmin = Auth.user.role === 'admin';
  el('app').innerHTML = `
    <div class="app">
      <aside class="side">
        <div class="logo">${IC.home} <span>Nội trú Esuhai</span></div>
        <nav id="nav">
          <div class="grp">Quản lý</div>
          ${isAdmin ? `<button data-v="exec"><span class="ico">${IC.gauge}</span><span class="lbl">Điều hành</span></button>` : ''}
          <button data-v="dashboard"><span class="ico">${IC.dashboard}</span><span class="lbl">Tổng quan</span></button>
          <button data-v="students"><span class="ico">${IC.users}</span><span class="lbl">Học viên</span></button>
          <button data-v="rooms"><span class="ico">${IC.doorOpen}</span><span class="lbl">Phòng</span></button>
          <button data-v="services"><span class="ico">${IC.sparkles}</span><span class="lbl">Dịch vụ</span></button>
          <div class="grp">Vận hành</div>
          <button data-v="checkin"><span class="ico">${IC.key}</span><span class="lbl">Check-in / out</span></button>
          <button data-v="invoices"><span class="ico">${IC.wallet}</span><span class="lbl">Tiền phòng</span></button>
          ${isAdmin ? `<button data-v="revenue"><span class="ico">${IC.trendingUp}</span><span class="lbl">Dự báo doanh thu</span></button>` : ''}
          <div class="grp">Tiếp nhận & Hỗ trợ</div>
          <button data-v="reg"><span class="ico">${IC.filePen}</span><span class="lbl">Đăng ký ở nội trú</span><span class="cnt" id="navReg" style="display:none"></span></button>
          <button data-v="checkout"><span class="ico">${IC.logOut}</span><span class="lbl">Đăng ký trả phòng</span><span class="cnt" id="navCheckout" style="display:none"></span></button>
          <button data-v="repair"><span class="ico">${IC.wrench}</span><span class="lbl">Báo hư hỏng CSVC</span><span class="cnt" id="navRepair" style="display:none"></span></button>
          <button data-v="violations"><span class="ico">${IC.alert}</span><span class="lbl">Quản lý vi phạm</span><span class="cnt" id="navViol" style="display:none"></span></button>
          <button data-v="feedback"><span class="ico">${IC.inbox}</span><span class="lbl">Hộp thư hỗ trợ/góp ý</span><span class="cnt" id="navFeed" style="display:none"></span></button>
          ${isAdmin ? `<div class="grp">Hệ thống</div>
          <button data-v="audit"><span class="ico">${IC.history}</span><span class="lbl">Lịch sử</span></button>
          <button data-v="settings"><span class="ico">${IC.settings}</span><span class="lbl">Cài đặt</span><span class="cnt" id="navSettings" style="display:none"></span></button>` : ''}
        </nav>
        <div class="foot">
          <div class="u">${esc(Auth.user.full_name || Auth.user.username)}</div>
          <div class="r muted" style="font-size:11px">${isAdmin ? 'Quản trị viên' : 'Nhân viên'}</div>
          ${dungMatKhau() ? `<button data-act="changePwd">${IC.key} Đổi mật khẩu</button>` : ''}
          <button data-act="logout">${IC.logOut} Đăng xuất</button>
        </div>
      </aside>
      <div class="side-backdrop" id="sideBackdrop" data-act="toggleSide"></div>
      <div class="main">
        <div class="top">
          <button class="hamburger" data-act="toggleSide" aria-label="Menu" aria-expanded="false">${IC.menu}</button>
          <button class="hamburger" id="backBtn" data-act="goBack" aria-label="Quay lại" title="Quay lại" style="display:none">${IC.arrowLeft}</button>
          <div style="flex:1;min-width:0"><h1 id="pgTitle">Tổng quan</h1><div class="sub" id="pgSub"></div></div>
          <div class="flex" style="gap:10px">
            <span id="facSel"></span>
            <button class="notif-bell" id="notifBell" title="Thông báo" aria-haspopup="dialog" aria-expanded="false" data-act="toggleNotif">${IC.bell}<span class="notif-dot" id="notifDot" style="display:none"></span></button>
            <div class="toolbar" id="topActions"></div>
          </div>
        </div>
        <div class="content" id="content"><div class="spinner"></div></div>
      </div>
    </div>`;
  document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => adminGo(b.dataset.v)));
  document.addEventListener('keydown', _escDrawer);   // BL-31: Esc đóng drawer (dedup nhờ named fn)
  startTableResize();
  // Màn ban đầu: ƯU TIÊN đường dẫn (deep-link /hoc-vien...), rồi tới ?view= cũ (giữ tương thích link cũ),
  // cuối cùng mặc định Tổng quan. adminGo lần đầu dùng {replace} để không tạo bước lịch sử thừa.
  const views = ['exec', 'dashboard', 'students', 'rooms', 'vehicles', 'services', 'checkin', 'invoices', 'revenue', 'reg', 'checkout', 'repair', 'violations', 'feedback', 'requests', 'audit', 'settings'];
  const legacy = new URLSearchParams(location.search).get('view');
  const fromPath = viewFromPath(location.pathname);
  // Ưu tiên đường dẫn khi nó chỉ tới một màn CỤ THỂ; còn '/' (→ dashboard) hoặc path lạ thì mới xét
  // ?view= cũ (giữ tương thích link/bookmark cũ). adminGo {replace} sẽ nắn '/?view=students' thành '/hoc-vien'.
  const initial = (fromPath && fromPath !== 'dashboard') ? fromPath
    : (views.includes(legacy) ? legacy : (fromPath || 'dashboard'));
  bootLoad(initial, { replace: true });
  startNotifPolling();
}

// BL-13: nạp dữ liệu nền lúc vào app. 4 API lõi (rooms/students/facilities/settings) là ĐIỀU KIỆN
// TIÊN QUYẾT — hỏng thì KHÔNG vẽ màn với số 0 giả (người ta tin số mà quyết định sai), mà hiện trạng
// thái lỗi kèm nút Thử lại — MỘT chỗ, không phải 11 .catch. Trước đây: Promise.all reject -> adminGo
// không chạy -> vùng nội dung kẹt ở <div class="spinner"> vĩnh viễn, toast lỗi thì bay mất -> bế tắc.
let _bootLoaded = false, _bootInitial = 'dashboard', _bootOpts = { replace: true };
function bootLoad(initial, opts) {
  _bootInitial = initial; _bootOpts = opts || {};
  const c = el('content'); if (c) c.innerHTML = '<div class="spinner"></div>';
  refreshCache().then(() => { _bootLoaded = true; adminGo(initial, _bootOpts); }).catch(renderBootError);
}
function bootRetry() { bootLoad(_bootInitial, _bootOpts); }
function renderBootError(e) {
  const c = el('content'); if (!c) return;
  c.innerHTML = `
    <div class="panel" style="max-width:460px;margin:48px auto;text-align:center">
      <div class="pad">
        <div style="color:var(--red-ink,#b91c1c);display:flex;justify-content:center;margin-bottom:8px">${IC.alert}</div>
        <h2 style="margin:0 0 6px">Không tải được dữ liệu</h2>
        <p class="muted" style="margin:0 0 4px">${esc((e && e.message) || 'Lỗi kết nối máy chủ')}</p>
        <p class="muted" style="font-size:13px;margin:0 0 16px">Máy chủ có thể đang khởi động lại (gói miễn phí ngủ đông) hoặc mất mạng. Chưa tải được dữ liệu nền nên chưa mở màn nào — bấm Thử lại.</p>
        <button class="btn pri" data-act="bootRetry">${IC.refresh} Thử lại</button>
      </div>
    </div>`;
}
// BL-21: lỗi tải TRONG một màn (viewExec/viewRequests/viewCheckin) → hiện khối lỗi + nút Thử lại
// (nạp lại CHÍNH màn đó qua adminGo), thay vì để #content kẹt ở spinner vĩnh viễn.
function renderViewError(view, e) {
  const c = el('content'); if (!c) return;
  c.innerHTML = `
    <div class="panel" style="max-width:460px;margin:48px auto;text-align:center">
      <div class="pad">
        <div style="color:var(--red-ink,#b91c1c);display:flex;justify-content:center;margin-bottom:8px">${IC.alert}</div>
        <h2 style="margin:0 0 6px">Không tải được dữ liệu</h2>
        <p class="muted" style="margin:0 0 4px">${esc((e && e.message) || 'Lỗi kết nối máy chủ')}</p>
        <p class="muted" style="font-size:13px;margin:0 0 16px">Máy chủ có thể đang bận hoặc mất mạng. Bấm Thử lại.</p>
        <button class="btn pri" data-act="adminGo" data-args='["${view}"]'>${IC.refresh} Thử lại</button>
      </div>
    </div>`;
}

async function refreshCache() {
  // BL-19: 4 API lõi (rooms/students/facilities/settings) GIỮ tiên quyết — hỏng thì reject -> renderBootError (BL-13).
  // 7 API phụ: hỏng thì ghi vết vào ST.cacheErrors (báo qua chuông) thay vì nuốt im -> hiện số 0 giả.
  const failed = [];
  const soft = (p, label, dflt) => p.catch(() => { failed.push(label); return dflt; });
  const [rooms, students, facilities, settings, applications, damage, couts, logs, assets, vtypes, vstats] = await Promise.all([
    API.rooms(), API.students(), API.facilities(), API.settings(),
    soft(API.applications(), 'đơn đăng ký', []),
    soft(API.damageAll(), 'hỗ trợ / hư hỏng', []),
    soft(API.checkoutReqs(), 'đơn trả phòng', []),
    soft(API.logs(), 'lịch sử', []),
    soft(API.assets(), 'tài sản', []),
    soft(API.violationTypes(), 'loại vi phạm', []),
    soft(API.violationStats(), 'vi phạm', { byStudent: [], needMail: 0, threshold: 3 }),
  ]);
  ST.cacheErrors = failed;
  Object.assign(ST, { rooms, students, facilities, settings, applications, damage, couts, logs, assets, vtypes, vstats });
  // Admin: đếm tài khoản chờ duyệt (SSO tự tạo role='pending') để BÁO qua chuông + badge Cài đặt.
  // Staff không có quyền endpoint này -> bỏ qua.
  if (Auth.user && Auth.user.role === 'admin') { try { ST.pendingCount = ((await API.pendingCount()) || {}).pending || 0; } catch (e) { /* giữ giá trị cũ */ } }
  updateNavBadges();
  renderFacilitySelector();
}
// Đa cơ sở: bộ chọn cơ sở toàn cục — CHỈ cho ĐIỀU HÀNH (admin) và khi có >1 cơ sở. Quản lý/bảo trì đã
// bị backend bó theo cơ sở nên không hiện. Đổi cơ sở -> nạp lại toàn bộ dữ liệu (API.setFacility) rồi vẽ lại.
function renderFacilitySelector() {
  const box = el('facSel'); if (!box) return;
  const show = Auth.user && Auth.user.role === 'admin' && (ST.facilities || []).length > 1;
  if (!show) { box.innerHTML = ''; return; }
  const cur = ST.facilityFilter || 0;
  box.innerHTML = `<select title="Lọc theo cơ sở" data-change="onFacSel" style="font-size:13px;padding:7px 9px;border-radius:10px;border:1px solid var(--line);background:var(--card)">
    <option value="0">${IC.building} Tất cả cơ sở</option>
    ${ST.facilities.map(f => `<option value="${f.id}" ${cur === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
  </select>`;
}
async function setFacilityFilter(f) {
  ST.facilityFilter = +f || 0;
  API.setFacility(ST.facilityFilter);        // áp cho mọi truy vấn danh sách
  try { await refreshCache(); } catch (e) { return toast(e.message, 'err'); }
  adminGo(ST.view || 'dashboard');           // vẽ lại view hiện tại với dữ liệu đã lọc
}
function updateNavBadges() {
  const dmg = ST.damage || [];
  const setBadge = (id, n) => { const b = el(id); if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; } };
  setBadge('navReg', ST.applications.filter(a => a.status === 'pending').length);
  setBadge('navCheckout', ST.couts.filter(c => c.status === 'pending').length);
  setBadge('navRepair', dmg.filter(d => (d.category || 'damage') === 'damage' && d.status !== 'done').length);
  setBadge('navViol', (ST.vstats && ST.vstats.needMail) || 0);
  setBadge('navFeed', dmg.filter(d => ['violation', 'other'].includes(d.category) && d.status !== 'done').length);
  setBadge('navSettings', ST.pendingCount || 0);   // SSO: tài khoản chờ duyệt
  updateNotif();
}
/* ---- Trung tâm thông báo (chuông) ---- */
function notifItems() {
  const items = [];
  // BL-19: dataset phụ tải hỏng -> cảnh báo trên chuông + nút Thử lại, thay vì để badge/số về 0 giả im lặng.
  if (ST.cacheErrors && ST.cacheErrors.length) items.push({ n: ST.cacheErrors.length, ic: IC.alert, tx: `Chưa tải được: ${ST.cacheErrors.join(', ')} — số liệu có thể chưa đầy đủ. Bấm để thử lại`, act: actAttr('retryCache') });
  const pApps = ST.applications.filter(a => a.status === 'pending').length;
  const pDmg = ST.damage.filter(d => (d.category || 'damage') === 'damage' && d.status !== 'done').length;
  const pCout = ST.couts.filter(c => c.status === 'pending').length;
  const needMail = (ST.vstats && ST.vstats.needMail) || 0;
  const refund = ST.students.filter(s => liveStatus(s) === 'left' && s.deposit_status === 'held').length;
  const pend = ST.pendingCount || 0;
  if (pend) items.push({ n: pend, ic: IC.shield, tx: `${pend} tài khoản Microsoft chờ duyệt`, act: actAttr('gotoUsers') });
  if (pApps) items.push({ n: pApps, ic: IC.filePen, tx: `${pApps} đơn đăng ký chờ duyệt`, act: actAttr('adminGo', 'reg') });
  if (pDmg) items.push({ n: pDmg, ic: IC.wrench, tx: `${pDmg} báo hư hỏng chưa xử lý`, act: actAttr('adminGo', 'repair') });
  if (pCout) items.push({ n: pCout, ic: IC.logOut, tx: `${pCout} đơn xin trả phòng`, act: actAttr('adminGo', 'checkout') });
  if (needMail) items.push({ n: needMail, ic: IC.alert, tx: `${needMail} học viên vi phạm cần báo nhà trường`, act: actAttr('adminGo', 'violations') });
  if (refund) items.push({ n: refund, ic: IC.handCoins, tx: `${refund} khoản cọc chờ hoàn (đã trả phòng)`, act: actAttr('quyCoc') });
  return items;
}
function updateNotif() {
  const total = notifItems().reduce((a, i) => a + i.n, 0);
  const d = el('notifDot'); if (d) { d.textContent = total > 99 ? '99+' : total; d.style.display = total ? '' : 'none'; }
}
// BL-19: thử tải lại các dataset phụ bị hỏng rồi vẽ lại màn hiện tại (cảnh báo tự mất khi thành công).
async function retryCache() {
  try { await refreshCache(); adminGo(ST.view || 'dashboard'); }
  catch (e) { toast((e && e.message) || 'Lỗi kết nối', 'err'); }
}
// TỰ hỏi server định kỳ. Trước đây chuông chỉ đếm lại từ ST (nạp 1 lần lúc mở trang) và chỉ đổi
// khi CHÍNH MÌNH bấm một nút có sửa dữ liệu -> việc mới từ máy khác nằm im, phải tự F5 mới thấy (V2-77).
let _notifTimer = null;
async function refreshNotifCounts() {
  if (!Auth.user || document.hidden) return;   // không poll khi ẩn tab / đã đăng xuất
  try {
    const [applications, damage, couts, vstats] = await Promise.all([
      API.applications(), API.damageAll(), API.checkoutReqs(), API.violationStats().catch(() => ST.vstats),
    ]);
    Object.assign(ST, { applications, damage, couts, vstats });
    if (Auth.user.role === 'admin') { try { ST.pendingCount = ((await API.pendingCount()) || {}).pending || 0; } catch (e) { /* bỏ qua */ } }
    updateNavBadges();                          // cập nhật cả badge nav lẫn chuông
    if (el('notifPanel')) {                      // panel đang mở -> vẽ lại nội dung cho khớp
      const items = notifItems();
      const inner = el('notifPanel');
      inner.innerHTML = `<div class="notif-hd" id="notifHd">${IC.bell} Thông báo — cần xử lý</div>${items.length ? items.map(i => `<button class="notif-item" data-closenotif ${i.act}>${i.ic}<span>${i.tx}</span></button>`).join('') : `<div class="notif-empty">${IC.checkCircle} Không có việc cần xử lý</div>`}`;
    }
  } catch (e) { /* lỗi mạng tạm -> lần poll sau thử lại, không quấy người dùng */ }
}
function startNotifPolling() {
  if (_notifTimer) clearInterval(_notifTimer);
  _notifTimer = setInterval(refreshNotifCounts, 60000);   // 60s: đủ kịp thời, không nặng server
  // Quay lại tab sau khi rời đi -> cập nhật ngay, khỏi chờ hết chu kỳ
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNotifCounts(); });
}
function closeNotif() {
  const p = el('notifPanel'); if (!p) return;
  p.remove();
  document.removeEventListener('mousedown', _notifOutside, true);
  document.removeEventListener('touchstart', _notifOutside, true);
  document.removeEventListener('keydown', _notifKey, true);
  const b = el('notifBell'); if (b) b.setAttribute('aria-expanded', 'false');
}
function toggleNotif(e) {
  if (e) e.stopPropagation();
  if (el('notifPanel')) { closeNotif(); return; }
  const items = notifItems();
  const p = document.createElement('div'); p.className = 'notif-panel'; p.id = 'notifPanel';
  p.setAttribute('role', 'dialog'); p.setAttribute('aria-labelledby', 'notifHd'); p.tabIndex = -1;   // BL-31: a11y dialog
  p.innerHTML = `<div class="notif-hd" id="notifHd">${IC.bell} Thông báo — cần xử lý</div>${items.length ? items.map(i => `<button class="notif-item" data-closenotif ${i.act}>${i.ic}<span>${i.tx}</span></button>`).join('') : `<div class="notif-empty">${IC.checkCircle} Không có việc cần xử lý</div>`}`;
  document.body.appendChild(p);
  const r = el('notifBell').getBoundingClientRect();
  p.style.top = (r.bottom + 8) + 'px';
  // BL-52: kẹp panel TRONG màn dù chuông nằm trái hay phải. Neo mép phải panel vào mép phải chuông
  // (r.right - pw) rồi giới hạn left trong [8, innerWidth - pw - 8] → không bao giờ tràn khỏi mép.
  // (Cách cũ neo `right = innerWidth - bell.right` giả định chuông ở bên phải — sai sau BL-46 đẩy chuông sang trái.)
  const pw = p.offsetWidth;
  p.style.left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8) + 'px';
  p.style.right = 'auto';
  const b = el('notifBell'); if (b) b.setAttribute('aria-expanded', 'true');
  const _f = p.querySelector('.notif-item'); (_f || p).focus();   // BL-31: đưa focus vào panel khi mở
  // Đóng khi: bấm/chạm ra ngoài (cả touchstart — iOS không phát mousedown khi chạm vùng trống),
  // và khi bấm Esc (trước đây không có handler bàn phím nào -> mở panel bằng phím là kẹt luôn).
  setTimeout(() => {
    document.addEventListener('mousedown', _notifOutside, true);
    document.addEventListener('touchstart', _notifOutside, true);
    document.addEventListener('keydown', _notifKey, true);
  }, 0);
}
function _notifOutside(e) {
  const p = el('notifPanel');
  if (p && !p.contains(e.target) && !e.target.closest('#notifBell')) closeNotif();
}
function _notifKey(e) { if (e.key === 'Escape') { closeNotif(); const b = el('notifBell'); if (b) b.focus(); } }   // BL-31: Esc trả focus về chuông
/* ---- Menu trượt trên mobile ---- */
function toggleSide() {
  const s = document.querySelector('.side'), b = el('sideBackdrop');
  const open = s && s.classList.toggle('open');
  if (b) b.classList.toggle('show', !!open);
  document.body.classList.toggle('drawer-open', !!open);   // BL-55: khoá cuộn trang nền khi drawer mở
  const h = document.querySelector('button.hamburger[data-act="toggleSide"]');   // BL-31: a11y (KHÔNG khớp #backBtn/backdrop)
  if (h) h.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { const fb = el('nav') && el('nav').querySelector('button'); if (fb) fb.focus(); }
}
function closeSide() {
  const s = document.querySelector('.side'), b = el('sideBackdrop');
  if (s) s.classList.remove('open'); if (b) b.classList.remove('show');
  document.body.classList.remove('drawer-open');
  const h = document.querySelector('button.hamburger[data-act="toggleSide"]');   // BL-31: a11y
  if (h) h.setAttribute('aria-expanded', 'false');
}
// BL-31: Esc đóng drawer + trả focus về nút Menu. Named function -> addEventListener dedup nếu renderAdmin chạy lại.
function _escDrawer(e) { if (e.key === 'Escape' && document.querySelector('.side.open')) { closeSide(); const h = document.querySelector('button.hamburger[data-act="toggleSide"]'); if (h) h.focus(); } }
/* ================= ĐỊNH TUYẾN (BL-10) =================
   Trước đây mọi màn quản trị dùng chung URL '/': Back thoát app, F5 mất chỗ, không gửi link được.
   Mỗi màn nay có đường dẫn riêng (/students, /rooms...). Server đã trả index.html cho mọi path
   không phải /api (SPA fallback), và sw.js trả index.html cho request điều hướng khi offline (BL-14),
   nên đổi URL không cần thêm gì ở server. '/' = Tổng quan (mặc định). */
const VIEW_PATHS = {
  dashboard: '/', exec: '/dieu-hanh', students: '/hoc-vien', rooms: '/phong', services: '/dich-vu',
  checkin: '/check-in', invoices: '/tien-phong', revenue: '/doanh-thu', reg: '/dang-ky-noi-tru',
  checkout: '/tra-phong', repair: '/bao-hong', violations: '/vi-pham', feedback: '/gop-y',
  audit: '/lich-su', settings: '/cai-dat',
};
const PATH_VIEWS = Object.fromEntries(Object.entries(VIEW_PATHS).map(([v, p]) => [p, v]));
const pathForView = v => VIEW_PATHS[v] || '/';
// Đường dẫn hiện tại -> tên view (null nếu không phải màn quản trị nào, vd /dang-ky công khai).
function viewFromPath(pathname) {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  return PATH_VIEWS[p] || null;
}

/* ================= BỘ LỌC TRÊN URL (BL-17) =================
   Path = màn (đã có ở BL-10). Query = bộ lọc CỦA CHÍNH màn đó. Vì path tách namespace theo màn,
   mỗi màn tự đặt tên tham số query mà không đụng màn khác (vd /hoc-vien?f=in, /lich-su?nguoi=an).
   Mỗi màn khai read()/write():
   - read(params): dựng LẠI toàn bộ trạng thái lọc từ query — thiếu tham số nào thì về mặc định
     (URL là nguồn sự thật khi nạp đầu / Back-Forward).
   - write(): sinh URLSearchParams từ biến RAM hiện tại, BỎ giá trị mặc định cho URL gọn.
   Màn không có bộ lọc thì không cần đăng ký (filterUrl trả về path trơn).
   Ngoài phạm vi: elecMonth (modal "Chỉ số điện" — không có route riêng); ST.facilityFilter (phạm vi
   toàn cục, có bộ chọn riêng, áp cho MỌI màn — không phải bộ lọc của một màn). */
const FILTERS = {
  students: {
    read: q => {
      stuFilter = q.get('f') || 'all';
      const s = q.get('sort') || '';
      stuSort = s ? { key: s.replace(/^-/, ''), dir: s[0] === '-' ? -1 : 1 } : { key: '', dir: 1 };
      stuSearch = q.get('q') || '';
    },
    write: () => {
      const p = new URLSearchParams();
      if (stuFilter && stuFilter !== 'all') p.set('f', stuFilter);
      if (stuSort && stuSort.key) p.set('sort', (stuSort.dir === -1 ? '-' : '') + stuSort.key);
      if (stuSearch) p.set('q', stuSearch);
      return p;
    },
  },
  services: {
    read: q => {
      svcTab = q.get('tab') === 'parking' ? 'parking' : 'washing';
      vehSearch = q.get('q') || '';
    },
    write: () => {
      const p = new URLSearchParams();
      if (svcTab && svcTab !== 'washing') p.set('tab', svcTab);
      if (vehSearch) p.set('q', vehSearch);
      return p;
    },
  },
  checkin: {
    read: q => { logFilter = q.get('loai') || 'all'; },
    write: () => {
      const p = new URLSearchParams();
      if (logFilter && logFilter !== 'all') p.set('loai', logFilter);
      return p;
    },
  },
  invoices: {
    read: q => {
      invMonth = q.get('thang') || curMonth();
      invFilter = q.get('loc') || 'all';
      invSearch = q.get('q') || '';
    },
    write: () => {
      const p = new URLSearchParams();
      if (invMonth && invMonth !== curMonth()) p.set('thang', invMonth);
      if (invFilter && invFilter !== 'all') p.set('loc', invFilter);
      if (invSearch) p.set('q', invSearch);
      return p;
    },
  },
  revenue: {
    read: q => { revYear = q.get('nam') || curMonth().slice(0, 4); },
    write: () => {
      const p = new URLSearchParams();
      if (revYear && revYear !== curMonth().slice(0, 4)) p.set('nam', revYear);
      return p;
    },
  },
  audit: {
    read: q => {
      auditFilter = {
        user: q.get('nguoi') || '', from: q.get('tu') || '', to: q.get('den') || '',
        offset: +(q.get('offset') || 0) || 0,
      };
      auditLimit = +(q.get('limit') || 200) || 200;
    },
    write: () => {
      const p = new URLSearchParams();
      if (auditFilter.user) p.set('nguoi', auditFilter.user);
      if (auditFilter.from) p.set('tu', auditFilter.from);
      if (auditFilter.to) p.set('den', auditFilter.to);
      if (auditFilter.offset) p.set('offset', String(auditFilter.offset));
      if (auditLimit && auditLimit !== 200) p.set('limit', String(auditLimit));
      return p;
    },
  },
  // Cài đặt: nhóm (tab) đang mở lên URL -> /cai-dat?tab=gioithieu mở THẲNG nhóm đó, F5 giữ nguyên
  // nhóm, gửi link cho đồng nghiệp là họ vào đúng chỗ. Giá trị lạ -> viewSettings tự nắn về 'gia'.
  settings: {
    read: q => { settingsTab = q.get('tab') || 'gia'; },
    write: () => {
      const p = new URLSearchParams();
      if (settingsTab && settingsTab !== 'gia') p.set('tab', settingsTab);
      return p;
    },
  },
};
// URL hiện tại (đường dẫn đã chuẩn hoá + query) — để so sánh idempotent trước khi ghi history.
function curUrl() {
  const p = (location.pathname || '/').replace(/\/+$/, '') || '/';
  return p + location.search;
}
// path của màn + '?' + bộ lọc (đã bỏ mặc định). Màn chưa đăng ký -> path trơn.
function filterUrl(view) {
  const qs = FILTERS[view] ? FILTERS[view].write().toString() : '';
  return pathForView(view) + (qs ? '?' + qs : '');
}
// Đồng bộ RAM -> URL khi đổi bộ lọc TRONG cùng một màn. Dùng replaceState nên KHÔNG rác lịch sử:
// nút Back (kể cả nút cứng Android trên PWA) vẫn rời màn thay vì lùi qua từng lần đổi bộ lọc; F5 và
// copy link vẫn giữ đúng bộ lọc. Gọi ở CUỐI mỗi viewX() (bắt mọi setter re-render) + ở ô tìm kiếm
// (những ô này lọc bằng ẩn/hiện hàng, không re-render nên phải gọi tay).
function syncFilterUrl() {
  if (!Auth.user || !el('nav')) return;             // chỉ áp cho giao diện quản trị
  const target = filterUrl(ST.view);
  if (curUrl() !== target) history.replaceState({ view: ST.view, d: navDepth() }, '', target);
}
// BL-58: độ sâu điều hướng TRONG app, lưu ở history.state.d (theo mỗi entry nên Back/Forward khôi phục đúng).
// Nút "Quay lại" (‹) chỉ hiện khi d>0 → ở màn gốc thì ẩn, không bấm back ra ngoài app.
const navDepth = () => (history.state && history.state.d) || 0;
function goBack() { history.back(); }               // routing (BL-10) + onpopstate đã xử lý sẵn
function updateBackBtn() { const b = el('backBtn'); if (b) b.style.display = navDepth() > 0 ? '' : 'none'; }

// opts.replace: nạp lần đầu (thay URL, không thêm history) · opts.fromPop: đến từ nút Back/Forward
// (URL đã đổi sẵn, chỉ đồng bộ lại nếu bị nắn view) · mặc định: điều hướng thường -> pushState.
function adminGo(view, opts) {
  opts = opts || {};
  // BL-13: dữ liệu nền chưa nạp xong (đang boot / boot lỗi / đang thử lại) -> đừng vẽ màn rỗng hoặc
  // crash vì ST.students còn trống; quay về luồng nạp (hiện spinner rồi lỗi/Thử lại nếu vẫn hỏng).
  if (!_bootLoaded) return bootLoad(view, { replace: true });
  // Đang điền dở form mà bấm menu khác -> hỏi trước, đừng vứt luôn công sức của người ta.
  // _dangLuu = đang trong luồng lưu (adminGo được gọi lại sau khi lưu xong) -> không hỏi.
  if (!window._dangLuu && typeof formDangDo === 'function' && formDangDo()) {
    if (!confirm('Bạn có dữ liệu chưa lưu.\n\nRời khỏi và bỏ những gì vừa nhập?')) {
      // Người dùng bấm Back rồi lại Huỷ: trình duyệt ĐÃ lùi URL — kéo lại về màn đang đứng.
      // pushState KHÔNG kích hoạt popstate nên không sinh vòng lặp. Giữ cả bộ lọc đang xem (BL-17).
      if (opts.fromPop) history.pushState({ view: ST.view, d: navDepth() }, '', filterUrl(ST.view));
      return;
    }
    closeModalNgay();
  }
  if (view === 'requests') view = 'reg'; // alias cũ → trang Đăng ký ở nội trú
  if (view === 'vehicles') { svcTab = 'parking'; view = 'services'; } // Xe đã gộp vào Dịch vụ → Gửi xe
  // Chặn nhân viên (staff) truy cập các mục dành riêng quản trị (kể cả deep-link — nay deep-link có thật)
  if (ADMIN_ONLY_VIEWS.includes(view) && Auth.user.role !== 'admin') view = 'dashboard';
  const prev = ST.view;
  ST.view = view; closeSide();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.v === view));
  el('pgTitle').textContent = AdminTitles[view][0];
  el('pgSub').textContent = AdminTitles[view][1];
  el('topActions').innerHTML = '';
  // BL-17: trên đường "URL-là-nguồn" (nạp đầu {replace} / Back-Forward {fromPop}), nạp bộ lọc từ query
  // vào RAM TRƯỚC khi vẽ, để deep-link/F5 hiện đúng bộ lọc. Điều hướng thường: RAM là nguồn -> ghi ra URL.
  if ((opts.replace || opts.fromPop) && FILTERS[view]) FILTERS[view].read(new URLSearchParams(location.search));
  // Đồng bộ URL. pushState/replaceState KHÔNG kích hoạt popstate -> an toàn, không vòng lặp.
  const target = filterUrl(view);   // path màn + query bộ lọc hiện tại (đã bỏ mặc định)
  const cur = curUrl();
  if (opts.replace || opts.fromPop || view === prev) {
    // nạp đầu (replace) -> gốc d=0; Back/Forward (fromPop) -> giữ d đã khôi phục; vẽ lại cùng màn -> giữ d.
    if (cur !== target) history.replaceState({ view, d: opts.replace ? 0 : navDepth() }, '', target);
  } else {
    history.pushState({ view, d: navDepth() + 1 }, '', target);      // điều hướng thường -> sâu thêm 1 bước
  }
  updateBackBtn();  // BL-58: hiện/ẩn nút Quay lại theo độ sâu điều hướng
  const _vp = ({ exec: viewExec, dashboard: viewDashboard, students: viewStudents, rooms: viewRooms, services: viewServices, checkin: viewCheckin, invoices: viewInvoices, revenue: viewRevenue, reg: viewRequests, checkout: viewRequests, repair: viewRequests, violations: viewRequests, feedback: viewRequests, audit: viewAudit, settings: viewSettings }[view])();
  // BL-21: màn async reject (lỗi tải) -> khối lỗi + Thử lại thay vì kẹt spinner. (Các màn tự bắt lỗi nội bộ thì không reject.)
  if (_vp && _vp.catch) _vp.catch(e => renderViewError(view, e));
}
// Nút Back/Forward của trình duyệt (kể cả nút cứng Android trên PWA standalone).
// Gán bằng onpopstate (không phải addEventListener) để boot() gọi lại nhiều lần cũng không nhân đôi.
window.onpopstate = () => {
  if (!Auth.user || !['admin', 'staff'].includes(Auth.user.role) || !el('nav')) return; // chỉ áp cho giao diện quản trị
  const v = viewFromPath(location.pathname);
  if (v) adminGo(v, { fromPop: true });
  else location.reload(); // lùi tới đường dẫn ngoài hệ view (vd /dang-ky) -> để boot() tự quyết
};
const roomById = id => ST.rooms.find(r => r.id === id);
const studentById = id => ST.students.find(s => s.id === id);
const facilityName = id => { const f = ST.facilities.find(x => x.id === id); return f ? f.name : '—'; };

/* ---------- ĐIỀU HÀNH (DASHBOARD LÃNH ĐẠO) ---------- */
// Biểu đồ cột doanh thu dự báo theo tháng (BL-49: caller truyền đủ 12 khe tháng -> cột đầy chiều ngang)
function svgBars(rows) {
  const n = rows.length || 1;
  const W = Math.max(260, Math.min(720, n * 60)), H = 240, pt = 16, pb = 30, pl = 6, pr = 6;
  const max = Math.max(1, ...rows.map(r => r.total));
  const cw = (W - pl - pr) / n, bw = Math.min(34, cw * 0.5), ch = H - pt - pb;
  const yOf = v => pt + ch - (v / max) * ch;
  // BL-49: 1 cột/tháng (bỏ lớp 2 màu vô nghĩa vì paid=total); tháng chưa có -> height 0, chỉ còn nhãn trục.
  const g = rows.map((r, i) => {
    const x = pl + cw * i + (cw - bw) / 2, yt = yOf(r.total);
    return `<g><rect x="${x}" y="${yt}" width="${bw}" height="${(pt + ch - yt).toFixed(1)}" rx="3" fill="var(--brand)"><title>${monthLabel(r.month)} · Dự báo ${money(r.total)}</title></rect>` +
      `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${r.label}</text></g>`;
  }).join('');
  // Khoá chiều cao ${H}px: trước đây width:100% làm SVG phóng to theo bề ngang -> cao ~450px, nhìn như hỏng
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="font-family:var(--sans);width:100%;height:${H}px;display:block">${g}</svg>`;
}
// Biểu đồ tròn (donut)
function svgDonut(segs) {
  const total = segs.reduce((a, s) => a + s.value, 0) || 1;
  const R = 78, r = 48, cx = 90, cy = 90;
  let a0 = -Math.PI / 2;
  const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
  const arcs = segs.filter(s => s.value > 0).map(s => {
    const a1 = a0 + (s.value / total) * Math.PI * 2, large = (a1 - a0) > Math.PI ? 1 : 0;
    const d = `M${p(a0, R)} A${R} ${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${s.color}"><title>${s.label}: ${money(s.value)} · ${Math.round(s.value / total * 100)}%</title></path>`;
  }).join('');
  return `<svg viewBox="0 0 180 180" width="164" height="164">${arcs}</svg>`;
}
