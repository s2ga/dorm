// === app-portals-boot.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
/* ================================================================= */
/* ==============          CỔNG HỌC VIÊN            ================= */
/* ================================================================= */
async function renderStudent() {
  el('app').innerHTML = `
    <div class="app"><div class="main" style="margin:0 auto;max-width:760px;width:100%">
      <div class="top">
        <div><h1>${IC.home} Phòng của tôi</h1><div class="sub">Xin chào, ${esc(Auth.user.full_name || Auth.user.username)}</div></div>
        <div class="toolbar">${dungMatKhau() ? `<button class="btn sm" data-act="changePwd">${IC.key} Đổi mật khẩu</button>` : ''}<button class="btn sm" data-act="logout">${IC.logOut} Đăng xuất</button></div>
      </div>
      <div class="content" id="content"><div class="spinner"></div></div>
    </div></div>`;
  startTableResize();
  loadStudentPortal();
}
// BL-16: cổng HV — bấm hàng phiếu báo để xem TÁCH các khoản (nước/dịch vụ/giặt/xe/khác + ghi chú
// "other_note"), số kWh và số ngày ở. Dữ liệu đã có sẵn trong /me/invoices (SELECT *); bảng ngoài chỉ
// gộp lại nên HV thấy cục "Khác" không giải thích được. _myInvs được lưu khi vẽ danh sách.
function myInvoiceDetail(id) {
  const i = (window._myInvs || []).find(x => x.id === id);
  if (!i) return;
  const line = (label, val, sub) => `<tr><td>${label}${sub ? ` <span class="muted" style="font-size:12px">${sub}</span>` : ''}</td><td class="num">${money(+val || 0)}</td></tr>`;
  const opt = (label, val, sub) => (+val) ? line(label, val, sub) : '';
  const leaderD = +i.leader_discount || 0, roomD = +i.room_discount || 0;
  openModal(`
    <div class="mh"><h3>${IC.receipt} Chi tiết phiếu ${monthLabel(i.month)}</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <p class="muted" style="margin:0 0 12px">Số ngày ở trong kỳ: <strong>${i.days_stayed || 0}</strong> ngày</p>
      <div class="table-wrap"><table><tbody>
        ${line('Tiền phòng', i.room_charge)}
        ${line('Tiền điện', i.electric_charge, `${i.electric_kwh || 0} kWh`)}
        ${opt('Tiền nước', i.water_charge)}
        ${opt('Phí dịch vụ', i.service_charge)}
        ${opt('Máy giặt', i.washing_charge)}
        ${opt('Gửi xe', i.parking_charge)}
        ${opt('Khoản khác', i.other_charge, i.other_note ? esc(i.other_note) : '')}
        ${leaderD ? `<tr><td>Giảm phòng trưởng</td><td class="num" style="color:var(--green)">−${money(leaderD)}</td></tr>` : ''}
        ${roomD ? `<tr><td>Giảm tiền phòng</td><td class="num" style="color:var(--green)">−${money(roomD)}</td></tr>` : ''}
        <tr style="border-top:2px solid var(--line)"><td><strong>Tổng cộng</strong></td><td class="num"><strong>${money(i.total)}</strong></td></tr>
      </tbody></table></div>
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">${IC.creditCard} Đóng tiền qua mã QR quản lý gửi trên Zalo.</p>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`);
}
async function loadStudentPortal() {
  let profile, invs, damage, coutReqs, myVios = [], mates = [], assets = [], chores = [], myLogs = [];
  try { [profile, invs, damage, coutReqs, myVios, mates, assets, chores, myLogs] = await Promise.all([API.meProfile(), API.meInvoices(), API.meDamage(), API.meCheckoutReq(), API.meViolations().catch(() => []), API.meRoommates().catch(() => []), API.meAssets().catch(() => []), API.meChores().catch(() => []), API.meLogs().catch(() => [])]); }
  catch (e) { el('content').innerHTML = `<div class="hint">${IC.alert} ${esc(e.message)}</div>`; return; }
  window._myInvs = invs; // BL-16: để myInvoiceDetail() tra cứu chi tiết khi bấm hàng
  const billNow = invs.filter(i => i.month === curMonth()).reduce((a, i) => a + (+i.total || 0), 0);
  const depTxt = { held: 'Đang giữ', refunded: 'Đã hoàn', forfeited: 'Không hoàn', none: '—' }[profile.deposit_status] || '—';
  const pendingCout = coutReqs.find(c => c.status === 'pending');
  const notMovedIn = profile.check_in_date && String(profile.check_in_date).slice(0, 10) > today();
  el('content').innerHTML = `
    ${notMovedIn ? `<div class="hint">${IC.hourglass} Bạn sẽ nhận phòng vào <strong>${fmtDate(profile.check_in_date)}</strong> — vui lòng đến đúng hẹn để bàn giao phòng. Hiện chưa thể gửi đơn trả phòng.</div>` : ''}
    <div class="cards">
      <div class="stat"><div class="l">${IC.doorOpen} Phòng của tôi</div><div class="v sm">${esc(profile.room_name || 'Chưa xếp')}</div></div>
      <div class="stat"><div class="l">${IC.receipt} Phiếu tháng này</div><div class="v sm">${money(billNow)}</div></div>
      <div class="stat"><div class="l">${IC.lock} Cọc</div><div class="v sm">${depTxt}</div></div>
    </div>
    <div class="panel"><div class="hd"><h2>${IC.user} Thông tin của tôi</h2></div><div class="pad">
      <p><strong>Họ tên:</strong> ${esc(profile.name)} · <span class="badge ${profile.gender === 'female' ? 'sage' : 'blue'}">${genderLabel(profile.gender)}</span></p>
      <p><strong>Mã HV:</strong> ${esc(profile.code || '—')} &nbsp;•&nbsp; <strong>Lớp:</strong> ${esc(profile.class_name || '—')} &nbsp;•&nbsp; <strong>SĐT:</strong> ${esc(profile.phone || '—')}</p>
      <p><strong>Ngày vào:</strong> ${fmtDate(profile.check_in_date)} ${profile.check_out_date ? `&nbsp;•&nbsp; <strong>Ngày trả:</strong> ${fmtDate(profile.check_out_date)}` : ''}</p>
    </div></div>

    <div class="panel"><div class="hd"><h2>${IC.users} Thành viên cùng phòng${profile.room_name ? ` (${mates.length})` : ''}</h2></div><div class="pad">
      ${!profile.room_name ? '<p class="muted" style="margin:0">Bạn chưa được xếp phòng.</p>'
        : mates.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${mates.map(m =>
            `<span class="badge ${m.is_leader ? 'amber' : 'blue'}" style="font-size:13px;padding:6px 12px">${m.is_leader ? IC.star : IC.user} ${esc(m.name)}${m.is_leader ? ' — Phòng trưởng' : ''}</span>`).join('')}</div>`
        : '<p class="muted" style="margin:0">Hiện bạn ở một mình trong phòng.</p>'}
      ${profile.room_name ? leaderNote(profile, mates) : ''}
    </div></div>

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

    ${myVios.length ? `<div class="panel"><div class="hd"><h2>${IC.alert} Nhắc nhở / Vi phạm (${myVios.length})</h2></div><div class="table-wrap card-tbl">
      <table><thead><tr><th>Ngày</th><th>Nội dung</th><th>Mức độ</th><th class="num">Lần</th></tr></thead><tbody>
        ${myVios.map(v => `<tr><td>${fmtDate(v.date)}</td><td data-label="Nội dung"><strong>${esc(v.type_name)}</strong>${v.note ? `<div class="muted" style="font-size:12px">${esc(v.note)}</div>` : ''}</td><td data-label="Mức độ">${vioSevBadge(v.severity)}</td><td class="num" data-label="Lần">${v.level}</td></tr>`).join('')}
      </tbody></table>
      <div class="pad muted" style="font-size:12.5px">${IC.info} Vui lòng tuân thủ nội quy ký túc xá. Vi phạm nhiều lần sẽ được thông báo về nhà trường.</div>
    </div></div>` : ''}

    <div class="panel"><div class="hd"><h2>${IC.receipt} Phiếu báo tiền phòng</h2></div><div class="table-wrap card-tbl">
      ${invs.length ? `<table><thead><tr><th>Kỳ</th><th class="num">Tiền phòng</th><th class="num">Điện</th><th class="num">Khác</th><th class="num">Giảm</th><th class="num">Tổng</th></tr></thead><tbody>
        ${invs.map(i => {
          // Cột "Giảm" phải hiện, nếu không thì 4 cột đầu cộng lại KHÔNG ra Tổng — học viên tưởng app tính sai
          const giam = (+i.leader_discount || 0) + (+i.room_discount || 0);
          return `<tr style="cursor:pointer" data-act="myInvoiceDetail" data-args='[${i.id}]' title="Bấm để xem chi tiết khoản thu"><td>${monthLabel(i.month)}</td><td class="num" data-label="Tiền phòng">${money(i.room_charge)}</td><td class="num" data-label="Điện">${money(i.electric_charge)}</td>
          <td class="num" data-label="Khác">${money((+i.water_charge) + (+i.service_charge) + (+i.washing_charge) + (+i.parking_charge) + (+i.other_charge || 0))}</td>
          <td class="num" data-label="Giảm">${giam ? `<span class="badge green">−${money(giam)}</span>` : '—'}</td>
          <td class="num" data-label="Tổng"><strong>${money(i.total)}</strong></td></tr>`;
        }).join('')}
      </tbody></table>` : '<div class="empty">Chưa có phiếu báo.</div>'}
      <div class="pad muted" style="font-size:12.5px">${IC.info} Bấm vào từng kỳ để xem chi tiết khoản thu. &nbsp;·&nbsp; ${IC.creditCard} Đóng tiền qua mã QR quản lý gửi trên Zalo theo hạn hằng tháng.</div>
    </div></div>

    <div class="panel"><div class="hd"><h2>${IC.handCoins} Hỗ trợ học viên</h2><button class="btn sm pri" data-act="damageForm">${IC.plus} Gửi yêu cầu hỗ trợ</button></div><div class="table-wrap">
      ${damage.length ? `<table><thead><tr><th>Ngày</th><th>Loại</th><th>Nội dung</th><th>Trạng thái</th></tr></thead><tbody>
        ${damage.map(d => `<tr><td>${fmtDate(String(d.created_at).slice(0, 10))}</td><td data-label="Loại">${supCatBadge(d.category)}</td><td data-label="Nội dung"><strong>${esc(d.title)}</strong>${d.description ? `<div class="muted" style="font-size:12px">${esc(d.description)}</div>` : ''}</td><td data-label="Trạng thái">${d.status === 'done' ? '<span class="badge green">Đã xử lý</span>' : d.status === 'blocked' ? '<span class="badge red">Chưa xử lý được — liên hệ quản lý</span>' : d.status === 'processing' ? '<span class="badge blue">Đang xử lý</span>' : '<span class="badge amber">Mới</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Chưa có yêu cầu nào.</div>'}
    </div></div>

    <div class="panel"><div class="hd"><h2>${IC.logOut} Đăng ký trả phòng</h2>${!pendingCout && profile.status === 'in' && !notMovedIn ? '<button class="btn sm danger" data-act="checkoutReqForm">Xin trả phòng</button>' : ''}</div><div class="pad">
      ${pendingCout ? `<div class="hint">${IC.hourglass} Bạn đã gửi đơn trả phòng ngày <strong>${fmtDate(pendingCout.desired_date)}</strong> — đang chờ quản lý duyệt.</div>` :
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
    <div class="mh"><h3>${tieuDe}</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
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
    <div class="mh"><h3>${IC.logOut} Đăng ký trả phòng</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
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
/* Dòng chú thích phòng trưởng ở trang "Phòng của tôi".
   Chính chủ là phòng trưởng thì KHÔNG nằm trong danh sách bạn cùng phòng -> phải báo riêng,
   không thì họ mở trang lên thấy phòng mình "chưa có phòng trưởng". */
function leaderNote(profile, mates) {
  if (profile.is_leader) {
    return `<div class="hint" style="margin:14px 0 0">${IC.star}<span><strong>Bạn là phòng trưởng</strong> của phòng này —
      giúp Ban quản lý theo dõi tình hình trong phòng. Bạn được <strong>miễn tiền nước và phí dịch vụ</strong> hằng tháng
      (vẫn hiện trên phiếu báo, kèm dòng "Giảm phòng trưởng").</span></div>`;
  }
  if (mates.some(m => m.is_leader)) return '';  // huy hiệu trên danh sách đã nói rõ rồi
  return `<div class="hint" style="margin:14px 0 0">${IC.info}<span>Phòng chưa có phòng trưởng. Ban quản lý sẽ cử một bạn trong phòng.</span></div>`;
}

/* Lịch trực nhật — xoay vòng theo tuần, app tự tính (không ai phải nhập).
   Tô đậm tuần HIỆN TẠI và đánh dấu rõ khi đến lượt chính mình — đó là thứ duy nhất
   người ta mở trang này để xem. */
function myChoresPanel(chores, profile) {
  if (!profile.room_name) return '';
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dm = s => { const d = new Date(s); return `${DOW[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
  return `<div class="panel"><div class="hd"><h2>${IC.calendar} Lịch trực nhật</h2></div><div class="pad">
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
  return `<div class="panel"><div class="hd"><h2>${IC.clipboard} Nội quy ký túc xá</h2></div><div class="pad">
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

async function toggleMyWashing(on) {
  if (!confirm(on ? 'Đăng ký dùng máy giặt? Phí sẽ tính vào phiếu báo từ kỳ sau.' : 'Hủy đăng ký máy giặt? Phí máy giặt sẽ không còn tính từ kỳ sau.')) return;
  await guard(() => API.meWashing(on));
  toast(on ? 'Đã đăng ký máy giặt' : 'Đã hủy máy giặt'); loadStudentPortal();
}

/* ================================================================= */
/* ==============          CỔNG BẢO TRÌ             ================= */
/* ================================================================= */
async function renderMaintenance() {
  el('app').innerHTML = `
    <div class="app"><div class="main" style="margin:0 auto;max-width:940px;width:100%">
      <div class="top">
        <div><h1>${IC.wrench} Bảo trì ký túc xá</h1><div class="sub">Xin chào, ${esc(Auth.user.full_name || Auth.user.username)}</div></div>
        <div class="toolbar"><button class="btn sm" data-act="loadMaintenance">${IC.refresh} Tải lại</button>${dungMatKhau() ? `<button class="btn sm" data-act="changePwd">${IC.key} Đổi mật khẩu</button>` : ''}<button class="btn sm" data-act="logout">${IC.logOut} Đăng xuất</button></div>
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
    if (!Auth.user || Auth.user.role !== 'maintenance') { clearInterval(_maintTimer); _maintTimer = null; return; }
    if (document.hidden) return;
    if (el('overlay') && el('overlay').classList.contains('show')) return;  // đang mở form -> đừng đụng
    loadMaintenance();
  }, 60000);
}
async function loadMaintenance() {
  let tasks = [];
  try { tasks = await API.maintenanceTasks(); }
  catch (e) { el('content').innerHTML = `<div class="hint">${IC.alert} ${esc(e.message)}</div>`; return; }
  const pending = tasks.filter(t => t.status !== 'done');
  const done = tasks.filter(t => t.status === 'done');
  el('content').innerHTML = `
    <div class="cards">
      <div class="stat"><div class="l">${IC.bell} Bảo trì cần xử lý</div><div class="v sm" style="color:${pending.length ? 'var(--red)' : 'var(--green)'}">${pending.length}</div></div>
      <div class="stat"><div class="l">${IC.checkCircle} Đã hoàn thành</div><div class="v sm">${done.length}</div></div>
    </div>
    <div id="handoverArea"><div class="spinner"></div></div>
    ${pending.length ? `<div class="hint" style="border-color:var(--amber-ink)">${IC.bell} Bạn có <strong>${pending.length}</strong> công việc bảo trì cần xử lý.</div>` : ''}
    <div class="panel"><div class="hd"><h2>${IC.wrench} Công việc cần xử lý</h2></div><div class="table-wrap card-tbl">
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
    ${done.length ? `<div class="panel"><div class="hd"><h2>${IC.history} Đã hoàn thành (${done.length})</h2></div><div class="table-wrap">
      <table><thead><tr><th>Xong lúc</th><th>Phòng</th><th>Nội dung</th><th>Ghi chú bảo trì</th></tr></thead><tbody>
        ${done.map(t => `<tr><td>${fmtDate(String(t.resolved_at || t.assigned_at).slice(0, 10))}</td><td>${esc(t.room_name || '—')}</td><td>${esc(t.title)}</td><td class="muted">${esc(t.admin_note || '—')}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`;
  loadHandovers();
}
/* ---- Bàn giao phòng (bảo trì xác nhận nhận/trả phòng thực tế) ---- */
let hoMonth = '';
async function loadHandovers(month) {
  if (month) hoMonth = month;
  const area = el('handoverArea'); if (!area) return;
  let d;
  try { d = await API.handovers(hoMonth); }
  catch (e) { area.innerHTML = `<div class="hint">${IC.alert} ${esc(e.message)}</div>`; return; }
  hoMonth = d.month;
  const pIn = d.checkins.filter(x => !x.checkin_confirmed_at).length;
  const pOut = d.checkouts.filter(x => !x.checkout_confirmed_at).length;
  const esq = s => esc(String(s || '')).replace(/'/g, '&#39;');
  const monthsList = [];
  for (let i = -1; i <= 12; i++) { const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i); monthsList.push(dt.toISOString().slice(0, 7)); }
  const monthOpts = monthsList.map(m => `<option value="${m}" ${m === hoMonth ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
  const inRow = x => `<tr>
    <td data-label="Học viên"><strong>${esc(x.name)}</strong></td><td data-label="Phòng">${esc(x.room_name || '—')}</td><td data-label="Ngày">${fmtDate(x.date)}</td>
    <td class="num">${x.checkin_confirmed_at
      ? `<span class="badge green">${IC.check} Đã nhận phòng</span>${x.checkin_confirm_note ? `<div class="muted" style="font-size:11px;white-space:normal">${esc(x.checkin_confirm_note)}</div>` : ''}`
      : `<button class="btn sm green" data-act="handoverCheckinRow" data-args='[${x.id}]' data-hname="${esc(x.name)}">${IC.check} Đã nhận phòng</button>`}</td></tr>`;
  const outRow = x => `<tr>
    <td data-label="Học viên"><strong>${esc(x.name)}</strong></td><td data-label="Phòng">${esc(x.room_name || '—')}</td><td data-label="Ngày ĐK">${fmtDate(x.date)}</td>
    <td class="num">${x.checkout_confirmed_at
      ? `<span class="badge green">${IC.check} Đã trả ${fmtDate(x.checkout_actual_date)}</span>${x.checkout_confirm_note ? `<div class="muted" style="font-size:11px;white-space:normal">${esc(x.checkout_confirm_note)}</div>` : ''}`
      : `<button class="btn sm green" data-act="handoverCheckoutRow" data-args='[${x.id}]' data-hname="${esc(x.name)}" data-plandate="${esc(x.date || '')}">${IC.check} Đã trả phòng</button>`}</td></tr>`;
  area.innerHTML = `
    <div class="panel"><div class="hd"><h2>${IC.key} Bàn giao phòng</h2>
      <select data-change="onHandoverMonth" style="font-weight:600;padding:6px 8px;border-radius:8px">${monthOpts}</select></div>
      <div class="pad"><div class="hint">${IC.info} <strong>${monthLabel(hoMonth)}</strong>: ${d.checkins.length} nhận phòng (<strong>${pIn}</strong> chưa xác nhận) · ${d.checkouts.length} trả phòng (<strong>${pOut}</strong> chưa xác nhận). Xác nhận thực tế + kiểm tra tài sản, thu chìa khóa.</div></div>
      <div class="grid2" style="align-items:start;padding:0 16px 16px;gap:16px">
        <div><h4 style="margin:0 0 8px"><span class="dot-svg dot-green">${IC.dot}</span> Nhận phòng (${d.checkins.length})</h4>
          <div class="table-wrap card-tbl">${d.checkins.length ? `<table><thead><tr><th>Học viên</th><th>Phòng</th><th>Ngày</th><th></th></tr></thead><tbody>${d.checkins.map(inRow).join('')}</tbody></table>` : '<div class="empty">Không có ai nhận phòng tháng này.</div>'}</div></div>
        <div><h4 style="margin:0 0 8px"><span class="dot-svg dot-gray">${IC.dot}</span> Trả phòng (${d.checkouts.length})</h4>
          <div class="table-wrap card-tbl">${d.checkouts.length ? `<table><thead><tr><th>Học viên</th><th>Phòng</th><th>Ngày ĐK</th><th></th></tr></thead><tbody>${d.checkouts.map(outRow).join('')}</tbody></table>` : '<div class="empty">Không có ai trả phòng tháng này.</div>'}</div></div>
      </div>
    </div>`;
}
function handoverCheckinForm(id, name) {
  openModal(`
    <div class="mh"><h3>${IC.check} Xác nhận đã nhận phòng</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
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
    <div class="mh"><h3>${IC.check} Xác nhận đã trả phòng</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
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
  await guard(() => API.confirmHandoverCheckout(id, d, el('ho_note').value.trim()));
  closeModal(); toast('Đã xác nhận trả phòng'); loadHandovers();
}
async function maintDo(id, status) { await guard(() => API.maintenanceTaskStatus(id, status)); toast('Đã cập nhật'); loadMaintenance(); }
function maintDoneForm(id) {
  openModal(`
    <div class="mh"><h3>${IC.check} Hoàn thành công việc</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb"><div class="field"><label>Ghi chú bảo trì (đã làm gì)</label><textarea id="mt_note" rows="3" placeholder="VD: Đã thay vòi nước mới, kiểm tra lại..."></textarea></div></div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="submitMaintDone" data-args='[${id}]'>Xác nhận đã xong</button></div>`);
}
async function submitMaintDone(id) {
  await guard(() => API.maintenanceTaskStatus(id, 'done', el('mt_note').value.trim()));
  closeModal(); toast('Đã hoàn thành công việc'); loadMaintenance();
}
function maintBlockForm(id) {
  openModal(`
    <div class="mh"><h3>${IC.alert} Chưa xử lý được</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
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
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      // Ngày ngoài khoảng cho phép: hiện mờ, KHÔNG bấm được (thà chặn còn hơn cho chọn rồi vứt đi)
      const cam = (max && ds > max) || (min && ds < min);
      cells += `<span class="cal-d${ds === sel ? ' sel' : ''}${cam ? ' cam' : ''}" ${cam ? '' : `data-d="${ds}"`}>${d}</span>`;
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
    cal.querySelector('[data-nav="-1"]').onclick = () => { view = new Date(y, m - 1, 1); render(); };
    cal.querySelector('[data-nav="1"]').onclick = () => { view = new Date(y, m + 1, 1); render(); };
    cal.querySelector('.cal-m').onchange = e => { view = new Date(y, +e.target.value, 1); render(); };
    cal.querySelector('.cal-y').onchange = e => { view = new Date(+e.target.value, m, 1); render(); };
    cal.querySelector('[data-today]').onclick = () => { const t = new Date(); pick(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`); };
    cal.querySelector('[data-clear]').onclick = () => pick('');
  };
  document.body.appendChild(cal);
  render();   // BL-27: dựng nội dung TRƯỚC để đo chiều cao thật (cần cho việc lật-lên)
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
    h.className = 'rz-handle'; h.title = 'Kéo để chỉnh độ rộng cột · nhấp đúp để reset';
    h.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      _rzFreeze(table); // chỉ đóng băng khi bắt đầu kéo
      const startX = e.pageX, startW = th.getBoundingClientRect().width;
      document.body.classList.add('rz-active');
      const move = ev => { th.style.width = Math.max(56, startW + (ev.pageX - startX)) + 'px'; };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('rz-active'); _rzSave(table);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
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
  'doApprove', 'doTransfer', 'doCheckOut', 'doCheckIn', 'doSetLeader', 'unsetLeader',
  'doChangePwd', 'doResetUserPw', 'delStudent', 'runGenerate',
  'settleDepositAndClose', 'submitCheckoutReq', 'submitDamage', 'submitHandoverCheckin',
  'submitHandoverCheckout', 'submitMaintBlock', 'submitMaintDone', 'toggleWashing',
  'toggleMyWashing', 'uploadRulesDoc', 'removeRulesDoc', 'luuChotGiuaKy', 'xoaChotGiuaKy',
].forEach(ten => {
  if (typeof window[ten] === 'function') window[ten] = chongBam2Lan(window[ten]);
  else console.warn('[chống bấm 2 lần] không thấy hàm:', ten); // đổi tên hàm mà quên sửa đây -> báo ngay
});

/* ================= KHỞI ĐỘNG ================= */
boot();

