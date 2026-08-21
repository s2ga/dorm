// === app-public-auth.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
/* ===== SSO Microsoft — LUỒNG SPA (không client_secret, không rotation) =========================
   Trình duyệt tự chạy auth-code + PKCE với Microsoft (đăng ký app kiểu SPA), tự đổi mã lấy id_token,
   rồi gửi id_token về /auth/sso/verify. Server xác minh chữ ký (JWKS) + cấp COOKIE PHIÊN ktx_token.
   Token Microsoft chỉ dùng MỘT LẦN để xác minh danh tính; MỌI API sau đó dùng cookie của app -> thu
   hồi/khoá tài khoản có hiệu lực TỨC THÌ (token_epoch + đọc DB mỗi request), không đợi token hết hạn. */
const _MS_AUTH = t => `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`;
const _MS_TOKEN = t => `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`;
function _b64url(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function _randStr(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return _b64url(a); }
async function _sha256url(s) { return _b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }

// Bấm "Đăng nhập bằng Microsoft": máy chủ dựng yêu cầu uỷ quyền rồi 302 sang Microsoft.
async function ssoLogin() {
  let cfg;
  try { cfg = await API.ssoConfig(); } catch (e) { return toast('Không lấy được cấu hình đăng nhập Microsoft', 'err'); }
  if (!cfg || !cfg.enabled) return toast('Đăng nhập Microsoft chưa được cấu hình', 'err');
  location.href = '/api/auth/sso/start';
}

// Microsoft chuyển về (origin/?code=...&state=...). Trả true nếu đang trong luồng SSO (đã xử lý).
// Bước đổi mã do TRÌNH DUYỆT làm (redirect URI khai kiểu SPA -> Microsoft đòi header Origin); tham số
// xin qua /auth/sso/exchange-params, endpoint đó chỉ trả lời khi cookie state khớp.
async function ssoHandleReturn() {
  const qp = new URLSearchParams(location.search);
  if (!qp.get('code') || !qp.get('state')) {
    // Microsoft từ chối ngay từ màn đăng nhập (người dùng bấm Huỷ, admin chưa cấp quyền...)
    if (qp.get('error')) { location.href = '/?sso_error=' + encodeURIComponent(qp.get('error_description') || qp.get('error')); return true; }
    return false;
  }
  history.replaceState(null, '', location.pathname); // dọn ?code khỏi thanh địa chỉ
  const fail = msg => { location.href = '/?sso_error=' + encodeURIComponent(msg); }; // dùng lại màn login + ghi chú lỗi
  el('app').innerHTML = '<div class="intro-loading"><div class="spinner"></div></div>';
  try {
    let saved;
    try { saved = await API.ssoExchangeParams(qp.get('state')); }
    catch (eP) { fail((eP && eP.message) || 'Phiên đăng nhập Microsoft đã hết hạn. Vui lòng thử lại.'); return true; }
    const body = new URLSearchParams({
      client_id: saved.clientId, grant_type: 'authorization_code', code: qp.get('code'),
      redirect_uri: saved.redirectUri, code_verifier: saved.codeVerifier, scope: 'openid profile email',
    });
    // Lời gọi này đi TRỰC TIẾP sang Microsoft (không qua api() nên không được dịch lỗi giúp). Mất
    // mạng / bị tường lửa chặn thì fetch ném TypeError("Failed to fetch") — chữ Anh, người dùng đọc
    // không hiểu, mà nó lại hiện ngay trên màn đăng nhập. Bắt riêng để nói bằng tiếng Việt.
    let r;
    try {
      r = await fetch(_MS_TOKEN(saved.tenantId), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    } catch (eNet) {
      fail('Không kết nối được tới Microsoft (mất mạng hoặc bị chặn). Vui lòng thử lại, hoặc đăng nhập bằng tên và mật khẩu.');
      return true;
    }
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) { fail('Microsoft từ chối: ' + String(tok.error_description || tok.error || 'không đổi được mã đăng nhập').split('\n')[0]); return true; }
    await API.ssoVerify(tok.id_token);   // server xác minh id_token (JWKS) + cấp cookie phiên
    Auth.user = null; boot();            // đã có cookie -> boot vẽ app / màn chờ duyệt
  } catch (e) {
    fail((e && e.message) || 'Lỗi kết nối khi đăng nhập Microsoft.');
  }
  return true;
}

/* ================= ĐIỀU PHỐI CHÍNH ================= */
// Nhân viên kiêm khách thuê phòng: vai nhân viên + gắn hồ sơ (student_id) -> được chuyển 2 cổng.
const laKiemNhiem = () => !!(Auth.user && Auth.user.student_id && Auth.user.role !== 'student');
// Cổng đang mở ('admin'|'student'|'maintenance'|'secretary') — các vòng poll tự tắt theo cờ này,
// KHÔNG theo role (người kiêm nhiệm đổi cổng nhưng role không đổi).
let _congDangMo = null;

async function boot() {
  if (await ssoHandleReturn()) return; // quay về từ Microsoft (SSO SPA) -> đổi mã + cấp cookie rồi thôi
  if (location.pathname.replace(/\/$/, '') === '/dang-ky') return renderPublicRegister();
  // `/auth/me` là NGUỒN DUY NHẤT về danh tính: cookie httpOnly xác thực, server đọc user từ DB trả về.
  // KHÔNG lấy thông tin user từ response /login nữa (login chỉ đặt cookie) -> không có 2 nguồn lệch nhau,
  // và F5 / admin đổi cơ sở / đổi họ tên đều tự tươi vì mỗi lần tải trang đều hỏi lại /me (BL-06).
  // localStorage (Auth.user) chỉ còn là hint HIỂN THỊ để mở được app khi offline, không phải nguồn xác thực.
  let user;
  try {
    user = await API.me();
    Auth.user = user;                 // lưu lại hint cho lần mở offline sau
  } catch (e) {
    if (e && e.status === 401) { Auth.user = null; return renderLogin(); } // chưa / không còn đăng nhập
    // Lỗi mạng (offline / server đang ngủ): dùng tạm hint đã lưu để app vẫn mở; không có thì về đăng nhập.
    user = Auth.user;
    if (!user) return renderLogin();
  }
  if (user.must_change_password) return renderForceChangePw();
  if (user.approved === false) return renderChoDuyet();
  // Kiêm nhiệm đã chọn cổng khách thuê -> giữ lựa chọn qua F5; server vẫn phân quyền theo DB.
  if (laKiemNhiem() && localStorage.getItem('ktx_portal') === 'tenant') return renderStudent();
  if (user.role === 'admin' || user.role === 'staff') renderAdmin();
  else if (user.role === 'maintenance') renderMaintenance();
  else if (user.role === 'secretary') renderSecretary();
  else renderStudent();
}

// Tài khoản do đăng nhập Microsoft tự tạo, admin chưa gán vai/duyệt -> chưa vào được gì.
function renderChoDuyet() {
  const u = Auth.user || {};
  el('app').innerHTML = `
    <div class="auth"><div class="auth-right" style="flex:1">
      <div class="auth-form" style="text-align:center">
        <div style="font-size:40px">${IC.clock || IC.info}</div>
        <h2>Tài khoản đang chờ duyệt</h2>
        <p class="sub">Bạn đã đăng nhập bằng Microsoft với email <strong>${esc(u.email || u.username || '')}</strong>,
        nhưng quản trị viên chưa cấp quyền sử dụng. Vui lòng liên hệ ban quản lý khu nội trú để được duyệt.</p>
        <button class="btn pri lg auth-btn" data-act="logout">Đăng xuất</button>
      </div>
    </div></div>`;
}

/* ================= TRANG ĐĂNG KÝ CÔNG KHAI ================= */
async function renderPublicRegister() {
  el('app').innerHTML = `<div class="intro-loading"><div class="spinner"></div></div>`;
  let info = null;
  try { info = await API.publicInfo(); } catch (e) {}
  if (!info || typeof info !== 'object') {   // BL-22: publicInfo lỗi -> KHÔNG render trang với giá "0" giả
    el('app').innerHTML = `<div class="login-wrap"><div class="login-card" style="text-align:center">
      <div style="color:var(--red-ink,#b91c1c);display:flex;justify-content:center;margin-bottom:8px">${IC.alert}</div>
      <h1 style="font-family:var(--serif);margin:6px 0;font-size:22px">Không tải được thông tin</h1>
      <p class="muted" style="margin:0 0 16px">Máy chủ có thể đang bận hoặc mất mạng. Vui lòng tải lại trang.</p>
      <button class="btn pri" data-act="reloadPage">${IC.refresh} Tải lại</button></div></div>`;
    return;
  }
  window._pubCccd = {};
  const dorm = esc(info.dorm_name || 'Ký túc xá Học viên');
  const imgCard = (key, def) => { const label = esc(info['imgcap_' + key] || def); return `<figure class="ph-img"><img src="/api/public/image/${key}" alt="${label}" loading="lazy" data-err="onImgRemove"><span class="ph-ico">${IC.building}</span><figcaption>${label}</figcaption></figure>`; };
  const amen = (ico, label) => `<div class="amen-item"><span class="amen-ic">${ico}</span><span>${label}</span></div>`;
  const priceRow = (label, val, unit, note) => `<tr><td>${label}${note ? `<div class="price-sub">${note}</div>` : ''}</td><td class="num"><strong>${money(val)}</strong><span class="muted"> ${unit}</span></td></tr>`;
  const priceRowOpt = (label, val, unit) => `<tr><td>${label} <span class="price-opt">tùy chọn</span><div class="price-sub">Chỉ tính khi đăng ký sử dụng</div></td><td class="num"><strong>${money(val)}</strong><span class="muted"> ${unit}</span></td></tr>`;
  const T = (k, def) => esc(info[k] || def); // nội dung trang giới thiệu (admin chỉnh trong Cài đặt)
  el('app').innerHTML = `
  <div class="intro">
    <header class="intro-hero">
      <figure class="intro-hero-bg ph-img"><img src="/api/public/image/hero" alt="" data-err="onImgRemove"><span class="ph-ico">${IC.building}</span></figure>
      <div class="intro-hero-in">
        <div class="intro-brand">${IC.home} <span>${dorm}</span></div>
        <h1>${T('intro_hero_title', 'Không gian nội trú\nan tâm & nề nếp').replace(/\n/g, '<br>')}</h1>
        <p>${info.address ? esc(info.address) + ' — ' : ''}${T('intro_hero_desc', 'chỗ ở tiện nghi, kỷ luật, đồng hành cùng học viên trên hành trình sang Nhật.')}</p>
        <div class="intro-stats">
          <div><b>${info.room_count != null ? info.room_count : '—'}</b><span>Phòng ở</span></div>
          <div><b>${info.bed_free != null ? info.bed_free : '—'}</b><span>Giường trống${info.bed_soon ? ` · +${info.bed_soon} sắp trống` : ''}</span></div>
          <div><b>${money(info.room_fee)}</b><span>Thuê ghép / tháng</span></div>
        </div>
        <div class="intro-cta">
          <a class="btn pri lg" href="#dangky">${IC.filePen} Đăng ký nội trú</a>
        </div>
      </div>
    </header>

    <section class="intro-sec">
      <div class="intro-head"><span class="eyebrow">${T('intro_about_eyebrow', 'Về khu nội trú')}</span><h2>${T('intro_about_title', 'Khuôn viên ngăn nắp, an ninh, gần trường')}</h2>
        <p>${T('intro_about_desc', 'Khu nội trú bố trí gọn gàng với khu tự học, sinh hoạt chung và bảo vệ 24/7 — nơi học viên rèn nếp sống kỷ luật kiểu Nhật.')}</p></div>
      <div class="intro-gallery">
        ${imgCard('khuon-vien-1', 'Khuôn viên')}
        ${imgCard('khuon-vien-2', 'Sảnh sinh hoạt chung')}
        ${imgCard('khuon-vien-3', 'Khu tự học')}
      </div>
    </section>

    <section class="intro-sec alt">
      <div class="intro-head"><span class="eyebrow">${T('intro_rooms_eyebrow', 'Phòng ở')}</span><h2>${T('intro_rooms_title', 'Phòng ở tiện nghi, sạch sẽ')}</h2>
        <p>${T('intro_rooms_desc', 'Phòng ghép đầy đủ nội thất: giường tầng, tủ locker riêng, máy lạnh, kệ đồ — vệ sinh định kỳ.')}</p></div>
      <div class="intro-gallery">
        ${imgCard('phong-1', 'Phòng ghép')}
        ${imgCard('phong-2', 'Nội thất phòng')}
        ${imgCard('phong-3', 'Khu vệ sinh')}
      </div>
    </section>

    <section class="intro-sec">
      <div class="intro-head"><span class="eyebrow">Tiện ích</span><h2>${T('intro_amenities_title', 'Tiện ích & dịch vụ')}</h2></div>
      <div class="amen-grid">
        ${amen(IC.bed, 'Giường tầng · tủ locker riêng')}
        ${amen(IC.wifi, 'Wifi tốc độ cao')}
        ${amen(IC.washer, 'Máy giặt chung')}
        ${amen(IC.bike, 'Bãi giữ xe máy')}
        ${amen(IC.shield, 'An ninh, bảo vệ 24/7')}
        ${amen(IC.users, 'Nam · Nữ riêng tầng')}
        ${amen(IC.building, 'Khu tự học · sinh hoạt chung')}
        ${amen(IC.sparkles, 'Vệ sinh phòng định kỳ')}
      </div>
    </section>

    <section class="intro-sec alt">
      <div class="intro-head"><span class="eyebrow">Chi phí</span><h2>${T('intro_price_title', 'Bảng giá thuê phòng ở ghép')}</h2>
        <p>${T('intro_price_desc', 'Minh bạch theo từng khoản. Tiền điện tính theo công-tơ, chia đều số người ở phòng.')}</p></div>
      <div class="intro-price">
        <div class="price-form-tag">${IC.users} Hình thức: <strong>Thuê phòng ở ghép</strong> — nhiều học viên ở chung một phòng, chia sẻ chi phí</div>
        <table><tbody>
          <tr class="price-grp"><td colspan="2">${IC.calendar} Chi phí hằng tháng</td></tr>
          ${priceRow('Tiền phòng', info.room_fee, '/người/tháng')}
          ${priceRow('Tiền điện', info.electric_unit, '/kWh', 'Theo công-tơ, chia đều số người ở phòng')}
          ${priceRow('Tiền nước', info.water_fee, '/người/tháng')}
          ${priceRow('Dịch vụ chung', info.service_fee, '/người/tháng', 'Wifi, rác, an ninh 24/7')}
          ${priceRowOpt('Máy giặt', info.washing_fee, '/tháng')}
          ${priceRowOpt('Gửi xe máy', info.parking_fee, '/xe/tháng')}
          <tr class="price-grp"><td colspan="2">${IC.lock} Đóng một lần khi nhận phòng</td></tr>
          <tr class="price-hi"><td><strong>Tiền cọc</strong><div class="price-sub">${IC.checkCircle} Được hoàn lại khi trả phòng đúng quy định</div></td><td class="num"><strong>${money(info.deposit_fee)}</strong></td></tr>
        </tbody></table>
        <div class="price-callout">${IC.info} <strong>Khi nhận phòng, bạn đóng:</strong> tiền cọc <strong>${money(info.deposit_fee)}</strong> (được hoàn lại khi trả phòng) <strong>+ chi phí tháng đầu</strong> (tiền phòng, điện, nước, dịch vụ). Máy giặt và gửi xe chỉ tính khi bạn đăng ký sử dụng.</div>
      </div>
    </section>

    <section class="intro-sec" id="dangky">
      <div class="intro-head"><span class="eyebrow">Đăng ký</span><h2>Đăng ký ở nội trú</h2>
        <p>Điền thông tin bên dưới, ban quản lý sẽ liên hệ xếp phòng cho bạn — không cần tài khoản.</p></div>
      <div class="intro-form"><div id="pubBody"><div class="spinner"></div></div></div>
    </section>

    <section class="intro-sec alt">
      <div class="intro-head"><span class="eyebrow">Liên hệ</span><h2>${T('intro_contact_title', 'Liên hệ & đường đến')}</h2>
        <p>${T('intro_contact_desc', 'Ghé thăm hoặc gọi cho ban quản lý để được tư vấn xếp phòng.')}</p></div>
      <div class="intro-contact">
        <div class="contact-info">
          ${info.address ? `<div class="ci-row">${IC.mapPin}<div><b>Địa chỉ</b><span>${esc(info.address)}</span></div></div>` : ''}
          ${/* Dưới tên khu là SỐ HOTLINE, không phải câu mô tả — người ta vào đây để gọi. */''}
          <div class="ci-row">${IC.home}<div><b>${dorm}</b>${info.hotline
    ? `<a class="ci-tel" href="tel:${esc(String(info.hotline).replace(/[\s.]/g, ''))}">${IC.phone}${esc(info.hotline)}</a>`
    : '<span>Ban quản lý khu nội trú</span>'}${info.contact_person ? `<span>${esc(info.contact_person)}</span>` : ''}</div></div>
        </div>
        ${info.address ? `<div class="contact-map"><iframe title="Bản đồ" src="https://www.google.com/maps?q=${encodeURIComponent(info.address)}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>` : ''}
      </div>
    </section>

    <footer class="intro-foot">${dorm}${info.address ? ` · ${esc(info.address)}` : ''}</footer>
  </div>`;
  el('pubBody').innerHTML = `
    <form id="applyForm">
      <div class="grid2">
        <div class="field"><label>Họ tên ${SAO}</label><input id="a_name" required></div>
        <div class="field"><label>Số điện thoại ${SAO}</label><input id="a_phone" type="tel" autocomplete="tel" inputmode="tel" required></div>
      </div>
      ${info.facilities && info.facilities.length ? `<div class="field"><label>Cơ sở đăng ký ${SAO}</label><select id="a_facility">${info.facilities.map(f => `<option value="${f.id}">${esc(f.name)}${f.address ? ' — ' + esc(f.address) : ''}</option>`).join('')}</select></div>` : ''}
      <div class="grid2">
        <div class="field"><label>Giới tính ${SAO}</label><select id="a_gender"><option value="female">Nữ</option><option value="male">Nam</option></select></div>
        <div class="field"><label>Ngày sinh</label><input id="a_birth"></div>
      </div>
      <div class="field"><label>Ngày muốn nhận phòng ${SAO}</label><input id="a_movein" required>
        <div class="muted" style="font-size:12.5px;margin-top:4px">${IC.info} Ban quản lý xếp phòng theo ngày này. Chọn từ hôm nay trở đi; chưa chắc ngày nào thì cứ chọn tạm rồi báo lại sau.</div>
      </div>
      <div class="muted" style="font-size:12.5px;margin:2px 0 7px">${IC.info} <strong>Chưa khai giảng?</strong> Nhiều bạn thuê phòng trước khi vào học — nếu chưa có mã học viên / lớp, bạn cứ <strong>bỏ trống 2 ô dưới</strong>. Khi nào có, báo Ban quản lý cập nhật sau.</div>
      <div class="grid2">
        <div class="field"><label>Mã học viên <span class="opt">(nếu đã có)</span></label><input id="a_code"></div>
        <div class="field"><label>Lớp <span class="opt">(nếu đã có)</span></label><input id="a_class"></div>
      </div>
      <div class="field"><label>Dịch vụ đăng ký thêm</label>
        <label class="check"><input type="checkbox" id="a_wash"> ${IC.washer} Máy giặt (${money(info.washing_fee)}/tháng)</label>
        <label class="check" style="margin-top:8px"><input type="checkbox" id="a_park" data-change="onPlateBoxToggle"> ${IC.bike} Gửi xe (${money(info.parking_fee)}/xe/tháng)</label>
        <div id="plateBox" style="display:none;margin-top:8px"><input id="a_plate" placeholder="Biển số xe (VD: 63-B4 508.58)"></div>
      </div>
      <div class="field"><label>Ảnh CCCD (2 mặt)</label>
        <div class="muted" style="font-size:12px;margin:-2px 0 8px">${IC.info} Chụp <strong>ngang</strong>, đủ sáng, thấy rõ 4 góc. Ảnh sẽ tự xoay đúng chiều khi tải lên.</div>
        <div class="grid2">
          <div><div class="muted" style="font-size:12px;margin-bottom:4px"><strong>Mặt trước</strong> — có ảnh chân dung & số CCCD</div>
            <input type="file" id="a_cccd_front" accept="image/*" data-change="onPubCccdFront"><div id="cccdFrontPrev" style="margin-top:6px"></div></div>
          <div><div class="muted" style="font-size:12px;margin-bottom:4px"><strong>Mặt sau</strong> — có đặc điểm nhận dạng & ngày cấp</div>
            <input type="file" id="a_cccd_back" accept="image/*" data-change="onPubCccdBack"><div id="cccdBackPrev" style="margin-top:6px"></div></div>
        </div>
      </div>
      <div class="field"><label>Ghi chú</label><textarea id="a_note" rows="2"></textarea></div>
      <button class="btn pri lg" type="submit">Gửi đăng ký</button>
    </form>`;
  attachDate(el('a_birth'), '', { max: today() });   // ngày sinh không thể ở tương lai
  attachDate(el('a_movein'), '', { min: today() });  // nhận phòng thì từ hôm nay trở đi
  el('applyForm').addEventListener('submit', async e => {
    e.preventDefault();
    // Ô ngày là input đọc-chỉ có lịch riêng nên `required` của trình duyệt không bắt được -> chặn ở đây.
    const ngayVao = el('a_movein').dataset.iso || '';
    if (!ngayVao) { toast('Chọn ngày muốn nhận phòng', 'err'); el('a_movein').focus(); return; }
    if (ngayVao < today()) { toast('Ngày muốn nhận phòng đã qua — chọn lại', 'err'); el('a_movein').focus(); return; }
    // e.submitter có thể null (gửi form bằng lệnh, không qua nút bấm) -> tra ngược nút Gửi.
    // Đây là form học viên LẠ tự đăng ký: văng lỗi ở đây là mất đơn mà không ai biết.
    const btn = e.submitter || e.target.querySelector('[type=submit]') || {};
    btn.disabled = true; btn.textContent = 'Đang gửi...';
    const body = {
      name: el('a_name').value.trim(), phone: el('a_phone').value.trim(), gender: el('a_gender').value,
      birth_date: el('a_birth').dataset.iso || null, desired_check_in: el('a_movein').dataset.iso || null,
      code: el('a_code').value.trim(), class_name: el('a_class').value.trim(),
      rental_type: 'ghep', // KTX không cho thuê nguyên phòng nữa — bỏ ô chọn, mọi đơn mới đều là thuê ghép
      note: el('a_note').value.trim(),
      facility_id: el('a_facility') ? +el('a_facility').value : null,
      wants_washing: el('a_wash').checked, wants_parking: el('a_park').checked, plate: el('a_plate').value.trim(),
      cccd_front: window._pubCccd.front || null, cccd_back: window._pubCccd.back || null,
    };
    try {
      await API.publicApply(body);
      el('pubBody').innerHTML = `<div style="text-align:center;padding:20px">
        <div style="font-size:48px">${IC.checkCircle}</div>
        <h2 style="margin:12px 0 6px">Đã gửi đăng ký!</h2>
        <p class="muted">Cảm ơn ${esc(body.name)}. Quản lý ký túc xá sẽ liên hệ với bạn qua số <strong>${esc(body.phone)}</strong> để xếp phòng.</p>
      </div>`;
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Gửi đăng ký'; }
  });
}
// Nạp ảnh về đúng CHIỀU (theo cờ EXIF của điện thoại) rồi thu nhỏ → JPEG chuẩn, tránh ảnh bị xoay ngang/lộn ngược.
function loadImgEl(file) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); }); }
async function normalizeImage(file, maxDim = 1600, quality = 0.85) {
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; } // trình duyệt tự xoay đúng theo EXIF
  catch (e) { src = await loadImgEl(file); w = src.naturalWidth || src.width; h = src.naturalHeight || src.height; }
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(src, 0, 0, cw, ch);
  if (src.close) src.close();
  return { dataUrl: c.toDataURL('image/jpeg', quality), portrait: ch > cw };
}
async function pubCccd(input, side) {
  const f = input.files[0]; if (!f) return;
  if (!tepHopLe(input, f, 'Ảnh CCCD', ['image/png', 'image/jpeg'])) return;
  const box = el(side === 'front' ? 'cccdFrontPrev' : 'cccdBackPrev');
  box.innerHTML = '<span class="muted" style="font-size:12px">Đang xử lý ảnh…</span>';
  try {
    const { dataUrl, portrait } = await normalizeImage(f);
    window._pubCccd[side] = dataUrl;
    box.innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:130px;border-radius:8px;border:1px solid var(--line)">`
      + (portrait ? `<div class="muted" style="font-size:11.5px;color:var(--amber-ink);margin-top:4px">${IC.alert} Ảnh đang dọc — CCCD nên chụp NGANG, thẳng, đủ 4 góc.</div>` : '');
  } catch (e) { input.value = ''; window._pubCccd[side] = null; box.innerHTML = ''; toast('Không đọc được ảnh, vui lòng chụp lại', 'err'); }
}

/* ================= ĐĂNG NHẬP ================= */
async function renderLogin() {
  el('app').innerHTML = `
    <div class="auth">
      <div class="auth-left">
        <div class="auth-brand">
          <span class="auth-logo">${IC.home}</span>
          <div>
            <div class="ab-title">KHU NỘI TRÚ ESUHAI</div>
            <div class="ab-sub">Hệ thống quản lý nội trú</div>
          </div>
        </div>
        <div class="auth-hero">
          <h1>Ở an tâm,<br>quen dần nếp Nhật.</h1>
          <p>Một chỗ ở yên tâm, sinh hoạt ngăn nắp — để nếp sống và sự kỷ luật của người Nhật dần thành thói quen.</p>
          <a class="auth-hero-link" href="/dang-ky">${IC.building} Xem giới thiệu khu nội trú →</a>
        </div>
      </div>
      <div class="auth-right">
        <div class="auth-form">
          <h2>Đăng nhập</h2>
          <p class="sub" id="lgSub">Nhân viên và học viên dùng chung một chỗ đăng nhập.</p>
          <div id="lgNotice"></div>
          <div id="lgSso" style="display:none">
            <button type="button" class="btn lg auth-btn auth-sso" data-act="ssoLogin">${IC.shield} Đăng nhập bằng tài khoản Microsoft</button>
            <div class="auth-or"><span>hoặc</span></div>
          </div>
          <form id="loginForm">
            <div class="field"><label>Tài khoản</label><input id="lg_user" autocomplete="username" placeholder="Tên đăng nhập" autofocus></div>
            <div class="field"><label>Mật khẩu</label><input id="lg_pass" type="password" autocomplete="current-password" placeholder="Mật khẩu"></div>
            <button class="btn pri lg auth-btn" type="submit">Đăng nhập →</button>
          </form>
          <div class="auth-or"><span>Chưa có tài khoản?</span></div>
          <a class="auth-card" href="/dang-ky">
            <span class="ac-ico">${IC.graduation}</span>
            <div><b>Xem giới thiệu &amp; đăng ký nội trú</b><small>Xem phòng ở, tiện ích, bảng giá và đăng ký — không cần tài khoản</small></div>
            <span class="ac-arrow">→</span>
          </a>
        </div>
      </div>
    </div>`;

  // Thông báo khi vừa quay về từ Microsoft (server chuyển hướng kèm tham số)
  const qp = new URLSearchParams(location.search);
  if (qp.get('sso_pending')) {
    el('lgNotice').innerHTML = `<div class="auth-note">Tài khoản Microsoft của bạn đã được ghi nhận nhưng <strong>chưa được quản trị viên duyệt</strong>. Vui lòng liên hệ ban quản lý.</div>`;
  } else if (qp.get('sso_error')) {
    el('lgNotice').innerHTML = `<div class="auth-note err"><span class="err-inline">${esc(qp.get('sso_error'))}</span></div>`;
  }
  if (location.search) history.replaceState(null, '', location.pathname); // dọn URL cho sạch

  // Nút Microsoft chỉ hiện khi công ty đã cấu hình xong (ENV hoặc màn Cài đặt). Chưa cấu hình
  // mà vẫn hiện thì người dùng bấm vào chỉ nhận lỗi — thà giấu đi.
  API.ssoConfig().then(c => { if (c && c.enabled) el('lgSso').style.display = ''; }).catch(() => {});

  el('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.textContent = 'Đang vào...';
    try {
      // /login CHỈ xác thực + đặt cookie. KHÔNG gửi "cổng" (loại tài khoản là thuộc tính user trong DB),
      // và KHÔNG lấy thông tin user ở đây — boot() sẽ hỏi /auth/me (nguồn duy nhất về danh tính).
      await API.login(el('lg_user').value.trim(), el('lg_pass').value);
      Auth.user = null;   // xoá hint cũ để boot() lấy thông tin MỚI từ /me, không dùng nhầm dữ liệu người trước
      boot();             // boot() gọi /me + chọn giao diện theo user.role (quản lý / bảo trì / học viên)
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Đăng nhập →';
      toast(err.message, 'err');
    }
  });
}

// Bắt buộc đổi mật khẩu (tài khoản admin khởi tạo lần đầu)
function renderForceChangePw() {
  const u = Auth.user || {};
  el('app').innerHTML = `
    <div class="auth">
      <div class="auth-left">
        <div class="auth-brand"><span class="auth-logo">${IC.home}</span>
          <div><div class="ab-title">KHU NỘI TRÚ ESUHAI</div><div class="ab-sub">Bảo mật tài khoản</div></div></div>
        <div class="auth-hero">
          <h1>Đặt mật khẩu<br>của riêng bạn.</h1>
          <p>Đây là lần đăng nhập đầu tiên bằng mật khẩu khởi tạo. Vì an toàn, vui lòng đổi sang mật khẩu mới trước khi sử dụng hệ thống.</p>
        </div>
      </div>
      <div class="auth-right">
        <div class="auth-form">
          <h2>Đổi mật khẩu</h2>
          <p class="sub">Xin chào <strong>${esc(u.full_name || u.username || '')}</strong> — hãy tạo mật khẩu mới (tối thiểu 6 ký tự).</p>
          <form id="fcpForm">
            <div class="field"><label>Mật khẩu mới</label><input id="fcp_new" type="password" autocomplete="new-password" placeholder="Tối thiểu 6 ký tự" autofocus></div>
            <div class="field"><label>Nhập lại mật khẩu mới</label><input id="fcp_new2" type="password" autocomplete="new-password" placeholder="Nhập lại"></div>
            <button class="btn pri lg auth-btn" type="submit">Cập nhật mật khẩu →</button>
          </form>
          <div class="auth-or"><span>hoặc</span></div>
          <button class="btn" style="width:100%" data-act="logout">${IC.logOut} Đăng xuất</button>
        </div>
      </div>
    </div>`;
  el('fcpForm').addEventListener('submit', async e => {
    e.preventDefault();
    const n1 = el('fcp_new').value, n2 = el('fcp_new2').value;
    if (n1.length < 6) return toast('Mật khẩu mới tối thiểu 6 ký tự', 'err');
    if (n1 !== n2) return toast('Hai mật khẩu mới không khớp', 'err');
    const btn = e.submitter; btn.disabled = true; btn.textContent = 'Đang cập nhật...';
    try {
      await API.changePassword(n1);
      Auth.user = { ...Auth.user, must_change_password: false };
      toast('Đã đổi mật khẩu, chào mừng bạn!');
      boot();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Cập nhật mật khẩu →'; }
  });
}

/* ================================================================= */
/* ==============          GIAO DIỆN QUẢN LÝ          =============== */
/* ================================================================= */
const AdminTitles = {
  exec: ['Điều hành', 'Báo cáo lãnh đạo — KPI & biểu đồ'],
  dashboard: ['Tổng quan', 'Bảng điều khiển ký túc xá'],
  students: ['Học viên', 'Hồ sơ, hợp đồng, tạm trú'],
  rooms: ['Phòng', 'Danh sách phòng theo tầng / hạng / giới tính'],
  vehicles: ['Xe', 'Danh sách xe học viên gửi'],
  services: ['Dịch vụ', 'Máy giặt · Gửi xe — dịch vụ tùy chọn của học viên'],
  hoso: ['Hồ sơ lưu trữ', 'Hợp đồng & CCCD của toàn bộ học viên — ai còn thiếu giấy tờ'],
  checkin: ['Check-in / Check-out', 'Lịch sử ra / vào ký túc xá'],
  invoices: ['Tiền phòng', 'Hóa đơn hàng tháng, điện nước, cọc'],
  revenue: ['Dự báo doanh thu', 'Dự báo từ phiếu báo tiền phòng · đối chiếu Bravo (thu thật do Bravo quản lý)'],
  reg: ['Đăng ký ở nội trú', 'Duyệt đơn đăng ký vào ở'],
  checkout: ['Đăng ký trả phòng', 'Duyệt đơn xin trả phòng'],
  repair: ['Báo hư hỏng CSVC', 'Hư hỏng cơ sở vật chất → chuyển bảo trì'],
  violations: ['Quản lý vi phạm', 'Ghi nhận & theo dõi vi phạm học viên'],
  feedback: ['Hộp thư hỗ trợ / góp ý', 'Học viên báo vi phạm · cần hỗ trợ khác'],
  requests: ['Đăng ký ở nội trú', 'Duyệt đơn đăng ký vào ở'],
  audit: ['Lịch sử hệ thống', 'Lịch sử thao tác của quản lý & nhân viên'],
  settings: ['Cài đặt', 'Đơn giá, hạng phòng, cơ sở'],
};
const ADMIN_ONLY_VIEWS = ['exec', 'revenue', 'audit', 'settings'];
let ST = { view: 'dashboard', rooms: [], students: [], facilities: [], settings: {}, applications: [], damage: [], couts: [], logs: [], assets: [], vtypes: [] };

const G = { male: 'Nam', female: 'Nữ' };
const genderLabel = g => G[g] || g;
const legalEntity = g => g === 'female' ? (ST.settings.legal_female || 'E2') : (ST.settings.legal_male || 'S2');
// Mã pháp nhân cho cột trong bảng: giới tính rỗng/lạ thì để '—'. legalEntity đổ MỌI giá trị khác
// 'female' về pháp nhân Nam, dùng thẳng nó cho hàng chưa tra được người là khai khống.
const legalEntityCell = g => (g === 'female' || g === 'male') ? legalEntity(g) : '—';
const HANGS = ['A', 'B', 'C', 'D'];
// Công suất phòng (số giường) theo hạng
const HANG_CAP = { A: 5, B: 4, C: 4, D: 3 };
// Loại phòng: shared=cho thuê ghép · whole=thuê nguyên phòng · security=an ninh · staff=nhân viên công tác
// Nhãn dùng chung cho thẻ phòng, form sửa phòng và cột xuất CSV.
const ROOM_TYPE = { shared: ['Thuê ghép', 'gray'], whole: ['Thuê nguyên phòng', 'blue'], security: ['Phòng an ninh', 'amber'], staff: ['Nhân viên công tác', 'amber'] };
const roomType = r => (ROOM_TYPE[r.room_type] ? r.room_type : 'shared');
const roomIsShared = r => roomType(r) === 'shared';          // CHỈ dùng cho nhãn/giá ("/người"), cấm dùng để đếm giường
const roomTypeBadge = r => { const [l, c] = ROOM_TYPE[roomType(r)]; return `<span class="badge ${c}">${l}</span>`; };
// Phòng xếp/đếm THEO GIƯỜNG. 'whole' bán trọn phòng nên ra khỏi cả tử lẫn mẫu số giường trống;
// phòng an ninh / nhân viên CÓ đếm vì ô Xếp phòng cho xếp người vào đó (owner chốt 20/08).
const phongTinhGiuong = r => ['shared', 'security', 'staff'].includes(roomType(r));
// Chỉ số MỘT phòng — nguồn số DUY NHẤT của toàn app. Chỉ đọc occupancy/upcoming/leaving máy chủ trả
// (đã theo mốc ngày nếu gọi kèm ?date=), không tự đếm lại từ ST.students.
function chiSoPhong(r) {
  const dem = phongTinhGiuong(r);
  const cap = dem ? (+r.capacity || 0) : 0;
  const dangO = +r.occupancy || 0;
  const datCho = dem ? (+r.upcoming || 0) : 0;
  const sapRa = dem ? (+r.leaving || 0) : 0;
  const trong = dem ? Math.max(0, cap - dangO) : 0;
  return {
    dem, cap, dangO, datCho, sapRa, trong,
    vuot: dem ? Math.max(0, dangO - cap) : 0,
    sapTrong: dem ? Math.max(0, cap - dangO + sapRa) - trong : 0,
    thucCon: Math.max(0, trong - datCho),
  };
}
// thucCon cộng theo TỪNG phòng rồi mới tổng — chỗ đã đặt ở phòng này không lấp được giường phòng khác.
function tongChiSo(rooms) {
  const t = { cap: 0, dangO: 0, datCho: 0, sapRa: 0, trong: 0, vuot: 0, sapTrong: 0, thucCon: 0,
    soPhong: 0, soPhongConCho: 0, soPhongThucCon: 0, soPhongVuot: 0 };
  (rooms || []).forEach(r => {
    if (!phongTinhGiuong(r)) return;
    const c = chiSoPhong(r);
    ['cap', 'dangO', 'datCho', 'sapRa', 'trong', 'vuot', 'sapTrong', 'thucCon'].forEach(k => { t[k] += c[k]; });
    t.soPhong++;
    if (c.trong > 0) t.soPhongConCho++;
    if (c.thucCon > 0) t.soPhongThucCon++;
    if (c.vuot > 0) t.soPhongVuot++;
  });
  return t;
}
// "Còn chỗ" HIỂN THỊ ở mọi màn = thucCon (đã trừ chỗ đặt trước) — owner chốt 21/08: một con số,
// người đọc không phải tự làm toán. trong/datCho chỉ còn là chi tiết phụ.
const phongConCho = r => chiSoPhong(r).thucCon > 0;
const phongQuaTai = r => chiSoPhong(r).vuot > 0;
const SAO = '<span class="sao" aria-hidden="true">*</span>'; // dấu bắt buộc, đỏ
const RENTAL_LABEL = { ghep: 'Thuê ghép', phong: 'Thuê nguyên phòng' };
// Hình thức thuê của một hồ sơ do LOẠI PHÒNG quyết định — rooms.room_type cũng chính là thứ công thức
// tính tiền dùng. Cột rental_type của hồ sơ chỉ còn nghĩa khi chưa xếp phòng.
const thueNguyenPhong = s => s.room_id ? roomType(roomById(s.room_id) || {}) === 'whole' : s.rental_type === 'phong';
const rentalLabelOf = s => thueNguyenPhong(s) ? RENTAL_LABEL.phong : RENTAL_LABEL.ghep;
const RESI = { registered: ['Đã đăng ký', 'green'], processing: ['Đang xử lý', 'amber'], unregistered: ['Chưa đăng ký', 'gray'] };
const resiBadge = st => { const [l, c] = RESI[st] || RESI.unregistered; return `<span class="badge ${c}">${l}</span>`; };
const CONTRACT_LABEL = { done: 'Đã hoàn tất', scanned: 'Đã scan HĐ', unsigned: 'Chưa ký HĐ', none: 'Không ký HĐ', handover: 'Đã ký phiếu bàn giao' };
const CONTRACT_BADGE = { done: 'green', scanned: 'blue', unsigned: 'amber', none: 'gray', handover: 'blue' };

// Các ô giảm giá % trong form học viên: [tên cột, id ô nhập, nhãn]
const GIAM_O = [
  ['room_fee_discount_pct', 'f_rdisc', 'Tiền phòng'],
  ['water_discount_pct', 'f_wdisc', 'Tiền nước'],
  ['electric_discount_pct', 'f_edisc', 'Tiền điện'],
  ['service_discount_pct', 'f_sdisc', 'Phí dịch vụ'],
  ['washing_discount_pct', 'f_mdisc', 'Máy giặt'],
  ['parking_discount_pct', 'f_pdisc', 'Gửi xe'],
];

// Liên kết tới hợp đồng của phòng trưởng, cho thành viên phòng thuê trọn (không ký HĐ riêng).
// Máy chủ trả contract_ref_*; day=true là bản dài dùng ở thẻ chi tiết.
function hdThamChieu(s, day) {
  if (!s || !s.contract_ref_id || !s.contract_ref_no) return '';
  const nhan = `${IC.link} HĐ ${esc(s.contract_ref_no)}`;
  const nguoi = esc(s.contract_ref_name || '');
  const moTa = `Theo hợp đồng thuê trọn phòng, người đứng tên: ${nguoi}`;
  // span role="button" chứ không <a href="#">: href="#" nhét dấu # vào URL và cuộn vọt lên đầu trang.
  const link = (noiDung) => `<span class="hd-ref" role="button" tabindex="0" title="${moTa}"` +
    ` data-act="studentDetail" data-args='[${s.contract_ref_id}]'>${noiDung}</span>`;
  return day
    ? `<p style="margin:8px 0 0" class="muted">Không ký riêng — theo hợp đồng của phòng: ${link(`${nhan} · ${nguoi}`)}</p>`
    : `<div class="sub2">${link(nhan)}</div>`;
}
const CHECKOUT_REASONS = [['departure', 'Xuất cảnh (đi Nhật)'], ['personal', 'Cá nhân'], ['facility', 'Cơ sở vật chất'], ['dropout', 'Nghỉ học'], ['reserve', 'Bảo lưu'], ['other', 'Khác']];
const REASON_LABEL = { departure: 'Xuất cảnh', personal: 'Cá nhân', facility: 'Cơ sở vật chất', dropout: 'Nghỉ học', reserve: 'Bảo lưu', other: 'Khác', normal: 'Khác', urgent_visa: 'Xuất cảnh' };
// Lý do trả phòng = XUẤT CẢNH (đi Nhật). 'urgent_visa' là giá trị CŨ (dữ liệu di sản) — luồng mới chỉ
// sinh 'departure', nhưng vẫn nhận diện urgent_visa cho hồ sơ cũ. Gom 1 chỗ thay vì rải mảng nhiều nơi.
const DEPARTURE_REASONS = ['departure', 'urgent_visa'];
const VIO_SEV = { minor: ['Nhẹ', 'gray'], major: ['Nặng', 'amber'], severe: ['Nghiêm trọng', 'red'] };
const INTRO_FIELDS = [
  ['intro_hero_title', 'Tiêu đề lớn (hero) — Enter để xuống dòng', 'ta'],
  ['intro_hero_desc', 'Mô tả dưới tiêu đề (địa chỉ tự thêm phía trước)', 'ta'],
  ['intro_about_eyebrow', 'Mục "Về khu nội trú" — nhãn nhỏ', 'in'],
  ['intro_about_title', 'Mục "Về khu nội trú" — tiêu đề', 'in'],
  ['intro_about_desc', 'Mục "Về khu nội trú" — mô tả', 'ta'],
  ['intro_rooms_eyebrow', 'Mục "Phòng ở" — nhãn nhỏ', 'in'],
  ['intro_rooms_title', 'Mục "Phòng ở" — tiêu đề', 'in'],
  ['intro_rooms_desc', 'Mục "Phòng ở" — mô tả', 'ta'],
  ['intro_amenities_title', 'Mục "Tiện ích" — tiêu đề', 'in'],
  ['intro_price_title', 'Mục "Bảng giá" — tiêu đề', 'in'],
  ['intro_price_desc', 'Mục "Bảng giá" — mô tả', 'ta'],
  ['intro_contact_title', 'Mục "Liên hệ" — tiêu đề', 'in'],
  ['intro_contact_desc', 'Mục "Liên hệ" — mô tả', 'ta'],
  ['contact_person', 'Người liên hệ — hiện dưới số hotline', 'in'],
];
const INTRO_MEDIA = [
  ['hero', 'Ảnh nền đầu trang (toàn cảnh)'],
  ['khuon-vien-1', 'Khuôn viên'],
  ['khuon-vien-2', 'Sảnh sinh hoạt chung'],
  ['khuon-vien-3', 'Khu tự học'],
  ['phong-1', 'Phòng ghép'],
  ['phong-2', 'Nội thất phòng'],
  ['phong-3', 'Khu vệ sinh'],
];
const vioSevBadge = sev => { const [l, c] = VIO_SEV[sev] || VIO_SEV.minor; return `<span class="badge ${c}">${l}</span>`; };

// Trạng thái tự tính theo ngày
function liveStatus(s) {
  const t = today(), ci = s.check_in_date && s.check_in_date.slice(0, 10), co = s.check_out_date && s.check_out_date.slice(0, 10);
  if (co && co <= t) return 'left';
  if (ci && ci > t) return 'upcoming';
  if (co && co > t) return 'leaving';
  return 'staying';
}
const STATUS_INFO = {
  upcoming: ['Sắp vào', 'blue'], staying: ['Đang ở', 'green'], leaving: ['Sắp trả', 'amber'], left: ['Đã trả', 'gray'],
};
const statusBadge = s => { const [l, c] = STATUS_INFO[liveStatus(s)]; return `<span class="badge ${c}">${l}</span>`; };
const isOccupying = s => ['staying', 'leaving'].includes(liveStatus(s));

// ---- Rule hợp đồng thuê ghép (điểm 5 — Sếp) ----
const DAY_MS = 86400000;
// Ngưỡng nghiệp vụ LẤY TỪ Cài đặt (Đợt 3 — dọn hard-code), có fallback nếu setting rỗng/NaN.
const overdueDays = () => +(ST.settings && ST.settings.overdue_remind_days) || 7;      // quá N ngày chưa ký HĐ/tạm trú → nhắc
const shortTermMaxDays = () => +(ST.settings && ST.settings.shortterm_max_days) || 60; // ở dưới N ngày = ngắn hạn
// Trần riêng cho CCCD đã bỏ — mọi tệp dùng chung mức 25MB ở tepHopLe (owner chốt 12/08/2026).
function stayDays(s) { // số ngày đã vào ở tính đến hôm nay
  const ci = s.check_in_date && s.check_in_date.slice(0, 10); if (!ci) return 0;
  return Math.floor((Date.parse(today()) - Date.parse(ci)) / DAY_MS);
}
// Ngắn hạn: có ngày trả & thời gian ở < ngưỡng (mặc định 60 ngày). Không có ngày trả = vô thời hạn = DÀI HẠN.
// (Quy tắc 24/07: áp cho MỌI hình thức thuê — <60 ngày ký phiếu bàn giao, >60 ngày ký HĐ.)
function isShortStay(s) {
  if (!s.check_out_date || !s.check_in_date) return false;
  const d = (Date.parse(s.check_out_date.slice(0, 10)) - Date.parse(s.check_in_date.slice(0, 10))) / DAY_MS;
  return d > 0 && d < shortTermMaxDays();
}
const contractSigned = s => ['done', 'scanned'].includes(s.contract_status);
const handoverSigned = s => ['handover', 'done', 'scanned'].includes(s.contract_status);
// Loại phòng của HV: shared/whole = CHO THUÊ (ghép/nguyên phòng); security = an ninh; staff = nhân viên công tác.
// Chưa xếp phòng → coi như thuê ghép (cần HĐ). roomType()/ROOM_TYPE khai ở trên.
const studentRoomKind = s => { if (!s.room_id) return 'shared'; const r = roomById(s.room_id); return r ? roomType(r) : 'shared'; };
const isRentalRoom = s => { const k = studentRoomKind(s); return k === 'shared' || k === 'whole'; };
// Quy tắc 24/07 — KÝ HĐ THUÊ PHÒNG: ở phòng cho thuê (ghép hoặc nguyên phòng), thuê >60 ngày (hoặc vô thời hạn).
const contractRequired = s => isOccupying(s) && isRentalRoom(s) && !isShortStay(s);
// KÝ PHIẾU ĐĂNG KÝ & BÀN GIAO: nhân viên công tác, HOẶC phòng cho thuê nhưng <60 ngày (cả 2 hình thức).
// Phòng an ninh (không thu tiền) → không cần ký gì.
const handoverRequired = s => isOccupying(s) && (studentRoomKind(s) === 'staff' || (isRentalRoom(s) && isShortStay(s)));
// Chưa hoàn thiện:
const contractPending = s => contractRequired(s) && !contractSigned(s);
const handoverPending = s => handoverRequired(s) && !handoverSigned(s);

// ---- Sắp xuất cảnh — điều phối phòng (giường sắp trống) ----
// Lấy ngày xuất cảnh: ưu tiên ngày dự kiến (Kaizen) + lịch trả phòng do xuất cảnh; chọn ngày TƯƠNG LAI gần nhất.
function nextDepartureDate(s) {
  const t = today();
  const cands = [s.expected_departure, (DEPARTURE_REASONS.includes(s.checkout_reason) ? s.check_out_date : null)]
    .filter(Boolean).map(d => String(d).slice(0, 10)).filter(d => d >= t).sort();
  return cands[0] || '';
}
const willDepartSoon = s => isOccupying(s) && !!nextDepartureDate(s);

