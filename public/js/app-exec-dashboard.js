// === app-exec-dashboard.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
async function viewExec() {
  el('topActions').innerHTML = `<button class="btn" data-act="doPrint">${IC.printer} In / Lưu PDF</button>`;
  el('content').innerHTML = '<div class="spinner"></div>';
  const year = curMonth().slice(0, 4);
  const [rev, revPrev] = await Promise.all([API.revenue(year), API.revenue(String(+year - 1)).catch(() => [])]); // BL-21: lỗi -> reject -> adminGo bắt -> renderViewError
  const sum = (arr, k) => arr.reduce((a, m) => a + (+m[k] || 0), 0);
  // Cọc là tiền GIỮ HỘ, không phải doanh thu — trừ ra y như màn Doanh thu, nếu không hai màn lệch nhau.
  const truCoc = arr => sum(arr, 'total') - sum(arr, 'deposit');
  const totalYear = truCoc(rev), paidYear = sum(rev, 'paid'), prevYear = truCoc(revPrev);
  const collection = totalYear ? Math.round(paidYear / totalYear * 100) : 0;
  // Chỉ so cùng kỳ khi năm trước có dữ liệu đủ ý nghĩa (>=5% năm nay), tránh % ảo
  const yoy = (prevYear > totalYear * 0.05) ? Math.round((totalYear - prevYear) / prevYear * 100) : null;
  const occ = ST.students.filter(dangOTinhGiuong).length;  // cùng tập người với sổ giường bên dưới
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
  const revByMonth = new Map(rev.map(m => [m.month, (+m.total || 0) - (+m.deposit || 0)]));
  const chartRows = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { month, label: 'Th' + (i + 1), total: revByMonth.get(month) || 0 };
  });
  const female = ST.students.filter(s => dangOTinhGiuong(s) && s.gender === 'female').length;
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
      ${kpi(IC.userCheck, 'ic-green', occRate + '%', 'Tỉ lệ lấp đầy', `${usedBeds}/${capacity} giường${overPeople ? ` · <strong style="color:var(--red-ink)">${IC.alert} quá tải ${overPeople} người (${overRoomCount} phòng)</strong>` : ''}`, actAttr('roomGo', 'all'))}
      ${kpi(IC.trendingUp, 'ic-brand', money(totalYear), 'Tổng tiền đã lập phiếu ' + year, `không gồm cọc giữ hộ${yoy != null ? ` · ${(yoy >= 0 ? '▲' : '▼') + Math.abs(yoy)}% vs ${+year - 1}` : ''}`, actAttr('doanhThuGo', year))}
      ${kpi(IC.users, 'ic-blue', occ, 'Học viên đang ở', '', actAttr('stuGoAdmin', 'in_ktx'))}
      ${kpi(IC.planeTakeoff, 'ic-gray', dep, 'Đã xuất cảnh (năm ' + year + ')', '', actAttr('xuatCanhGo', year))}
    </div>
    <div class="panel"><div class="hd"><h2>${IC.trendingUp} Tiền đã lập phiếu theo tháng — ${year}</h2><span class="muted" style="font-size:12px">Cộng từ phiếu báo đã lập, không gồm cọc giữ hộ (thu thật do Bravo quản lý)</span></div>
    <div class="pad">${chartRows.some(r => r.total) ? svgBars(chartRows) : `<div class="empty">${trongChuaCo('phiếu báo nào trong năm này')}</div>`}</div></div>
    <div class="grid2" style="align-items:start">
      <div class="panel" style="margin:0"><div class="hd"><h2>${IC.pie} Cơ cấu doanh thu dự báo</h2></div><div class="pad" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        ${svcs.length ? svgDonut(svcs.map(s => ({ label: s[0], value: s[1], color: s[2] }))) : `<div class="empty">${trongChuaCo('phiếu báo nào trong năm này')}</div>`}
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
// BL-112/BL-119: "chưa lập phiếu" phải khớp ĐÚNG dân số đợt lập phiếu backend — nếu không sẽ vừa réo
// oan vừa bỏ sót người mất tiền. Ngày vào/ra lấy COALESCE(thật, dự kiến) như backend.
const _vaoHieuLuc = s => (s.check_in_date || s.planned_check_in || '').slice(0, 10);
const _raHieuLuc = s => (s.check_out_date || s.planned_check_out || '').slice(0, 10);
const _soNgayTinhTu = ngay => ngay ? Math.floor((Date.parse(today()) - Date.parse(ngay)) / DAY_MS) : 0;
const _thangTruoc = m => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };
// Có ở trong tháng M: ngày vào hiệu lực <= hết tháng M và chưa rời trước tháng M.
const _giaoThang = (s, M) => !!_vaoHieuLuc(s) && _vaoHieuLuc(s).slice(0, 7) <= M
  && (!_raHieuLuc(s) || _raHieuLuc(s).slice(0, 7) >= M);
// Người ĐỨNG PHIẾU của phòng nguyên căn (khớp nguyenphong.go) chọn trong nhóm ở cùng phòng TRONG KỲ M —
// không theo nhóm đang ở hôm nay, nên cả phòng đã trả thì vẫn chỉ đúng một người đứng phiếu (BL-134).
function laNguoiDungPhieuPhong(s, M) {
  if (!thueNguyenPhong(s)) return true;
  const cung = ST.students.filter(x => !x.deleted_at && x.room_id === s.room_id && _giaoThang(x, M));
  if (!cung.length) return true;
  const coHD = cung.filter(x => { const h = (x.contract_no || '').trim().toLowerCase(); return h && h !== 'x'; });
  const pool = coHD.length ? coHD : cung;
  const dung = pool.slice().sort((a, b) => (_vaoHieuLuc(a).localeCompare(_vaoHieuLuc(b))) || (a.id - b.id))[0];
  return !!dung && dung.id === s.id;
}
// Phiếu TRỌN PHÒNG (hơn một suất nước/dịch vụ) của người khác cùng phòng trong kỳ đã gồm phần người này —
// phòng đổi từ nguyên căn sang ghép sau kỳ đó thì loại phòng hôm nay không còn nói đúng.
function daNamTrongPhieuPhong(s, phieu) {
  const nuoc = +ST.settings.water_fee || 0, dv = +ST.settings.service_fee || 0;
  return phieu.some(i => i.room_id === s.room_id && i.student_id !== s.id
    && ((nuoc > 0 && +i.water_charge > nuoc + 1) || (dv > 0 && +i.service_charge > dv + 1)));
}
const canPhieuThang = (s, M, phieu) => !s.deleted_at && _giaoThang(s, M)
  && laNguoiDungPhieuPhong(s, M) && !daNamTrongPhieuPhong(s, phieu);
// Ba nhóm: ĐÃ Ở trong kỳ này mà chưa có phiếu (không chừa ai, kể cả mới vào), CHƯA NHẬN PHÒNG nhưng đã
// có lịch vào kỳ này, và người RỜI KỲ TRƯỚC còn thiếu phiếu. phieuKyNay/phieuKyTruoc: danh sách phiếu.
function dsChuaLapPhieu(phieuKyNay, phieuKyTruoc) {
  const M = curMonth(), Mt = _thangTruoc(M);
  const coNay = new Set(phieuKyNay.map(i => i.student_id)), coTruoc = new Set(phieuKyTruoc.map(i => i.student_id));
  const thieu = ST.students.filter(s => canPhieuThang(s, M, phieuKyNay) && !coNay.has(s.id));
  const chuaVao = s => ['upcoming', 'cho_vao'].includes(liveStatus(s));
  const kyNay = thieu.filter(s => !chuaVao(s)).sort((a, b) => _soNgayTinhTu(_vaoHieuLuc(b)) - _soNgayTinhTu(_vaoHieuLuc(a)));
  const sapVao = thieu.filter(chuaVao).sort((a, b) => _vaoHieuLuc(a).localeCompare(_vaoHieuLuc(b)));
  const kyTruoc = ST.students.filter(s => !s.deleted_at && (s.check_out_date || '').slice(0, 7) === Mt
    && laNguoiDungPhieuPhong(s, Mt) && !daNamTrongPhieuPhong(s, phieuKyTruoc) && !coTruoc.has(s.id))
    .sort((a, b) => (a.check_out_date || '').localeCompare(b.check_out_date || ''));
  return { kyNay, sapVao, kyTruoc };
}

/* ---- 4 ô đầu Tổng quan: chỉ con số; bấm vào tách theo pháp nhân (E2/S2) và phòng nhân viên / an ninh ---- */
const KPI_NHOM = () => [['nu', legalEntity('female')], ['nam', legalEntity('male')], ['nhan_vien', 'Nhân viên'], ['an_ninh', 'An ninh']];
const KPI_TEN = {
  dang_o: ['Học viên đang ở', 'userCheck', 'Không có học viên đang ở.'], giuong: ['Giường trống', 'bed', 'Không còn phòng trống giường.'],
  sap_tra: ['Sắp trả phòng', 'logOut', 'Không có học viên sắp trả phòng.'], sap_vao: ['Sắp vào', 'key', 'Không có học viên sắp vào.'],
};
const nhomCuaHV = s => { const k = studentRoomKind(s); return k === 'security' ? 'an_ninh' : k === 'staff' ? 'nhan_vien' : (s.gender === 'female' ? 'nu' : 'nam'); };
const sapTraMoiPhong = s => isOccupying(s) && !!_d10(s.planned_check_out);
const sapVaoMoiPhong = s => !_d10(s.check_in_date) && !_d10(s.check_out_date) && !!_d10(s.planned_check_in);
// Số trên ô = tổng các tab. Giường trống chỉ có E2/S2 (phòng nhân viên, an ninh không vào tổng giường) và
// cộng thucCon từng phòng như tongChiSo, nên E2 + S2 bằng đúng số trên ô.
function kpiNhom(loai) {
  if (loai === 'giuong') {
    const nhom = { nu: [], nam: [] };
    (ST.rooms || []).filter(phongTinhGiuong).forEach(r => nhom[r.gender === 'female' ? 'nu' : 'nam'].push({ r, c: chiSoPhong(r) }));
    const so = { nu: nhom.nu.reduce((a, x) => a + x.c.thucCon, 0), nam: nhom.nam.reduce((a, x) => a + x.c.thucCon, 0) };
    return { nhom, so, tong: so.nu + so.nam };
  }
  const loc = loai === 'sap_tra' ? sapTraMoiPhong : loai === 'sap_vao' ? sapVaoMoiPhong : isOccupying;
  const nhom = { nu: [], nam: [], nhan_vien: [], an_ninh: [] };
  ST.students.filter(s => !s.deleted_at && loc(s)).forEach(s => nhom[nhomCuaHV(s)].push(s));
  const so = {};
  Object.keys(nhom).forEach(k => { so[k] = nhom[k].length; });
  return { nhom, so, tong: so.nu + so.nam + so.nhan_vien + so.an_ninh };
}
let _kpiTab = { loai: 'dang_o', nhom: 'nu' };
function kpiTabGo(loai) {
  const d = kpiNhom(loai), co = Object.keys(d.so);
  _kpiTab = { loai, nhom: co.find(k => d.so[k] > 0) || co[0] };
  openModal(kpiTabHtml(), true);
}
function kpiTabChon(nhom) { _kpiTab.nhom = nhom; modalThay(kpiTabHtml()); }
function kpiTabHtml() {
  const { loai, nhom } = _kpiTab, d = kpiNhom(loai), [ten, ico, rong] = KPI_TEN[loai];
  const tabs = KPI_NHOM().filter(([k]) => k in d.so).map(([k, nhan]) =>
    `<button class="seg ${k === nhom ? 'on' : ''}" data-act="kpiTabChon" data-args='["${k}"]' aria-pressed="${k === nhom}">${esc(nhan)}: ${d.so[k]}</button>`).join('');
  const theoTen = (a, b) => String(a || '').localeCompare(String(b || ''), 'vi', { numeric: true });
  let bang = '';
  if (loai === 'giuong') {
    const ds = d.nhom[nhom].filter(x => x.c.thucCon > 0).sort((a, b) => b.c.thucCon - a.c.thucCon || theoTen(a.r.name, b.r.name));
    if (ds.length) bang = `<table><thead><tr><th>Phòng</th><th class="num">Giường trống</th><th class="num">Sức chứa</th><th class="num">Đang ở</th><th class="num">Đã đặt chỗ</th></tr></thead><tbody>
      ${ds.map(x => `<tr><td><a href="#" data-act="roomDetail" data-args='[${x.r.id}]'><strong>${esc(x.r.name)}</strong></a></td>
        <td class="num" data-label="Giường trống"><strong>${x.c.thucCon}</strong></td><td class="num" data-label="Sức chứa">${x.c.cap}</td>
        <td class="num" data-label="Đang ở">${x.c.dangO}</td><td class="num" data-label="Đã đặt chỗ">${x.c.datCho || '—'}</td></tr>`).join('')}
      </tbody></table>`;
  } else {
    const ngay = loai === 'sap_tra' ? s => _d10(s.planned_check_out) : loai === 'sap_vao' ? s => _d10(s.planned_check_in) : s => _d10(s.check_in_date);
    const cot = loai === 'sap_tra' ? 'Hẹn trả' : loai === 'sap_vao' ? 'Hẹn vào' : 'Ngày vào';
    const ds = d.nhom[nhom].slice().sort((a, b) => (loai === 'dang_o'
      ? theoTen(a.room_name, b.room_name) || theoTen(a.name, b.name) : ngay(a).localeCompare(ngay(b)) || theoTen(a.name, b.name)));
    if (ds.length) bang = `<table><thead><tr><th>Học viên</th><th>Phòng</th><th>${cot}</th><th>Tình trạng</th></tr></thead><tbody>
      ${ds.map(s => `<tr><td><div class="flex stu-name" data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Mở hồ sơ">
          <div><strong>${esc(s.name)}</strong>${s.code ? `<div class="sub2">${esc(s.code)}</div>` : ''}</div><span class="row-chev">${IC.chevronRight}</span></div></td>
        <td data-label="Phòng">${esc(s.room_name || '—')}</td><td data-label="${cot}">${fmtDate(ngay(s))}</td>
        <td data-label="Tình trạng">${statusBadge(s)}</td></tr>`).join('')}
      </tbody></table>`;
  }
  return `
    <div class="mh"><h3>${IC[ico]} ${ten} (${d.tong})</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="seg-thu tab" role="group" aria-label="Nhóm" style="max-width:100%;overflow-x:auto">${tabs}</div>
      ${loai === 'giuong' ? `<div class="hint" style="margin-top:10px">${IC.info} Phòng nhân viên và phòng an ninh không tính vào tổng giường.</div>` : ''}
      ${bang ? `<div class="table-wrap card-tbl" style="margin-top:10px">${bang}</div>` : `<div class="empty" style="margin-top:10px">${rong}</div>`}
    </div>
    <div class="mf"><button class="btn" data-act="modalBack">Đóng</button>${loai === 'giuong' ? `<button class="btn" data-close ${actAttr('roomGo', 'trong')}>${IC.bed} Sang màn Phòng</button>` : ''}</div>`;
}

async function billOverdueModal() {
  openModal(`<div class="mb"><div class="spinner"></div></div>`, true);
  return napChuaLapPhieu();
}
async function napChuaLapPhieu() {
  const dau = `<div class="mh"><h3>${IC.receipt} Chưa lập phiếu báo</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>`;
  modalThay(`${dau}<div class="mb"><div class="spinner"></div></div>`);
  const M = curMonth(), Mt = _thangTruoc(M);
  let inv, invT;
  try { [inv, invT] = await Promise.all([API.invoices(M), API.invoices(Mt)]); }
  catch (e) {
    return modalThay(`${dau}
      <div class="mb"><div class="bang-tin" title="${esc(e.message || '')}">${IC.alert} <span>Không tải được danh sách phiếu báo.</span></div></div>
      <div class="mf"><button class="btn" data-act="modalBack">Đóng</button><button class="btn pri" data-act="napChuaLapPhieu">${IC.refresh} Thử lại</button></div>`);
  }
  const { kyNay, sapVao, kyTruoc } = dsChuaLapPhieu(inv, invT);
  const tong = kyNay.length + sapVao.length + kyTruoc.length;
  // Cột "Đã ở" tính theo ngày vào hiệu lực; người sắp vào ra số âm nên hiện "—" cho khỏi rối.
  const dong = ky => s => {
    const vao = _vaoHieuLuc(s), n = _soNgayTinhTu(vao), duKien = !s.check_in_date && s.planned_check_in;
    return `<tr>
      <td><div class="flex stu-name" data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Mở hồ sơ">
        <div><strong>${esc(s.name)}</strong>${s.code ? `<div class="sub2">${esc(s.code)}</div>` : ''}</div>
        <span class="row-chev">${IC.chevronRight}</span></div></td>
      <td data-label="Phòng">${esc(s.room_name || '—')}</td>
      <td data-label="Ngày vào">${fmtDate(vao)}${duKien ? ' <span class="badge gray" style="font-size:10px" title="Ngày dự kiến — chưa xác nhận vào">dự kiến</span>' : ''}</td>
      <td class="num" data-label="Đã ở">${n > 0 ? n + ' ngày' : '—'}</td>
      <td data-label="Tình trạng">${liveStatus(s) === 'left'
    ? `<span class="badge red">Đã trả ${fmtDate(s.check_out_date)}</span>`
    : statusBadge(s)}</td>
      <td class="num"><button class="btn sm" style="white-space:nowrap" data-act="lapPhieuChoHV" data-args='[${s.id},"${ky}"]' title="Lập phiếu báo ${monthLabel(ky)} cho ${esc(s.name)}">${IC.receipt} Lập phiếu</button></td>
    </tr>`;
  };
  const bang = (arr, ky) => `<div class="table-wrap card-tbl" style="margin-top:10px"><table>
    <thead><tr><th>Học viên</th><th>Phòng</th><th>Ngày vào</th><th class="num">Đã ở</th><th>Tình trạng</th><th></th></tr></thead>
    <tbody>${arr.map(dong(ky)).join('')}</tbody></table></div>`;
  modalThay(`
    <div class="mh"><h3>${IC.receipt} Chưa lập phiếu báo (${tong})</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="hint">${IC.info} Đúng dân số đợt lập phiếu: đã bỏ thành viên phòng thuê nguyên căn (nằm trong
        phiếu người ký HĐ của kỳ đó), tính cả người mới vào, người sắp vào theo lịch và người rời kỳ trước còn thiếu phiếu.</div>
      ${tong ? `<h4 class="asset-h" style="margin:16px 0 0">Kỳ này (${monthLabel(M)}) — đã ở mà chưa có phiếu: ${kyNay.length}</h4>
        ${kyNay.length ? bang(kyNay, M) : `<div class="empty" style="margin-top:8px">${IC.checkCircle} Ai đã ở trong kỳ này cũng đã có phiếu báo.</div>`}
        ${sapVao.length ? `<h4 class="asset-h" style="margin:18px 0 0">Kỳ này — chưa nhận phòng, đã có lịch vào: ${sapVao.length}</h4>
          <p class="muted" style="margin:4px 0 0;font-size:13px">Đợt lập phiếu tính cả người có lịch vào trong kỳ. Họ chưa đến thì chưa cần thu ngay.</p>
          ${bang(sapVao, M)}` : ''}
        ${kyTruoc.length ? `<h4 class="asset-h" style="margin:18px 0 0;color:var(--red-ink)">${IC.alert} Rời kỳ trước (${monthLabel(Mt)}) mà chưa có phiếu — ${kyTruoc.length}</h4>
          <p class="muted" style="margin:4px 0 0;font-size:13px">Họ đã đi, đợt lập phiếu hằng tháng không còn quét tới.</p>
          ${bang(kyTruoc, Mt)}` : ''}`
    : `<div class="empty" style="margin-top:10px">${IC.checkCircle} Không có học viên thiếu phiếu báo.</div>`}
    </div>
    <div class="mf"><button class="btn" data-act="modalBack">Đóng</button></div>`);
}
// Lập phiếu đúng kỳ cho một người ngay từ hộp "Chưa lập phiếu báo", rồi mở phiếu đó ở màn Tiền phòng.
async function lapPhieuChoHV(id, ky) {
  const r = await guard(() => API.generateOneInvoice({ student_id: id, month: ky }));
  closeModal(); invMonth = ky; invFilter = 'all';
  toast(r.created ? 'Đã lập phiếu báo' : 'Đã cập nhật phiếu báo');
  adminGo('invoices');
  if (r.invoice) { r.invoice.room_name = (roomById(r.invoice.room_id) || {}).name || ''; setTimeout(() => phieuBao(r.invoice), 300); }
}

// Màn Tạm trú (/tam-tru): ba tab theo tình trạng tạm trú của học viên đang ở, tab thứ tư lập danh sách in ảnh
// CCCD gửi cơ quan chức năng. Tháng lọc theo ngày vào ở ('' = tất cả tháng), áp cho mọi tab.
// Ảnh lấy qua proxy /api/students/:id/cccd/... (cookie phiên tự gửi -> ảnh hiện khi in).
const TT_TAB = [
  ['chua', 'unregistered', 'Chưa đăng ký'], ['dang', 'processing', 'Đang xử lý'],
  ['xong', 'registered', 'Đã hoàn thành'], ['in', '', 'Tạo danh sách gửi cơ quan chức năng'],
];
const TT_TEN = { unregistered: 'Chưa đăng ký', processing: 'Đang xử lý', registered: 'Đã hoàn thành' };
const TT_TAB_URL = { 'chua-dang-ky': 'chua', 'dang-xu-ly': 'dang', 'hoan-thanh': 'xong', 'danh-sach-gui': 'in' };
let _tamTruTab = 'chua';
let _tamTruThang = '';
// Danh sách in: 'unregistered' = in mới; 'processing' = in lại đợt đã gửi.
let _tamTruTT = 'unregistered';
function tamTruGo(tab) { _tamTruTab = TT_TAB.some(t => t[0] === tab) ? tab : 'chua'; _tamTruThang = ''; adminGo('tamtru'); }
function tamTruTab(tab) { _tamTruTab = tab; viewTamTru(); }
function tamTruTatCaThang() { _tamTruThang = ''; viewTamTru(); }
function tamTruChonTT() { _tamTruTT = this.value === 'processing' ? 'processing' : 'unregistered'; viewTamTru(); }
// Ô chọn tình trạng trong ba tab danh sách: chọn là lưu, hồ sơ chuyển sang tab tương ứng.
const MAU_TAM_TRU = { processing: 'background:var(--amber-bg);color:var(--amber-ink)', registered: 'background:var(--green-bg);color:var(--green-ink)' };
function oChonTamTru(s) {
  const hien = TT_TEN[s.residency_status] ? s.residency_status : 'unregistered';
  return `<select data-change="doiTamTru" data-args='[${s.id}]' aria-label="Tình trạng tạm trú của ${esc(s.name)}"
    style="width:auto;padding:6px 10px;border-radius:9px;font-size:13px;font-weight:600;${MAU_TAM_TRU[hien] || ''}">
    ${Object.keys(TT_TEN).map(k => `<option value="${k}"${k === hien ? ' selected' : ''}>${TT_TEN[k]}</option>`).join('')}</select>`;
}
async function doiTamTru(id) {
  const o = this, s = studentById(id);
  if (!s || !o) return;
  const cu = TT_TEN[s.residency_status] ? s.residency_status : 'unregistered', moi = o.value;
  if (moi === cu || !TT_TEN[moi]) return;
  o.disabled = true;
  try { await guard(() => API.updateStudent(id, { residency_status: moi })); }
  catch (e) { o.value = cu; o.disabled = false; return; }
  s.residency_status = moi;
  toast(`Đã chuyển ${s.name} sang "${TT_TEN[moi]}"`);
  if (ST.view === 'tamtru') viewTamTru();
}
// Màn riêng (/tam-tru): có tiêu đề, nút Quay lại, F5 giữ tháng đang xem; lưu hồ sơ xong vẽ lại đúng màn này.
function viewTamTru() {
  _ttGoc.clear();   // vẽ lại trang = đọc lại ảnh đang lưu, không xoay tiếp từ bản cũ trong bộ nhớ
  const thangCua = s => String(s.check_in_date || '').slice(0, 7);
  const theoTT = st => ST.students.filter(s => isOccupying(s) && s.residency_status === st && (!_tamTruThang || thangCua(s) === _tamTruThang))
    .sort((a, b) => String(a.room_name || '').localeCompare(String(b.room_name || ''), 'vi') || String(a.name).localeCompare(String(b.name), 'vi'));
  const tab = TT_TAB.find(t => t[0] === _tamTruTab) || TT_TAB[0];
  const laIn = tab[0] === 'in';
  const tabs = TT_TAB.map(([k, st, nhan]) => `<button class="seg ${k === tab[0] ? 'on' : ''}" data-act="tamTruTab" data-args='["${k}"]' aria-pressed="${k === tab[0]}">${nhan}${st ? ` (${theoTT(st).length})` : ''}</button>`).join('');
  const all = laIn ? theoTT(_tamTruTT) : theoTT(tab[1]);
  const ready = laIn ? all.filter(s => s.has_cccd_front && s.has_cccd_back) : [];   // đủ 2 mặt -> đưa vào bản in
  const missing = laIn ? all.filter(s => !(s.has_cccd_front && s.has_cccd_back)) : [];
  const missSide = s => [!s.has_cccd_front ? 'mặt trước' : null, !s.has_cccd_back ? 'mặt sau' : null].filter(Boolean).join(' + ') || 'chưa có ảnh';

  _tamTruDot = ready;
  el('topActions').innerHTML = ready.length
    ? `<button class="btn pri" data-act="tamTruIn">${IC.printer} In danh sách (${ready.length})</button>`
    : '';

  const oTen = s => `<td><div class="flex stu-name" data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Mở hồ sơ">
        <div><strong>${esc(s.name)}</strong>${s.code ? `<div class="sub2">${esc(s.code)}</div>` : ''}</div><span class="row-chev">${IC.chevronRight}</span></div></td>
      <td data-label="Phòng">${esc(s.room_name || '—')}</td>`;
  const ngayVao = s => {
    const tre = s.residency_status === 'unregistered' && stayDays(s) > overdueDays();
    return `<td data-label="Ngày vào" style="white-space:nowrap">${fmtDate(s.check_in_date)}${tre ? `<div class="sub2" style="color:var(--red-ink)">đã ở ${stayDays(s)} ngày</div>` : ''}</td>`;
  };
  const hangDs = s => `<tr>${oTen(s)}${ngayVao(s)}<td data-label="Mã pháp nhân">${legalEntityCell(s.gender)}</td><td data-label="Tình trạng">${oChonTamTru(s)}</td></tr>`;
  const hang = (s, i) => `<tr><td class="num" data-label="STT">${i + 1}</td>${oTen(s)}${ngayVao(s)}</tr>`;
  const hangThieu = s => `<tr>${oTen(s)}${ngayVao(s)}<td data-label="Ảnh CCCD"><span class="badge red">Thiếu ${missSide(s)}</span>
        <button class="btn sm" style="margin-left:6px;white-space:nowrap" data-act="studentForm" data-args='[${s.id}]'>${IC.filePen} Bổ sung ảnh</button></td></tr>`;
  const bang = (dau, rows) => `<div class="table-wrap card-tbl"><table><thead><tr>${dau.map(h => `<th${h === 'STT' ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const RONG = { chua: 'Không có học viên chưa đăng ký tạm trú.', dang: 'Không có hồ sơ đang xử lý.', xong: trongChuaCo('học viên hoàn thành tạm trú'),
    in: 'Không có học viên đủ ảnh CCCD để in.' };
  const lanVe = Date.now();   // URL mới mỗi lần vẽ: Firefox dùng lại ảnh cũ cùng URL trong trang dù máy chủ báo no-cache
  const cell = (s, side, nhan) => `<div class="tt-cell"><img src="${ttAnhUrl(s.id, side)}?t=${lanVe}" alt="${nhan}" data-anh="${s.id}-${side}">
        <div class="tt-cong-cu rc-noprint"><span class="tt-doc-nhan">ảnh dọc</span>
          <button class="tt-nut" type="button" data-act="tamTruXoay" data-args='[${s.id},"${side}",-1]' title="Xoay trái 90° — bấm tiếp tới khi đúng chiều" aria-label="Xoay trái">${IC.rotateLeft}</button>
          <button class="tt-nut" type="button" data-act="tamTruXoay" data-args='[${s.id},"${side}",1]' title="Xoay phải 90° — bấm tiếp tới khi đúng chiều" aria-label="Xoay phải">${IC.rotateRight}</button>
          <button class="tt-nut" type="button" data-act="tamTruCatMo" data-args='[${s.id},"${side}"]' title="Cắt gọn ảnh cho vừa khung thẻ">${IC.crop}<span>Cắt</span></button></div></div>`;
  const pair = s => `<div class="tt-pair">${cell(s, 'front', 'CCCD mặt trước')}${cell(s, 'back', 'CCCD mặt sau')}</div>`;

  el('content').innerHTML = `
  <style>
    .tt-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .tt-bar select,.tt-bar input{width:auto;padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);font:inherit;font-size:13.5px}
    #printArea .tt-doc{max-width:210mm;margin:0 auto}
    .tt-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
    .tt-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;break-inside:avoid;page-break-inside:avoid}
    .tt-cell{position:relative;border:1.5px dashed #8fae91;padding:4px;background:#fff}
    .tt-cell img{width:100%;aspect-ratio:85.6/54;object-fit:contain;display:block}
    .tt-cong-cu{position:absolute;top:6px;right:6px;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 2px 8px rgba(0,0,0,.12);opacity:0;pointer-events:none;transition:opacity .15s}
    .tt-cell:hover .tt-cong-cu,.tt-cell:focus-within .tt-cong-cu{opacity:1;pointer-events:auto}
    @media (hover:none){ .tt-cong-cu{opacity:1;pointer-events:auto} }
    .tt-nut{display:inline-flex;align-items:center;gap:4px;padding:5px 8px;border:0;border-radius:999px;background:transparent;color:var(--ink);font:inherit;font-size:12px;line-height:1;cursor:pointer}
    .tt-nut:hover{background:var(--bg2)}
    .tt-nut[disabled]{opacity:.45;cursor:default}
    .tt-nut .ic-svg{width:15px;height:15px}
    .tt-doc-nhan{display:none;padding:0 4px 0 8px;color:var(--amber-ink);font-weight:700;font-size:12px}
    .tt-cell.tt-doc{border-color:var(--amber-ink)}
    .tt-cell.tt-doc .tt-doc-nhan{display:inline}
    @media print{ @page{size:A4;margin:10mm} .tt-cell,.tt-cell.tt-doc{border-color:#8fae91} }
  </style>
  <div class="rc-noprint">
    <div class="panel">
      <div class="pad" style="padding-bottom:0"><div class="seg-thu tab" role="group" aria-label="Tình trạng tạm trú" style="max-width:100%;overflow-x:auto">${tabs}</div></div>
      <div class="pad tt-bar">
        <label class="flex" style="gap:8px;font-size:13.5px;white-space:nowrap">${IC.calendar} Tháng vào ở <input id="ttThang" aria-label="Tháng vào ở"></label>
        <button class="btn sm ${!_tamTruThang ? 'pri' : ''}" data-act="tamTruTatCaThang" aria-pressed="${!_tamTruThang}">Tất cả tháng</button>
        ${laIn ? `<label class="flex" style="gap:8px;font-size:13.5px;white-space:nowrap">${IC.flag} Tình trạng
          <select id="ttTT" data-change="tamTruChonTT">${['unregistered', 'processing'].map(k => `<option value="${k}"${k === _tamTruTT ? ' selected' : ''}>${TT_TEN[k]} (${theoTT(k).length})</option>`).join('')}</select></label>` : ''}
      </div>
      ${laIn ? '' : (all.length ? bang(['Học viên', 'Phòng', 'Ngày vào', 'Mã pháp nhân', 'Tình trạng'], all.map(hangDs).join('')) : `<div class="empty">${RONG[tab[0]]}</div>`)}
    </div>
    ${laIn ? `<div class="panel"><div class="hd"><h2>Danh sách in (${ready.length})</h2></div>${ready.length ? bang(['STT', 'Học viên', 'Phòng', 'Ngày vào'], ready.map(hang).join('')) : `<div class="empty">${RONG.in}</div>`}</div>
    ${missing.length ? `<details class="panel"><summary style="cursor:pointer;padding:14px 18px;font-weight:700;color:var(--red-ink,#b4432b)">${IC.alert} Thiếu ảnh CCCD (${missing.length})</summary>${bang(['Học viên', 'Phòng', 'Ngày vào', 'Ảnh CCCD'], missing.map(hangThieu).join(''))}</details>` : ''}` : ''}
  </div>
  ${ready.length ? `<div id="printArea"><div class="tt-doc"><div class="tt-grid">${ready.map(pair).join('')}</div></div></div>` : ''}`;
  const o = el('ttThang');
  attachMonth(o, _tamTruThang || curMonth());
  if (!_tamTruThang) { o.value = ''; o.placeholder = 'Chọn tháng'; }
  o.onchange = () => { _tamTruThang = o.dataset.ym; viewTamTru(); };
  tamTruDanhDauDoc();
  syncFilterUrl();
}
// Ảnh cao hơn rộng = chụp dọc -> viền cam (bản in chỉ nhận thẻ nằm ngang); nút sửa ảnh chỉ hiện khi trỏ chuột vào ảnh.
function tamTruDanhDauDoc() {
  document.querySelectorAll('#printArea .tt-cell img').forEach(img => {
    const danhDau = () => img.parentElement.classList.toggle('tt-doc', img.naturalHeight > img.naturalWidth);
    img.addEventListener('load', danhDau);
    if (img.complete && img.naturalWidth) danhDau();
  });
}
// Mỗi lượt sửa đọc lại ảnh ĐANG LƯU rồi ghi đè, nên xoay/cắt bao nhiêu lượt cũng được, chiều nào cũng được.
// Ghi đè file thật (không phải transform CSS) để bản in và hồ sơ lưu trữ cùng đúng chiều.
const ttAnhUrl = (id, side) => `/api/students/${id}/cccd/${side}`;
// PUT nhận data URL y như form Học viên; ghi xong nạp lại đúng ô ảnh trên trang in.
async function tamTruGhiAnh(id, side, canvas) {
  await API.updateStudent(id, { ['cccd_' + side]: canvas.toDataURL('image/jpeg', ANH_CHAT) });
  const img = document.querySelector(`#printArea img[data-anh="${id}-${side}"]`);
  if (img) img.src = ttAnhUrl(id, side) + '?t=' + Date.now();
}
// Ảnh gốc + góc đang xoay + ETag từng ô: xoay lượt sau dựng lại từ GỐC (chỉ nén một lần);
// ETag khác bản vừa lưu = ảnh đã bị thay ở nơi khác -> bỏ gốc cũ.
const _ttGoc = new Map();
async function ttEtag(id, side, etagCu) {
  const r = await fetch(ttAnhUrl(id, side), { cache: 'no-store', headers: etagCu ? { 'If-None-Match': etagCu } : {} });
  if (r.body) r.body.cancel().catch(() => {});
  if (r.status === 304) return etagCu;
  if (!r.ok) throw new Error('không đọc được ảnh');
  return r.headers.get('ETag') || '';
}
async function tamTruXoay(id, side, chieu) {
  const khoa = id + '-' + side;
  const nut = [...this.parentElement.querySelectorAll('button')];
  nut.forEach(n => n.disabled = true);
  try {
    let g = _ttGoc.get(khoa);
    if (g && (!g.etag || await ttEtag(id, side, g.etag) !== g.etag)) g = null;
    if (!g) {
      const etag = await ttEtag(id, side, '');
      g = { bm: await anhNap(ttAnhUrl(id, side) + '?t=' + Date.now()), goc: 0, etag };
      _ttGoc.set(khoa, g);
    }
    g.goc = (g.goc + (chieu < 0 ? -90 : 90) + 360) % 360;
    await tamTruGhiAnh(id, side, anhVeXoay(g.bm, g.goc));
    g.etag = await ttEtag(id, side, '');
    toast('Đã xoay và lưu ảnh vào hồ sơ');
  } catch (e) { toast('Xoay ảnh thất bại: ' + (e.message || 'không đọc được ảnh'), 'err'); }
  nut.forEach(n => n.disabled = false);
}
// Cắt ở đây ghi thẳng vào hồ sơ vì trang in không có nút Lưu nào khác.
function tamTruCatMo(id, side) {
  return anhSuaMo(ttAnhUrl(id, side) + '?t=' + Date.now(), 'Cắt & xoay ảnh CCCD', async canvas => {
    await tamTruGhiAnh(id, side, canvas);
    _ttGoc.delete(id + '-' + side);   // ảnh đã cắt là gốc mới, xoay tiếp phải xoay bản đã cắt
    toast('Đã lưu ảnh vào hồ sơ');
  });
}

// Đợt đang hiện trên trang in. In xong hỏi lại rồi mới chuyển cả đợt sang "Đang xử lý" — hộp in bị
// huỷ thì không đổi gì. "Đã hoàn thành" chọn tay khi có kết quả tạm trú.
let _tamTruDot = [];
function tamTruIn() {
  window.print();
  const n = _tamTruDot.filter(s => s.residency_status === 'unregistered').length;
  if (!n) return;
  openModal(`
    <div class="mh"><h3>${IC.printer} Đã in xong?</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb"><p style="margin:0">Chuyển <strong>${n} hồ sơ</strong> sang <strong>Đang xử lý</strong>?</p></div>
    <div class="mf"><button class="btn" data-act="closeModal">Để sau</button><button class="btn pri" data-act="tamTruXacNhanIn">${IC.check} Chuyển ${n} hồ sơ</button></div>`);
}
function tamTruXacNhanIn() {
  closeModal();
  return tamTruChuyenXuLy();
}
// PUT hồ sơ gộp với bản hiện có ở máy chủ nên chỉ cần gửi đúng ô tạm trú. Hỏng hồ sơ nào thì báo tên
// và cho bấm thử lại — không in lại, không chuyển lần hai hồ sơ đã xong.
async function tamTruChuyenXuLy() {
  const ds = _tamTruDot.filter(s => s.residency_status === 'unregistered');
  if (!ds.length) return;
  el('topActions').innerHTML = `<button class="btn" disabled>${IC.hourglass} Đang chuyển ${ds.length} hồ sơ sang Đang xử lý…</button>`;
  const kq = await Promise.allSettled(ds.map(s => API.updateStudent(s.id, { residency_status: 'processing' })));
  const loi = [];
  kq.forEach((r, i) => {
    if (r.status === 'fulfilled') ds[i].residency_status = 'processing';
    else loi.push(`${ds[i].name} (${(r.reason && r.reason.message) || 'lỗi kết nối'})`);
  });
  const xong = ds.length - loi.length;
  if (xong) {
    try { await napLai('students'); } catch (e) { /* trạng thái đã ghi ở máy chủ; số đếm Tổng quan sẽ đúng ở lần nạp sau */ }
  }
  // Chuyển hết: đợt vừa in nằm ở "Đang xử lý" của tab in, vẽ lại để in lại được ngay.
  if (!loi.length && ST.view === 'tamtru') {
    _tamTruTT = 'processing';
    toast(`Đã chuyển ${xong} hồ sơ sang Đang xử lý`);
    return viewTamTru();
  }
  if (loi.length) {
    toast(`Chưa chuyển được ${loi.length} hồ sơ`, 'err');
    el('content').insertAdjacentHTML('afterbegin', `<div class="bang-tin rc-noprint" style="border-color:var(--red-ink)">${IC.alert}
      <span><strong>Chưa chuyển được ${loi.length} hồ sơ:</strong><ul style="margin:6px 0 0 18px">${loi.map(x => `<li>${esc(x)}</li>`).join('')}</ul></span></div>`);
    el('topActions').innerHTML = `<button class="btn pri" data-act="tamTruChuyenXuLy">${IC.refresh} Thử lại (${loi.length})</button> <button class="btn" data-act="doPrint">${IC.printer} In lại</button>`;
  } else {
    toast(`Đã chuyển ${xong} hồ sơ sang Đang xử lý`);
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
    <div class="mf"><button class="btn" data-act="modalBack">Đóng</button></div>`);
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
    <div class="mf"><button class="btn" data-act="modalBack">Đóng</button></div>`);
}
async function viewDashboard() {
  el('content').innerHTML = '<div class="spinner"></div>';
  const occ = ST.students.filter(isOccupying);
  // Danh sách "Cần xử lý" phía dưới quét occ (mọi người đang ở) — không giấu việc của ai.
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
  const logs = ST.logs, damage = ST.damage;
  let invAll = [];
  // BL-12: chỉ lấy hoá đơn THÁNG NÀY (dashboard chỉ dùng 2 con số của tháng hiện tại) thay vì kéo
  // mọi hoá đơn từ trước tới nay. Server đã hỗ trợ lọc theo tháng sẵn.
  try { invAll = await API.invoices(curMonth()); } catch {}
  // CHỈ đếm hư hỏng phòng (category='damage') — ô "Bảo trì" bấm vào mở trang repair (chỉ hiện damage).
  // Trước đây đếm gộp cả feedback/vi phạm (category violation/other) -> số > số dòng thực (khớp updateNavBadges).
  const pDmg = damage.filter(d => (d.category || 'damage') === 'damage' && d.status !== 'done').length;
  // App CHỈ lập phiếu báo tiền phòng — KHÔNG quản lý doanh thu/công nợ (đã có Bravo)
  const billedThisMonth = invAll.filter(i => i.month === curMonth()).reduce((a, i) => a + (+i.total || 0), 0);
  // Mốc tháng trước làm ngữ cảnh cho ô "Phiếu báo tháng này" (đầu tháng billing chưa chạy xong nên
  // KHÔNG hiện % tăng/giảm — dễ báo động giả; chỉ nêu con số tháng trước để đối chiếu).
  const [_cy, _cmm] = curMonth().split('-').map(Number);
  const prevMonth = _cmm === 1 ? `${_cy - 1}-12` : `${_cy}-${String(_cmm - 1).padStart(2, '0')}`;
  const billedLastMonth = invAll.filter(i => i.month === prevMonth).reduce((a, i) => a + (+i.total || 0), 0);
  // BL-112/BL-119: đếm khớp modal — cần cả phiếu kỳ trước để bắt người rời kỳ trước còn thiếu phiếu.
  let invPrev = [];
  try { invPrev = await API.invoices(prevMonth); } catch {}
  const _chuaLap = dsChuaLapPhieu(invAll.filter(i => i.month === curMonth()), invPrev);
  const billOverdue = _chuaLap.kyNay.length + _chuaLap.sapVao.length + _chuaLap.kyTruoc.length;

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
      ${kpi('ic-green', IC.userCheck, kpiNhom('dang_o').tong, 'Học viên đang ở', actAttr('kpiTabGo', 'dang_o'))}
      ${kpi('ic-blue', IC.bed, `${T.thucCon}<span class="muted" style="font-size:15px;font-weight:600"> / ${capacity}</span>`, 'Giường trống', actAttr('kpiTabGo', 'giuong'))}
      ${kpi('ic-amber', IC.logOut, kpiNhom('sap_tra').tong, 'Sắp trả phòng', actAttr('kpiTabGo', 'sap_tra'))}
      ${kpi('ic-gray', IC.key, kpiNhom('sap_vao').tong, 'Sắp vào', actAttr('kpiTabGo', 'sap_vao'))}
      ${kpi('ic-brand', IC.receipt, money(billedThisMonth), 'Phiếu báo tháng này', actAttr('phieuThangNayGo'), billedLastMonth ? 'Tháng trước ' + money(billedLastMonth) : '')}
    </div>

    <div class="panel"><div class="hd"><h2>${IC.zap} Cần xử lý</h2></div><div class="pad">
      <div class="todo-grid">
        ${/* Nhận phòng và Trả phòng TÁCH RIÊNG (owner 26/08): đây sẽ là hai nơi BQL vào xác nhận vào/ra
              thực tế (BL-117). Tiền cọc + Dự kiến xuất cảnh bỏ khỏi Tổng quan theo yêu cầu cùng ngày. */''}
        ${todo(IC.key, 'Nhận phòng', nguoiCanXuLyPhong('checkin').tong, actAttr('nhanPhongGo'), 'on')}
        ${todo(IC.logOut, 'Trả phòng', nguoiCanXuLyPhong('checkout').tong, actAttr('traPhongGo'), 'on')}
        ${todo(IC.wrench, 'Bảo trì', pDmg, actAttr('baoTriGo'), 'warn')}
        ${todo(IC.flag, 'Đăng ký Tạm Trú', resiOverdue, actAttr('tamTruGo', 'chua'), 'warn')}
        ${todo(IC.fileText, 'Hợp đồng', contractIncomplete, actAttr('contractIssuesModal'), 'warn')}
        ${todo(IC.receipt, 'Lập phiếu báo', billOverdue, actAttr('billOverdueModal'), 'bad')}
        ${todo(IC.alert, 'Vi phạm cần báo', needMail, actAttr('viPhamGo', 'canbao'), 'bad')}
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
  if (!logs.length) return `<div class="empty">${trongChuaCo('hoạt động nào')}</div>`;
  return `<table><thead><tr><th>Ngày</th><th>Học viên</th><th>Hoạt động</th><th>Phòng</th><th>Nguồn</th><th>Ghi chú</th></tr></thead><tbody>
    ${logs.map(l => `<tr><td>${fmtDate(l.date)}${String(l.date).slice(0, 10) > today() ? ' <span class="badge blue" style="font-size:10px">sắp tới</span>' : ''}</td><td><a href="#" data-act="studentDetail" data-args='[${l.student_id}]'>${esc(l.student_name)}</a></td>
      <td>${l.type === 'in' ? '<span class="badge green">Nhận phòng</span>' : '<span class="badge red">Trả phòng</span>'}</td>
      <td>${l.room_id ? `<a href="#" data-act="roomDetail" data-args='[${l.room_id}]'>${esc(l.room_name || '—')}</a>` : esc(l.room_name || '—')}</td>
      <td>${l.source === 'self' ? '<span class="badge blue">Học viên</span>' : '<span class="badge gray">Quản lý</span>'}</td>
      <td class="muted">${esc(ghiChuRaVao(l.note))}</td></tr>`).join('')}
  </tbody></table>`;
}

/* ---------- PHÒNG ---------- */
let roomSearch = '', roomShowDeleted = false;
