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
  const T = tongChiSo(ST.rooms);                      // một nguồn số duy nhất — xem chiSoPhong
  const capacity = T.cap;
  const availBeds = T.thucCon;   // "còn trống" hiển thị = đã trừ chỗ đặt trước (owner chốt 21/08)
  const usedBeds = T.cap - T.trong;
  const occRate = capacity ? Math.round(usedBeds / capacity * 100) : 0;
  const overPeople = T.vuot, overRoomCount = T.soPhongVuot;
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
      ${kpi(IC.userCheck, 'ic-green', occRate + '%', 'Tỉ lệ lấp đầy', `${usedBeds}/${capacity} giường${overPeople ? ` · <strong style="color:var(--red-ink)">${IC.alert} quá tải ${overPeople} người (${overRoomCount} phòng)</strong>` : ''}`, actAttr('adminGo', 'rooms'))}
      ${kpi(IC.trendingUp, 'ic-brand', money(totalYear), 'Dự báo doanh thu ' + year, yoy != null ? (yoy >= 0 ? '▲' : '▼') + Math.abs(yoy) + '% vs ' + (+year - 1) : '', actAttr('adminGo', 'revenue'))}
      ${kpi(IC.users, 'ic-blue', occ, 'Học viên đang ở', '', actAttr('stuGoAdmin', 'in'))}
      ${kpi(IC.planeTakeoff, 'ic-gray', dep, 'Đã xuất cảnh (năm ' + year + ')', '', actAttr('stuGoAdmin', 'departure'))}
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
// BL-112: ai CẦN phiếu kỳ này — người đang ở, CỘNG người đã trả phòng trong kỳ (họ vẫn ở một phần
// tháng nên vẫn phải thu, và đây là ca dễ mất tiền nhất vì đợt lập phiếu bỏ qua họ). Người sắp vào thì chưa.
const canPhieuKyNay = s => !s.deleted_at && (isOccupying(s)
  || (liveStatus(s) === 'left' && (s.check_out_date || '').slice(0, 7) === curMonth()));
const dsQuaHanPhieu = daCoPhieu => ST.students
  .filter(s => canPhieuKyNay(s) && !daCoPhieu.has(s.id) && stayDays(s) > overdueDays())
  .sort((a, b) => stayDays(b) - stayDays(a));

async function billOverdueModal() {
  openModal(`<div class="mh"><h3>${IC.receipt} Chưa lập phiếu thu</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb"><div class="spinner"></div></div>`, true);
  let inv = [];
  try { inv = await API.invoices(curMonth()); }
  catch (e) {
    return modalThay(`<div class="mh"><h3>${IC.receipt} Chưa lập phiếu thu</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
      <div class="mb"><div class="bang-tin">${IC.alert} <span>Không tải được danh sách phiếu: ${esc(e.message || 'lỗi kết nối')}</span></div></div>
      <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`);
  }
  const ds = dsQuaHanPhieu(new Set(inv.map(i => i.student_id)));
  const daRoi = s => liveStatus(s) === 'left';
  modalThay(`
    <div class="mh"><h3>${IC.receipt} Chưa lập phiếu thu kỳ ${curMonth()} (${ds.length})</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="hint">${IC.info} Đã ở quá ${overdueDays()} ngày mà kỳ này chưa có phiếu. Gồm cả người
        <strong>đã trả phòng trong kỳ</strong> — đợt lập phiếu hàng tháng bỏ qua họ nên dễ đi rồi mới nhớ chưa thu.</div>
      ${ds.length ? `<div class="table-wrap card-tbl" style="margin-top:10px"><table>
        <thead><tr><th>Học viên</th><th>Phòng</th><th>Ngày vào</th><th class="num">Đã ở</th><th>Tình trạng</th></tr></thead>
        <tbody>${ds.map(s => `<tr>
          <td><div class="flex stu-name" data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Mở hồ sơ">
            <div><strong>${esc(s.name)}</strong>${s.code ? `<div class="sub2">${esc(s.code)}</div>` : ''}</div>
            <span class="row-chev">${IC.chevronRight}</span></div></td>
          <td data-label="Phòng">${esc(s.room_name || '—')}</td>
          <td data-label="Ngày vào">${fmtDate(s.check_in_date)}</td>
          <td class="num" data-label="Đã ở">${stayDays(s)} ngày</td>
          <td data-label="Tình trạng">${daRoi(s)
    ? `<span class="badge red">Đã trả ${fmtDate(s.check_out_date)}</span>`
    : statusBadge(s)}</td>
        </tr>`).join('')}</tbody></table></div>`
    : `<div class="empty" style="margin-top:10px">${IC.checkCircle} Không sót ai — mọi người cần thu kỳ này đều đã có phiếu.</div>`}
    </div>
    <div class="mf">${ds.length ? `<button class="btn pri" data-act="adminGo" data-args='["invoices"]'>${IC.receipt} Sang màn Tiền phòng để lập</button>` : ''}
      <button class="btn" data-act="closeModal">Đóng</button></div>`);
}

function residencyModal() {
  const occ = ST.students.filter(isOccupying);
  const over = occ.filter(s => s.residency_status === 'unregistered' && stayDays(s) > overdueDays()).length;
  const proc = occ.filter(s => s.residency_status === 'processing').length;
  const reg = occ.filter(s => s.residency_status === 'registered').length;
  const row = (ico, label, n, filter, cls) => `<div class="todo ${n ? cls : 'calm'}" ${n ? actAttr('stuGoAdmin', filter) : ''}><span class="ic">${ico}</span><span class="tx">${label}</span><span class="n">${n}</span></div>`;
  openModal(`
    <div class="mh"><h3>${IC.flag} Đăng ký tạm trú</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="hint">${IC.info} Tình trạng đăng ký tạm trú của học viên đang ở. Bấm từng nhóm để xem danh sách.</div>
      <div class="todo-grid" style="grid-template-columns:1fr;margin-top:10px">
        ${row(IC.alert, `Chưa đăng ký (đã ở >${overdueDays()} ngày)`, over, 'resi_overdue', 'bad')}
        ${row(IC.hourglass, 'Đang xử lý', proc, 'resi_processing', 'warn')}
        ${row(IC.checkCircle, 'Đã có tạm trú', reg, 'resi_registered', 'on')}
      </div>
    </div>
    <div class="mf"><button class="btn pri" data-act="tamTruMo">${IC.printer} Danh sách gửi công an</button><button class="btn" data-act="closeModal">Đóng</button></div>`);
}

// Tự gom CCCD 2 mặt của HV đang ở CHƯA đăng ký tạm trú, lọc theo THÁNG VÀO Ở -> trang ảnh in gửi công an.
// Ảnh lấy qua proxy /api/students/:id/cccd/... (cookie phiên admin tự gửi -> ảnh hiện khi in).
// Bản in theo mẫu hồ sơ tạm trú: CHỈ lưới ảnh thẻ, mỗi hàng 2 người (trước–sau · trước–sau), viền đứt.
let _tamTruThang = null;   // null = chưa chọn -> tháng gần nhất có người; '' = tất cả tháng
function tamTruMo() { _tamTruThang = null; tamTruSheet(); }
function tamTruChonThang() { _tamTruThang = this.value; tamTruSheet(); }
function tamTruSheet() {
  closeModal();
  const all = ST.students.filter(s => isOccupying(s) && s.residency_status === 'unregistered')
    .sort((a, b) => String(a.room_name || '').localeCompare(String(b.room_name || ''), 'vi') || String(a.name).localeCompare(String(b.name), 'vi'));
  const thangCua = s => String(s.check_in_date || '').slice(0, 7);
  const thangs = [...new Set(all.map(thangCua).filter(Boolean))].sort().reverse();
  if (_tamTruThang === null) _tamTruThang = thangs.find(m => m <= curMonth()) || '';
  const targets = _tamTruThang ? all.filter(s => thangCua(s) === _tamTruThang) : all;
  const ready = targets.filter(s => s.has_cccd_front && s.has_cccd_back);     // đủ 2 mặt -> đưa vào bản in
  const missing = targets.filter(s => !(s.has_cccd_front && s.has_cccd_back)); // thiếu ảnh -> chưa in
  const missSide = s => [!s.has_cccd_front ? 'mặt trước' : null, !s.has_cccd_back ? 'mặt sau' : null].filter(Boolean).join(' + ') || 'chưa có ảnh';
  const nhanThang = m => m ? `${m.slice(5)}/${m.slice(0, 4)}` : 'Tất cả tháng';
  const demThang = m => (m ? all.filter(s => thangCua(s) === m) : all).length;

  _tamTruDot = ready;
  el('topActions').innerHTML = ready.length
    ? `<button class="btn pri" data-act="tamTruIn">${IC.printer} In & chuyển sang Đang xử lý (${ready.length})</button>`
    : '';

  const oTen = s => `<td><div class="flex stu-name" data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Mở hồ sơ">
        <div><strong>${esc(s.name)}</strong>${s.code ? `<div class="sub2">${esc(s.code)}</div>` : ''}</div><span class="row-chev">${IC.chevronRight}</span></div></td>
      <td data-label="Phòng">${esc(s.room_name || '—')}</td>
      <td data-label="Ngày vào" style="white-space:nowrap">${fmtDate(s.check_in_date) || '—'}</td>`;
  const hang = (s, i) => `<tr><td class="num" data-label="STT">${i + 1}</td>${oTen(s)}<td data-label="Ảnh CCCD"><span class="badge green">Đủ 2 mặt</span></td></tr>`;
  const hangThieu = s => `<tr><td class="num" data-label="STT">—</td>${oTen(s)}<td data-label="Ảnh CCCD"><span class="badge red">Thiếu ${missSide(s)}</span>
        <button class="btn sm" style="margin-left:6px;white-space:nowrap" data-act="studentForm" data-args='[${s.id}]'>${IC.filePen} Bổ sung ảnh</button></td></tr>`;
  const bang = rows => `<div class="table-wrap card-tbl"><table><thead><tr><th class="num">STT</th><th>Học viên</th><th>Phòng</th><th>Ngày vào</th><th>Ảnh CCCD</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const cell = (s, side, nhan) => `<div class="tt-cell"><img src="/api/students/${s.id}/cccd/${side}" alt="${nhan}">
        <button class="tt-xoay rc-noprint" type="button" data-act="tamTruXoay" data-args='[${s.id},"${side}"]' title="Xoay ảnh 90° và lưu vào hồ sơ">${IC.refresh}<span class="tt-doc-nhan">ảnh dọc</span></button></div>`;
  const pair = s => `<div class="tt-pair">${cell(s, 'front', 'CCCD mặt trước')}${cell(s, 'back', 'CCCD mặt sau')}</div>`;

  el('content').innerHTML = `
  <style>
    .tt-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .tt-bar select{padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);font:inherit}
    .tt-bar .tt-note{margin-left:auto;font-size:12.5px}
    #printArea .tt-doc{max-width:210mm;margin:0 auto}
    .tt-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
    .tt-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;break-inside:avoid;page-break-inside:avoid}
    .tt-cell{position:relative;border:1.5px dashed #8fae91;padding:4px;background:#fff}
    .tt-cell img{width:100%;aspect-ratio:85.6/54;object-fit:contain;display:block}
    .tt-xoay{position:absolute;top:8px;right:8px;display:none;align-items:center;gap:5px;padding:4px 8px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--ink);font:inherit;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}
    .tt-xoay .ic-svg{width:14px;height:14px}
    .tt-cell:hover .tt-xoay,.tt-cell.tt-doc .tt-xoay{display:inline-flex}
    .tt-doc-nhan{display:none;color:var(--amber-ink,#b5822f);font-weight:700}
    .tt-cell.tt-doc{border-color:var(--amber-ink,#b5822f)}
    .tt-cell.tt-doc .tt-doc-nhan{display:inline}
    @media print{ @page{size:A4;margin:10mm} .tt-cell,.tt-cell.tt-doc{border-color:#8fae91} }
  </style>
  <div class="rc-noprint">
    <div class="panel"><div class="hd"><h2>${IC.flag} Ảnh CCCD gửi công an đăng ký tạm trú</h2><span class="muted" style="font-size:12px">Học viên đang ở, chưa đăng ký tạm trú · xếp theo phòng rồi theo tên</span></div>
      <div class="pad tt-bar">
        <label class="flex" style="gap:8px;font-size:13.5px">${IC.calendar} Tháng vào ở
          <select id="ttThang" data-change="tamTruChonThang">${['', ...thangs].map(m => `<option value="${m}"${m === _tamTruThang ? ' selected' : ''}>${nhanThang(m)} (${demThang(m)})</option>`).join('')}</select></label>
        <span class="badge green">${ready.length} đủ ảnh — sẽ in</span>
        <span class="badge ${missing.length ? 'red' : 'gray'}">${missing.length} thiếu ảnh</span>
        <span class="muted tt-note">Bản in chỉ có ảnh theo mẫu tạm trú · ảnh dọc bấm ${IC.refresh} trên ảnh để xoay ngang</span>
      </div></div>
    ${ready.length ? `<div class="panel"><div class="hd"><h2>Trong bản in (${ready.length})</h2><span class="muted" style="font-size:12px">STT = thứ tự ảnh trên giấy</span></div>${bang(ready.map(hang).join(''))}</div>` : ''}
    ${missing.length ? `<details class="panel"><summary style="cursor:pointer;padding:14px 18px;font-weight:700;color:var(--red-ink,#b4432b)">${IC.alert} ${missing.length} học viên thiếu ảnh CCCD — chưa đưa vào bản in</summary>${bang(missing.map(hangThieu).join(''))}</details>` : ''}
  </div>
  <div id="printArea"><div class="tt-doc">
    ${ready.length ? `<div class="tt-grid">${ready.map(pair).join('')}</div>` : `<div class="empty" style="padding:36px;text-align:center;color:#888">${all.length ? `Tháng ${nhanThang(_tamTruThang)} không có ai đủ ảnh CCCD 2 mặt để in — chọn tháng khác hoặc "Tất cả tháng".` : 'Không có học viên nào đang chờ đăng ký tạm trú.'}</div>`}
  </div></div>`;
  tamTruDanhDauDoc();
}
// Ảnh cao hơn rộng = chụp dọc -> viền cam + nút xoay hiện sẵn (bản in chỉ nhận thẻ nằm ngang).
function tamTruDanhDauDoc() {
  document.querySelectorAll('#printArea .tt-cell img').forEach(img => {
    const danhDau = () => img.parentElement.classList.toggle('tt-doc', img.naturalHeight > img.naturalWidth);
    img.addEventListener('load', danhDau);
    if (img.complete && img.naturalWidth) danhDau();
  });
}
// Xoay 90° theo chiều kim đồng hồ rồi lưu đè vào hồ sơ (PUT nhận data URL y như form Học viên).
async function tamTruXoay(id, side) {
  const nut = this, img = nut.parentElement.querySelector('img');
  nut.disabled = true;
  try {
    const bm = await createImageBitmap(await (await fetch(`/api/students/${id}/cccd/${side}`)).blob());
    const cv = document.createElement('canvas'); cv.width = bm.height; cv.height = bm.width;
    const cx = cv.getContext('2d'); cx.translate(cv.width, 0); cx.rotate(Math.PI / 2); cx.drawImage(bm, 0, 0);
    await API.updateStudent(id, { ['cccd_' + side]: cv.toDataURL('image/jpeg', 0.92) });
    img.src = `/api/students/${id}/cccd/${side}?t=${Date.now()}`;
    toast('Đã xoay và lưu ảnh vào hồ sơ');
  } catch (e) { toast('Xoay ảnh thất bại: ' + (e.message || 'lỗi kết nối'), 'err'); }
  nut.disabled = false;
}

// Đợt đang hiện trên trang in (để nút In biết chuyển ai). Bấm In = hồ sơ đã xuất đi công an -> cả đợt
// sang "Đang xử lý" ngay, khỏi phải nhớ vào từng hồ sơ; "Đã đăng ký" nhập tay khi công an trả kết quả.
let _tamTruDot = [];
function tamTruIn() {
  window.print();
  return tamTruChuyenXuLy();
}
// PUT hồ sơ gộp với bản hiện có ở máy chủ nên chỉ cần gửi đúng ô tạm trú. Hỏng bạn nào thì báo tên
// và cho bấm thử lại — không in lại, không chuyển lần hai ai đã xong.
async function tamTruChuyenXuLy() {
  const ds = _tamTruDot.filter(s => s.residency_status === 'unregistered');
  if (!ds.length) return;
  el('topActions').innerHTML = `<button class="btn" disabled>${IC.hourglass} Đang chuyển ${ds.length} bạn sang Đang xử lý…</button>`;
  const kq = await Promise.allSettled(ds.map(s => API.updateStudent(s.id, { residency_status: 'processing' })));
  const loi = [];
  kq.forEach((r, i) => {
    if (r.status === 'fulfilled') ds[i].residency_status = 'processing';
    else loi.push(`${ds[i].name} (${(r.reason && r.reason.message) || 'lỗi kết nối'})`);
  });
  const xong = ds.length - loi.length;
  if (xong) {
    el('content').insertAdjacentHTML('afterbegin', `<div class="rc-noprint" style="background:#f1f8f2;border:1px solid #bfd9c4;border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <strong style="color:var(--brand,#1b5e3b)">${IC.checkCircle} Đã chuyển ${xong} bạn sang "Đang xử lý".</strong>
      <div style="font-size:13px;margin-top:4px">Khi công an trả kết quả tạm trú, mở hồ sơ từng bạn đổi ô Tạm trú sang <strong>Đã đăng ký</strong>.</div></div>`);
    try { await napLai('students'); } catch (e) { /* trạng thái đã ghi ở máy chủ; số đếm Tổng quan sẽ đúng ở lần nạp sau */ }
  }
  if (loi.length) {
    toast(`Chưa chuyển được ${loi.length} bạn: ${loi.join(', ')}`, 'err');
    el('topActions').innerHTML = `<button class="btn pri" data-act="tamTruChuyenXuLy">${IC.refresh} Thử lại chuyển ${loi.length} bạn còn lại</button> <button class="btn" data-act="doPrint">${IC.printer} In lại</button>`;
  } else {
    toast(`Đã chuyển ${xong} bạn sang Đang xử lý`);
    el('topActions').innerHTML = `<button class="btn" data-act="doPrint">${IC.printer} In lại</button>`;
  }
}
// Popup gộp "Hợp đồng chưa hoàn thiện": 3 loại cần xử lý, bấm từng loại xem danh sách
function contractIssuesModal() {
  const occ = ST.students.filter(isOccupying);
  const ghepNC = occ.filter(s => contractPending(s) && studentRoomKind(s) === 'shared').length;
  const phongNC = occ.filter(s => contractPending(s) && studentRoomKind(s) === 'whole').length;
  const ho = occ.filter(handoverPending).length;
  const row = (ico, label, n, filter, cls) => `<div class="todo ${n ? cls : 'calm'}" ${n ? actAttr('stuGoAdmin', filter) : ''}><span class="ic">${ico}</span><span class="tx">${label}</span><span class="n">${n}</span></div>`;
  openModal(`
    <div class="mh"><h3>${IC.fileText} Hợp đồng chưa hoàn thiện</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
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
    <div class="mh"><h3>${IC.handCoins} Tiền cọc</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
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
  // "Hôm nay" = việc PHẢI LÀM hôm nay -> tính theo lịch dự kiến (BL-117), người đã xác nhận rồi không đếm nữa
  const checkinToday = ST.students.filter(s => !s.check_in_date && s.planned_check_in && String(s.planned_check_in).slice(0, 10) === today()).length;
  const checkoutToday = ST.students.filter(s => s.check_in_date && !s.check_out_date && s.planned_check_out && String(s.planned_check_out).slice(0, 10) === today()).length;
  const T = tongChiSo(ST.rooms);                  // một nguồn số duy nhất — xem chiSoPhong
  const capacity = T.cap, beds = T.trong;
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
  // Mốc tháng trước làm ngữ cảnh cho ô "Phiếu báo tháng này" (đầu tháng billing chưa chạy xong nên
  // KHÔNG hiện % tăng/giảm — dễ báo động giả; chỉ nêu con số tháng trước để đối chiếu).
  const [_cy, _cmm] = curMonth().split('-').map(Number);
  const prevMonth = _cmm === 1 ? `${_cy - 1}-12` : `${_cy}-${String(_cmm - 1).padStart(2, '0')}`;
  const billedLastMonth = invAll.filter(i => i.month === prevMonth).reduce((a, i) => a + (+i.total || 0), 0);
  const billStudents = new Set(invAll.filter(i => i.month === curMonth()).map(i => i.student_id));
  const noBill = occ.filter(s => !billStudents.has(s.id)).length; // HV đang ở chưa lập phiếu tháng này
  // BL-112: quá hạn lập phiếu. Gác bằng overdueDays() vì mùng 1 thì CẢ KTX chưa có phiếu — không gác
  // thì ô nhắc thành báo động giả rồi bị phớt. Đây cũng là phần "chưa lập phiếu" mà nhãn ô cài đặt
  // "Nhắc khi ở quá N ngày" vốn đã hứa nhưng chưa nối.
  const billOverdue = dsQuaHanPhieu(billStudents).length;

  // act = onclick đầy đủ → mọi ô KPI đều drill-through tới đúng danh sách đằng sau con số
  const kpi = (cls, ico, val, label, act, sub) => `<div class="kpi${act ? ' clickable' : ''}" ${act ? act + ' role="button" tabindex="0"' : ''}><span class="ic ${cls}">${ico}</span><div><div class="v">${val}</div><div class="l">${label}${sub ? ` · ${sub}` : ''}</div></div></div>`;
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
      ${kpi('ic-blue', IC.bed, `${T.thucCon}<span class="muted" style="font-size:15px;font-weight:600"> / ${capacity}</span>`, `Giường còn trống${T.datCho ? ` · đã trừ ${T.datCho} chỗ đặt trước` : ''}`, actAttr('roomGo', 'trong'))}
      ${kpi('ic-brand', IC.receipt, money(billedThisMonth), 'Phiếu báo tháng này', actAttr('adminGo', 'invoices'), billedLastMonth ? 'Tháng trước ' + money(billedLastMonth) : '')}
    </div>

    <div class="panel"><div class="hd"><h2>${IC.zap} Cần xử lý</h2></div><div class="pad">
      <div class="todo-grid">
        ${/* Nhận phòng và Trả phòng TÁCH RIÊNG (owner 26/08): đây sẽ là hai nơi BQL vào xác nhận vào/ra
              thực tế (BL-117). Tiền cọc + Dự kiến xuất cảnh bỏ khỏi Tổng quan theo yêu cầu cùng ngày. */''}
        ${todo(IC.key, 'Nhận phòng', pApps + ST.students.filter(choXacNhanVao).length, actAttr('nhanPhongGo'), 'on')}
        ${todo(IC.logOut, 'Trả phòng', pCout + ST.students.filter(choXacNhanRa).length, actAttr('traPhongGo'), 'on')}
        ${todo(IC.wrench, 'Bảo trì', pDmg, actAttr('baoTriGo'), 'warn')}
        ${todo(IC.flag, 'Đăng ký Tạm Trú', resiOverdue, actAttr('residencyModal'), 'warn')}
        ${todo(IC.fileText, 'Hợp đồng', contractIncomplete, actAttr('contractIssuesModal'), 'warn')}
        ${todo(IC.receipt, 'Lập phiếu thu', billOverdue, actAttr('billOverdueModal'), 'bad')}
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
    ${logs.map(l => `<tr><td>${fmtDate(l.date)}${String(l.date).slice(0, 10) > today() ? ' <span class="badge blue" style="font-size:10px">sắp tới</span>' : ''}</td><td><a href="#" data-act="studentDetail" data-args='[${l.student_id}]'>${esc(l.student_name)}</a></td>
      <td>${l.type === 'in' ? '<span class="badge green">Check-in</span>' : '<span class="badge red">Check-out</span>'}</td>
      <td>${l.room_id ? `<a href="#" data-act="roomDetail" data-args='[${l.room_id}]'>${esc(l.room_name || '—')}</a>` : esc(l.room_name || '—')}</td>
      <td>${l.source === 'self' ? '<span class="badge blue">Học viên</span>' : '<span class="badge gray">Quản lý</span>'}</td>
      <td class="muted">${esc(l.note || '')}</td></tr>`).join('')}
  </tbody></table>`;
}

/* ---------- PHÒNG ---------- */
let roomSearch = '', roomShowDeleted = false;
