// === app-exec-dashboard.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
async function viewExec() {
  el('topActions').innerHTML = `<button class="btn" data-act="doPrint">${IC.printer} In / Lưu PDF</button>`;
  el('content').innerHTML = '<div class="spinner"></div>';
  const year = curMonth().slice(0, 4);
  const [rev, revPrev] = await Promise.all([API.revenue(year), API.revenue(String(+year - 1)).catch(() => [])]); // BL-21: lỗi -> reject -> adminGo bắt -> renderViewError
  const sum = (arr, k) => arr.reduce((a, m) => a + (+m[k] || 0), 0);
  const totalYear = sum(rev, 'total'), paidYear = sum(rev, 'paid'), prevYear = sum(revPrev, 'total');
  const collection = totalYear ? Math.round(paidYear / totalYear * 100) : 0;
  // Chỉ so cùng kỳ khi năm trước có dữ liệu đủ ý nghĩa (>=5% năm nay), tránh % ảo
  const yoy = (prevYear > totalYear * 0.05) ? Math.round((totalYear - prevYear) / prevYear * 100) : null;
  const occ = ST.students.filter(isOccupying).length;
  const capacity = rentCapOf(ST.rooms);               // giường thuộc quỹ cho thuê (ghép + nguyên phòng)
  const availBeds = availBedsOf(ST.rooms);            // giường trống: chỉ phòng ghép còn slot
  const usedBeds = Math.max(0, capacity - availBeds); // giường ĐANG có người trong quỹ cho thuê (khớp với %)
  const occRate = capacity ? Math.round(usedBeds / capacity * 100) : 0;
  // QUÁ TẢI: phòng ghép có số người > công suất (HV vào ở chờ bạn cùng phòng xuất cảnh) — cấp trên cần thấy
  const overRooms = ST.rooms.filter(r => roomIsShared(r) && r.capacity > 0 && r.occupancy > r.capacity);
  const overPeople = overRooms.reduce((a, r) => a + (r.occupancy - r.capacity), 0);
  const outstanding = totalYear - paidYear;
  const dep = ST.students.filter(s => s.check_out_date && DEPARTURE_REASONS.includes(s.checkout_reason) && String(s.check_out_date).slice(0, 4) === year).length;
  const svcs = [
    ['Tiền phòng', sum(rev, 'room'), 'var(--brand)'], ['Điện', sum(rev, 'electric'), '#5f7ea3'],
    ['Nước', sum(rev, 'water'), '#4f8f63'], ['Dịch vụ', sum(rev, 'service'), '#b5822f'],
    ['Máy giặt', sum(rev, 'washing'), '#9a7bb0'], ['Gửi xe', sum(rev, 'parking'), '#c25545'], ['Khác', sum(rev, 'other'), '#8a8172'],
  ].filter(x => x[1] > 0);
  const svcTotal = svcs.reduce((a, s) => a + s[1], 0) || 1;
  // BL-49: dựng đủ 12 khe tháng (Th1…Th12) của năm để cột nằm trong ngữ cảnh trục, không lơ lửng giữa vùng trắng.
  const revByMonth = new Map(rev.map(m => [m.month, +m.total || 0]));
  const chartRows = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { month, label: 'Th' + (i + 1), total: revByMonth.get(month) || 0 };
  });
  const female = ST.students.filter(s => isOccupying(s) && s.gender === 'female').length;
  const male = occ - female;
  // --- Vận hành & tuân thủ (điểm 3): máy giặt · hợp đồng · hư hỏng · vi phạm ---
  const occStu = ST.students.filter(isOccupying);
  const needC = occStu.filter(contractRequired);              // ghép dài hạn (>=2 tháng) → BẮT BUỘC ký HĐ
  const cSigned = needC.filter(contractSigned).length;
  const cUnsigned = needC.length - cSigned;                   // cần ký mà chưa ký
  const cPct = needC.length ? Math.round(cSigned / needC.length * 100) : 0;
  const cSignedF = needC.filter(s => s.gender === 'female' && contractSigned(s)).length;
  const cSignedM = needC.filter(s => s.gender === 'male' && contractSigned(s)).length;
  const handoverNeed = occStu.filter(handoverRequired).length;   // cần ký phiếu đăng ký & bàn giao (nhân viên / ngắn hạn <60 ngày)
  const handoverPend = occStu.filter(handoverPending).length;    // trong đó chưa ký phiếu
  const resiReg = occStu.filter(s => s.residency_status === 'registered').length;
  const resiUnreg = occStu.length - resiReg;
  const resiOverdueE = occStu.filter(s => s.residency_status === 'unregistered' && stayDays(s) > overdueDays()).length;
  const resiPct = occStu.length ? Math.round(resiReg / occStu.length * 100) : 0;
  const dmg = (ST.damage || []).filter(d => (d.category || 'damage') === 'damage');
  const dmgDone = dmg.filter(d => d.status === 'done').length;
  const dmgBlocked = dmg.filter(d => d.status === 'blocked').length;
  const dmgOpen = Math.max(0, dmg.length - dmgDone - dmgBlocked);
  const dmgPct = dmg.length ? Math.round(dmgDone / dmg.length * 100) : 0;
  const vio = ST.vstats || {};
  const vioTotal = vio.total || 0, vioNeedMail = vio.needMail || 0;
  const sevMap = { minor: 'Nhẹ', major: 'Nặng', severe: 'Nghiêm trọng' };
  const vioSev = (vio.bySeverity || []).map(x => `${sevMap[x.severity] || x.severity}: ${x.c}`).join(' · ');
  const es = (ico, cls, title, main, sub, bar, act) => `<div class="es${act ? ' clickable' : ''}" ${act ? act + ' role="button" tabindex="0"' : ''}><div class="es-h"><span class="es-ic ${cls}">${ico}</span>${title}</div><div class="es-v">${main}</div>${bar != null ? `<div class="es-bar"><div style="width:${bar}%"></div></div>` : ''}<div class="es-sub">${sub}</div></div>`;
  const kpi = (ic, cls, val, label, sub, act) => `<div class="kpi${act ? ' clickable' : ''}" ${act ? act + ' role="button" tabindex="0"' : ''}><span class="ic ${cls}">${ic}</span><div><div class="v">${val}</div><div class="l">${label}${sub ? ` · ${sub}` : ''}</div></div></div>`;

  el('content').innerHTML = `<div id="printArea">
    <div class="print-only" style="margin-bottom:14px"><h2 style="font-family:var(--serif);margin:0">${esc(ST.settings.dorm_name || 'Ký túc xá')} — Báo cáo điều hành ${year}</h2><div class="muted">Xuất ngày ${fmtDate(today())}</div></div>
    <div class="kpis">
      ${kpi(IC.userCheck, 'ic-green', occRate + '%', 'Tỉ lệ lấp đầy', `${usedBeds}/${capacity} giường${overPeople ? ` · <strong style="color:var(--red-ink)">${IC.alert} quá tải ${overPeople} người (${overRooms.length} phòng)</strong>` : ''}`, actAttr('adminGo', 'rooms'))}
      ${kpi(IC.trendingUp, 'ic-brand', money(totalYear), 'Dự báo doanh thu ' + year, yoy != null ? (yoy >= 0 ? '▲' : '▼') + Math.abs(yoy) + '% vs ' + (+year - 1) : '', actAttr('adminGo', 'revenue'))}
      ${kpi(IC.users, 'ic-blue', occ, 'Học viên đang ở', '', actAttr('stuGoAdmin', 'in'))}
      ${kpi(IC.planeTakeoff, 'ic-gray', dep, 'Xuất cảnh năm ' + year, '', actAttr('stuGoAdmin', 'departure'))}
    </div>
    <div class="panel"><div class="hd"><h2>${IC.trendingUp} Dự báo doanh thu theo tháng — ${year}</h2><span class="muted" style="font-size:12px">Ước tính từ phiếu báo đã lập (thu thật do Bravo quản lý)</span></div>
    <div class="pad">${chartRows.some(r => r.total) ? svgBars(chartRows) : '<div class="empty">Chưa có phiếu báo năm này.</div>'}</div></div>
    <div class="grid2" style="align-items:start">
      <div class="panel" style="margin:0"><div class="hd"><h2>${IC.pie} Cơ cấu doanh thu dự báo</h2></div><div class="pad" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        ${svcs.length ? svgDonut(svcs.map(s => ({ label: s[0], value: s[1], color: s[2] }))) : '<div class="empty">Chưa có dữ liệu.</div>'}
        <div style="flex:1;min-width:170px">${svcs.map(s => `<div class="flex" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span class="flex" style="gap:8px"><span style="width:11px;height:11px;border-radius:3px;background:${s[2]};display:inline-block"></span>${s[0]}</span><strong>${Math.round(s[1] / svcTotal * 100)}%</strong></div>`).join('')}</div>
      </div></div>
      <div class="panel" style="margin:0"><div class="hd"><h2>${IC.users} Cơ cấu học viên đang ở</h2></div><div class="pad">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><div class="muted" style="font-size:12.5px">Nữ · ${legalEntity('female')}</div><div style="font-size:22px;font-weight:800">${female}</div></div>
          <div><div class="muted" style="font-size:12.5px">Nam · ${legalEntity('male')}</div><div style="font-size:22px;font-weight:800">${male}</div></div>
          <div><div class="muted" style="font-size:12.5px">Giường trống</div><div style="font-size:22px;font-weight:800">${availBeds}</div></div>
        </div>
      </div></div>
    </div>
    <!-- BL-64: bỏ khối "Vận hành & Tuân thủ" — trùng y hệt "Cần xử lý" ở Tổng quan (4 mảng, cùng số, cùng modal).
         Điều hành nay = chiến lược (lấp đầy/doanh thu/donut/cơ cấu HV); việc cần xử lý xem ở Tổng quan. -->
  </div>`;
}

/* ---------- TỔNG QUAN ---------- */
// Popup "Đăng ký tạm trú": 3 trạng thái, bấm từng trạng thái xem danh sách
function residencyModal() {
  const occ = ST.students.filter(isOccupying);
  const over = occ.filter(s => s.residency_status === 'unregistered' && stayDays(s) > overdueDays()).length;
  const proc = occ.filter(s => s.residency_status === 'processing').length;
  const reg = occ.filter(s => s.residency_status === 'registered').length;
  const row = (ico, label, n, filter, cls) => `<div class="todo ${n ? cls : 'calm'}" ${n ? actAttr('stuGoAdmin', filter) : ''}><span class="ic">${ico}</span><span class="tx">${label}</span><span class="n">${n}</span></div>`;
  openModal(`
    <div class="mh"><h3>${IC.flag} Đăng ký tạm trú</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="hint">${IC.info} Tình trạng đăng ký tạm trú của học viên đang ở. Bấm từng nhóm để xem danh sách.</div>
      <div class="todo-grid" style="grid-template-columns:1fr;margin-top:10px">
        ${row(IC.alert, `Chưa đăng ký (đã ở >${overdueDays()} ngày)`, over, 'resi_overdue', 'bad')}
        ${row(IC.hourglass, 'Đang xử lý', proc, 'resi_processing', 'warn')}
        ${row(IC.checkCircle, 'Đã có tạm trú', reg, 'resi_registered', 'on')}
      </div>
    </div>
    <div class="mf"><button class="btn pri" data-act="tamTruSheet">${IC.printer} Danh sách gửi công an</button><button class="btn" data-act="closeModal">Đóng</button></div>`);
}

// Tự gom CCCD 2 mặt của HV đang ở CHƯA đăng ký tạm trú -> danh sách in gửi công an.
// Ảnh lấy trực tiếp qua proxy /api/students/:id/cccd/... (cookie phiên admin tự gửi -> ảnh hiện khi in).
function tamTruSheet() {
  closeModal();
  const S = ST.settings || {};
  const occ = ST.students.filter(isOccupying);
  const targets = occ.filter(s => s.residency_status === 'unregistered')
    .sort((a, b) => String(a.room_name || '').localeCompare(String(b.room_name || ''), 'vi') || String(a.name).localeCompare(String(b.name), 'vi'));
  const ready = targets.filter(s => s.has_cccd_front && s.has_cccd_back);   // đủ 2 mặt -> đưa vào bản in
  const missing = targets.filter(s => !(s.has_cccd_front && s.has_cccd_back)); // thiếu ảnh -> cảnh báo, chưa in
  const missSide = s => [!s.has_cccd_front ? 'mặt trước' : null, !s.has_cccd_back ? 'mặt sau' : null].filter(Boolean).join(' + ') || 'chưa có ảnh';

  el('topActions').innerHTML = ready.length
    ? `<button class="btn pri" data-act="doPrint">${IC.printer} In / Lưu PDF (${ready.length})</button>`
    : '';

  const block = (s, i) => `
    <div class="tt-block">
      <div class="tt-head"><span class="tt-no">${i + 1}</span>
        <span class="tt-name">${esc(s.name)}</span>
        <span class="tt-meta">Ngày sinh: ${fmtDate(s.birth_date) || '—'} · CCCD: ${esc(s.id_card || '—')} · Phòng: ${esc(s.room_name || '—')} · Vào ở: ${fmtDate(s.check_in_date) || '—'}</span>
      </div>
      <div class="tt-imgs">
        <figure><img src="/api/students/${s.id}/cccd/front" alt="" loading="lazy"><figcaption>Mặt trước</figcaption></figure>
        <figure><img src="/api/students/${s.id}/cccd/back" alt="" loading="lazy"><figcaption>Mặt sau</figcaption></figure>
      </div>
    </div>`;

  el('content').innerHTML = `
  <style>
    #printArea .tt-doc{max-width:210mm;margin:0 auto}
    .tt-title{text-align:center;margin-bottom:16px}
    .tt-title .org{font-size:13px;color:#555}
    .tt-title h2{font-family:var(--serif,serif);margin:6px 0 0;font-size:20px;letter-spacing:.3px}
    .tt-title .sub{color:#555;font-size:13px;margin-top:4px}
    .tt-title .addr{color:#555;font-size:12.5px;margin-top:4px}
    .tt-block{border:1px solid #d8cdbd;border-radius:8px;padding:10px 12px;margin-bottom:12px;break-inside:avoid;page-break-inside:avoid}
    .tt-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
    .tt-no{background:var(--brand,#1b5e3b);color:#fff;border-radius:50%;width:22px;height:22px;min-width:22px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
    .tt-name{font-weight:800;font-size:15px}
    .tt-meta{color:#555;font-size:12.5px}
    .tt-imgs{display:flex;gap:10px}
    .tt-imgs figure{flex:1;margin:0}
    .tt-imgs img{width:100%;aspect-ratio:85.6/54;object-fit:contain;background:#fff;border:1px solid #ddd;border-radius:6px;display:block}
    .tt-imgs figcaption{text-align:center;font-size:11px;color:#999;margin-top:3px}
    @media print{ @page{size:A4;margin:12mm} .tt-block{border-color:#999} }
  </style>
  ${missing.length ? `<div class="rc-noprint" style="background:#fff6f2;border:1px solid #e9c9c0;border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <strong style="color:var(--red-ink,#b4432b)">${IC.alert} ${missing.length} học viên chưa đủ ảnh CCCD — CHƯA đưa vào bản in:</strong>
      <ul style="margin:8px 0 0 18px;font-size:13px;line-height:1.7">${missing.map(s => `<li>${esc(s.name)} — ${esc(s.room_name || '—')} <span style="color:var(--red-ink,#b4432b)">(thiếu ${missSide(s)})</span> · <a href="#" data-act="studentForm" data-args='[${s.id}]'>bổ sung ảnh</a></li>`).join('')}</ul>
    </div>` : ''}
  <div id="printArea"><div class="tt-doc">
    <div class="tt-title">
      <div class="org">${esc(S.dorm_name || 'Ký túc xá')}${S.hotline ? ' · ĐT: ' + esc(S.hotline) : ''}</div>
      <h2>DANH SÁCH ĐỀ NGHỊ ĐĂNG KÝ TẠM TRÚ</h2>
      <div class="addr">Địa chỉ chỗ ở: ...................................................................................</div>
      <div class="sub">Tổng ${ready.length} học viên · Xuất ngày ${fmtDate(today())}</div>
    </div>
    ${ready.length ? ready.map(block).join('') : '<div class="empty" style="padding:36px;text-align:center;color:#888">Không có học viên nào đang chờ đăng ký tạm trú (có đủ ảnh CCCD 2 mặt).</div>'}
  </div></div>`;
}
// Popup gộp "Hợp đồng chưa hoàn thiện": 3 loại cần xử lý, bấm từng loại xem danh sách
function contractIssuesModal() {
  const occ = ST.students.filter(isOccupying);
  const ghepNC = occ.filter(s => contractPending(s) && studentRoomKind(s) === 'shared').length;
  const phongNC = occ.filter(s => contractPending(s) && studentRoomKind(s) === 'whole').length;
  const ho = occ.filter(handoverPending).length;
  const row = (ico, label, n, filter, cls) => `<div class="todo ${n ? cls : 'calm'}" ${n ? actAttr('stuGoAdmin', filter) : ''}><span class="ic">${ico}</span><span class="tx">${label}</span><span class="n">${n}</span></div>`;
  openModal(`
    <div class="mh"><h3>${IC.fileText} Hợp đồng chưa hoàn thiện</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="hint">${IC.info} Các nhóm cần hoàn thiện hợp đồng / bàn giao. Bấm từng nhóm để xem danh sách học viên.</div>
      <div class="todo-grid" style="grid-template-columns:1fr;margin-top:10px">
        ${row(IC.fileText, 'Thuê ghép chưa ký HĐ', ghepNC, 'nocontract_ghep', 'warn')}
        ${row(IC.fileText, 'Thuê nguyên phòng chưa ký HĐ', phongNC, 'nocontract_phong', 'warn')}
        ${row(IC.fileText, 'Chưa ký phiếu đăng ký & bàn giao', ho, 'handover_pending', 'warn')}
      </div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`);
}
// Popup "Tiền cọc": gộp hoàn cọc + chưa đóng cọc
function depositModal() {
  const refund = ST.students.filter(s => liveStatus(s) === 'left' && s.deposit_status === 'held').length;
  const noDep = ST.students.filter(s => isOccupying(s) && s.deposit_status === 'none').length;
  const row = (ico, label, n, act, cls) => `<div class="todo ${n ? cls : 'calm'}" ${n ? `data-close ${act}` : ''}><span class="ic">${ico}</span><span class="tx">${label}</span><span class="n">${n}</span></div>`;
  openModal(`
    <div class="mh"><h3>${IC.handCoins} Tiền cọc</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="hint">${IC.info} Các việc liên quan tiền cọc. Bấm từng mục để xem danh sách.</div>
      <div class="todo-grid" style="grid-template-columns:1fr;margin-top:10px">
        ${row(IC.handCoins, 'Hoàn cọc (đã trả phòng)', refund, actAttr('quyCoc'), 'bad')}
        ${row(IC.lock, 'Chưa đóng cọc', noDep, actAttr('stuGoAdmin', 'nodeposit'), 'warn')}
      </div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`);
}
async function viewDashboard() {
  el('content').innerHTML = '<div class="spinner"></div>';
  const occ = ST.students.filter(isOccupying);
  const inCount = occ.length;
  const checkinToday = ST.students.filter(s => s.check_in_date && s.check_in_date.slice(0, 10) === today()).length;   // nhận phòng hôm nay
  const checkoutToday = ST.students.filter(s => s.check_out_date && s.check_out_date.slice(0, 10) === today()).length; // trả phòng hôm nay
  const capacity = rentCapOf(ST.rooms);           // tổng giường thuộc quỹ cho thuê (ghép + nguyên phòng)
  const beds = availBedsOf(ST.rooms);             // giường trống: CHỈ phòng cho thuê ghép còn slot
  const resiOverdue = occ.filter(s => s.residency_status === 'unregistered' && stayDays(s) > overdueDays()).length; // chưa ĐK tạm trú, đã ở >7 ngày
  // Gộp 3 loại "hợp đồng chưa hoàn thiện" (đếm không trùng): cần ký chưa ký + ngắn hạn chưa ký bàn giao
  const contractIncomplete = occ.filter(s => contractPending(s) || handoverPending(s)).length;
  const depExpected = occ.filter(willDepartSoon).length; // dự kiến xuất cảnh (điều phối phòng)
  const totalVehicles = occ.reduce((a, s) => a + (+s.vehicle_count || 0), 0);
  const refundPending = ST.students.filter(s => liveStatus(s) === 'left' && s.deposit_status === 'held').length;
  const needMail = (ST.vstats && ST.vstats.needMail) || 0;
  const logs = ST.logs, apps = ST.applications, damage = ST.damage, couts = ST.couts;
  let invAll = [];
  // BL-12: chỉ lấy hoá đơn THÁNG NÀY (dashboard chỉ dùng 2 con số của tháng hiện tại) thay vì kéo
  // mọi hoá đơn từ trước tới nay. Server đã hỗ trợ lọc theo tháng sẵn.
  try { invAll = await API.invoices(curMonth()); } catch {}
  const pApps = apps.filter(a => a.status === 'pending').length;
  // CHỈ đếm hư hỏng phòng (category='damage') — ô "Bảo trì" bấm vào mở trang repair (chỉ hiện damage).
  // Trước đây đếm gộp cả feedback/vi phạm (category violation/other) -> số > số dòng thực (khớp updateNavBadges).
  const pDmg = damage.filter(d => (d.category || 'damage') === 'damage' && d.status !== 'done').length;
  const pCout = couts.filter(c => c.status === 'pending').length;
  // App CHỈ lập phiếu báo tiền phòng — KHÔNG quản lý doanh thu/công nợ (đã có Bravo)
  const billedThisMonth = invAll.filter(i => i.month === curMonth()).reduce((a, i) => a + (+i.total || 0), 0);
  const billStudents = new Set(invAll.filter(i => i.month === curMonth()).map(i => i.student_id));
  const noBill = occ.filter(s => !billStudents.has(s.id)).length; // HV đang ở chưa lập phiếu tháng này

  // act = onclick đầy đủ → mọi ô KPI đều drill-through tới đúng danh sách đằng sau con số
  const kpi = (cls, ico, val, label, act) => `<div class="kpi${act ? ' clickable' : ''}" ${act ? act + ' role="button" tabindex="0"' : ''}><span class="ic ${cls}">${ico}</span><div><div class="v">${val}</div><div class="l">${label}</div></div></div>`;
  // act = biểu thức onclick đầy đủ (đặt đúng bộ lọc / tab rồi mới điều hướng) → bấm vào đúng danh sách cần xử lý
  const todo = (ico, tx, n, act, cls) => `<div class="todo ${n ? cls : 'calm'}" ${act && n ? act + ' role="button" tabindex="0"' : ''}><span class="ic">${ico}</span><span class="tx">${tx}</span><span class="n">${n}</span></div>`;

  // noc = không cần ký HĐ (ngắn hạn ký phiếu bàn giao, thuê nguyên phòng, phòng an ninh/nhân viên)
  // -> Đã ký + Chưa ký + Không cần HĐ = Tổng (bảng cộng ra đúng)
  const zone = g => { const arr = occ.filter(s => s.gender === g); const need = arr.filter(contractRequired); const sg = need.filter(contractSigned).length; const un = need.length - sg; return { sg, un, noc: arr.length - sg - un, wash: arr.filter(s => s.uses_washing).length, veh: arr.reduce((a, s) => a + (+s.vehicle_count || 0), 0), total: arr.length }; };
  const zE = zone('female'), zS = zone('male');
  const zRow = (name, z, tot) => `<tr ${tot ? 'style="background:#faf6f2"' : ''}><td><strong>${name}</strong></td><td class="num">${z.sg}</td><td class="num">${z.un}</td><td class="num muted">${z.noc}</td><td class="num">${z.wash}</td><td class="num">${z.veh}</td><td class="num"><strong>${z.total}</strong></td></tr>`;

  el('content').innerHTML = `
    <div class="kpis">
      ${kpi('ic-green', IC.userCheck, inCount, 'Học viên đang ở', actAttr('stuGoAdmin', 'in'))}
      ${kpi('ic-blue', IC.bed, `${beds}<span class="muted" style="font-size:15px;font-weight:600"> / ${capacity}</span>`, 'Giường còn trống', actAttr('adminGo', 'rooms'))}
      ${kpi('ic-brand', IC.receipt, money(billedThisMonth), 'Phiếu báo tháng này', actAttr('adminGo', 'invoices'))}
      ${kpi('ic-amber', IC.filePen, noBill, 'HV chưa lập phiếu tháng này', actAttr('adminGo', 'invoices'))}
    </div>

    <div class="panel"><div class="hd"><h2>${IC.zap} Cần xử lý</h2></div><div class="pad">
      <div class="todo-grid">
        ${todo(IC.filePen, 'Thuê phòng / trả phòng', pApps + pCout, pApps ? actAttr('adminGo', 'reg') : actAttr('adminGo', 'checkout'), 'on')}
        ${todo(IC.wrench, 'Bảo trì', pDmg, actAttr('adminGo', 'repair'), 'warn')}
        ${todo(IC.flag, 'Đăng ký Tạm Trú', resiOverdue, actAttr('residencyModal'), 'warn')}
        ${todo(IC.fileText, 'Hợp đồng', contractIncomplete, actAttr('contractIssuesModal'), 'warn')}
        ${todo(IC.handCoins, 'Tiền cọc', refundPending + occ.filter(s => s.deposit_status === 'none').length, actAttr('depositModal'), 'warn')}
        ${todo(IC.planeTakeoff, 'Dự kiến xuất cảnh (điều phối phòng)', depExpected, actAttr('stuGoAdmin', 'departure_expected'), 'on')}
        ${todo(IC.alert, 'Quản lý vi phạm', needMail, actAttr('adminGo', 'violations'), 'bad')}
      </div>
    </div></div>

    <div class="grid2" style="align-items:start">
      <div class="panel" style="margin:0"><div class="hd"><h2>${IC.dashboard} Tình hình hôm nay</h2></div><div class="pad">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div style="cursor:pointer" role="button" tabindex="0" data-act="stuGoAdmin" data-args='["checkin_today"]'><div class="muted" style="font-size:12.5px"><span class="dot-svg dot-green">${IC.dot}</span> Nhận phòng hôm nay ›</div><div style="font-size:22px;font-weight:800">${checkinToday}</div></div>
          <div style="cursor:pointer" role="button" tabindex="0" data-act="stuGoAdmin" data-args='["checkout_today"]'><div class="muted" style="font-size:12.5px"><span class="dot-svg dot-gray">${IC.dot}</span> Trả phòng hôm nay ›</div><div style="font-size:22px;font-weight:800">${checkoutToday}</div></div>
        </div>
      </div></div>

      <div class="panel" style="margin:0"><div class="hd"><h2>${IC.fileText} Hợp đồng (${legalEntity('female')} · ${legalEntity('male')})</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Pháp nhân</th><th class="num">Đã ký</th><th class="num">Chưa ký</th><th class="num" title="Ngắn hạn ký phiếu bàn giao, thuê nguyên phòng, phòng an ninh/nhân viên">Không cần HĐ</th><th class="num">${IC.washer} Máy giặt</th><th class="num">${IC.bike} Xe</th><th class="num">Tổng</th></tr></thead><tbody>
          ${zRow(legalEntity('female') + ' · Nữ', zE)}
          ${zRow(legalEntity('male') + ' · Nam', zS)}
          ${zRow('Tổng cộng', { sg: zE.sg + zS.sg, un: zE.un + zS.un, noc: zE.noc + zS.noc, wash: zE.wash + zS.wash, veh: zE.veh + zS.veh, total: zE.total + zS.total }, true)}
        </tbody></table></div>
      </div>
    </div>

    <div class="panel"><div class="hd"><h2>${IC.history} Hoạt động gần đây</h2><button class="btn sm" data-act="adminGo" data-args='["checkin"]'>Xem tất cả</button></div>
      <div class="table-wrap">${logsTable(logs.filter(l => String(l.date).slice(0, 10) <= today()).slice(0, 6))}</div></div>`;
}
function logsTable(logs) {
  if (!logs.length) return `<div class="empty">Chưa có hoạt động nào.</div>`;
  return `<table><thead><tr><th>Ngày</th><th>Học viên</th><th>Hoạt động</th><th>Phòng</th><th>Nguồn</th><th>Ghi chú</th></tr></thead><tbody>
    ${logs.map(l => `<tr><td>${fmtDate(l.date)}${String(l.date).slice(0, 10) > today() ? ' <span class="badge blue" style="font-size:10px">sắp tới</span>' : ''}</td><td>${esc(l.student_name)}</td>
      <td>${l.type === 'in' ? '<span class="badge green">Check-in</span>' : '<span class="badge red">Check-out</span>'}</td>
      <td>${esc(l.room_name || '—')}</td>
      <td>${l.source === 'self' ? '<span class="badge blue">Học viên</span>' : '<span class="badge gray">Quản lý</span>'}</td>
      <td class="muted">${esc(l.note || '')}</td></tr>`).join('')}
  </tbody></table>`;
}

/* ---------- PHÒNG ---------- */
let roomSearch = '', roomShowDeleted = false;
