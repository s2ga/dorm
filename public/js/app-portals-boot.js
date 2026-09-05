// === app-portals-boot.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
/* ================================================================= */
/* ==============          CỔNG HỌC VIÊN            ================= */
/* ================================================================= */
async function renderStudent() {
  _congDangMo = 'student';
  el('app').innerHTML = `
    <div class="app"><div class="main" style="margin:0 auto;max-width:760px;width:100%">
      <div class="top">
        <div><h1>${IC.home} Phòng của tôi</h1><div class="sub">Xin chào, ${esc(Auth.user.full_name || Auth.user.username)}</div></div>
        ${/* Chuông tách RIÊNG khỏi .toolbar: trên điện thoại cụm nút hành động tự xuống dòng, để
             chung một cụm là kéo cái chuông xuống theo (đã gặp ở cổng quản lý, xem app-admin-core). */''}
        <div class="flex" style="gap:10px">
          <button class="notif-bell" id="hvNotifBell" title="Thông báo" aria-haspopup="dialog" aria-expanded="false" data-act="toggleHvNotif">${IC.bell}<span class="notif-dot" id="hvNotifDot" style="display:none"></span></button>
        </div>
        <div class="toolbar">${laKiemNhiem() ? `<button class="btn sm" data-act="switchPortal" data-args='["work"]'>${IC.arrowLeft} Về cổng làm việc</button>` : ''}${dungMatKhau() ? `<button class="btn sm" data-act="changePwd">${IC.key} Đổi mật khẩu</button>` : ''}<button class="btn sm" data-act="logout">${IC.logOut} Đăng xuất</button></div>
      </div>
      <div class="content" id="content"><div class="spinner"></div></div>
    </div></div>`;
  startTableResize();
  loadStudentPortal();
  hvNotifTai();
  startHvNotifPolling();
}
// BL-16: cổng HV — bấm hàng phiếu báo để xem TÁCH các khoản (nước/dịch vụ/giặt/xe/khác + ghi chú
// "other_note"), số kWh và số ngày ở. Dữ liệu đã có sẵn trong /me/invoices (SELECT *); bảng ngoài chỉ
// gộp lại nên HV thấy cục "Khác" không giải thích được. _myInvs được lưu khi vẽ danh sách.
// Trạng thái thu tiền của phiếu. /me/invoices vốn đã trả về `status` + `paid_date` (SELECT *) nhưng
// trang không hiện, nên học viên không có đường nào tự biết mình đã đóng kỳ nào — phải đi hỏi quản lý.
// Chỉ hai trạng thái: 'sent' (đã gửi) với 'pending' đối với người đóng tiền là một, đều là CHƯA thu.
function invPaidBadge(i) {
  return i.status === 'paid'
    ? `<span class="badge green">${IC.check} Đã thu${i.paid_date ? ' ' + fmtDate(i.paid_date) : ''}</span>`
    : '<span class="badge amber">Chưa thu</span>';
}
function myInvoiceDetail(id) {
  const i = (window._myInvs || []).find(x => x.id === id);
  if (!i) return;
  const line = (label, val, sub) => `<tr><td>${label}${sub ? ` <span class="muted" style="font-size:12px">${sub}</span>` : ''}</td><td class="num">${money(+val || 0)}</td></tr>`;
  const opt = (label, val, sub) => (+val) ? line(label, val, sub) : '';
  const leaderD = +i.leader_discount || 0, roomD = +i.room_discount || 0, feeD = +i.fee_discount || 0;
  openModal(`
    <div class="mh"><h3>${IC.receipt} Chi tiết phiếu ${monthLabel(i.month)}</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <p class="muted" style="margin:0 0 12px">Số ngày ở trong kỳ: <strong>${i.days_stayed || 0}</strong> ngày &nbsp;•&nbsp; ${invPaidBadge(i)}</p>
      <div class="table-wrap"><table><tbody>
        ${line('Tiền phòng', i.room_charge)}
        ${line('Tiền điện', i.electric_charge, `${kwh(i.electric_kwh)} kWh · kỳ ${monthLabel(prevKy(i.month))}`)}
        ${opt('Tiền nước', i.water_charge)}
        ${opt('Phí dịch vụ', i.service_charge)}
        ${opt('Máy giặt', i.washing_charge)}
        ${opt('Gửi xe', i.parking_charge)}
        ${opt('Khoản khác', i.other_charge, i.other_note ? esc(i.other_note) : '')}
        ${opt('Tiền cọc', i.deposit_charge, 'thu một lần khi nhận phòng · hoàn lại khi trả phòng')}
        ${leaderD ? `<tr><td>Giảm phòng trưởng</td><td class="num" style="color:var(--green)">−${money(leaderD)}</td></tr>` : ''}
        ${roomD ? `<tr><td>Giảm tiền phòng</td><td class="num" style="color:var(--green)">−${money(roomD)}</td></tr>` : ''}
        ${feeD ? `<tr><td>Giảm các khoản khác</td><td class="num" style="color:var(--green)">−${money(feeD)}</td></tr>` : ''}
        <tr style="border-top:2px solid var(--line)"><td><strong>Tổng cộng</strong></td><td class="num"><strong>${money(i.total)}</strong></td></tr>
      </tbody></table></div>
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">${IC.creditCard} Đóng tiền qua mã QR quản lý gửi trên Zalo.</p>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`);
}
async function loadStudentPortal() {
  let profile, invs, damage, coutReqs, myVios = [], mates = [], assets = [], chores = [], myLogs = [];
  try { [profile, invs, damage, coutReqs, myVios, mates, assets, chores, myLogs] = await Promise.all([API.meProfile(), API.meInvoices(), API.meDamage(), API.meCheckoutReq(), API.meViolations().catch(() => []), API.meRoommates().catch(() => []), API.meAssets().catch(() => []), API.meChores().catch(() => []), API.meLogs().catch(() => [])]); }
  catch (e) { el('content').innerHTML = `<div class="bang-tin">${IC.alert} ${esc(e.message)}</div>`; return; }
  window._myInvs = invs; // BL-16: để myInvoiceDetail() tra cứu chi tiết khi bấm hàng
  const billNow = invs.filter(i => i.month === curMonth()).reduce((a, i) => a + (+i.total || 0), 0);
  const depTxt = { held: 'Đang giữ', refunded: 'Đã hoàn', forfeited: 'Không hoàn', none: '—' }[profile.deposit_status] || '—';
  const pendingCout = coutReqs.find(c => c.status === 'pending');
  const notMovedIn = profile.check_in_date && String(profile.check_in_date).slice(0, 10) > today();
  el('content').innerHTML = `
    ${notMovedIn ? `<div class="bang-tin">${IC.hourglass} Bạn sẽ nhận phòng vào <strong>${fmtDate(profile.check_in_date)}</strong> — vui lòng đến đúng hẹn để bàn giao phòng. Hiện chưa thể gửi đơn trả phòng.</div>` : ''}
    <div class="cards">
      <div class="stat"><div class="l">${IC.doorOpen} Phòng của tôi</div><div class="v sm">${esc(profile.room_name || 'Chưa xếp')}</div></div>
      <div class="stat"><div class="l">${IC.receipt} Phiếu tháng này</div><div class="v sm">${money(billNow)}</div></div>
      <div class="stat"><div class="l">${IC.lock} Cọc</div><div class="v sm">${depTxt}</div></div>
    </div>
    ${myContactPanel(profile)}

    <div class="panel"><div class="hd"><h2>${IC.user} Thông tin của tôi</h2></div><div class="pad">
      <p><strong>Họ tên:</strong> ${esc(profile.name)} · <span class="badge ${profile.gender === 'female' ? 'sage' : 'blue'}">${genderLabel(profile.gender)}</span></p>
      <p><strong>Mã HV:</strong> ${esc(profile.code || '—')} &nbsp;•&nbsp; <strong>Lớp:</strong> ${esc(profile.class_name || '—')} &nbsp;•&nbsp; <strong>SĐT:</strong> ${esc(profile.phone || '—')}</p>
      <p><strong>Ngày vào:</strong> ${fmtDate(profile.check_in_date)} ${profile.check_out_date ? `&nbsp;•&nbsp; <strong>Ngày trả:</strong> ${fmtDate(profile.check_out_date)}` : ''}</p>
    </div></div>

    ${myRoomPanel(profile, mates)}

    ${myChoresPanel(chores, profile)}
    ${myAssetsPanel(assets, profile)}
    ${myRulesPanel(profile)}

    <div class="panel"><div class="hd"><h2>${IC.washer} Dịch vụ máy giặt</h2></div><div class="pad">
      ${profile.uses_washing
        ? `<div class="flex" style="justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
            <div>${IC.checkCircle} Bạn <strong>đang dùng</strong> máy giặt — phí <strong>${money(profile.washing_fee)}/tháng</strong> (tính vào phiếu báo).</div>
            <button class="btn sm ghost" data-act="toggleMyWashing" data-args='[false]'>Hủy đăng ký</button></div>`
        : `<div class="flex" style="justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
            <div class="muted">Bạn chưa dùng máy giặt. Đăng ký nếu có nhu cầu — phí <strong>${money(profile.washing_fee)}/tháng</strong>.</div>
            <button class="btn sm pri" data-act="toggleMyWashing" data-args='[true]'>${IC.plus} Đăng ký máy giặt</button></div>`}
    </div></div>

    ${myVios.length ? `<div class="panel" id="pnViPham"><div class="hd"><h2>${IC.alert} Nhắc nhở / Vi phạm (${myVios.length})</h2></div><div class="table-wrap card-tbl">
      <table><thead><tr><th>Ngày</th><th>Nội dung</th><th>Mức độ</th><th class="num">Lần</th></tr></thead><tbody>
        ${myVios.map(v => `<tr><td>${fmtDate(v.date)}</td><td data-label="Nội dung"><strong>${esc(v.type_name)}</strong>${v.note ? `<div class="muted" style="font-size:12px">${esc(v.note)}</div>` : ''}</td><td data-label="Mức độ">${vioSevBadge(v.severity)}</td><td class="num" data-label="Lần">${v.level}</td></tr>`).join('')}
      </tbody></table>
      <div class="pad muted" style="font-size:12.5px">${IC.info} Vui lòng tuân thủ nội quy ký túc xá. Vi phạm nhiều lần sẽ được thông báo về nhà trường.</div>
    </div></div>` : ''}

    <div class="panel" id="pnPhieu"><div class="hd"><h2>${IC.receipt} Phiếu báo tiền phòng</h2></div><div class="table-wrap card-tbl">
      ${invs.length ? `<table><thead><tr><th>Kỳ</th><th class="num">Tiền phòng</th><th class="num">Điện</th><th class="num">Khác</th><th class="num">Giảm</th><th class="num">Tổng</th></tr></thead><tbody>
        ${invs.map(i => {
          // Cột "Giảm" phải hiện, nếu không thì 4 cột đầu cộng lại KHÔNG ra Tổng — học viên tưởng app tính sai
          const giam = (+i.leader_discount || 0) + (+i.room_discount || 0) + (+i.fee_discount || 0);
          return `<tr style="cursor:pointer" data-act="myInvoiceDetail" data-args='[${i.id}]' title="Bấm để xem chi tiết khoản thu"><td>${monthLabel(i.month)}<div style="margin-top:4px">${invPaidBadge(i)}</div></td><td class="num" data-label="Tiền phòng">${money(i.room_charge)}</td><td class="num" data-label="Điện">${money(i.electric_charge)}</td>
          <td class="num" data-label="Khác">${money((+i.water_charge) + (+i.service_charge) + (+i.washing_charge) + (+i.parking_charge) + (+i.other_charge || 0) + (+i.deposit_charge || 0))}</td>
          <td class="num" data-label="Giảm">${giam ? `<span class="badge green">−${money(giam)}</span>` : '—'}</td>
          <td class="num" data-label="Tổng"><strong>${money(i.total)}</strong></td></tr>`;
        }).join('')}
      </tbody></table>` : '<div class="empty">Chưa có phiếu báo.</div>'}
      <div class="pad muted" style="font-size:12.5px">${IC.info} Bấm vào từng kỳ để xem chi tiết khoản thu. &nbsp;·&nbsp; ${IC.creditCard} Đóng tiền qua mã QR quản lý gửi trên Zalo theo hạn hằng tháng.</div>
    </div></div>

    <div class="panel" id="pnHoTro"><div class="hd"><h2>${IC.handCoins} Hỗ trợ học viên</h2><button class="btn sm pri" data-act="damageForm">${IC.plus} Gửi yêu cầu hỗ trợ</button></div><div class="table-wrap">
      ${damage.length ? `<table><thead><tr><th>Ngày</th><th>Loại</th><th>Nội dung</th><th>Trạng thái</th></tr></thead><tbody>
        ${damage.map(d => `<tr><td>${fmtDate(String(d.created_at).slice(0, 10))}</td><td data-label="Loại">${supCatBadge(d.category)}</td><td data-label="Nội dung"><strong>${esc(d.title)}</strong>${d.description ? `<div class="muted" style="font-size:12px">${esc(d.description)}</div>` : ''}</td><td data-label="Trạng thái">${d.status === 'done' ? '<span class="badge green">Đã xử lý</span>' : d.status === 'blocked' ? '<span class="badge red">Chưa xử lý được — liên hệ quản lý</span>' : d.status === 'processing' ? '<span class="badge blue">Đang xử lý</span>' : '<span class="badge amber">Mới</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Chưa có yêu cầu nào.</div>'}
    </div></div>

    <div class="panel" id="pnTraPhong"><div class="hd"><h2>${IC.logOut} Đăng ký trả phòng</h2>${!pendingCout && profile.status === 'in' && !notMovedIn ? '<button class="btn sm danger" data-act="checkoutReqForm">Xin trả phòng</button>' : ''}</div><div class="pad">
      ${pendingCout ? `<div class="bang-tin">${IC.hourglass} Bạn đã gửi đơn trả phòng ngày <strong>${fmtDate(pendingCout.desired_date)}</strong> — đang chờ quản lý duyệt.</div>` :
      notMovedIn ? '<p class="muted" style="margin:0">Bạn chưa tới ngày nhận phòng nên chưa thể gửi đơn trả phòng.</p>' :
      profile.status !== 'in' ? '<p class="muted" style="margin:0">Bạn đã trả phòng.</p>' :
      `<p class="muted" style="margin:0">Cần báo trước 1 tháng để được hoàn cọc (trừ trường hợp xuất cảnh đột xuất).</p>`}
      ${coutReqs.filter(c => c.status !== 'pending').length ? `<div class="table-wrap card-tbl" style="margin-top:10px"><table><thead><tr><th>Ngày gửi</th><th>Ngày muốn trả</th><th>Trạng thái</th></tr></thead><tbody>
        ${coutReqs.filter(c => c.status !== 'pending').map(c => `<tr><td>${fmtDate(String(c.created_at).slice(0, 10))}</td><td data-label="Ngày muốn trả">${fmtDate(c.desired_date)}</td><td data-label="Trạng thái">${c.status === 'done' ? '<span class="badge green">Đã duyệt</span>' : '<span class="badge gray">Từ chối</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    </div></div>

    <div class="panel"><div class="hd"><h2>${IC.history} Lịch sử ra / vào của tôi</h2></div><div class="table-wrap card-tbl">
      ${myLogs.length ? `<table><thead><tr><th>Ngày</th><th>Hoạt động</th><th>Nguồn</th><th>Ghi chú</th></tr></thead><tbody>
        ${myLogs.map(l => `<tr><td>${fmtDate(l.date)}</td>
          <td data-label="Hoạt động">${l.type === 'in' ? '<span class="badge green">Nhận phòng</span>' : '<span class="badge red">Trả phòng</span>'}</td>
          <td data-label="Nguồn">${l.source === 'self' ? '<span class="badge blue">Bạn tự thao tác</span>' : '<span class="badge gray">Quản lý</span>'}</td>
          <td class="muted" data-label="Ghi chú">${esc(l.note || '')}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Chưa có lịch sử ra / vào.</div>'}
    </div></div>`;

}
function damageForm(cat) {
  const sel = v => cat === v ? ' selected' : '';
  const tieuDe = cat === 'damage' ? `${IC.wrench} Báo hư hỏng trong phòng` : `${IC.handCoins} Gửi yêu cầu hỗ trợ`;
  openModal(`
    <div class="mh"><h3>${tieuDe}</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="field"><label>Loại yêu cầu *</label><select id="dm_cat" data-change="dmCatHint">
        <option value="damage"${sel('damage')}>Báo hư hỏng trong phòng</option>
        <option value="violation"${sel('violation')}>Báo cáo vi phạm</option>
        <option value="other"${sel('other')}>Khác (cần hỗ trợ trong quá trình ở)</option>
      </select></div>
      <div class="field"><label>Nội dung *</label><input id="dm_title" placeholder="Nêu ngắn gọn nội dung..."></div>
      <div class="field"><label>Mô tả chi tiết</label><textarea id="dm_desc" rows="3" placeholder="Mô tả thêm nếu cần..."></textarea></div>
      <div class="hint" id="dmHint" style="font-size:12px">${IC.info} Báo hư hỏng thiết bị/cơ sở vật chất trong phòng để quản lý sửa chữa.</div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="submitDamage">Gửi yêu cầu</button></div>`);
  setTimeout(() => { dmCatHint(); el('dm_title').focus(); }, 50);
}
function dmCatHint() {
  const c = el('dm_cat').value, h = el('dmHint');
  const t = { damage: 'Báo hư hỏng thiết bị/cơ sở vật chất trong phòng để quản lý sửa chữa.',
    violation: 'Phản ánh vi phạm nội quy (ồn ào, mất vệ sinh, người lạ...) để quản lý xử lý.',
    other: 'Nội dung khác cần hỗ trợ trong quá trình ở — điền rõ ở ô Nội dung.' };
  if (h) h.innerHTML = `${IC.info} ${t[c] || t.damage}`;
  el('dm_title').placeholder = c === 'other' ? 'Bạn cần hỗ trợ việc gì?' : (c === 'violation' ? 'Vi phạm gì? Ai/phòng nào?' : 'Hư hỏng gì?');
}
async function submitDamage() {
  const title = el('dm_title').value.trim(); if (!title) return toast('Nhập nội dung yêu cầu', 'err');
  await guard(() => API.createMeDamage({ category: el('dm_cat').value, title, description: el('dm_desc').value.trim() }));
  closeModal(); toast('Đã gửi yêu cầu hỗ trợ'); loadStudentPortal();
}
function checkoutReqForm() {
  openModal(`
    <div class="mh"><h3>${IC.logOut} Đăng ký trả phòng</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="field"><label>Ngày dự kiến trả phòng</label><input id="co_date"></div>
      <div class="field"><label>Lý do</label><select id="co_reason">
        ${CHECKOUT_REASONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select></div>
      <div class="field"><label>Ghi chú</label><textarea id="co_note" rows="2"></textarea></div>
      <div class="hint">${IC.info} Đơn sẽ được gửi tới quản lý để duyệt. Cần báo trước 1 tháng để được hoàn cọc.</div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn danger" data-act="submitCheckoutReq">Gửi đơn</button></div>`);
  attachDate(el('co_date'), today(), { min: today() });   // BL-35[6]: không cho chọn ngày trả trong quá khứ
}
async function submitCheckoutReq() {
  const d = el('co_date').dataset.iso;
  if (!d) return toast('Chọn ngày dự kiến trả phòng', 'err');
  await guard(() => API.createMeCheckoutReq({ desired_date: d, reason: el('co_reason').value, note: el('co_note').value.trim() }));
  closeModal(); toast('Đã gửi đơn trả phòng'); loadStudentPortal();
}
/* Panel "Phòng của tôi" — thông số phòng + wifi + người ở cùng gộp làm một, vì cùng nói về một chỗ.
   Sức chứa cố ý hiện TRUNG TÍNH: ở vượt số giường là chuyện nghiệp vụ CHO PHÉP (xếp người vào chờ
   bạn cũ xuất cảnh), tô đỏ là học viên tưởng app tính sai rồi đi hỏi quản lý.
   KHÔNG hiện giá phòng ở đây: giá thật đi theo hạng + loại thuê + giảm giá, số trên phòng lệch với
   số trên phiếu báo là nguồn khiếu nại. Tiền đã có chỗ nói riêng là bảng phiếu báo. */
function myRoomPanel(profile, mates) {
  if (!profile.room_name) {
    return `<div class="panel"><div class="hd"><h2>${IC.doorOpen} Phòng của tôi</h2></div><div class="pad">
      <p class="muted" style="margin:0">Bạn chưa được xếp phòng.</p></div></div>`;
  }
  const cap = +profile.room_capacity || 0;
  const soNguoi = mates.length + 1;   // mates KHÔNG gồm chính mình
  const spec = [
    profile.room_floor ? `Tầng ${profile.room_floor}` : '',
    cap ? `${cap} giường` : '',
    profile.room_area ? `${esc(profile.room_area)} m²` : '',
    profile.room_hang ? `Hạng ${esc(profile.room_hang)}` : '',
    `Đang ở ${soNguoi} người`,
  ].filter(Boolean).join(' &nbsp;•&nbsp; ');
  return `<div class="panel" id="pnPhong"><div class="hd"><h2>${IC.doorOpen} Phòng ${esc(profile.room_name)}</h2></div><div class="pad">
    <p class="muted" style="margin:0">${spec}</p>
    ${myWifiBlock(profile)}
    <h4 class="asset-h" style="margin-top:18px">Người ở cùng ${mates.length ? `(${mates.length})` : ''}</h4>
    ${mates.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${mates.map(m =>
        `<span class="badge ${m.is_leader ? 'amber' : 'blue'}" style="font-size:13px;padding:6px 12px">${m.is_leader ? IC.star : IC.user} ${esc(m.name)}${m.is_leader ? ' — Phòng trưởng' : ''}</span>`).join('')}</div>`
      : '<p class="muted" style="margin:0">Hiện bạn ở một mình trong phòng.</p>'}
    ${leaderNote(profile, mates)}
  </div></div>`;
}

/* Wifi dùng chung toàn KTX. Máy chủ CHỈ gửi mật khẩu về cho học viên đang ở (me.go) — người đã trả
   phòng mở trang lên sẽ không thấy khối này.
   Không che mật khẩu sau dấu chấm: cả phòng đều biết chuỗi này, che chỉ tổ vướng. Thứ thật sự cần là
   nút chép — gõ tay khoá WPA trên điện thoại là gõ sai, rồi đi báo "wifi hỏng". */
function myWifiBlock(profile) {
  if (!profile.wifi_ssid) return '';
  const mk = profile.wifi_password || '';
  return `<div class="bang-tin" style="margin:14px 0 0;align-items:flex-start">${IC.wifi}<span>
    <strong>Wifi:</strong> ${esc(profile.wifi_ssid)}
    ${mk ? `<br><strong>Mật khẩu:</strong> <code style="font-size:14px;letter-spacing:.02em">${esc(mk)}</code>
      <button class="btn sm ghost" style="margin-left:8px;vertical-align:middle" data-act="copyWifi" data-args='[${JSON.stringify(mk)}]'>${IC.clipboard} Chép</button>`
    : '<br><span class="muted">Mật khẩu chưa được cập nhật — hỏi ban quản lý.</span>'}
  </span></div>`;
}
async function copyWifi(mk) {
  try { await navigator.clipboard.writeText(mk); toast('Đã chép mật khẩu wifi'); }
  catch (e) { toast('Trình duyệt không cho chép tự động — bạn chép tay giúp nhé', 'err'); }
}

/* Panel "Liên hệ khi cần" — đặt NGAY ĐẦU trang, trên cả hồ sơ cá nhân. Số an ninh ca đêm là thứ
   người ta tìm lúc 2 giờ sáng đang hoảng; nằm dưới sáu khối phải cuộn mới thấy thì coi như không có.
   Giữ dạng chip gọn một hàng để không đẩy phần còn lại của trang xuống quá sâu. */
function myContactPanel(p) {
  const ca = caDangTruc(p.security_day_from, p.security_day_to);
  const gioNgay = (p.security_day_from && p.security_day_to) ? `${p.security_day_from} – ${p.security_day_to}` : '';
  const gioDem = (p.security_day_from && p.security_day_to) ? `${p.security_day_to} – ${p.security_day_from}` : '';
  const chip = (ic, ten, sdt, gio, dangTruc) => !sdt ? '' : `
    <a class="ci-row" style="flex:1 1 210px;padding:13px 15px" href="tel:${esc(String(sdt).replace(/[\s.]/g, ''))}">${ic}<div>
      <b>${ten}${dangTruc ? ' <span class="badge green" style="font-weight:600">Đang trực</span>' : ''}</b>
      ${gio ? `<span>${esc(gio)}</span>` : ''}
      <span class="ci-tel">${IC.phone}${esc(sdt)}</span>
    </div></a>`;
  const chips = [
    chip(IC.home, 'Quản lý ký túc xá', p.hotline, '', false),
    chip(IC.shield, 'An ninh ca ngày', p.security_day_phone, gioNgay, ca === 'day'),
    chip(IC.shield, 'An ninh ca đêm', p.security_night_phone, gioDem, ca === 'night'),
  ].join('');
  if (!chips.trim()) return '';   // chưa nhập số nào -> không dựng khối rỗng
  return `<div class="panel"><div class="hd"><h2>${IC.phone} Liên hệ khi cần</h2></div><div class="pad">
    <div style="display:flex;flex-wrap:wrap;gap:10px">${chips}</div>
  </div></div>`;
}
/* Ca nào đang trực, tính theo giờ máy người dùng. Chỉ lưu khung ca NGÀY; ca đêm là phần còn lại nên
   hai ca không bao giờ mâu thuẫn nhau. Giờ trong Cài đặt hỏng -> trả '' để không tô ca nào:
   nói sai ca còn tệ hơn không nói, người ta gọi đúng số mà nhầm ca thì không ai bắt máy. */
function caDangTruc(from, to) {
  const phut = s => { const m = /^(\d{2}):(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };
  const f = phut(from), t = phut(to);
  if (f === null || t === null || f === t) return '';
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const trongCaNgay = f < t ? (cur >= f && cur < t) : (cur >= f || cur < t);   // ca vắt qua nửa đêm
  return trongCaNgay ? 'day' : 'night';
}

/* Dòng chú thích phòng trưởng ở trang "Phòng của tôi".
   Chính chủ là phòng trưởng thì KHÔNG nằm trong danh sách bạn cùng phòng -> phải báo riêng,
   không thì họ mở trang lên thấy phòng mình "chưa có phòng trưởng". */
function leaderNote(profile, mates) {
  if (profile.is_leader) {
    return `<div class="bang-tin" style="margin:14px 0 0">${IC.star}<span><strong>Bạn là phòng trưởng</strong> của phòng này —
      giúp Ban quản lý theo dõi tình hình trong phòng. Bạn được <strong>miễn tiền nước và phí dịch vụ</strong> hằng tháng
      (vẫn hiện trên phiếu báo, kèm dòng "Giảm phòng trưởng").</span></div>`;
  }
  if (mates.some(m => m.is_leader)) return '';  // huy hiệu trên danh sách đã nói rõ rồi
  return `<div class="bang-tin" style="margin:14px 0 0">${IC.info}<span>Phòng chưa có phòng trưởng. Ban quản lý sẽ cử một bạn trong phòng.</span></div>`;
}

/* Lịch trực nhật — xoay vòng theo tuần, app tự tính (không ai phải nhập).
   Tô đậm tuần HIỆN TẠI và đánh dấu rõ khi đến lượt chính mình — đó là thứ duy nhất
   người ta mở trang này để xem. */
function myChoresPanel(chores, profile) {
  if (!profile.room_name) return '';
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dm = s => { const d = new Date(s); return `${DOW[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
  return `<div class="panel" id="pnTrucNhat"><div class="hd"><h2>${IC.calendar} Lịch trực nhật</h2></div><div class="pad">
    ${!chores.length ? '<p class="muted" style="margin:0">Chưa xếp được lịch — phòng chưa có ai ở.</p>' : `
    <div class="chore-list">${chores.map((w, i) => `
      <div class="chore-row${i === 0 ? ' now' : ''}${w.is_me ? ' mine' : ''}">
        <div class="chore-when">${i === 0 ? '<span class="badge amber">Tuần này</span>' : `<span class="muted">${i === 1 ? 'Tuần sau' : 'Tuần thứ ' + (i + 1)}</span>`}</div>
        <div class="chore-date">${dm(w.from)} – ${dm(w.to)}</div>
        <div class="chore-who">${w.is_me
          // "Đến lượt bạn" chỉ được nói khi ĐÚNG LÀ tuần này. Tuần sau cũng ghi vậy là sai sự thật,
          // người ta đi trực nhầm tuần rồi tuần của mình lại bỏ trống.
          ? `<strong>${esc(w.name)}</strong> <span class="badge ${i === 0 ? 'green' : 'gray'}">${i === 0 ? 'Đến lượt bạn' : 'Lượt của bạn'}</span>`
          : esc(w.name)}</div>
      </div>`).join('')}</div>
    <div class="hint" style="margin:16px 0 0">${IC.info}<span>Lịch xoay vòng theo <strong>tuần</strong> (thứ Hai → Chủ nhật)
      giữa các bạn đang ở phòng, app tự xếp. Bạn nào trả phòng thì tự bỏ khỏi lịch.</span></div>`}
  </div></div>`;
}

/* Nội quy ký túc xá (PDF do quản lý tải lên). Chưa có file thì KHÔNG hiện khối này —
   thà không có mục còn hơn hiện ra một nút bấm vào báo lỗi. */
function myRulesPanel(profile) {
  if (!profile.has_rules) return '';
  return `<div class="panel" id="pnNoiQuy"><div class="hd"><h2>${IC.clipboard} Nội quy ký túc xá</h2></div><div class="pad">
    <div class="flex" style="justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div class="muted">Bản nội quy, quy định của ký túc xá. Vui lòng đọc kỹ và tuân thủ.</div>
      <a class="btn pri" href="/api/public/doc/noi-quy" target="_blank" rel="noopener">${IC.clipboard} Xem nội quy</a>
    </div>
  </div></div>`;
}

/* Cơ sở vật chất trong phòng — trang "Phòng của tôi".
   Tách 2 nhóm vì học viên chịu trách nhiệm khác nhau:
     person = bàn giao riêng cho từng người, mất/hư là TRỪ THẲNG VÀO TIỀN CỌC lúc trả phòng
     fixed  = trang bị chung của phòng
   Phí bồi hoàn phải nói TRƯỚC. Trừ tiền rồi mới cho biết là không sòng phẳng. */
function myAssetsPanel(assets, profile) {
  if (!assets.length) return '';
  const mine = assets.filter(a => a.category === 'person');
  const room = assets.filter(a => a.category !== 'person');
  const qty = a => (+a.quantity > 1 ? ` <span class="muted">×${a.quantity}</span>` : '');

  const list = (arr, showFee) => `<div class="asset-grid">${arr.map(a => `
    <div class="asset-item">
      <div class="asset-name">${esc(a.name)}${qty(a)}${a.note ? `<div class="sub2">${esc(a.note)}</div>` : ''}</div>
      ${showFee && +a.fee > 0 ? `<div class="asset-fee"><span class="asset-fee-tag">Đền nếu mất/hư</span><span class="asset-fee-amt">${money(a.fee)}<span class="u">/${esc(a.unit || 'cái')}</span></span></div>` : ''}
    </div>`).join('')}</div>`;

  return `<div class="panel"><div class="hd"><h2>${IC.box} Cơ sở vật chất trong phòng</h2></div><div class="pad">
    ${room.length ? `<h4 class="asset-h">Trang bị chung của phòng <span class="muted" style="text-transform:none;font-weight:500">(dùng chung, hỏng do hao mòn không phải đền)</span></h4>${list(room, false)}` : ''}
    ${mine.length ? `<h4 class="asset-h" style="margin-top:18px">Bàn giao riêng cho bạn <span class="muted" style="text-transform:none;font-weight:500">— nếu làm mất / hư / không vệ sinh thì trừ tiền cọc theo mức bên phải</span></h4>${list(mine, true)}` : ''}
    <div class="hint" style="margin:18px 0 0">${IC.info}<span>Con số <strong>"Đền nếu mất/hư"</strong> bên phải sẽ bị
      <strong>trừ vào tiền cọc</strong> khi bạn trả phòng — chỉ khi món đó <strong>mất, hư hoặc chưa vệ sinh</strong>.
      Đồ hỏng do <strong>hao mòn bình thường</strong> thì <strong>không phải đền</strong>. Nếu có bất kỳ vấn đề gì
      trong quá trình ở, hãy <strong>Gửi yêu cầu hỗ trợ</strong> ở mục <strong>Hỗ trợ học viên</strong> bên dưới.</span></div>
  </div></div>`;
}

// Phí máy giặt KHÔNG có ngày bắt đầu — chỉ là một ô đúng/sai, tính theo số ngày Ở của tháng
// (billing.go:598). Phiếu kỳ này chưa đóng tiền mà được lập lại là phí vào luôn kỳ này; phiếu đã
// đóng thì bị khoá (invoices.go:855) nên phí rơi sang kỳ sau. Câu hỏi phải nói đúng như vậy.
async function toggleMyWashing(on) {
  if (!confirm(on
    ? 'Đăng ký dùng máy giặt?\n\nNếu phiếu báo kỳ này chưa đóng tiền thì phí có thể được tính luôn vào kỳ này. Phiếu đã đóng rồi thì tính từ kỳ sau.'
    : 'Hủy đăng ký máy giặt?\n\nNếu phiếu báo kỳ này chưa đóng tiền thì kỳ này cũng thôi tính phí. Phiếu đã đóng rồi thì hết tính từ kỳ sau.')) return;
  await guard(() => API.meWashing(on));
  toast(on ? 'Đã đăng ký máy giặt' : 'Đã hủy máy giặt'); loadStudentPortal();
}

/* ================= CHUÔNG THÔNG BÁO (cổng học viên) =================
   Máy chủ suy thông báo từ dữ liệu nghiệp vụ và trả về dạng có cấu trúc; câu chữ dựng ở đây.
   Mỗi loại khai: [icon, câu chữ, id khối để nhảy tới]. */
const HV_NOTIF = {
  invoice_new:       n => [IC.receipt, `Phiếu báo kỳ ${monthLabel(n.txt)} đã có — ${money(n.amount)}`, 'pnPhieu'],
  invoice_paid:      n => [IC.checkCircle, `Đã xác nhận nhận tiền kỳ ${monthLabel(n.txt)}`, 'pnPhieu'],
  checkout_done:     n => [IC.logOut, `Đơn trả phòng đã được duyệt${n.txt ? ` — ngày trả ${fmtDate(n.txt)}` : ''}`, 'pnTraPhong'],
  checkout_rejected: () => [IC.alert, 'Đơn trả phòng không được duyệt — liên hệ ban quản lý', 'pnTraPhong'],
  handover:          () => [IC.key, 'Đã xác nhận bàn giao phòng', 'pnTraPhong'],
  deposit_refunded:  () => [IC.handCoins, 'Tiền cọc của bạn đã được hoàn', 'pnTraPhong'],
  damage_assigned:   n => [IC.wrench, `Yêu cầu "${esc(n.txt)}" đã chuyển bộ phận xử lý`, 'pnHoTro'],
  damage_done:       n => [IC.checkCircle, `Yêu cầu "${esc(n.txt)}" đã xử lý xong`, 'pnHoTro'],
  violation:         n => [IC.alert, `Ghi nhận nhắc nhở: ${esc(n.txt)}`, 'pnViPham'],
  leader:            () => [IC.star, 'Bạn được cử làm phòng trưởng', 'pnPhong'],
  rules:             () => [IC.clipboard, 'Nội quy ký túc xá vừa được cập nhật', 'pnNoiQuy'],
  chore:             () => [IC.calendar, 'Tuần này đến lượt bạn trực nhật', 'pnTrucNhat'],
};
let _hvNotif = [], _hvNotifTimer = null;

// Chỉ đổi CON SỐ trên chuông, không vẽ lại trang: người ta đang đọc dở mà đập lại cả trang là mất
// chỗ đang cuộn. Nội dung được làm mới khi họ bấm vào một thông báo.
async function hvNotifTai() {
  if (!Auth.user || _congDangMo !== 'student') return;   // theo CỔNG đang mở, không theo role (kiêm nhiệm)
  let d;
  try { d = await API.meNotifications(); } catch (e) { return; }   // lỗi mạng tạm -> lần sau thử lại
  _hvNotif = (d && d.items) || [];
  const dot = el('hvNotifDot');
  if (dot) { dot.textContent = d.unread > 99 ? '99+' : d.unread; dot.style.display = d.unread ? '' : 'none'; }
  if (el('hvNotifPanel')) hvNotifVe();
}
function startHvNotifPolling() {
  if (_hvNotifTimer) clearInterval(_hvNotifTimer);
  _hvNotifTimer = setInterval(() => {
    if (!Auth.user || _congDangMo !== 'student') { clearInterval(_hvNotifTimer); _hvNotifTimer = null; return; }
    if (document.hidden) return;
    hvNotifTai();
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) hvNotifTai(); });
}
function hvNotifDong() {
  const p = el('hvNotifPanel'); if (!p) return;
  p.remove();
  document.removeEventListener('mousedown', _hvNotifNgoai, true);
  document.removeEventListener('touchstart', _hvNotifNgoai, true);
  document.removeEventListener('keydown', _hvNotifPhim, true);
  const b = el('hvNotifBell'); if (b) b.setAttribute('aria-expanded', 'false');
}
function _hvNotifNgoai(e) {
  const p = el('hvNotifPanel'), b = el('hvNotifBell');
  if (p && !p.contains(e.target) && b && !b.contains(e.target)) hvNotifDong();
}
function _hvNotifPhim(e) { if (e.key === 'Escape') { e.stopPropagation(); hvNotifDong(); } }
function hvNotifVe() {
  const p = el('hvNotifPanel'); if (!p) return;
  const dong = n => {
    const f = HV_NOTIF[n.kind]; if (!f) return '';       // loại lạ (máy chủ mới hơn client) -> bỏ qua
    const [ic, chu, neo] = f(n);
    return `<button class="notif-item${n.unread ? ' notif-moi' : ''}" data-act="hvNotifDi" data-args='["${neo}"]'>${ic}<span>${chu}
      <span class="muted" style="display:block;font-size:11.5px">${fmtDate(String(n.ts).slice(0, 10))}</span></span></button>`;
  };
  const ds = _hvNotif.map(dong).join('');
  p.innerHTML = `<div class="notif-hd" id="hvNotifHd">${IC.bell} Thông báo</div>${ds ||
    `<div class="notif-empty">${IC.checkCircle} Chưa có thông báo nào</div>`}`;
}
async function toggleHvNotif(e) {
  if (e) e.stopPropagation();
  if (el('hvNotifPanel')) { hvNotifDong(); return; }
  const p = document.createElement('div');
  p.className = 'notif-panel'; p.id = 'hvNotifPanel';
  p.setAttribute('role', 'dialog'); p.setAttribute('aria-labelledby', 'hvNotifHd'); p.tabIndex = -1;
  document.body.appendChild(p);           // gắn vào body: trang vẽ lại thì panel vẫn sống
  hvNotifVe();
  const r = el('hvNotifBell').getBoundingClientRect(), pw = p.offsetWidth;
  p.style.top = (r.bottom + 8) + 'px';
  p.style.left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8) + 'px';
  p.style.right = 'auto';
  el('hvNotifBell').setAttribute('aria-expanded', 'true');
  (p.querySelector('.notif-item') || p).focus();
  setTimeout(() => {
    document.addEventListener('mousedown', _hvNotifNgoai, true);
    document.addEventListener('touchstart', _hvNotifNgoai, true);
    document.addEventListener('keydown', _hvNotifPhim, true);
  }, 0);
  // Mở chuông = đã xem hết. Dấu "mới" trên từng dòng vẫn giữ tới lần tải sau để còn nhìn ra cái nào mới.
  try { await API.meNotifSeen(); } catch (err) { return; }
  const dot = el('hvNotifDot'); if (dot) dot.style.display = 'none';
}
// Bấm một thông báo: tải lại nội dung trang (số liệu có thể đã cũ) rồi nhảy tới đúng khối và tô sáng.
async function hvNotifDi(neo) {
  hvNotifDong();
  await loadStudentPortal();
  const t = el(neo); if (!t) return;
  t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  t.classList.add('pn-sang');
  setTimeout(() => t.classList.remove('pn-sang'), 1600);
}

/* ================================================================= */
/* ==============          CỔNG BẢO TRÌ             ================= */
/* ================================================================= */
async function renderMaintenance() {
  _congDangMo = 'maintenance';
  el('app').innerHTML = `
    <div class="app"><div class="main" style="margin:0 auto;max-width:940px;width:100%">
      <div class="top">
        <div><h1>${IC.wrench} Bảo trì ký túc xá</h1><div class="sub">Xin chào, ${esc(Auth.user.full_name || Auth.user.username)}</div></div>
        <div class="toolbar"><button class="btn sm" data-act="loadMaintenance">${IC.refresh} Tải lại</button>${laKiemNhiem() ? `<button class="btn sm" data-act="switchPortal" data-args='["tenant"]'>${IC.home} Cổng khách thuê</button>` : ''}${dungMatKhau() ? `<button class="btn sm" data-act="changePwd">${IC.key} Đổi mật khẩu</button>` : ''}<button class="btn sm" data-act="logout">${IC.logOut} Đăng xuất</button></div>
      </div>
      <div class="content" id="content"><div class="spinner"></div></div>
    </div></div>`;
  startTableResize();
  loadMaintenance();
  startMaintPolling();
}
// Bảo trì cần biết có việc mới được giao mà không phải tự bấm Tải lại (tinh thần V2-81).
// Trang bảo trì CHÍNH là hàng đợi việc của họ nên tự làm mới cả trang, nhưng KHÔNG đè khi đang
// mở form (modal) hay ẩn tab — tránh cắt ngang thao tác đang dở.
let _maintTimer = null;
function startMaintPolling() {
  if (_maintTimer) clearInterval(_maintTimer);
  _maintTimer = setInterval(() => {
    if (!Auth.user || _congDangMo !== 'maintenance') { clearInterval(_maintTimer); _maintTimer = null; return; }
    if (document.hidden) return;
    if (el('overlay') && el('overlay').classList.contains('show')) return;  // đang mở form -> đừng đụng
    if (maintTab !== 'sua') return;   // đang ở tab khác -> đừng vẽ lại dưới tay người ta
    loadMaintenance();
  }, 60000);
}
// Mỗi việc MỘT tab, tab nào chỉ hiện việc của tab đó. Nhồi nhiều bảng vào một màn thì trên điện
// thoại thành cuộn vô tận, còn trên máy tính thì hai bảng cạnh nhau bị bóp cụt cột.
let maintTab = 'nhan';
let maintChiChuaXong = false;   // ô cảnh báo bật bộ lọc này -> bảng chỉ còn việc cần làm
const MAINT_TABS = [
  ['nhan', 'userCheck', 'Nhận phòng'],
  ['tra', 'doorOpen', 'Trả phòng'],
  ['sua', 'wrench', 'Sửa chữa'],
  ['xe', 'bike', 'Xe'],
];
function maintGo(tab) {
  if (tab !== maintTab) maintChiChuaXong = false;
  maintTab = tab; loadMaintenance();
}
function maintLocChuaXong() { maintChiChuaXong = !maintChiChuaXong; loadMaintenance(); }
// Đếm cho huy hiệu trên đầu tab. Hỏng thì bỏ huy hiệu, KHÔNG chặn cả trang.
let _maintDem = { nhan: null, tra: null, sua: null };
async function maintNapDem() {
  try { const s = await API.handoverSummary(); _maintDem.nhan = s.pendingCheckin; _maintDem.tra = s.pendingCheckout; } catch {}
  try { const s = await API.maintenanceSummary(); _maintDem.sua = s.pending; } catch {}
}
async function loadMaintenance() {
  const veTab = () => el('maintTabs') && (el('maintTabs').innerHTML = MAINT_TABS.map(([k, ico, nhan]) => {
    const n = _maintDem[k];
    return `<button class="btn sm ${maintTab === k ? 'pri' : ''}" data-act="maintGo" data-args='["${k}"]'>${IC[ico]} ${nhan}${
      n ? ` <span class="badge red" style="margin-left:2px">${n}</span>` : ''}</button>`;
  }).join(''));
  el('content').innerHTML = `<div class="pill-row" id="maintTabs"></div><div id="maintBody"><div class="spinner"></div></div>`;
  veTab();
  maintNapDem().then(veTab);
  if (maintTab === 'xe') return loadParkingCheck();
  if (maintTab === 'sua') return loadMaintViec();
  return loadHandovers();
}
// Ô cảnh báo: bấm được, bật/tắt bộ lọc "chỉ việc chưa xong". Còn việc thì màu hổ phách, hết thì xanh.
function maintCanhBao(soViec, chuCoViec, chuXong) {
  if (!soViec) return `<div class="bang-tin" style="border-color:var(--green);color:var(--green-ink)">${IC.checkCircle} ${chuXong}</div>`;
  return `<button type="button" class="bang-tin canh-bao" data-act="maintLocChuaXong"
    aria-pressed="${maintChiChuaXong}" title="Bấm để ${maintChiChuaXong ? 'xem lại tất cả' : 'chỉ xem việc chưa xong'}"
    style="border-color:var(--amber-ink);color:var(--amber-ink);width:100%;text-align:left;cursor:pointer">
    ${IC.bell} <span><strong>${soViec}</strong> ${chuCoViec} —
    <u>${maintChiChuaXong ? 'đang lọc, bấm để xem tất cả' : 'bấm để xem riêng'}</u></span></button>`;
}
async function loadMaintViec() {
  let tasks = [];
  try { tasks = await API.maintenanceTasks(); }
  catch (e) { el('maintBody').innerHTML = `<div class="bang-tin">${IC.alert} ${esc(e.message)}</div>`; return; }
  const pending = tasks.filter(t => t.status !== 'done');
  const done = tasks.filter(t => t.status === 'done');
  el('maintBody').innerHTML = `
    ${maintCanhBao(pending.length, 'việc sửa chữa chưa xong', 'Không còn việc sửa chữa nào.')}
    <div class="panel"><div class="hd"><h2>${IC.wrench} Cần xử lý (${pending.length})</h2></div><div class="table-wrap card-tbl">
      ${pending.length ? `<table><thead><tr><th>Chuyển lúc</th><th>Phòng</th><th>Nội dung</th><th>Người báo</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${pending.map(t => `<tr>
          <td data-label="Chuyển lúc">${fmtDate(String(t.assigned_at).slice(0, 10))}</td>
          <td data-label="Phòng"><strong>${esc(t.room_name || '—')}</strong></td>
          <td data-label="Nội dung"><strong>${esc(t.title)}</strong>${t.description ? `<div class="muted" style="font-size:12px">${esc(t.description)}</div>` : ''}</td>
          <td data-label="Người báo">${esc(t.student_name || '—')}${t.student_phone ? `<div class="muted" style="font-size:11px">${esc(t.student_phone)}</div>` : ''}</td>
          <td data-label="Trạng thái">${t.status === 'blocked' ? `<span class="badge red">Chưa xử lý được</span>${t.admin_note ? `<div style="font-size:11px;color:var(--red-ink)">Lý do: ${esc(t.admin_note)}</div>` : ''}`
            : t.status === 'processing' ? '<span class="badge blue">Đang xử lý</span>' : '<span class="badge amber">Mới nhận</span>'}</td>
          <td class="num"><div class="rowbtns" style="justify-content:flex-end;flex-wrap:wrap;gap:4px">
            ${t.status !== 'processing' ? `<button class="btn sm" data-act="maintDo" data-args='[${t.id},"processing"]'>Bắt đầu xử lý</button>` : ''}
            <button class="btn sm danger" data-act="maintBlockForm" data-args='[${t.id}]'>${IC.alert} Chưa xử lý được</button>
            <button class="btn sm green" data-act="maintDoneForm" data-args='[${t.id}]'>${IC.check} Đã xử lý xong</button>
          </div></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Không có công việc cần xử lý.</div>'}
    </div></div>
    ${!maintChiChuaXong && done.length ? `<div class="panel"><div class="hd"><h2>${IC.history} Đã hoàn thành (${done.length})</h2></div><div class="table-wrap card-tbl">
      <table><thead><tr><th>Xong lúc</th><th>Phòng</th><th>Nội dung</th><th>Ghi chú bảo trì</th></tr></thead><tbody>
        ${done.map(t => `<tr><td data-label="Xong lúc">${fmtDate(String(t.resolved_at || t.assigned_at).slice(0, 10))}</td><td data-label="Phòng">${esc(t.room_name || '—')}</td><td data-label="Nội dung">${esc(t.title)}</td><td data-label="Ghi chú" class="muted">${esc(t.admin_note || '—')}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`;
}
/* ---- Bàn giao phòng (bảo trì xác nhận nhận/trả phòng thực tế) ---- */
let hoMonth = '';
async function loadHandovers(month) {
  if (month) hoMonth = month;
  const area = el('maintBody'); if (!area) return;
  let d;
  try { d = await API.handovers(hoMonth); }
  catch (e) { area.innerHTML = `<div class="bang-tin">${IC.alert} ${esc(e.message)}</div>`; return; }
  hoMonth = d.month;
  const laNhan = maintTab === 'nhan';
  const esq = s => esc(String(s || '')).replace(/'/g, '&#39;');
  const monthsList = [];
  for (let i = -1; i <= 12; i++) { const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i); monthsList.push(dt.toISOString().slice(0, 7)); }
  const monthOpts = monthsList.map(m => `<option value="${m}" ${m === hoMonth ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
  // An ninh đứng trước mặt học viên: biển số và ngày đến đều đối chiếu được ngay, sai thì sửa tại chỗ.
  const oXe = x => {
    const xe = x.vehicles || [];
    if (!xe.length) return '<span class="muted">không có xe</span>';
    return xe.map(v => `<div class="flex" style="gap:6px;align-items:center;flex-wrap:wrap">
      <strong>${esc(v.plate || '—')}</strong>${v.vehicle_type ? `<span class="muted" style="font-size:11px">${esc(v.vehicle_type)}</span>` : ''}
      <button class="btn sm ghost" title="Biển thật khác biển này — sửa lại"
        data-act="maintSuaBienForm" data-args='[${v.id},"${esq(v.plate || '')}"]'>${IC.pencil}</button></div>`).join('');
  };
  const inRow = x => `<tr>
    <td data-label="Học viên"><strong>${esc(x.name)}</strong></td><td data-label="Phòng">${esc(x.room_name || '—')}</td>
    <td data-label="Biển số xe">${oXe(x)}</td>
    <td data-label="Ngày">${fmtDate(x.date)}
      <button class="btn sm ghost" title="Đến nhận lệch ngày — sửa về ngày thật"
        data-act="maintSuaNgayNhanForm" data-args='[${x.id},"${esc(x.date || '')}","${esq(x.name)}"]'>${IC.pencil}</button></td>
    <td class="num">${x.checkin_confirmed_at
      ? `<span class="badge green">${IC.check} Đã nhận phòng</span>${x.checkin_confirm_note ? `<div class="muted" style="font-size:11px;white-space:normal">${esc(x.checkin_confirm_note)}</div>` : ''}`
      : `<button class="btn sm green" data-act="handoverCheckinRow" data-args='[${x.id}]' data-hname="${esc(x.name)}">${IC.check} Đã nhận phòng</button>`}</td></tr>`;
  const outRow = x => `<tr>
    <td data-label="Học viên"><strong>${esc(x.name)}</strong></td><td data-label="Phòng">${esc(x.room_name || '—')}</td><td data-label="Ngày ĐK">${fmtDate(x.date)}</td>
    <td class="num">${x.checkout_confirmed_at
      ? `<span class="badge green">${IC.check} Đã trả ${fmtDate(x.checkout_actual_date)}</span>
        <button class="btn sm ghost" title="Ngày rời thật khác ngày đã ghi — sửa lại"
          data-act="maintSuaNgayTraForm" data-args='[${x.id},"${esc((x.checkout_actual_date || '').slice(0, 10))}","${esq(x.name)}"]'>${IC.pencil}</button>${x.checkout_confirm_note ? `<div class="muted" style="font-size:11px;white-space:normal">${esc(x.checkout_confirm_note)}</div>` : ''}`
      : `<button class="btn sm green" data-act="handoverCheckoutRow" data-args='[${x.id}]' data-hname="${esc(x.name)}" data-plandate="${esc(x.date || '')}">${IC.check} Đã trả phòng</button>`}</td></tr>`;

  const tatCa = laNhan ? d.checkins : d.checkouts;
  const xong = x => (laNhan ? x.checkin_confirmed_at : x.checkout_confirmed_at);
  const chuaXong = tatCa.filter(x => !xong(x));
  const hien = maintChiChuaXong ? chuaXong : tatCa;
  const tieuDe = laNhan ? 'Nhận phòng' : 'Trả phòng';
  const cotNgay = laNhan ? 'Ngày' : 'Ngày ĐK';
  area.innerHTML = `
    <div class="panel"><div class="hd"><h2>${laNhan ? IC.userCheck : IC.doorOpen} ${tieuDe} — ${monthLabel(hoMonth)}</h2>
      <select data-change="onHandoverMonth" aria-label="Chọn tháng" style="font-weight:600;padding:6px 8px;border-radius:8px;max-width:100%">${monthOpts}</select></div>
      <div class="pad">
        ${maintCanhBao(chuaXong.length, `học viên ${laNhan ? 'nhận' : 'trả'} phòng chưa xác nhận`,
    `Đã xác nhận hết ${tatCa.length} lượt ${laNhan ? 'nhận' : 'trả'} phòng tháng này.`)}
        <div class="hint">${IC.info}<span>Xác nhận thực tế: ${laNhan ? 'giao phòng, bàn giao tài sản, phát chìa khoá.' : 'kiểm tra tài sản, thu chìa khoá, ghi ngày rời thật.'}</span></div>
      </div>
      <div class="table-wrap card-tbl" style="padding:0 16px 16px">
        ${hien.length ? `<table><thead><tr><th>Học viên</th><th>Phòng</th>${laNhan ? '<th>Biển số xe</th>' : ''}<th>${cotNgay}</th><th></th></tr></thead><tbody>
          ${hien.map(laNhan ? inRow : outRow).join('')}</tbody></table>`
    : `<div class="empty">${maintChiChuaXong ? 'Không còn ai chưa xác nhận.' : `Không có ai ${laNhan ? 'nhận' : 'trả'} phòng tháng này.`}</div>`}
      </div>
    </div>`;
}
// Sửa biển số ngay lúc bàn giao — an ninh nhìn tận mắt xe thật.
function maintSuaBienForm(vehicleId, bienCu) {
  openModal(`
    <div class="mh"><h3>${IC.pencil} Sửa biển số xe</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="bang-tin">${IC.info} <span>Biển đang lưu trên app: <strong>${esc(bienCu) || '(trống)'}</strong>.
        Nhập biển ĐỌC ĐƯỢC TRÊN XE THẬT. Mọi lần sửa đều được ghi vết.</span></div>
      <div class="field" style="margin:0"><label>Biển số thật ${SAO}</label>
        <input id="sb_plate" value="${esc(bienCu)}" placeholder="59-XB 564.35" autocapitalize="characters"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button>
      <button class="btn pri" data-act="maintSuaBienLuu" data-args='[${vehicleId}]'>Lưu biển mới</button></div>`);
  setTimeout(() => el('sb_plate') && el('sb_plate').focus(), 50);
}
async function maintSuaBienLuu(vehicleId) {
  const v = el('sb_plate').value.trim();
  if (!v) return toast('Chưa nhập biển số', 'err');
  const r = await guard(() => API.maintSuaBienSo(vehicleId, v));
  closeModal();
  toast(r.doi ? `Đã sửa biển: ${r.cu || '(trống)'} → ${r.plate}` : 'Biển không đổi');
  loadMaintenance();
}
// Học viên đến nhận phòng lệch ngày ghi trên app -> sửa về ngày thật.
function maintSuaNgayNhanForm(id, ngayCu, ten) {
  openModal(`
    <div class="mh"><h3>${IC.calendar} Sửa ngày nhận phòng</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="bang-tin">${IC.info} <span><strong>${esc(ten)}</strong> — app ghi ngày nhận phòng là
        <strong>${fmtDate(ngayCu)}</strong>. Nếu hôm nay mới đến thật thì sửa lại, tiền phòng tính theo ngày này.
        Mọi lần sửa đều được ghi vết.</span></div>
      <div class="field" style="margin:0"><label>Ngày nhận phòng thật ${SAO}</label><input id="sn_ngay"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button>
      <button class="btn pri" data-act="maintSuaNgayNhanLuu" data-args='[${id}]'>Lưu ngày mới</button></div>`);
  attachDate(el('sn_ngay'), (ngayCu || '').slice(0, 10));
}
async function maintSuaNgayNhanLuu(id) {
  const iso = el('sn_ngay').dataset.iso;
  if (!iso) return toast('Chưa chọn ngày', 'err');
  const r = await guard(() => API.maintSuaNgayNhan(id, iso));
  closeModal();
  toast(r.doi ? `Đã sửa ngày nhận: ${fmtDate(r.cu) || '(trống)'} → ${fmtDate(r.date)}` : 'Ngày không đổi');
  loadMaintenance();
}
// Trả phòng đã xác nhận nhưng ngày rời thật khác -> an ninh sửa tại chỗ, cùng handler "Sửa ngày trả"
// của BQL (dời lượt ở + tính lại phiếu hai tháng + phần điện bạn cùng phòng).
function maintSuaNgayTraForm(id, ngayCu, ten) {
  openModal(`
    <div class="mh"><h3>${IC.calendar} Sửa ngày trả phòng</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="bang-tin">${IC.info} <span><strong>${esc(ten)}</strong> — app ghi ngày trả phòng là
        <strong>${fmtDate(ngayCu)}</strong>. Rời sớm/muộn hơn thì sửa về ngày thật: phiếu báo và phần điện
        của cả phòng tính lại theo ngày này. Mọi lần sửa đều được ghi vết.</span></div>
      <div class="field"><label>Ngày trả phòng thật ${SAO}</label><input id="st_ngay"></div>
      <div class="field" style="margin:0"><label>Ghi chú</label><input id="st_note" placeholder="VD: bạn ấy rời từ hôm trước, nay mới báo"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button>
      <button class="btn pri" data-act="maintSuaNgayTraLuu" data-args='[${id}]'>Lưu ngày mới</button></div>`);
  attachDate(el('st_ngay'), (ngayCu || '').slice(0, 10));
}
async function maintSuaNgayTraLuu(id) {
  const iso = el('st_ngay').dataset.iso;
  if (!iso) return toast('Chưa chọn ngày', 'err');
  const r = await guard(() => API.maintSuaNgayTra(id, { date: iso, note: el('st_note').value.trim() }));
  closeModal();
  toast(r.cu === r.moi ? 'Ngày không đổi' : `Đã sửa ngày trả: ${fmtDate(r.cu)} → ${fmtDate(r.moi)}`);
  loadHandovers();
  if (r.canh_bao) alert(r.canh_bao);
}
function handoverCheckinForm(id, name) {
  openModal(`
    <div class="mh"><h3>${IC.check} Xác nhận đã nhận phòng</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <p class="muted" style="margin:0 0 10px">Học viên: <strong>${esc(name)}</strong></p>
      <div class="field"><label>Ghi chú bàn giao <span class="opt">(tình trạng phòng, đã giao chìa khóa...)</span></label><textarea id="ho_note" rows="3" placeholder="VD: Phòng sạch, đã giao 1 chìa khóa phòng + 1 chìa tủ locker..."></textarea></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="submitHandoverCheckin" data-args='[${id}]'>Xác nhận đã nhận phòng</button></div>`);
}
async function submitHandoverCheckin(id) {
  await guard(() => API.confirmHandoverCheckin(id, el('ho_note').value.trim()));
  closeModal(); toast('Đã xác nhận nhận phòng'); loadHandovers();
}
function handoverCheckoutForm(id, name, planDate) {
  openModal(`
    <div class="mh"><h3>${IC.check} Xác nhận đã trả phòng</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <p class="muted" style="margin:0 0 10px">Học viên: <strong>${esc(name)}</strong>${planDate ? ` · đăng ký trả: ${fmtDate(planDate)}` : ''}</p>
      <div class="field"><label>Ngày trả phòng THỰC TẾ *</label><input id="ho_date"></div>
      <div class="field"><label>Ghi chú (kiểm tra tài sản, thu chìa khóa) *</label><textarea id="ho_note" rows="3" placeholder="VD: Đã thu 2 chìa khóa, tài sản đủ, tường có vết bẩn nhỏ..."></textarea></div>
      <div class="hint" style="font-size:12px">${IC.info} Ngày trả thực tế sẽ cập nhật để phiếu báo tính đúng số ngày ở.</div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="submitHandoverCheckout" data-args='[${id}]'>Xác nhận đã trả phòng</button></div>`);
  attachDate(el('ho_date'), planDate || today());
}
async function submitHandoverCheckout(id) {
  const d = el('ho_date').dataset.iso;
  if (!d) return toast('Chọn ngày trả phòng thực tế', 'err');
  const r = await guard(() => API.confirmHandoverCheckout(id, d, el('ho_note').value.trim()));
  closeModal(); toast('Đã xác nhận trả phòng'); loadHandovers();
  if (r && r.canh_bao) alert(r.canh_bao);   // phiếu kỳ này ĐÃ THU — báo để BQL xử phần chênh
}
async function maintDo(id, status) { await guard(() => API.maintenanceTaskStatus(id, status)); toast('Đã cập nhật'); loadMaintenance(); }
function maintDoneForm(id) {
  openModal(`
    <div class="mh"><h3>${IC.check} Hoàn thành công việc</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb"><div class="field"><label>Ghi chú bảo trì (đã làm gì)</label><textarea id="mt_note" rows="3" placeholder="VD: Đã thay vòi nước mới, kiểm tra lại..."></textarea></div></div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="submitMaintDone" data-args='[${id}]'>Xác nhận đã xong</button></div>`);
}
async function submitMaintDone(id) {
  await guard(() => API.maintenanceTaskStatus(id, 'done', el('mt_note').value.trim()));
  closeModal(); toast('Đã hoàn thành công việc'); loadMaintenance();
}
function maintBlockForm(id) {
  openModal(`
    <div class="mh"><h3>${IC.alert} Chưa xử lý được</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb"><div class="field"><label>Lý do chưa xử lý được *</label>
      <textarea id="mt_reason" rows="3" placeholder="VD: Cần thay linh kiện, đang đặt hàng · Ngoài khả năng, cần thợ ngoài · Chờ học viên có mặt..."></textarea></div>
      <div class="hint" style="font-size:12px">${IC.info} Công việc vẫn nằm trong danh sách "Cần xử lý"; quản lý & học viên sẽ thấy lý do này.</div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn danger" data-act="submitMaintBlock" data-args='[${id}]'>Lưu lý do</button></div>`);
  setTimeout(() => el('mt_reason').focus(), 50);
}
async function submitMaintBlock(id) {
  const reason = el('mt_reason').value.trim(); if (!reason) return toast('Nhập lý do chưa xử lý được', 'err');
  await guard(() => API.maintenanceTaskStatus(id, 'blocked', reason));
  closeModal(); toast('Đã ghi nhận lý do'); loadMaintenance();
}

/* ================================================================= */
/* ==============      ĐIỂM DANH BÃI XE (an ninh)   ================= */
/* ================================================================= */
let pkNgay = '';            // ngày đang điểm danh (rỗng = hôm nay, server tự điền)
let pkData = null;          // dữ liệu lượt kiểm đang mở (dùng cho tìm nhanh + gợi ý biển)
let pkAnh = '';             // ảnh biển số vừa chụp ở form quét (data URL)

// Chuẩn hoá biển số y hệt máy chủ: bỏ mọi ký tự không phải chữ/số, viết hoa.
// "63-B4 508.58" và "63B450858" là CÙNG một xe.
const pkChuanBien = p => String(p || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

async function loadParkingCheck() {
  const body = el('maintBody'); if (!body) return;
  let d;
  try { d = await API.parkingList(pkNgay); }
  catch (e) { body.innerHTML = `<div class="bang-tin">${IC.alert} ${esc(e.message)}</div>`; return; }
  pkNgay = d.date; pkData = d;
  const s = d.summary, laHomNay = d.date === d.hom_nay;
  const conLai = s.chua_danh;

  const hang = v => {
    const tim = `${v.plate || ''} ${v.plate_norm || ''} ${v.student_name || ''} ${v.room_name || ''} ${v.vehicle_type || ''} ${v.sticker || ''}`.toLowerCase();
    const nut = v.status
      ? `<span class="badge ${v.status === 'present' ? 'green' : 'gray'}">${v.status === 'present' ? IC.checkCircle + ' Có' : IC.undo + ' Vắng'}</span>
         <button class="btn sm ghost" title="Bỏ đánh dấu" data-act="pkBoDanhDau" data-args='[${v.check_id}]'>${IC.undo}</button>`
      : `<button class="btn sm green" data-act="pkDanhDau" data-args='[${v.vehicle_id},"present"]'>${IC.check} Có</button>
         <button class="btn sm ghost" data-act="pkDanhDau" data-args='[${v.vehicle_id},"absent"]'>Vắng</button>`;
    return `<tr data-s="${esc(tim)}">
      <td data-label="Biển số"><strong>${esc(v.plate || '—')}</strong>${v.sticker ? `<div class="muted" style="font-size:11px">Dán số ${esc(v.sticker)}</div>` : ''}</td>
      <td data-label="Chủ xe">${esc(v.student_name || '—')}<div class="muted" style="font-size:11px">${esc(v.room_name || 'Chưa xếp phòng')}${v.vehicle_type ? ' · ' + esc(v.vehicle_type) : ''}</div></td>
      <td class="num"><div class="rowbtns" style="justify-content:flex-end;flex-wrap:wrap;gap:4px">${nut}
        ${v.has_photo ? `<button class="btn sm ghost" title="Xem ảnh đã chụp" data-act="pkXemAnh" data-args='[${v.check_id}]'>${IC.search}</button>` : ''}</div></td></tr>`;
  };

  body.innerHTML = `
    <div class="cards">
      <div class="stat"><div class="l">${IC.bike} Xe phải kiểm</div><div class="v sm">${s.tong}</div></div>
      <div class="stat"><div class="l">${IC.checkCircle} Có</div><div class="v sm" style="color:var(--green)">${s.co_mat}</div></div>
      <div class="stat"><div class="l">${IC.undo} Vắng</div><div class="v sm">${s.vang}</div></div>
      <div class="stat"><div class="l">${IC.hourglass} Chưa đánh</div><div class="v sm" style="color:${conLai ? 'var(--amber-ink)' : 'var(--green)'}">${conLai}</div></div>
    </div>
    <div class="panel"><div class="hd">
      <h2>${IC.bike} Điểm danh bãi xe — ${fmtDate(d.date)}${laHomNay ? ' (hôm nay)' : ''}</h2>
      <div class="toolbar" style="flex-wrap:wrap;gap:6px">
        <input id="pk_ngay" style="max-width:150px">
        <button class="btn sm pri" data-act="pkCameraForm">${IC.search} Quét camera</button>
        <button class="btn sm" data-act="pkQuetForm">${IC.pencil} Gõ biển</button>
        <button class="btn sm" data-act="pkXeLaForm">${IC.plus} Xe lạ</button>
        <button class="btn sm" data-act="pkBaoCaoForm">${IC.history} Báo cáo</button>
      </div></div>
      <div class="pad">
        <div class="bang-tin">${IC.info} Đi hết bãi rồi bấm <strong>Chốt lượt kiểm</strong> — mọi xe chưa đánh dấu sẽ được ghi là <strong>vắng</strong>.</div>
        <div class="flex" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
          <button class="btn ${conLai ? 'pri' : ''}" ${conLai ? '' : 'disabled'} data-act="pkChotLuot">${IC.check} Chốt lượt kiểm${conLai ? ` (${conLai} xe còn lại)` : ' — đã kiểm đủ'}</button>
        </div>
      </div>
      <div class="search" style="margin:0 16px 10px"><span class="i">${IC.search}</span>
        <input id="pk_tim" placeholder="Gõ vài số cuối biển, tên chủ xe hoặc phòng..."></div>
      <div class="table-wrap card-tbl">${d.vehicles.length
        ? `<table><thead><tr><th>Biển số</th><th>Chủ xe</th><th></th></tr></thead><tbody>
            ${d.vehicles.map(hang).join('')}
            <tr class="no-result" style="display:none"><td colspan="3"><div class="empty">Không tìm thấy xe phù hợp.</div></td></tr>
          </tbody></table>`
        : '<div class="empty">Ngày này không có xe nào đang đăng ký gửi.</div>'}</div>
    </div>
    <div class="panel"><div class="hd"><h2>${IC.alert} Xe lạ ghi nhận hôm nay (${d.strangers.length})</h2></div>
      <div class="table-wrap card-tbl">${d.strangers.length
        ? `<table><thead><tr><th>Biển số</th><th>Ghi chú</th><th>Người ghi</th><th></th></tr></thead><tbody>
            ${d.strangers.map(x => `<tr>
              <td data-label="Biển số"><strong>${esc(x.plate)}</strong></td>
              <td data-label="Ghi chú" class="muted">${esc(x.note || '—')}</td>
              <td data-label="Người ghi" class="muted">${esc(x.checked_by || '—')}</td>
              <td class="num"><div class="rowbtns" style="justify-content:flex-end;gap:4px">
                ${x.has_photo ? `<button class="btn sm ghost" title="Xem ảnh" data-act="pkXemAnh" data-args='[${x.id}]'>${IC.search}</button>` : ''}
                <button class="btn sm ghost" title="Xoá bản ghi" data-act="pkBoDanhDau" data-args='[${x.id}]'>${IC.trash}</button>
              </div></td></tr>`).join('')}
          </tbody></table>`
        : '<div class="empty">Chưa ghi nhận xe lạ nào.</div>'}</div>
    </div>`;
  attachDate(el('pk_ngay'), d.date, { max: d.hom_nay });
  el('pk_ngay').addEventListener('change', () => { pkNgay = el('pk_ngay').dataset.iso; loadParkingCheck(); });
  attachRowSearch(el('pk_tim'));
}

async function pkDanhDau(vehicleId, status) {
  await guard(() => API.parkingMark({ vehicle_id: vehicleId, date: pkNgay, status }));
  toast(status === 'present' ? 'Đã ghi: có' : 'Đã ghi: vắng');
  loadParkingCheck();
}
async function pkBoDanhDau(id) {
  if (!confirm('Bỏ ghi nhận này?')) return;
  await guard(() => API.parkingUndo(id));
  toast('Đã bỏ ghi nhận'); loadParkingCheck();
}
async function pkChotLuot() {
  const conLai = pkData ? pkData.summary.chua_danh : 0;
  if (!confirm(`Chốt lượt kiểm ngày ${fmtDate(pkNgay)}?\n\n${conLai} xe chưa đánh dấu sẽ được ghi là VẮNG.`)) return;
  const r = await guard(() => API.parkingFinish(pkNgay));
  toast(`Đã chốt lượt · ghi ${r.da_ghi_vang} xe vắng`);
  loadParkingCheck();
}
function pkXemAnh(id) {
  openModal(`
    <div class="mh"><h3>${IC.search} Ảnh biển số</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb" style="text-align:center"><img src="/api/maintenance/parking/photo/${id}" alt="Ảnh biển số"
      style="max-width:100%;border-radius:10px" data-err="onImgFallback">
      <div style="display:none;padding:24px" class="empty">Không tải được ảnh.</div></div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`);
}

/* ---- Quét biển số: chụp ảnh + gõ vài ký tự -> app gợi ý 3 xe khớp nhất, bấm 1 lần là xong ---- */
function pkQuetForm() {
  pkAnh = '';
  openModal(`
    <div class="mh"><h3>${IC.search} Quét biển số</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="field"><label>Ảnh biển số <span class="opt">(không bắt buộc — lưu làm bằng chứng)</span></label>
        ${pkNutAnh('pk_cam', 'onPkCam')}
        <div id="pk_xem" style="margin-top:8px"></div></div>
      <div class="field"><label>Biển số — gõ vài ký tự là đủ</label>
        <input id="pk_bien" placeholder="VD: 508 · 63B4 · 50858" autocomplete="off" data-input="onPkBien"></div>
      <div id="pk_goiy"><div class="muted" style="font-size:13px">Gõ để tìm xe trong bãi.</div></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`);
  setTimeout(() => { const i = el('pk_bien'); if (i) i.focus(); }, 60);
}
function onPkCam() { pkDocAnh(this, xong => { el('pk_xem').innerHTML = xong ? `<img src="${xong}" style="max-width:100%;border-radius:8px">` : ''; }); }

// Ô chọn tệp gốc của trình duyệt in chữ Anh ("Choose File / No file chosen") — cả app tiếng Việt
// thì không để một mẩu tiếng Anh giữa form. Giấu ô thật, bấm qua <label for> (CSP không chặn).
// capture="environment": trên điện thoại mở thẳng camera sau, không phải đi vòng qua thư viện ảnh.
function pkNutAnh(id, ham) {
  // display/font ghi đè tại chỗ: `.field label` (styles.css:355) ép block + chữ nhỏ, nếu không nó
  // kéo dài hết bề ngang và trông y như một ô nhập chứ không phải nút bấm.
  return `<label class="btn" for="${id}" style="display:inline-flex;width:auto;cursor:pointer;font-size:14px;color:var(--ink);margin:0">${IC.search} Chụp ảnh biển số</label>
    <input type="file" accept="image/*" capture="environment" id="${id}" data-change="${ham}" style="display:none">`;
}

// Ảnh máy điện thoại 3-8MB, mà body API chỉ nhận 2MB -> thu về tối đa 1280px, JPEG chất lượng 0,72.
function pkDocAnh(input, xong) {
  const f = input.files && input.files[0];
  if (!f) { pkAnh = ''; return xong(''); }
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canh = Math.max(img.width, img.height), ti = canh > 1280 ? 1280 / canh : 1;
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * ti); cv.height = Math.round(img.height * ti);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      pkAnh = cv.toDataURL('image/jpeg', 0.72);
      xong(pkAnh);
    };
    img.onerror = () => { pkAnh = ''; toast('Không đọc được ảnh', 'err'); xong(''); };
    img.src = String(fr.result);
  };
  fr.onerror = () => { pkAnh = ''; toast('Không đọc được ảnh', 'err'); xong(''); };
  fr.readAsDataURL(f);
}

// Điểm giống nhau giữa chuỗi gõ vào và biển số. Bãi chỉ vài chục xe nên gõ 3 ký tự là đủ tách bạch;
// khớp lệch vài ký tự vẫn ra đúng xe, và người bấm mới là người quyết định.
function pkDiem(q, bien) {
  if (!q) return 0;
  if (bien === q) return 1000;
  if (bien.indexOf(q) >= 0) return 800 + q.length * 4 - bien.indexOf(q);
  let i = 0, khop = 0;
  for (const ch of bien) { if (i < q.length && ch === q[i]) { i++; khop++; } }
  if (i < q.length) return 0;                       // không chứa đủ ký tự đã gõ, theo đúng thứ tự
  return 300 + khop * 4 - (bien.length - khop);
}
function onPkBien() {
  const hop = el('pk_goiy'); if (!hop || !pkData) return;
  const q = pkChuanBien(this.value);
  if (!q) { hop.innerHTML = '<div class="muted" style="font-size:13px">Gõ để tìm xe trong bãi.</div>'; return; }
  const top = pkData.vehicles
    .map(v => ({ v, d: pkDiem(q, pkChuanBien(v.plate)) }))
    .filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
  if (!top.length) {
    hop.innerHTML = `<div class="bang-tin">${IC.alert} Không có xe đăng ký nào khớp <strong>${esc(this.value)}</strong>.
      <button class="btn sm danger" style="margin-left:8px" data-act="pkGhiXeLaTuQuet">${IC.plus} Ghi là xe lạ</button></div>`;
    return;
  }
  hop.innerHTML = top.map(({ v }) => `
    <div class="flex" style="justify-content:space-between;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)">
      <div><strong>${esc(v.plate)}</strong>${v.status ? ` <span class="badge ${v.status === 'present' ? 'green' : 'gray'}">${v.status === 'present' ? 'Đã ghi: có' : 'Đã ghi: vắng'}</span>` : ''}
        <div class="muted" style="font-size:12px">${esc(v.student_name || '—')} · ${esc(v.room_name || 'chưa xếp phòng')}</div></div>
      <button class="btn sm green" data-act="pkQuetChon" data-args='[${v.vehicle_id}]'>${IC.check} Có</button>
    </div>`).join('')
    + `<div style="margin-top:10px"><button class="btn sm ghost" data-act="pkGhiXeLaTuQuet">${IC.plus} Không phải xe nào ở trên — ghi là xe lạ</button></div>`;
}
async function pkQuetChon(vehicleId) {
  await guard(() => API.parkingMark({ vehicle_id: vehicleId, date: pkNgay, status: 'present', photo: pkAnh || undefined }));
  closeModal(); toast('Đã ghi: có gửi'); loadParkingCheck();
}
function pkGhiXeLaTuQuet() {
  const bien = el('pk_bien') ? el('pk_bien').value.trim() : '';
  const anh = pkAnh;
  pkXeLaForm(bien);
  pkAnh = anh;                                   // giữ lại tấm vừa chụp cho form xe lạ
  if (anh && el('pk_xem2')) el('pk_xem2').innerHTML = `<img src="${anh}" style="max-width:100%;border-radius:8px">`;
}

/* ================= QUÉT BIỂN SỐ BẰNG CAMERA =================
   Bộ đọc chạy NGAY TRÊN MÁY bảo vệ (WebAssembly), không gửi ảnh về máy chủ — nên quét được cả
   khi mất mạng và không phải chờ máy chủ thức dậy.
   Không có bước tự dò vùng biển: bảo vệ đưa biển vào KHUNG NGẮM, app chỉ đọc đúng vùng đó. */
const PK_BANG_CHU = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_';
const PK_O_CHU = 9;        // model có 9 ô ký tự
const PK_SO_LOP = 37;      // mỗi ô chọn 1 trong 37 ký tự
const PK_MODEL_W = 128, PK_MODEL_H = 64;
const PK_KHUNG_TL = 1.35;  // khung ngắm rộng/cao — bằng tỉ lệ biển xe máy Việt Nam
const PK_LANG_MS = 6000;   // xử lý xong một chuỗi thì làm ngơ đúng chuỗi đó bấy nhiêu mili giây
let _pkOrt = null;         // phiên suy luận, nạp một lần rồi giữ lại
let _pkCam = null;         // { stream, huy } của lượt quét đang chạy

// Phiên bản asset, lấy từ chính thẻ script đang nạp — khỏi phải sửa tay ở hai chỗ.
const pkV = () => { const s = document.querySelector('script[src*="/js/"][src*="?v="]'); return s ? '?v=' + s.src.split('?v=')[1] : ''; };

function pkNapScript(src) {
  return new Promise((ok, hong) => {
    if (window.ort) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = () => ok(); s.onerror = () => hong(new Error('Không tải được bộ đọc biển số'));
    document.head.appendChild(s);
  });
}
async function pkNapOrt(bao) {
  if (_pkOrt) return _pkOrt;
  bao('Đang tải bộ đọc biển số (chỉ lần đầu, ~15MB)…');
  // Bản CHỈ-WASM, không phải bundle "all" — bundle all đòi thêm tệp jsep 25MB cho WebGPU mà ta không dùng.
  await pkNapScript('/vendor/plate/ort.wasm.min.js' + pkV());
  // Ghim tường minh từng tệp: để ORT tự đoán là nó đi tìm biến thể khác (jsep/asyncify) không có ở đây.
  ort.env.wasm.wasmPaths = {
    mjs: '/vendor/plate/ort-wasm-simd-threaded.mjs' + pkV(),
    wasm: '/vendor/plate/ort-wasm-simd-threaded.wasm' + pkV(),
  };
  ort.env.wasm.numThreads = 1;
  bao('Đang khởi động bộ đọc…');
  _pkOrt = await ort.InferenceSession.create('/vendor/plate/plate-ocr.onnx' + pkV(), { executionProviders: ['wasm'] });
  return _pkOrt;
}

// Cắt đúng vùng khung ngắm rồi nén về 128×64 — giống hệt cách đã đo được 5/5 trên ảnh thật.
function pkLayTensor(video, khung) {
  const cv = document.createElement('canvas');
  cv.width = PK_MODEL_W; cv.height = PK_MODEL_H;
  cv.getContext('2d').drawImage(video, khung.x, khung.y, khung.w, khung.h, 0, 0, PK_MODEL_W, PK_MODEL_H);
  const px = cv.getContext('2d').getImageData(0, 0, PK_MODEL_W, PK_MODEL_H).data;   // RGBA
  const rgb = new Uint8Array(PK_MODEL_W * PK_MODEL_H * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
  return new ort.Tensor('uint8', rgb, [1, PK_MODEL_H, PK_MODEL_W, 3]);
}
function pkGiaiMa(logits) {
  let bien = '';
  for (let o = 0; o < PK_O_CHU; o++) {
    let cao = -Infinity, chon = 0;
    for (let c = 0; c < PK_SO_LOP; c++) { const v = logits[o * PK_SO_LOP + c]; if (v > cao) { cao = v; chon = c; } }
    const ch = PK_BANG_CHU[chon];
    if (ch !== '_') bien += ch;
  }
  return bien;
}
// Các cặp ký tự bộ đọc hay lẫn trên biển số — lẫn đúng những cặp này thì phạt nhẹ thôi.
const PK_HAY_LAN = ['0OQD', '1IL7', '2Z', '5S', '6G', '8B', '4A'];
function pkPhat(a, b) {
  if (a === b) return 0;
  for (const nhom of PK_HAY_LAN) if (nhom.includes(a) && nhom.includes(b)) return 0.4;
  return 1;
}
// Khoảng cách sửa lỗi giữa chuỗi MÁY ĐỌC và biển đã đăng ký.
// KHÔNG dùng pkDiem ở đây: hàm đó đòi chuỗi là DÃY CON đúng thứ tự — hợp với người gõ tay, nhưng
// máy đọc thì sai vài ký tự GIỮA chuỗi, nên xe đúng bị chấm 0 điểm và biến mất khỏi gợi ý.
function pkKhoangCach(a, b) {
  const m = a.length, n = b.length;
  let truoc = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const sau = [i];
    for (let j = 1; j <= n; j++) {
      sau[j] = Math.min(truoc[j] + 1, sau[j - 1] + 1, truoc[j - 1] + pkPhat(a[i - 1], b[j - 1]));
    }
    truoc = sau;
  }
  return truoc[n];
}
// Xếp hạng xe trong bãi theo độ gần với chuỗi máy đọc được.
function pkXepGan(bien) {
  if (!pkData) return [];
  return pkData.vehicles
    .map(x => ({ x, kc: pkKhoangCach(bien, pkChuanBien(x.plate)) }))
    .sort((a, b) => a.kc - b.kc);
}

// Tiếng tít khi quét trúng — bảo vệ không phải nhìn màn hình.
function pkTit(cao) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ac = new AC(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = cao ? 880 : 300; o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.12, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.16);
    o.start(); o.stop(ac.currentTime + 0.17);
  } catch (e) { /* máy không cho phát tiếng thì thôi */ }
}

function pkCameraForm() {
  openModal(`
    <div class="mh"><h3>${IC.search} Quét biển số</h3><button class="x" aria-label="Đóng" data-act="pkCamDong">×</button></div>
    <div class="mb" style="padding-top:8px">
      <div id="pk_cam_box" data-act="pkCamQuetLai" title="Chạm để quét lại"
           style="position:relative;background:#000;border-radius:12px;overflow:hidden;aspect-ratio:3/4;max-height:56vh;margin:0 auto;cursor:pointer">
        <video id="pk_video" playsinline autoplay muted style="width:100%;height:100%;object-fit:cover"></video>
        <div id="pk_khung" style="position:absolute;border:3px solid #fff;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.45);pointer-events:none"></div>
      </div>
      <div id="pk_cam_tt" class="bang-tin" style="margin-top:10px">${IC.info} Đang chuẩn bị camera…</div>
      <div id="pk_cam_kq" style="margin-top:8px"></div>
      <div class="hint" style="font-size:12px">${IC.info} Đưa biển số vào trong khung trắng, giữ máy yên khoảng một giây.
        App chỉ tự ghi "có gửi" khi đọc <strong>trùng khít</strong> biển đã đăng ký; lệch dù một ký tự là nó
        hiện vài xe gần giống để <strong>bạn xác nhận</strong>, máy không tự quyết.
        Đọc sai thì bấm <strong>Quét lại</strong> (hoặc chạm vào hình) — không phải tắt camera. Trời tối thì bật đèn pin.</div>
    </div>
    <div class="mf">
      <button class="btn" data-act="pkCamQuetLai">${IC.refresh} Quét lại</button>
      <button class="btn" data-act="pkCamSangGoTay">${IC.pencil} Gõ tay</button>
      <button class="btn" data-act="pkCamDong">Đóng</button>
    </div>`);
  pkCamChay();
}
function pkCamDatKhung() {
  const box = el('pk_cam_box'), k = el('pk_khung'); if (!box || !k) return null;
  const W = box.clientWidth, H = box.clientHeight;
  const w = Math.round(W * 0.82), h = Math.round(w / PK_KHUNG_TL);
  const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
  k.style.left = x + 'px'; k.style.top = y + 'px'; k.style.width = w + 'px'; k.style.height = h + 'px';
  return { x, y, w, h, W, H };
}
async function pkCamChay() {
  const bao = t => { const e = el('pk_cam_tt'); if (e) e.innerHTML = `${IC.info} ${esc(t)}`; };
  // Trình duyệt CHỈ cho dùng camera ở ngữ cảnh an toàn (HTTPS hoặc localhost). Vào bằng địa chỉ IP
  // trong mạng nội bộ thì navigator.mediaDevices không tồn tại — phải nói rõ, đừng để văng TypeError.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    bao(location.protocol === 'https:' || location.hostname === 'localhost'
      ? 'Trình duyệt này không hỗ trợ camera. Dùng nút "Gõ tay thay vì quét" bên dưới.'
      : 'Chỉ quét được khi vào app bằng địa chỉ https:// (đang vào bằng ' + location.protocol + '//' + location.hostname + '). Dùng nút "Gõ tay thay vì quét" bên dưới.');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } });
  } catch (e) {
    const n = e && e.name;
    bao(n === 'NotAllowedError' ? 'Bạn đã từ chối quyền dùng camera. Mở lại quyền trong cài đặt trình duyệt rồi thử lại.'
      : n === 'NotFoundError' ? 'Máy này không có camera. Dùng nút "Gõ tay thay vì quét" bên dưới.'
      : 'Không mở được camera (' + (n || 'lỗi') + '). Dùng nút "Gõ tay thay vì quét" bên dưới.');
    return;
  }
  const v = el('pk_video');
  if (!v) { stream.getTracks().forEach(t => t.stop()); return; }
  v.srcObject = stream;
  _pkCam = { stream, huy: false };
  await new Promise(r => { v.onloadedmetadata = r; setTimeout(r, 2500); });
  try { await v.play(); } catch (e) { /* một số máy cần chạm mới phát */ }
  pkCamDatKhung();

  try { await pkNapOrt(bao); }
  catch (e) { bao('Không tải được bộ đọc: ' + (e.message || '') + '. Dùng nút "Gõ tay thay vì quét".'); return; }
  bao('Đưa biển vào khung trắng…');

  let lanTruoc = '';
  _pkCam.daGhi = {};
  _pkCam.choChon = false;   // đang chờ bảo vệ bấm chọn -> tạm ngưng tự nhận, khỏi nhấp nháy
  _pkCam.bienCuoi = '';     // chuỗi vừa xử lý gần nhất
  _pkCam.bienXong = '';     // chuỗi đang được làm ngơ (đã xử lý xong hoặc vừa bấm quét lại)
  _pkCam.bienXongLuc = 0;
  const vong = async () => {
    if (!_pkCam || _pkCam.huy || !el('pk_video') || !el('overlay').classList.contains('show')) return pkCamDung();
    if (_pkCam.choChon) return setTimeout(vong, 250);      // vẫn giữ camera, chỉ ngưng chấm
    const khung = pkCamDatKhung();
    if (!khung || !v.videoWidth) return setTimeout(vong, 250);
    // Khung ngắm đang tính theo pixel của THẺ VIDEO; object-fit:cover nên phải quy về pixel ảnh gốc.
    const ti = Math.max(khung.W / v.videoWidth, khung.H / v.videoHeight);
    const leX = (v.videoWidth * ti - khung.W) / 2, leY = (v.videoHeight * ti - khung.H) / 2;
    const g = { x: (khung.x + leX) / ti, y: (khung.y + leY) / ti, w: khung.w / ti, h: khung.h / ti };
    try {
      const out = await _pkOrt.run({ [_pkOrt.inputNames[0]]: pkLayTensor(v, g) });
      const bien = pkGiaiMa(out[_pkOrt.outputNames[0]].data);
      // Chốt hai lần đọc GIỐNG NHAU mới nhận — một khung hình mờ là đủ để đọc sai.
      if (bien && bien === lanTruoc && bien.length >= 7) {
        lanTruoc = '';
        // Xử lý xong một chuỗi thì LÀM NGƠ đúng chuỗi đó một lúc: xe vẫn nằm trước camera nên
        // khung sau đọc ra y hệt, không chặn thì nó ghi đè mất thông báo vừa hiện.
        const lapLai = bien === _pkCam.bienXong && Date.now() - _pkCam.bienXongLuc < PK_LANG_MS;
        if (!lapLai) await pkCamNhan(bien);
      } else lanTruoc = bien;
    } catch (e) { /* khung hình lỗi thì bỏ qua, thử khung sau */ }
    setTimeout(vong, 180);
  };
  _pkCam.chay = vong;
  vong();
}
// Quét lại: xoá kết quả cũ, cho vòng chấm chạy tiếp. Bảo vệ KHÔNG phải tắt/bật camera nữa.
// Kèm làm ngơ chính chuỗi vừa đọc sai một lúc — không thì khung hình sau lại ra đúng nó và
// màn hình hiện lại y hệt, nhìn như nút không có tác dụng.
function pkCamQuetLai() {
  const kq = el('pk_cam_kq'); if (kq) kq.innerHTML = '';
  const tt = el('pk_cam_tt');
  if (tt) tt.innerHTML = `${IC.info} Đang quét lại — chỉnh lại góc máy cho rõ biển, hoặc đưa xe khác vào khung.`;
  if (_pkCam) {
    _pkCam.bienXong = _pkCam.bienCuoi || '';
    _pkCam.bienXongLuc = Date.now();
    _pkCam.choChon = false;
  }
}
// Đã đọc ra chuỗi ổn định -> dò vào danh sách xe của bãi.
// Chỉ TỰ GHI khi gần như chắc chắn; hơi ngờ thì đưa 3 xe gần nhất cho bảo vệ bấm chọn.
// Bộ đọc sai vài ký tự là chuyện thường, nên bế tắc ở đây là bảo vệ phải tắt/bật lại camera.
async function pkCamNhan(bien) {
  const kq = el('pk_cam_kq'); if (!kq || !pkData || !_pkCam) return;
  _pkCam.bienCuoi = bien;
  const gan = pkXepGan(bien);
  const nhat = gan[0];
  const nutQuetLai = `<button class="btn sm" data-act="pkCamQuetLai">${IC.refresh} Quét lại</button>`;
  const theXe = (t, chinh) => `<div class="flex" style="justify-content:space-between;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)">
      <div><strong>${esc(t.x.plate)}</strong>${t.x.status === 'present' ? ' <span class="badge green">đã ghi</span>' : ''}
        <div class="muted" style="font-size:12px">${esc(t.x.student_name || '—')}${t.x.room_name ? ' · ' + esc(t.x.room_name) : ''}</div></div>
      <div class="flex" style="gap:6px">
        <button class="btn sm" title="Biển trên app ghi sai — sửa thành ${esc(bien)}"
          data-act="pkCamSuaBien" data-args='[${t.x.vehicle_id},"${esc(bien)}"]'>${IC.pencil} Sửa biển</button>
        <button class="btn sm ${chinh ? 'green' : ''}" data-act="pkCamChon" data-args='[${t.x.vehicle_id},"${esc(bien)}"]'>${IC.check} Có</button>
      </div>
    </div>`;

  // CHỈ tự ghi khi đọc TRÙNG KHÍT biển đã đăng ký. Lệch dù một ký tự cũng phải người bấm xác nhận:
  // đây là ghi nhận vào tài sản của người khác, máy không được tự quyết thay.
  // Trọng số ký tự hay lẫn (8↔B, 0↔O…) chỉ dùng để XẾP HẠNG gợi ý, không dùng để tự ghi.
  if (nhat && nhat.kc === 0) {
    await pkCamGhi(nhat.x, bien);
    return;
  }
  _pkCam.choChon = true;                                  // ngưng chấm, chờ người quyết
  const ungVien = gan.filter(t => t.kc <= 4).slice(0, 3);
  if (ungVien.length) {
    pkTit(false);
    kq.innerHTML = `<div class="bang-tin" style="border-color:var(--amber-ink)">${IC.alert}
        Đọc được <strong>${esc(bien)}</strong> — <strong>không trùng khít</strong> biển nào, bạn xác nhận đúng xe:</div>
      ${ungVien.map((t, i) => theXe(t, i === 0)).join('')}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${nutQuetLai}
        <button class="btn sm danger" data-act="pkCamXeLa" data-args='["${esc(bien)}"]'>${IC.plus} Ghi là xe lạ</button></div>`;
    return;
  }
  pkTit(false);
  kq.innerHTML = `<div class="bang-tin" style="border-color:var(--amber-ink)">${IC.alert}
      Đọc được <strong>${esc(bien)}</strong> nhưng không giống xe nào đã đăng ký.</div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${nutQuetLai}
      <button class="btn sm danger" data-act="pkCamXeLa" data-args='["${esc(bien)}"]'>${IC.plus} Ghi là xe lạ</button></div>`;
}
// Biển trên app ghi sai so với xe thật: sửa lại rồi ghi điểm danh luôn, khỏi phải nhớ quay lại.
async function pkCamSuaBien(vehicleId, bien) {
  if (!confirm(`Sửa biển số trong app thành "${bien}" (đọc từ ảnh)?\n\nSau đó sẽ ghi luôn là có gửi. Lần sửa này được ghi vết.`)) return;
  const r = await guard(() => API.maintSuaBienSo(vehicleId, bien));
  if (!r) return;
  toast(r.doi ? `Đã sửa biển: ${r.cu || '(trống)'} → ${r.plate}` : 'Biển không đổi');
  const v = (pkData.vehicles || []).find(x => x.vehicle_id === vehicleId);
  if (v) { v.plate = r.plate; await pkCamGhi(v, bien); }
}
// Bảo vệ bấm chọn một xe trong danh sách gợi ý.
async function pkCamChon(vehicleId, bien) {
  const v = (pkData.vehicles || []).find(x => x.vehicle_id === vehicleId);
  if (!v) return;
  await pkCamGhi(v, bien);
  if (_pkCam) _pkCam.choChon = false;                     // ghi xong thì quét tiếp ngay
}
// Ghi "có gửi" cho một xe + hiện kết quả.
async function pkCamGhi(v, bien) {
  const kq = el('pk_cam_kq'); if (!kq || !_pkCam) return;
  const daGhi = _pkCam.daGhi || (_pkCam.daGhi = {});
  if (daGhi[v.vehicle_id]) return;                        // vừa ghi xong, đừng ghi lại
  daGhi[v.vehicle_id] = true;
  // Xe vẫn nằm trước camera nên khung sau đọc ra y hệt — làm ngơ chuỗi này một lúc, nếu không
  // thông báo "đã ghi có gửi" bị chính nó ghi đè sau chưa tới nửa giây, bảo vệ không kịp thấy.
  _pkCam.bienXong = bien;
  _pkCam.bienXongLuc = Date.now();
  if (v.status === 'present') {
    pkTit(true);
    kq.innerHTML = `<div class="bang-tin">${IC.checkCircle} <strong>${esc(v.plate)}</strong> — ${esc(v.student_name || '')} đã ghi "có gửi" từ trước.</div>`;
    return;
  }
  try {
    await API.parkingMark({ vehicle_id: v.vehicle_id, date: pkNgay, status: 'present' });
    v.status = 'present';
    pkTit(true);
    kq.innerHTML = `<div class="bang-tin" style="border-color:var(--green)">${IC.checkCircle}
      <strong>${esc(v.plate)}</strong> — ${esc(v.student_name || '')} · ${esc(v.room_name || '')} → <strong>đã ghi có gửi</strong>.
      <span class="muted">(đọc: ${esc(bien)})</span></div>`;
  } catch (e) {
    pkTit(false);
    kq.innerHTML = `<div class="bang-tin" style="border-color:var(--red)">${IC.alert} ${esc(e.message || 'Không ghi được')}</div>`;
    delete daGhi[v.vehicle_id];
  }
}
function pkCamXeLa(bien) { pkCamDung(); pkXeLaForm(bien); }
function pkCamSangGoTay() { pkCamDung(); pkQuetForm(); }
function pkCamDung() {
  if (_pkCam) { _pkCam.huy = true; try { _pkCam.stream.getTracks().forEach(t => t.stop()); } catch (e) {} _pkCam = null; }
}
function pkCamDong() { pkCamDung(); closeModal(); loadParkingCheck(); }

/* ---- Ghi nhận xe lạ (không có trong danh sách đăng ký) ---- */
function pkXeLaForm(bienSan) {
  if (!bienSan) pkAnh = '';
  openModal(`
    <div class="mh"><h3>${IC.alert} Ghi nhận xe lạ</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="field"><label>Biển số *</label><input id="pk_la_bien" value="${esc(bienSan || '')}" placeholder="VD: 63-B4 508.58"></div>
      <div class="field"><label>Ghi chú <span class="opt">(loại xe, màu, chỗ đậu, đã nhắc ai...)</span></label>
        <textarea id="pk_la_note" rows="3" placeholder="VD: Xe Wave đỏ đậu sát cổng, không có mã dán"></textarea></div>
      <div class="field"><label>Ảnh biển số <span class="opt">(không bắt buộc)</span></label>
        ${pkNutAnh('pk_cam2', 'onPkCam2')}
        <div id="pk_xem2" style="margin-top:8px"></div></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="pkLuuXeLa">Ghi nhận</button></div>`);
  setTimeout(() => { const i = el('pk_la_bien'); if (i && !bienSan) i.focus(); }, 60);
}
function onPkCam2() { pkDocAnh(this, xong => { el('pk_xem2').innerHTML = xong ? `<img src="${xong}" style="max-width:100%;border-radius:8px">` : ''; }); }
async function pkLuuXeLa() {
  const plate = el('pk_la_bien').value.trim();
  if (!plate) return toast('Nhập biển số', 'err');
  try {
    await API.parkingStranger({ plate, date: pkNgay, note: el('pk_la_note').value.trim(), photo: pkAnh || undefined });
  } catch (e) {
    // Biển hoá ra đã đăng ký: mời điểm danh đúng chỗ thay vì tạo một bản ghi "xe lạ" sai.
    const dk = e && e.status === 409 && e.data && e.data.registered;
    if (dk) {
      if (confirm(`${e.data.error}\n\n${dk.plate} — ${dk.student_name || ''}${dk.room_name ? ' · ' + dk.room_name : ''}\n\nĐánh dấu xe này CÓ GỬI luôn?`)) {
        await guard(() => API.parkingMark({ vehicle_id: dk.vehicle_id, date: pkNgay, status: 'present', photo: pkAnh || undefined }));
        closeModal(); toast('Đã ghi: có gửi'); loadParkingCheck();
      }
      return;
    }
    toast((e && e.message) || 'Có lỗi xảy ra', 'err'); return;
  }
  closeModal(); toast('Đã ghi nhận xe lạ'); loadParkingCheck();
}

/* ---- Báo cáo lịch sử gửi xe (dùng chung cho an ninh và quản lý) ---- */
let pkBcTu = '', pkBcDen = '';
function pkBaoCaoForm() {
  const nay = today();
  pkBcDen = pkBcDen || nay;
  pkBcTu = pkBcTu || addDays(nay, -13);
  openModal(`
    <div class="mh"><h3>${IC.history} Lịch sử gửi xe</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="flex" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>Từ ngày</label><input id="pk_bc_tu" style="max-width:150px"></div>
        <div class="field" style="margin:0"><label>Đến ngày</label><input id="pk_bc_den" style="max-width:150px"></div>
        <button class="btn sm" data-act="pkBcNhanh" data-args='[7]'>7 ngày</button>
        <button class="btn sm" data-act="pkBcNhanh" data-args='[14]'>14 ngày</button>
        <button class="btn sm" data-act="pkBcNhanh" data-args='[30]'>30 ngày</button>
        <button class="btn sm pri" data-act="pkBcTai">${IC.refresh} Xem</button>
      </div>
      <div id="pk_bc_body" style="margin-top:12px"><div class="spinner"></div></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`, 'x');
  attachDate(el('pk_bc_tu'), pkBcTu, { max: nay });
  attachDate(el('pk_bc_den'), pkBcDen, { max: nay });
  pkBcTai();
}
function pkBcNhanh(n) {
  const nay = today();
  pkBcDen = nay; pkBcTu = addDays(nay, -(n - 1));
  attachDate(el('pk_bc_tu'), pkBcTu, { max: nay });
  attachDate(el('pk_bc_den'), pkBcDen, { max: nay });
  pkBcTai();
}
async function pkBcTai() {
  const hop = el('pk_bc_body'); if (!hop) return;
  pkBcTu = el('pk_bc_tu').dataset.iso || pkBcTu;
  pkBcDen = el('pk_bc_den').dataset.iso || pkBcDen;
  hop.innerHTML = '<div class="spinner"></div>';
  let d;
  try { d = await API.parkingReport(pkBcTu, pkBcDen); }
  catch (e) { hop.innerHTML = `<div class="bang-tin">${IC.alert} ${esc(e.message)}</div>`; return; }

  const nhan = ds => { const p = ds.split('-'); return `${p[2]}/${p[1]}`; };
  const o = st => st === 'present' ? '<span title="Có" style="color:var(--green);font-weight:700">●</span>'
    : st === 'absent' ? '<span title="Vắng" style="color:var(--red-ink)">○</span>'
    : '<span title="Chưa kiểm" class="muted">·</span>';
  const tongCoMat = d.rows.reduce((a, r) => a + r.co_mat, 0);
  const tongVang = d.rows.reduce((a, r) => a + r.vang, 0);
  const canhBao = d.rows.filter(r => r.vang_lien_tiep >= d.alert_days);
  const ngayChuaKiem = d.day_summary.filter(x => !x.da_kiem);

  hop.innerHTML = `
    <div class="cards">
      <div class="stat"><div class="l">${IC.bike} Xe theo dõi</div><div class="v sm">${d.rows.length}</div></div>
      <div class="stat"><div class="l">${IC.checkCircle} Lượt có gửi</div><div class="v sm" style="color:var(--green)">${tongCoMat}</div></div>
      <div class="stat"><div class="l">${IC.undo} Lượt vắng</div><div class="v sm">${tongVang}</div></div>
      <div class="stat"><div class="l">${IC.alert} Bỏ gửi ≥ ${d.alert_days} ngày</div><div class="v sm" style="color:${canhBao.length ? 'var(--red)' : 'var(--green)'}">${canhBao.length}</div></div>
    </div>
    ${ngayChuaKiem.length ? `<div class="bang-tin" style="border-color:var(--amber-ink)">${IC.alert}
      <strong>${ngayChuaKiem.length}</strong> ngày trong khoảng này không có ai đi kiểm bãi:
      ${ngayChuaKiem.slice(0, 8).map(x => fmtDate(x.date)).join(' · ')}${ngayChuaKiem.length > 8 ? '…' : ''}</div>` : ''}
    ${canhBao.length ? `<div class="bang-tin" style="border-color:var(--red)">${IC.alert}
      Xe vắng liên tiếp từ ${d.alert_days} ngày trở lên — kiểm tra lại đăng ký hoặc hỏi chủ xe:
      ${canhBao.map(r => `<strong>${esc(r.plate)}</strong> (${esc(r.student_name || 'đã gỡ')} · ${r.vang_lien_tiep} ngày)`).join(' · ')}</div>` : ''}
    <div class="table-wrap" style="max-height:56vh;overflow:auto">
      ${d.rows.length ? `<table><thead><tr>
        <th style="position:sticky;left:0;background:var(--card);z-index:2;min-width:190px">Xe · có gửi / không</th>
        ${d.days.map(x => `<th style="text-align:center;font-size:11px;white-space:nowrap">${nhan(x)}</th>`).join('')}
        </tr></thead><tbody>
        ${d.rows.map(r => `<tr>
          <td style="position:sticky;left:0;background:var(--card);min-width:190px">
            <strong>${esc(r.plate || '—')}</strong>${r.da_go ? ' <span class="badge gray">đã gỡ</span>' : ''}
            <span style="white-space:nowrap;margin-left:6px"><strong style="color:var(--green)">${r.co_mat}</strong><span class="muted"> / ${r.vang}</span></span>
            ${r.vang_lien_tiep >= d.alert_days ? ` <span class="badge red" style="font-size:10px">bỏ ${r.vang_lien_tiep} ngày</span>` : ''}
            <div class="muted" style="font-size:11px">${esc(r.student_name || '—')}${r.room_name ? ' · ' + esc(r.room_name) : ''}</div></td>
          ${d.days.map(x => `<td style="text-align:center">${o(r.marks[x])}</td>`).join('')}
        </tr>`).join('')}
      </tbody></table>` : '<div class="empty">Không có xe nào trong khoảng đã chọn.</div>'}
    </div>
    <div class="muted" style="font-size:12px;margin-top:8px">
      <span style="color:var(--green);font-weight:700">●</span> có gửi &nbsp;·&nbsp;
      <span style="color:var(--red-ink)">○</span> vắng &nbsp;·&nbsp; <span class="muted">·</span> chưa ai kiểm ngày đó
    </div>
    ${d.strangers.length ? `<div class="panel" style="margin-top:14px"><div class="hd"><h2>${IC.alert} Xe lạ ghi nhận trong khoảng (${d.strangers.length})</h2></div>
      <div class="table-wrap card-tbl"><table><thead><tr><th>Ngày</th><th>Biển số</th><th>Ghi chú</th><th>Người ghi</th></tr></thead><tbody>
        ${d.strangers.map(x => `<tr><td data-label="Ngày">${fmtDate(String(x.check_date).slice(0, 10))}</td>
          <td data-label="Biển số"><strong>${esc(x.plate)}</strong></td>
          <td data-label="Ghi chú" class="muted">${esc(x.note || '—')}</td>
          <td data-label="Người ghi" class="muted">${esc(x.checked_by || '—')}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`;
}

/* ================= LỊCH CHỌN NGÀY (tiếng Việt, chỉ chọn) ================= */
const VN_DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
function fmtDMY(iso) { if (!iso) return ''; const p = iso.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }
// Gắn bộ chọn ngày cho 1 ô input: readonly, giá trị ISO lưu ở dataset.iso, hiển thị dd/mm/yyyy
// max: ngày muộn nhất được chọn (vd ngày sinh không thể ở TƯƠNG LAI).
// Không giới hạn thì lịch mời người ta chọn năm 2031 làm ngày sinh, app nhận, rồi server
// ÂM THẦM đổi thành trống — người dùng thấy "Đã gửi đăng ký!" và không hề biết mình mất dữ liệu.
function attachDate(input, iso, opt) {
  if (!input) return;
  input.readOnly = true;
  input.dataset.iso = (iso || '').slice(0, 10);
  input.value = fmtDMY(input.dataset.iso);
  input.placeholder = 'Chọn ngày';
  input.classList.add('date-in');
  if (opt && opt.max) input.dataset.max = opt.max;
  if (opt && opt.min) input.dataset.min = opt.min;
  // choTrong: ô ngày của modal xếp phòng — lịch tô màu + số giường trống từng ngày (lọc theo gt).
  if (opt && opt.choTrong) input.dataset.choTrong = '1';
  if (opt && opt.gt) input.dataset.gt = opt.gt;
  input.onclick = () => openCalendar(input);
  input.onfocus = () => openCalendar(input);
}
let _calEl = null;
function closeCalendar() { if (_calEl) { _calEl.remove(); _calEl = null; document.removeEventListener('mousedown', _calOutside, true); } }
function _calOutside(e) { if (_calEl && !_calEl.contains(e.target) && e.target !== _calEl._input) closeCalendar(); }
function openCalendar(input) {
  closeCalendar();
  const base = input.dataset.iso ? new Date(input.dataset.iso + 'T00:00:00') : new Date();
  let view = new Date(base.getFullYear(), base.getMonth(), 1);
  const cal = document.createElement('div'); cal.className = 'cal-pop'; cal._input = input;
  const pick = ds => { input.dataset.iso = ds; input.value = fmtDMY(ds); closeCalendar(); input.dispatchEvent(new Event('change')); };
  const render = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const start = (new Date(y, m, 1).getDay() + 6) % 7; // Thứ 2 = 0
    const days = new Date(y, m + 1, 0).getDate();
    const sel = input.dataset.iso;
    const nowY = new Date().getFullYear();
    let cells = '';
    const max = input.dataset.max || '', min = input.dataset.min || '';
    for (let i = 0; i < start; i++) cells += '<span class="cal-d empty"></span>';
    const coCT = input.dataset.choTrong === '1', gt = input.dataset.gt || '';
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      // Ngày ngoài khoảng cho phép: hiện mờ, KHÔNG bấm được (thà chặn còn hơn cho chọn rồi vứt đi)
      const cam = (max && ds > max) || (min && ds < min);
      const T = coCT && !cam ? tongNgay(ds, gt) : null;
      const cls = T ? (T.vuot ? ' vuot' : T.thucCon ? ' co' : ' het') : '';
      // Số trong ô = CÒN NHẬN ĐƯỢC (đã trừ chỗ đặt trước — owner chốt 21/08, một con số duy nhất).
      // Ô có số là nơi RA QUYẾT ĐỊNH -> <button> để bàn phím focus được; ô thường giữ <span>.
      if (T) cells += `<button type="button" class="cal-d${ds === sel ? ' sel' : ''}${cls}" data-d="${ds}"
        title="còn nhận được ${T.thucCon} giường${T.datCho ? ' (đã trừ ' + T.datCho + ' chỗ đặt trước)' : ''}"
        aria-label="${fmtDMY(ds)}: còn ${T.thucCon} giường${gt ? (gt === 'female' ? ' nữ' : ' nam') : ''}">${d}<b class="cd-so">${T.thucCon}</b></button>`;
      else cells += `<span class="cal-d${ds === sel ? ' sel' : ''}${cam ? ' cam' : ''}" ${cam ? '' : `data-d="${ds}"`}>${d}</span>`;
    }
    cal.innerHTML = `
      <div class="cal-hd">
        <button type="button" class="cal-nav" data-nav="-1">‹</button>
        <div class="cal-title">
          <select class="cal-m">${Array.from({ length: 12 }, (_, i) => `<option value="${i}" ${i === m ? 'selected' : ''}>Tháng ${i + 1}</option>`).join('')}</select>
          <select class="cal-y">${Array.from({ length: 100 }, (_, i) => nowY + 5 - i)
            // Ô có giới hạn (vd ngày sinh) -> KHÔNG liệt kê năm ngoài khoảng. Liệt kê ra rồi
            // chặn ở ngày là bắt người ta bấm mò mới biết mình không được chọn.
            .filter(yy => (!max || yy <= +max.slice(0, 4)) && (!min || yy >= +min.slice(0, 4)))
            .map(yy => `<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy}</option>`).join('')}</select>
        </div>
        <button type="button" class="cal-nav" data-nav="1">›</button>
      </div>
      <div class="cal-dow">${VN_DOW.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-ft"><button type="button" class="btn sm" data-today>Hôm nay</button><button type="button" class="btn sm ghost" data-clear>Xóa</button></div>`;
    cal.querySelectorAll('[data-d]').forEach(e => e.onclick = () => pick(e.dataset.d));
    cal.querySelector('[data-nav="-1"]').onclick = () => { view = new Date(y, m - 1, 1); render(); napThang(); };
    cal.querySelector('[data-nav="1"]').onclick = () => { view = new Date(y, m + 1, 1); render(); napThang(); };
    cal.querySelector('.cal-m').onchange = e => { view = new Date(y, +e.target.value, 1); render(); napThang(); };
    cal.querySelector('.cal-y').onchange = e => { view = new Date(+e.target.value, m, 1); render(); napThang(); };
    cal.querySelector('[data-today]').onclick = () => { const t = new Date(); pick(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`); };
    cal.querySelector('[data-clear]').onclick = () => pick('');
  };
  // Nạp ma trận chỗ trống BẤT ĐỒNG BỘ rồi vẽ lại — chậm hay hỏng thì lịch vẫn mở ngay, chỉ thiếu số.
  const napThang = () => {
    if (input.dataset.choTrong !== '1') return;
    const y = view.getFullYear(), m = view.getMonth();
    const dau = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const cuoi = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;
    napLich(dau, cuoi).then(ok => { if (ok && _calEl === cal) render(); });
  };
  if (input.dataset.choTrong === '1') cal.classList.add('cal-ct');
  document.body.appendChild(cal);
  render();   // BL-27: dựng nội dung TRƯỚC để đo chiều cao thật (cần cho việc lật-lên)
  napThang();
  const r = input.getBoundingClientRect();
  const calH = cal.offsetHeight || 300, calW = cal.offsetWidth || 288;
  // BL-27: mặc định mở XUỐNG; nếu gần đáy màn (tràn viewport) thì LẬT LÊN để hàng ngày cuối + nút
  // "Hôm nay/Xóa" không bị cắt khỏi màn hình. .cal-pop là position:fixed nên dùng toạ độ viewport.
  let top = r.bottom + 6;
  if (top + calH > window.innerHeight - 8) top = Math.max(8, r.top - calH - 6);
  cal.style.top = top + 'px';
  cal.style.left = Math.max(8, Math.min(r.left, window.innerWidth - calW - 8)) + 'px';
  _calEl = cal;
  setTimeout(() => document.addEventListener('mousedown', _calOutside, true), 0);
}

// Bộ chọn THÁNG (kỳ) dạng lịch: điều hướng năm ‹ › + lưới 12 tháng. Dùng lại .cal-pop/closeCalendar.
function attachMonth(input, ym, opt) {
  if (!input) return;
  input.readOnly = true;
  input.dataset.ym = (ym || curMonth()).slice(0, 7);
  input.value = monthLabel(input.dataset.ym);
  input.classList.add('date-in');
  if (opt && opt.max) input.dataset.max = opt.max;   // 'YYYY-MM'
  if (opt && opt.min) input.dataset.min = opt.min;
  input.onclick = () => openMonthPicker(input);
  input.onfocus = () => openMonthPicker(input);
}
function openMonthPicker(input) {
  closeCalendar();
  let year = +(input.dataset.ym || curMonth()).slice(0, 4);
  const cal = document.createElement('div'); cal.className = 'cal-pop'; cal._input = input;
  const pick = ym => { input.dataset.ym = ym; input.value = monthLabel(ym); closeCalendar(); input.dispatchEvent(new Event('change')); };
  const render = () => {
    const sel = input.dataset.ym, max = input.dataset.max || '', min = input.dataset.min || '';
    let cells = '';
    for (let mo = 1; mo <= 12; mo++) {
      const ym = `${year}-${String(mo).padStart(2, '0')}`;
      const cam = (max && ym > max) || (min && ym < min);   // ngoài khoảng -> mờ, không bấm
      cells += `<span class="mo-cell${ym === sel ? ' sel' : ''}${cam ? ' cam' : ''}" ${cam ? '' : `data-ym="${ym}"`}>Th${mo}</span>`;
    }
    cal.innerHTML = `
      <div class="cal-hd">
        <button type="button" class="cal-nav" data-nav="-1">‹</button>
        <div class="cal-title" style="font-weight:700;font-size:15px">Năm ${year}</div>
        <button type="button" class="cal-nav" data-nav="1">›</button>
      </div>
      <div class="cal-mgrid">${cells}</div>`;
    cal.querySelectorAll('[data-ym]').forEach(e => e.onclick = () => pick(e.dataset.ym));
    cal.querySelector('[data-nav="-1"]').onclick = () => { year--; render(); };
    cal.querySelector('[data-nav="1"]').onclick = () => { year++; render(); };
  };
  document.body.appendChild(cal);
  render();
  const r = input.getBoundingClientRect();
  const calH = cal.offsetHeight || 240, calW = cal.offsetWidth || 288;
  let top = r.bottom + 6;
  if (top + calH > window.innerHeight - 8) top = Math.max(8, r.top - calH - 6);
  cal.style.top = top + 'px';
  cal.style.left = Math.max(8, Math.min(r.left, window.innerWidth - calW - 8)) + 'px';
  _calEl = cal;
  setTimeout(() => document.addEventListener('mousedown', _calOutside, true), 0);
}

/* ================= KÉO GIÃN CỘT BẢNG ================= */
function _rzKey(table) {
  const heads = [...table.querySelectorAll('thead th')].map(th => (th.dataset.h || th.textContent).trim()).join('|');
  return 'rzw:' + (ST.view || location.pathname) + ':' + heads.slice(0, 140);
}
function _rzFreeze(table) {
  // Đóng băng độ rộng cột hiện tại -> chuyển sang table-layout:fixed (chỉ khi bắt đầu kéo)
  if (table.classList.contains('rz-fixed')) return;
  const ths = [...table.tHead.rows[0].cells];
  const widths = ths.map(th => th.getBoundingClientRect().width);
  ths.forEach((th, i) => { th.style.width = Math.max(56, Math.round(widths[i])) + 'px'; });
  table.classList.add('rz-fixed');
}
function _rzApplySaved(table) {
  let saved; try { saved = JSON.parse(localStorage.getItem(_rzKey(table)) || 'null'); } catch {}
  const ths = table.querySelectorAll('thead th');
  if (!saved || saved.length !== ths.length) return false;
  ths.forEach((th, i) => { th.style.width = saved[i] + 'px'; });
  table.classList.add('rz-fixed');
  return true;
}
function _rzSave(table) {
  const w = [...table.querySelectorAll('thead th')].map(th => Math.round(th.getBoundingClientRect().width));
  try { localStorage.setItem(_rzKey(table), JSON.stringify(w)); } catch {}
}
function setupResizable(table) {
  if (table.dataset.rz || !table.tHead || !table.tHead.rows.length) return;
  const ths = [...table.tHead.rows[0].cells];
  if (ths.length < 2) return;
  table.dataset.rz = '1'; table.classList.add('rz');
  ths.forEach(th => { if (!th.dataset.h) th.dataset.h = (th.textContent.trim() || th.className || 'c'); });
  _rzApplySaved(table); // Áp độ rộng đã lưu (nếu có); nếu chưa thì giữ mặc định 1 dòng
  ths.forEach((th, i) => {
    if (i === ths.length - 1) return; // cột cuối không cần tay cầm
    const h = document.createElement('span');
    h.className = 'rz-handle'; h.title = 'Kéo để chỉnh độ rộng cột · nhấp đúp để trả về mặc định';
    // Pointer Events: một đường cho cả chuột, cảm ứng và bút. Trước đây chỉ bắt mousedown nên máy
    // tính bảng không kéo được cột nào.
    h.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      _rzFreeze(table); // chỉ đóng băng khi bắt đầu kéo
      const startX = e.clientX, startW = th.getBoundingClientRect().width;
      document.body.classList.add('rz-active');
      try { h.setPointerCapture(e.pointerId); } catch {}
      const move = ev => { th.style.width = Math.max(56, startW + (ev.clientX - startX)) + 'px'; };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        document.body.classList.remove('rz-active'); _rzSave(table);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
    // Nhấp đúp: xóa độ rộng đã lưu, trở về mặc định (1 dòng)
    h.addEventListener('dblclick', e => {
      e.preventDefault(); e.stopPropagation();
      table.querySelectorAll('thead th').forEach(t => t.style.width = '');
      table.classList.remove('rz-fixed');
      try { localStorage.removeItem(_rzKey(table)); } catch {}
    });
    th.appendChild(h);
  });
}
let _rzObs;
function startTableResize() {
  const scan = r => { if (r && r.querySelectorAll) r.querySelectorAll('.table-wrap table').forEach(setupResizable); };
  if (!_rzObs) {
    _rzObs = new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.tagName === 'TABLE' && n.closest('.table-wrap')) setupResizable(n); else scan(n);
    })));
  } else _rzObs.disconnect();
  ['content', 'modal'].forEach(id => { const e = el(id); if (e) { _rzObs.observe(e, { childList: true, subtree: true }); scan(e); } });
}

/* ================================================================= */
/* ==============      CỔNG BAN THƯ KÝ (chỉ xem)     ================ */
/* ================================================================= */
// Ban thư ký chỉ có MỘT màn: hồ sơ lưu trữ rút gọn (API /students/archive).
// Không dùng renderAdmin: các API nền (rooms/settings/facilities...) đều 403 với vai này.
function renderSecretary() {
  _congDangMo = 'secretary';
  el('app').innerHTML = `
    <div class="app"><div class="main" style="margin:0 auto;max-width:1180px;width:100%">
      <div class="top">
        <div><h1>${IC.fileText} Hồ sơ lưu trữ</h1><div class="sub">Xin chào, ${esc(Auth.user.full_name || Auth.user.username)} — Ban thư ký</div></div>
        <div class="toolbar"><button class="btn sm" data-act="loadSecretary">${IC.refresh} Tải lại</button>${laKiemNhiem() ? `<button class="btn sm" data-act="switchPortal" data-args='["tenant"]'>${IC.home} Cổng khách thuê</button>` : ''}${dungMatKhau() ? `<button class="btn sm" data-act="changePwd">${IC.key} Đổi mật khẩu</button>` : ''}<button class="btn sm" data-act="logout">${IC.logOut} Đăng xuất</button></div>
      </div>
      <div class="content" id="content"><div class="spinner"></div></div>
    </div></div>`;
  startTableResize();
  loadSecretary();
}
async function loadSecretary() {
  el('content').innerHTML = '<div class="spinner"></div>';
  let ds = [];
  try { ds = await API.studentsArchive(); }
  catch (e) {
    el('content').innerHTML = `<div class="bang-tin">${IC.alert} <span>${esc(e.message || 'Lỗi kết nối máy chủ')}</span>
      <button class="btn sm" data-act="loadSecretary" style="margin-left:8px">${IC.refresh} Thử lại</button></div>`;
    return;
  }
  const coHD = s => !!String(s.contract_no || '').trim() && String(s.contract_no).trim().toLowerCase() !== 'x';
  el('content').innerHTML = `
    <div class="panel"><div class="hd"><h2>${IC.fileText} Hợp đồng & CCCD (<span id="tkCount">${ds.length}</span>)</h2>
      <div class="toolbar"><div class="search"><span class="i">${IC.search}</span>
        <input id="tkSearch" placeholder="Tìm họ tên / số HĐ / lớp..."></div></div></div>
      <div class="table-wrap card-tbl">
        ${ds.length ? `<table><thead><tr><th>Họ tên</th><th>Ngày sinh</th><th>Trường / lớp</th><th>Số HĐ</th>
          <th>Ngày nhận phòng</th><th>Ngày trả phòng</th>
          <th class="num">Scan HĐ</th><th class="num">CCCD trước</th><th class="num">CCCD sau</th></tr></thead><tbody>
          ${ds.map(s => `<tr data-s="${esc(((s.name || '') + ' ' + (s.contract_no || '') + ' ' + (s.class_name || '')).toLowerCase())}">
            <td data-label="Họ tên"><strong>${esc(s.name)}</strong></td>
            <td data-label="Ngày sinh">${s.birth_date ? fmtDate(s.birth_date) : '<span class="muted">—</span>'}</td>
            <td data-label="Trường / lớp">${esc(s.class_name || '—')}</td>
            <td data-label="Số HĐ">${coHD(s) ? `<strong>${esc(s.contract_no)}</strong>` : '<span class="badge amber">chưa có</span>'}</td>
            <td data-label="Ngày nhận phòng">${s.check_in_date ? fmtDate(s.check_in_date) : '<span class="muted">—</span>'}</td>
            <td data-label="Ngày trả phòng">${s.check_out_date ? fmtDate(s.check_out_date) : '<span class="muted">—</span>'}</td>
            <td class="num" data-label="Scan HĐ">${hsCo(s.has_contract_scan, 'Bản scan hợp đồng', `/api/students/${s.id}/contract-scan`)}</td>
            <td class="num" data-label="CCCD trước">${hsCo(s.has_cccd_front, 'CCCD mặt trước', `/api/students/${s.id}/cccd/front`)}</td>
            <td class="num" data-label="CCCD sau">${hsCo(s.has_cccd_back, 'CCCD mặt sau', `/api/students/${s.id}/cccd/back`)}</td>
          </tr>`).join('')}
          <tr class="no-result" style="display:none"><td colspan="9"><div class="empty">Không tìm thấy hồ sơ phù hợp.</div></td></tr>
        </tbody></table>` : '<div class="empty">Chưa có hồ sơ nào.</div>'}
      </div>
      <div class="pad"><div class="hint">${IC.info}<span>Bấm <strong>Xem</strong> ở ba cột cuối để mở tệp (ảnh hoặc PDF) trong tab mới.</span></div></div>
    </div>`;
  const sb = el('tkSearch'); if (sb) attachRowSearch(sb, 'tkCount');
}

/* ================= CHỐNG BẤM 2 LẦN =================
   Bấm "Lưu" phát thứ hai trong lúc phát đầu chưa xong = 2 request = 2 bản ghi trùng.
   Đây CHÍNH LÀ GỐC của việc thu dư 10.907.925đ/tháng đã phải dọn tay ngày 16/07/2026:
   nhân viên tưởng chưa ăn (mạng chậm) nên bấm lại — app tạo luôn 2 hồ sơ, mỗi hồ sơ 1 phiếu.
   Tuyến chặn trùng ở server KHÔNG cứu được ca này: nó dựa vào mã HV / CCCD, mà học viên
   mới đăng ký thì chưa có mã → cả 2 bản ghi đều lọt.

   Bọc MỘT LẦN ở đây thay vì sửa 42 chỗ gọi — sót một chỗ là lỗ lại mở. Các hàm này khai báo
   bằng `function` ở cấp cao nhất nên nằm sẵn trên window, ghi đè được. */
let _nutVuaBam = null;
document.addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('button') : null;
  if (b) _nutVuaBam = b;
}, true); // pha capture: chạy TRƯỚC onclick, để hàm bên dưới biết nút nào vừa bị bấm

function chongBam2Lan(fn) {
  let dangChay = false;
  return async function (...args) {
    if (dangChay) return;              // cú bấm thứ 2 -> bỏ qua thẳng, không gửi request
    dangChay = true;
    // Báo cho closeModal/adminGo biết đang trong luồng LƯU -> đừng hỏi "bỏ dữ liệu chưa lưu?"
    // ngay sau khi vừa lưu xong. Nhờ cờ này mà không phải sửa 126 chỗ gọi closeModal().
    window._dangLuu = true;
    const nut = _nutVuaBam, chuCu = nut ? nut.textContent : null;
    if (nut) { nut.disabled = true; nut.textContent = 'Đang xử lý…'; } // cho người ta THẤY là đang chạy
    try { return await fn.apply(this, args); }
    finally {
      dangChay = false; window._dangLuu = false;
      if (nut && document.contains(nut)) { nut.disabled = false; nut.textContent = chuCu; }
    }
  };
}

[
  'saveStudent', 'saveRoom', 'saveVehicle', 'saveAsset', 'saveFacility', 'saveUser', 'saveApp',
  'saveViolation', 'saveVtype', 'saveInvoice', 'saveOneInvoice', 'saveElectric', 'saveDeposit',
  'saveAccount', 'saveSettings', 'saveIntro', 'saveBravo', 'saveMailSettings', 'saveSsoSettings', 'saveNote',
  'saveHocVienInfo', 'linkTenant', 'unlinkTenant',
  'doApprove', 'doTransfer', 'doCheckOut', 'doCheckIn', 'doSetLeader', 'unsetLeader',
  'doChangePwd', 'doResetUserPw', 'doKhoaHoSo', 'runGenerate',
  'settleDepositAndClose', 'submitCheckoutReq', 'submitDamage', 'submitHandoverCheckin',
  'submitHandoverCheckout', 'submitMaintBlock', 'submitMaintDone', 'toggleWashing',
  'toggleMyWashing', 'uploadRulesDoc', 'removeRulesDoc', 'luuChotGiuaKy', 'xoaChotGiuaKy',
  'luuTatCaChotGiuaKy',
].forEach(ten => {
  if (typeof window[ten] === 'function') window[ten] = chongBam2Lan(window[ten]);
  else console.warn('[chống bấm 2 lần] không thấy hàm:', ten); // đổi tên hàm mà quên sửa đây -> báo ngay
});

/* ================= CHUYỂN CỔNG (kiêm nhiệm) ================= */
// p = 'tenant' (cổng khách thuê) | 'work' (cổng theo vai). Chỉ là lựa chọn UI — server phân quyền theo DB.
function switchPortal(p) {
  try { localStorage.setItem('ktx_portal', p); } catch {}
  // Tắt hết các vòng poll của cổng cũ; _notifTimer (cổng quản lý) KHÔNG có guard nên phải clear tay.
  if (typeof _notifTimer !== 'undefined' && _notifTimer) { clearInterval(_notifTimer); _notifTimer = null; }
  if (_hvNotifTimer) { clearInterval(_hvNotifTimer); _hvNotifTimer = null; }
  if (_maintTimer) { clearInterval(_maintTimer); _maintTimer = null; }
  boot();
}

/* ================= KHỞI ĐỘNG ================= */
boot();

