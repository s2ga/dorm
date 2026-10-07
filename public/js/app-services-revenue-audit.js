// === app-services-revenue-audit.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
/* ================== HỒ SƠ LƯU TRỮ — hợp đồng + CCCD của toàn bộ học viên ==================
   Trước nay giấy tờ nằm rải: ảnh CCCD ở form Sửa học viên và ở khối "Hợp đồng" của thẻ chi tiết,
   bản scan HĐ ở chỗ khác — không có màn nào trả lời "ai còn thiếu giấy tờ". */
let hsLoc = 'all';
function hsGo(k) { hsLoc = hsLoc === k ? 'all' : k; viewHoSo(); }
// Vào màn từ menu = xem TOÀN BỘ hồ sơ; không giữ bộ lọc của lần xem trước để ba ô đếm khớp bảng.
function hoSoGo() { hsLoc = 'all'; adminGo('hoso'); }
// Ô giấy tờ: có tệp thì là ĐƯỜNG MỞ TỆP luôn (mở tab mới, máy chủ trả inline nên ảnh/PDF xem thẳng),
// không bắt vào hồ sơ rồi mới bấm tiếp.
const hsCo = (co, nhan, href) => co
  ? `<a class="badge green tep-mo" href="${href}" target="_blank" rel="noopener" title="${nhan}: bấm để mở tệp">${IC.fileText} Xem</a>`
  : `<span class="badge gray" title="${nhan}: chưa có">—</span>`;
async function viewHoSo() {
  const ds = ST.students.filter(s => !s.deleted_at)
    .sort((a, b) => (a.room_name || '').localeCompare(b.room_name || '', 'vi', { numeric: true })
      || (a.name || '').localeCompare(b.name || '', 'vi'));
  const coHD = s => !!String(s.contract_no || '').trim() && String(s.contract_no).trim().toLowerCase() !== 'x';
  const duCCCD = s => s.has_cccd_front && s.has_cccd_back;
  const thieu = s => !coHD(s) || !s.has_contract_scan || !duCCCD(s);
  const boLoc = {
    all: () => true,
    du: s => !thieu(s),
    thieu_hd: s => !coHD(s),
    thieu_scan: s => !s.has_contract_scan,
    thieu_cccd: s => !duCCCD(s),
    thieu: thieu,
  };
  const list = ds.filter(boLoc[hsLoc] || boLoc.all);
  const dem = k => ds.filter(boLoc[k]).length;
  const pill = (k, nhan, n, mau) => `<button class="btn sm ${hsLoc === k ? 'pri' : ''}" data-act="hsGo" data-args='["${k}"]'
    aria-pressed="${hsLoc === k}">${nhan} <span class="badge ${hsLoc === k ? '' : (mau || 'gray')}">${n}</span></button>`;
  el('topActions').innerHTML = '';
  el('content').innerHTML = `
    <div class="panel"><div class="hd"><h2>${IC.fileText} Hồ sơ lưu trữ — hợp đồng và CCCD (<span id="hsCount">${list.length}</span>)</h2>
      <div class="toolbar"><div class="search"><span class="i">${IC.search}</span>
        <input id="hsSearch" placeholder="Tìm tên HV / mã / số phòng…"></div></div></div>
      <div class="pill-row" style="padding:12px 16px 0;margin:0">
        ${pill('all', 'Tất cả', ds.length)}
        ${pill('du', `${IC.check} Đủ giấy tờ`, dem('du'), 'green')}
        ${pill('thieu', `${IC.alert} Còn thiếu gì đó`, dem('thieu'), 'red')}
        ${pill('thieu_hd', 'Chưa có số HĐ', dem('thieu_hd'), 'amber')}
        ${pill('thieu_scan', 'Chưa chụp HĐ', dem('thieu_scan'), 'amber')}
        ${pill('thieu_cccd', 'Thiếu CCCD', dem('thieu_cccd'), 'amber')}
      </div>
      <div class="table-wrap card-tbl">
        ${list.length ? `<table><thead><tr><th>Học viên</th><th>Phòng</th><th>Trạng thái</th><th>Số HĐ</th><th>Ngày ký</th><th>Tình trạng HĐ</th>
          <th class="num">Bản chụp HĐ</th><th class="num">CCCD trước</th><th class="num">CCCD sau</th></tr></thead><tbody>
          ${list.map(s => `<tr data-s="${esc(((s.name || '') + ' ' + (s.code || '') + ' ' + (s.room_name || '') + ' ' + (s.contract_no || '') + ' ' + STATUS_INFO[liveStatus(s)][0]).toLowerCase())}">
            <td><div class="flex stu-name" data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Mở hồ sơ để xem/nộp giấy tờ">
              <div><strong>${esc(s.name)}</strong>${s.code ? `<div class="sub2">${esc(s.code)}</div>` : ''}</div>
              <span class="row-chev">${IC.chevronRight}</span></div></td>
            <td data-label="Phòng">${esc(s.room_name || '—')}</td>
            <td data-label="Trạng thái">${statusBadge(s)}</td>
            <td data-label="Số HĐ">${coHD(s) ? `<strong>${esc(s.contract_no)}</strong>` : '<span class="badge amber">chưa có</span>'}</td>
            <td data-label="Ngày ký">${s.contract_date ? fmtDate(s.contract_date) : '<span class="muted">—</span>'}</td>
            <td data-label="Tình trạng HĐ"><span class="badge ${CONTRACT_BADGE[s.contract_status] || 'gray'}">${CONTRACT_LABEL[s.contract_status] || '—'}</span></td>
            <td class="num" data-label="Bản chụp HĐ">${hsCo(s.has_contract_scan, 'Bản chụp hợp đồng', `/api/students/${s.id}/contract-scan`)}</td>
            <td class="num" data-label="CCCD trước">${hsCo(s.has_cccd_front, 'CCCD mặt trước', `/api/students/${s.id}/cccd/front`)}</td>
            <td class="num" data-label="CCCD sau">${hsCo(s.has_cccd_back, 'CCCD mặt sau', `/api/students/${s.id}/cccd/back`)}</td>
          </tr>`).join('')}
          ${hangKhongKhop('hồ sơ', 9)}
        </tbody></table>` : `<div class="empty">${ds.length ? `${trongKhongKhop('hồ sơ')} ${nutXoaLoc(`data-act="hsGo" data-args='["all"]'`)}` : trongChuaCo('hồ sơ nào')}</div>`}
      </div>
      <div class="pad"><div class="hint">${IC.info}<span>Bấm <strong>Xem</strong> ở ba cột cuối để mở thẳng tệp
        (ảnh hoặc PDF) trong cửa sổ mới. Bấm tên học viên để mở hồ sơ — nộp giấy tờ còn thiếu tại đó.</span></div></div>
    </div>`;
  const sb = el('hsSearch'); if (sb) attachRowSearch(sb, 'hsCount', { xoaLoc: hsLoc !== 'all' ? () => hsGo('all') : null });
}

async function viewServices() {
  const occ = ST.students.filter(isOccupying);
  const washFee = +ST.settings.washing_fee || 0, parkFee = +ST.settings.parking_fee || 0;
  const washUsers = occ.filter(s => s.uses_washing).sort((a, b) => (a.room_name || '').localeCompare(b.room_name || '', 'vi'));
  el('content').innerHTML = '<div class="spinner"></div>';
  // Xe: lấy từ bảng xe (nguồn sự thật), lọc theo HV đang ở bằng CÙNG bộ isOccupying như dashboard
  // → totalVeh ở đây == "Xe đang gửi" ở Tổng quan; dùng CHUNG cho KPI, pill và danh sách (tránh 3 số khác nhau)
  const occIds = new Set(occ.map(s => s.id));
  let allVeh = []; try { allVeh = await API.vehicles(); } catch (e) { return renderViewError('services', e); } // BL-22: lỗi tải xe -> khối lỗi, KHÔNG hiện "0 xe" giả
  const veh = allVeh.filter(v => occIds.has(v.student_id)).sort((a, b) => (a.room_name || '').localeCompare(b.room_name || '', 'vi'));
  const totalVeh = veh.length;
  el('topActions').innerHTML = '';
  const svcCard = (ico, cls, headline, sub) => `<div class="kpi"><span class="ic ${cls}">${ico}</span><div><div class="v">${headline}</div><div class="l">${sub}</div></div></div>`;
  const pill = (k, ico, label) => `<button class="btn sm ${svcTab === k ? 'pri' : ''}" data-act="svcGo" data-args='["${k}"]' aria-pressed="${svcTab === k}">${ico} ${label}</button>`;   // BL-69: bỏ (N) — số đã có ở thẻ KPI
  el('content').innerHTML = `
    <div class="kpis">
      ${svcCard(IC.washer, 'ic-blue', `${washUsers.length}<span class="muted" style="font-size:14px;font-weight:600"> HV</span>`, `Máy giặt · ${money(washUsers.length * washFee)}/tháng · đơn giá ${money(washFee)}`)}
      ${svcCard(IC.bike, 'ic-brand', `${totalVeh}<span class="muted" style="font-size:14px;font-weight:600"> xe</span>`, `Gửi xe · ${money(totalVeh * parkFee)}/tháng · đơn giá ${money(parkFee)}`)}
    </div>
    <div class="pill-row">
      ${pill('washing', IC.washer, 'Máy giặt', washUsers.length)}
      ${pill('parking', IC.bike, 'Gửi xe', totalVeh)}
    </div>
    <div id="svcBody"><div class="spinner"></div></div>`;
  // Đề nghị học viên tự gửi ở cổng của mình — hỏng thì báo trong khối, không chặn phần còn lại.
  let dnHV = [], loiHV = '';
  try { dnHV = (await API.serviceRequests('pending', svcTab === 'parking' ? 'parking' : 'washing')).rows || []; }
  catch (e) { loiHV = (e && e.message) || 'Không tải được đề nghị của học viên'; }
  const khoiHV = dvAdminPanel(dnHV, loiHV, svcTab === 'parking' ? 'parking' : 'washing');
  if (svcTab === 'parking') {
    window._detailVehicles = allVeh;   // vehicleForm tra lại bản ghi khi bấm sửa
    // BL-120: đề nghị sửa biển của an ninh, báo cáo bãi xe, bản chốt hôm nay — phần này hỏng vẫn vẽ bảng xe.
    let deNghi = [], baoCao = [], cb = null, loiPk = '';
    try {
      const [dn, bc, al] = await Promise.all([API.plateRequests('pending'), API.parkingReportsAdmin(pkAdminLoc), API.parkingAlerts()]);
      deNghi = dn.rows || []; baoCao = bc.rows || []; cb = al;
      // Vừa xem/xử lý xong một báo cáo thì chuông phải giảm theo — trước đây số mới chỉ nằm ở biến
      // cục bộ, ST.pkAlerts giữ số cũ tới lượt poll sau.
      if (al) { ST.pkAlerts = al; updateNotif(); }
    } catch (e) { loiPk = (e && e.message) || 'Không tải được phần bãi xe'; }
    // Vừa chuyển phòng: hiện "cũ → mới" cùng nguồn với màn an ninh.
    const phongXe = v => `${v.prev_room_name ? `<span class="muted" title="Chuyển phòng từ ${fmtDate(v.moved_on)}">${esc(v.prev_room_name)} ${IC.chevronRight} </span>` : ''}${esc(v.room_name || '—')}`;
    el('svcBody').innerHTML = `${khoiHV}${loiPk ? `<div class="bang-tin" style="border-color:var(--red)">${IC.alert} <span>Phần bãi xe (đề nghị sửa biển, báo cáo an ninh) chưa tải được: ${esc(loiPk)}</span>
      <button class="btn sm" data-act="viewServices" style="margin-left:8px">${IC.refresh} Thử lại</button></div>` : pkAdminPanels(deNghi, baoCao, cb)}
      <div class="panel"><div class="hd"><h2>${IC.bike} Gửi xe — HV đang ở (<span id="vehCount">${totalVeh}</span> xe)</h2>
      <div class="search"><span class="i">${IC.search}</span><input id="vs" placeholder="Tìm biển số, loại, chủ xe, phòng…" value="${esc(vehSearch)}"></div>
      <button class="btn sm" data-act="pkBaoCaoForm">${IC.history} Lịch sử gửi xe</button>
      <button class="btn sm pri" data-act="vehicleForm" data-args='[0, 0]'>${IC.plus} Thêm xe</button></div>
      <div class="table-wrap card-tbl">${totalVeh ? `<table><thead><tr><th>Biển số</th><th>Loại xe</th><th>Mã dán</th><th>Chủ xe</th><th>Phòng</th><th>Hiệu lực</th><th></th></tr></thead><tbody>
        ${veh.map(v => `<tr data-s="${esc((v.plate + ' ' + (v.vehicle_type || '') + ' ' + (v.student_name || '') + ' ' + (v.room_name || '') + ' ' + (v.prev_room_name || '') + ' ' + (v.sticker || '')).toLowerCase())}">
          <td><strong>${esc(v.plate || '—')}</strong>${v.req_status === 'pending' ? `<div><span class="badge amber" style="font-size:10px" title="An ninh đề nghị sửa biển — duyệt ở bảng phía trên">Chờ duyệt: ${esc(v.req_plate)}</span></div>` : ''}</td><td data-label="Loại xe">${esc(v.vehicle_type || '—')}</td><td data-label="Mã dán">${esc(v.sticker || '—')}</td>
          <td data-label="Chủ xe"><a href="#" data-act="studentDetail" data-args='[${v.student_id}]'>${esc(v.student_name)}</a></td><td data-label="Phòng">${phongXe(v)}</td>
          <td data-label="Hiệu lực" class="muted" style="font-size:12px;white-space:nowrap">${fmtDate(v.from_date)} → ${v.to_date ? fmtDate(v.to_date) : 'còn gửi'}</td>
          <td class="num"><div class="rowbtns" style="justify-content:flex-end">
            <button class="btn sm ghost" title="Sửa xe" data-act="vehicleForm" data-args='[${v.id}, ${v.student_id}]'>${IC.pencil}</button>
            <button class="btn sm ghost" title="Xoá hẳn (nhập nhầm)" data-act="delVehicle" data-args='[${v.id}, ${v.student_id}]'>${IC.trash}</button>
          </div></td>
        </tr>`).join('')}
        ${hangKhongKhop('xe', 7)}
      </tbody></table>` : `<div class="empty">${trongChuaCo('xe nào đang gửi')} Bấm <strong>Thêm xe</strong>.</div>`}</div></div>`;
    const vs = el('vs'); if (vs) { vs.addEventListener('input', () => { vehSearch = vs.value; syncFilterUrl(); }); attachRowSearch(vs, 'vehCount'); }
  } else {
    // BL-120 cùng luật: an ninh gửi đề nghị, duyệt ở đây mới vào danh sách máy giặt.
    let dnGiat = [], loiBC = '';
    try { dnGiat = (await API.washingRequests('pending')).rows || []; }
    catch (e) { loiBC = (e && e.message) || 'Không tải được đề nghị của an ninh'; }
    el('svcBody').innerHTML = `${khoiHV}
      ${loiBC ? `<div class="bang-tin" style="border-color:var(--red)">${IC.alert} <span>Phần đề nghị đăng ký máy giặt chưa tải được: ${esc(loiBC)}</span></div>`
        : dnGiat.length ? `<div class="panel" id="wq_panel"><div class="hd"><h2>${IC.washer} Đề nghị đăng ký máy giặt từ an ninh (${dnGiat.length})</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Học viên</th><th>Phòng</th><th>Ngày gửi</th><th>Ghi chú</th><th>Người gửi</th><th></th></tr></thead><tbody>
            ${dnGiat.map(q => `<tr>
              <td data-label="Học viên"><a href="#" data-act="studentDetail" data-args='[${q.student_id}]'><strong>${esc(q.student_name)}</strong></a>${q.student_code ? `<div class="muted" style="font-size:11px">${esc(q.student_code)}</div>` : ''}</td>
              <td data-label="Phòng">${esc(q.room_name || '—')}</td>
              <td data-label="Ngày gửi">${fmtDate(q.seen_date)}</td>
              <td data-label="Ghi chú" class="muted">${esc(q.note || '—')}</td>
              <td data-label="Người gửi" class="muted" style="font-size:12px">${esc(q.requested_by || '—')}</td>
              <td class="num"><div class="rowbtns" style="justify-content:flex-end;gap:4px">
                <button class="btn sm green" data-act="washReqDuyet" data-args='[${q.id}]'>${IC.check} Duyệt</button>
                <button class="btn sm danger" data-act="washReqTuChoiForm" data-args='[${q.id}]'>Từ chối</button>
              </div></td></tr>`).join('')}
          </tbody></table></div>
          <div class="pad"><div class="hint">${IC.info}<span>Duyệt là thêm học viên vào danh sách máy giặt, ngày đăng ký ghi nhận từ hôm nay. Phí máy giặt tính theo kỳ của phiếu báo, không chia theo ngày đăng ký.</span></div></div>
        </div>` : ''}
      <div class="panel"><div class="hd"><h2>${IC.washer} Máy giặt</h2><button class="btn sm pri" data-act="addWashingForm">${IC.plus} Thêm học viên</button></div>
      <div class="table-wrap card-tbl">${washUsers.length ? `<table><thead><tr><th>Học viên</th><th>Phòng</th><th>Ngày đăng ký</th><th>Mã pháp nhân</th><th></th></tr></thead><tbody>
        ${washUsers.map(s => `<tr><td><a href="#" data-act="studentDetail" data-args='[${s.id}]'><strong>${esc(s.name)}</strong></a>${s.code ? `<div class="muted" style="font-size:11px">${esc(s.code)}</div>` : ''}</td><td data-label="Phòng">${s.room_id ? `<a href="#" data-act="roomDetail" data-args='[${s.room_id}]'>${esc(s.room_name || '—')}</a>` : esc(s.room_name || '—')}</td><td data-label="Ngày đăng ký">${s.washing_from ? fmtDate(s.washing_from) : '<span class="muted">chưa rõ</span>'}</td><td data-label="Mã pháp nhân">${legalEntityCell(s.gender)}</td><td class="num"><button class="btn sm ghost" data-act="toggleWashing" data-args='[${s.id}, false]'>${IC.pause} Ngưng</button></td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">${trongChuaCo('học viên dùng máy giặt')} Bấm <strong>Thêm học viên</strong>.</div>`}</div></div>`;
  }
  syncFilterUrl(); // BL-17: tab dịch vụ (washing/parking) + tìm xe lên URL
}

/* ---- BL-120: phần bãi xe ở màn Gửi xe — bản chốt hôm nay, đề nghị sửa biển, báo cáo của an ninh ---- */
let pkAdminLoc = 'new';   // bộ lọc báo cáo an ninh: 'new' (chưa xem, mọi ngày) | 'all' (30 ngày gần đây)
function pkAdminLocGo(t) { pkAdminLoc = t; viewServices(); }
function pkAdminPanels(deNghi, baoCao, cb) {
  const gio = iso => { const t = new Date(iso); return isNaN(t) ? '' : `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
  const luc = iso => iso ? `${fmtDate(String(iso).slice(0, 10))} ${gio(iso)}` : '—';
  const mailChu = x => x.mail_sent_at ? `${IC.mail} email đã gửi ${gio(x.mail_sent_at)}${x.mail_to ? ' tới ' + esc(x.mail_to) : ''}`
    : x.mail_error ? `<span style="color:var(--red-ink)" title="${esc(x.mail_error)}">${IC.alert} email chưa gửi được</span>` : `${IC.hourglass} đang gửi email…`;
  const dailies = (cb && cb.dailies) || [], vangLau = (cb && cb.vang_lau) || [];
  const LOAI = { stranger: ['Xe lạ', 'red'], absent_long: ['Vắng nhiều ngày', 'amber'], other: ['Khác', 'gray'] };
  const TT = { new: ['Mới', 'blue'], seen: ['Đã xem', 'amber'], done: ['Đã xử lý', 'green'] };
  const bd = (m, k) => { const [t, c] = m[k] || [k, 'gray']; return `<span class="badge ${c}">${esc(t)}</span>`; };

  const oNgay = `<div class="panel"><div class="hd"><h2>${IC.bike} Bãi xe hôm nay${cb ? ` — ${cb.co_mat} có · ${cb.vang} vắng · ${cb.chua_danh} chưa kiểm / ${cb.tong} xe` : ''}</h2></div><div class="pad">
    ${dailies.length ? dailies.map(x => `<div class="bang-tin" style="border-color:var(--green)">${IC.checkCircle} <span>${x.facility_name ? `<strong>${esc(x.facility_name)}</strong> · ` : ''}An ninh <strong>${esc(x.closed_by)}</strong> chốt lúc <strong>${gio(x.closed_at)}</strong> · ${x.co_mat} có · ${x.vang} vắng · ${x.so_bao_cao} báo cáo${x.vang_lau ? ` · <strong>${x.vang_lau}</strong> xe vắng lâu` : ''}<br>${mailChu(x)}</span></div>`).join('')
    : cb && cb.chua_chot ? `<div class="bang-tin" style="border-color:var(--red);color:var(--red-ink)">${IC.alert} <span>Đã quá <strong>${esc(cb.alert_time)}</strong> mà an ninh <strong>chưa chốt bãi xe</strong> hôm nay.</span></div>`
      : `<div class="muted" style="font-size:13px">${IC.hourglass} An ninh chưa chốt lượt kiểm hôm nay${cb ? ` (chuông sẽ nhắc sau ${esc(cb.alert_time)})` : ''}.</div>`}
    ${vangLau.length ? `<div class="bang-tin" style="border-color:var(--red);margin-top:8px">${IC.alert} <span><strong>${vangLau.length}</strong> xe vắng liên tiếp từ ${cb.alert_days} ngày trở lên — hỏi chủ xe, xe không còn gửi thì ngưng để thôi tính phí và an ninh thôi điểm danh.</span></div>
      <div class="table-wrap card-tbl" id="pk_panel_vanglau"><table><thead><tr><th>Biển số</th><th>Chủ xe</th><th>Phòng</th><th class="num">Vắng liên tiếp</th><th></th></tr></thead><tbody>
        ${vangLau.map(x => `<tr>
          <td data-label="Biển số"><strong>${esc(x.plate || '—')}</strong></td>
          <td data-label="Chủ xe">${esc(x.student_name || '—')}</td>
          <td data-label="Phòng">${esc(x.room_name || '—')}</td>
          <td class="num" data-label="Vắng liên tiếp"><span class="badge red">${x.days} ngày</span></td>
          <td class="num"><div class="rowbtns" style="justify-content:flex-end;gap:4px">
            ${x.student_id ? `<button class="btn sm" data-act="studentDetail" data-args='[${x.student_id}]' title="Mở hồ sơ để lấy số điện thoại">${IC.user} Xem học viên</button>` : ''}
            <button class="btn sm" data-act="vehicleForm" data-args='[${x.vehicle_id}, ${x.student_id || 0}]' title="Mở hồ sơ xe, điền ngày ngưng gửi ở ô Đến ngày">${IC.pause} Ngưng gửi xe</button>
          </div></td></tr>`).join('')}
      </tbody></table></div>` : ''}
  </div></div>`;

  const oDeNghi = `<div class="panel" id="pk_panel_bien"><div class="hd"><h2>${IC.pencil} Đề nghị sửa biển số từ an ninh (${deNghi.length})</h2></div>
    <div class="table-wrap card-tbl">${deNghi.length ? `<table><thead><tr><th>Biển đang lưu</th><th>Biển đề nghị</th><th>Chủ xe</th><th>Phòng</th><th>Ghi chú</th><th>Người gửi</th><th></th></tr></thead><tbody>
      ${deNghi.map(q => `<tr>
        <td data-label="Biển đang lưu">${esc(q.plate_hien_tai || q.plate_cu || '—')}</td><td data-label="Biển đề nghị"><strong>${esc(q.plate_moi)}</strong></td>
        <td data-label="Chủ xe"><a href="#" data-act="studentDetail" data-args='[${q.student_id}]'>${esc(q.student_name || '—')}</a></td><td data-label="Phòng">${esc(q.room_name || '—')}</td>
        <td data-label="Ghi chú" class="muted">${esc(q.note || '—')}</td><td data-label="Người gửi" class="muted" style="font-size:12px">${esc(q.requested_by)}<div>${luc(q.requested_at)}</div></td>
        <td class="num"><div class="rowbtns" style="justify-content:flex-end">
          <button class="btn sm green" data-act="pkDuyetBien" data-args='[${q.id}]'>${IC.check} Duyệt</button>
          <button class="btn sm danger" data-act="pkTuChoiBienForm" data-args='[${q.id}]'>Từ chối</button>
        </div></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Không có đề nghị nào chờ duyệt.</div>'}</div></div>`;

  window._pkBaoCao = baoCao;   // pkGanXeForm tra lại biển số / nội dung của báo cáo khi bấm ghi xe
  const oBaoCao = `<div class="panel" id="pk_panel_baocao"><div class="hd"><h2>${IC.flag} Báo cáo bãi xe từ an ninh (${baoCao.length})</h2>
      <div class="toolbar"><button class="btn sm ${pkAdminLoc === 'new' ? 'pri' : ''}" data-act="pkAdminLocGo" data-args='["new"]' aria-pressed="${pkAdminLoc === 'new'}">Chưa xem</button>
      <button class="btn sm ${pkAdminLoc === 'all' ? 'pri' : ''}" data-act="pkAdminLocGo" data-args='["all"]' aria-pressed="${pkAdminLoc === 'all'}">30 ngày gần đây</button></div></div>
    <div class="table-wrap card-tbl">${baoCao.length ? `<table><thead><tr><th>Ngày</th><th>Loại</th><th>Biển số</th><th>Nội dung</th><th>Người gửi</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      ${baoCao.map(x => `<tr>
        <td data-label="Ngày" style="white-space:nowrap">${fmtDate(x.report_date)}</td><td data-label="Loại">${bd(LOAI, x.kind)}</td>
        <td data-label="Biển số"><strong>${esc(x.plate || '—')}</strong>${x.student_name ? `<div class="muted" style="font-size:11px">${esc(x.student_name)}${x.room_name ? ' · ' + esc(x.room_name) : ''}</div>` : ''}</td>
        <td data-label="Nội dung" class="muted">${esc(x.note || '—')}</td><td data-label="Người gửi" class="muted" style="font-size:12px">${esc(x.reported_by || '—')}</td>
        <td data-label="Trạng thái">${bd(TT, x.status)}${x.handled_by ? `<div class="muted" style="font-size:11px">${esc(x.handled_by)} · ${luc(x.handled_at)}</div>` : ''}</td>
        <td class="num"><div class="rowbtns" style="justify-content:flex-end">
          ${x.has_photo ? `<button class="btn sm ghost" title="Xem ảnh" data-act="pkXemAnhBaoCao" data-args='[${x.id}]'>${IC.search}</button>` : ''}
          ${x.kind === 'stranger' && !x.vehicle_id ? `<button class="btn sm pri" title="Xe này là của một học viên đang ở — ghi vào danh sách gửi xe" data-act="pkGanXeForm" data-args='[${x.id}]'>${IC.bike} Ghi vào danh sách</button>` : ''}
          ${x.status === 'new' ? `<button class="btn sm" data-act="pkBcTrangThai" data-args='[${x.id},"seen"]'>Đã xem</button>` : ''}
          ${x.status !== 'done' ? `<button class="btn sm green" data-act="pkBcTrangThai" data-args='[${x.id},"done"]'>${IC.check} Đã xử lý</button>` : ''}
        </div></td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">${pkAdminLoc === 'new' ? 'Không có báo cáo nào chưa xem.' : 'Không có báo cáo nào trong 30 ngày gần đây.'}</div>`}</div></div>`;
  return oNgay + oDeNghi + oBaoCao;
}
async function pkDuyetBien(id) {
  if (!(await xacNhan('Duyệt đề nghị này? Biển số trên hồ sơ xe sẽ đổi theo biển an ninh đọc được, có ghi nhật ký.', { dongY: 'Duyệt' }))) return;
  await guard(() => API.approvePlateRequest(id, ''));
  toast('Đã duyệt — hồ sơ xe đã đổi biển'); viewServices();
}
function pkTuChoiBienForm(id) {
  openModal(`
    <div class="mh"><h3>${IC.undo} Từ chối đề nghị sửa biển</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb"><div class="field" style="margin:0"><label>Lý do (an ninh sẽ thấy trên dòng xe) ${SAO}</label>
      <textarea id="pk_tc_note" rows="3" placeholder="VD: Đã đối chiếu cà vẹt, biển trên hồ sơ đúng"></textarea></div></div>
    <div class="mf"><button class="btn" data-act="modalBack">Hủy</button><button class="btn danger" data-act="pkTuChoiBienLuu" data-args='[${id}]'>Từ chối</button></div>`);
  setTimeout(() => el('pk_tc_note') && el('pk_tc_note').focus(), 50);
}
async function pkTuChoiBienLuu(id) {
  const note = el('pk_tc_note').value.trim();
  if (!note) return loiTaiO('pk_tc_note', 'Nhập lý do từ chối');
  await guard(() => API.rejectPlateRequest(id, note));
  closeModal(); toast('Đã từ chối đề nghị'); viewServices();
}
async function pkBcTrangThai(id, st) {
  await guard(() => API.parkingReportStatus(id, st, ''));
  toast(st === 'done' ? 'Đã đánh dấu xử lý xong' : 'Đã đánh dấu đã xem'); viewServices();
}
// Xe lạ hoá ra là xe của một HV đang ở: ghi thẳng vào danh sách gửi xe rồi đóng báo cáo — một lượt,
// không phải sang màn khác gõ lại biển số.
function pkGanXeForm(id) {
  const bc = (window._pkBaoCao || []).find(x => x.id === id) || {};
  const dsHV = ST.students.filter(isOccupying)
    .sort((a, b) => (a.room_name || '').localeCompare(b.room_name || '', 'vi') || (a.name || '').localeCompare(b.name || '', 'vi'));
  if (!dsHV.length) return toast('Không có học viên đang ở để gán xe', 'info');
  openModal(`
    <div class="mh"><h3>${IC.bike} Ghi xe lạ vào danh sách gửi xe</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="field"><label>Chủ xe ${SAO}</label><select id="pg_stu">
        <option value="">— Chọn học viên đang ở —</option>
        ${dsHV.map(x => `<option value="${x.id}">${x.room_name ? esc(x.room_name) + ' — ' : ''}${esc(x.name)}${x.code ? ' (' + esc(x.code) + ')' : ''}</option>`).join('')}
      </select></div>
      <div class="grid2">
        <div class="field"><label>Biển số ${SAO}</label><input id="pg_plate" value="${esc(bc.plate || '')}" placeholder="63-B4 508.58" autocapitalize="characters"></div>
        <div class="field"><label>Loại xe</label><input id="pg_type" placeholder="Xe số / Xe ga…"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Mã dán xe</label><input id="pg_sticker" placeholder="201.1"></div>
        <div class="field"><label>Ghi chú</label><input id="pg_note" value="${esc(bc.note || '')}"></div>
      </div>
      <div class="hint">${IC.bulb} Hiệu lực lấy theo lượt ở của học viên (nhận phòng → trả phòng), sửa được ở màn Gửi xe.
        Phí gửi xe ${money(ST.settings.parking_fee)}/xe/tháng tính từ đó. Lưu xong báo cáo này chuyển sang <strong>Đã xử lý</strong>.</div>
    </div>
    <div class="mf"><button class="btn" data-act="modalBack">Hủy</button><button class="btn pri" data-act="pkGanXeLuu" data-args='[${id}]'>Lưu</button></div>`);
  setTimeout(() => el('pg_stu') && el('pg_stu').focus(), 50);
}
async function pkGanXeLuu(id) {
  const sid = +((el('pg_stu') || {}).value || 0);
  if (!sid) return loiTaiO('pg_stu', 'Chọn chủ xe');
  const plate = el('pg_plate').value.trim();
  if (!plate) return loiTaiO('pg_plate', 'Nhập biển số');
  await guard(() => API.parkingReportAssign(id, {
    student_id: sid, plate, vehicle_type: el('pg_type').value.trim(),
    sticker: el('pg_sticker').value.trim(), note: el('pg_note').value.trim(),
  }));
  await refreshCache(); closeModal(); toast('Đã ghi ' + plate + ' vào danh sách gửi xe'); viewServices();
}
function addWashingForm() {
  const avail = ST.students.filter(s => !s.uses_washing && isOccupying(s)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
  if (!avail.length) return toast('Mọi học viên đang ở đều đã dùng máy giặt', 'info');
  const opts = avail.map(s => `<option value="${s.id}">${esc(s.name)}${s.code ? ' (' + esc(s.code) + ')' : ''}${s.room_name ? ' — ' + esc(s.room_name) : ''}</option>`).join('');
  openModal(`
    <div class="mh"><h3>${IC.washer} Thêm học viên dùng máy giặt</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="field"><label>Học viên ${SAO}</label><select id="wash_stu"><option value="">— Chọn học viên đang ở —</option>${opts}</select></div>
      <div class="hint">${IC.info} Phí máy giặt ${money(+ST.settings.washing_fee || 0)}/tháng sẽ được tính vào phiếu báo từ kỳ kế tiếp.</div>
    </div>
    <div class="mf"><button class="btn" data-act="modalBack">Hủy</button><button class="btn pri" data-act="washAdd">Thêm</button></div>`);
}
async function toggleWashing(id, on) {
  if (!id) return;
  if (!on && !(await xacNhan(`Ngưng dịch vụ máy giặt cho ${(studentById(id) || {}).name || 'học viên này'}?`, { dongY: 'Ngưng', nguyHiem: true }))) return;
  await guard(() => API.setWashing(id, on));
  await napLai('students'); await luuXongVeLai(veLaiNen);
  toast(on ? 'Đã thêm HV dùng máy giặt' : 'Đã ngưng máy giặt');
}
async function washReqDuyet(id) {
  if (!confirm('Duyệt đề nghị này? Học viên sẽ vào danh sách máy giặt và được tính phí máy giặt từ kỳ phiếu kế tiếp.')) return;
  await guard(() => API.washingRequestApprove(id, ''));
  await napLai('students');
  toast('Đã duyệt — đã thêm vào danh sách máy giặt'); viewServices();
}
function washReqTuChoiForm(id) {
  openModal(`
    <div class="mh"><h3>${IC.undo} Từ chối đề nghị đăng ký máy giặt</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb"><div class="field" style="margin:0"><label>Lý do (an ninh sẽ thấy ở thẻ Máy giặt) *</label>
      <textarea id="wq_tc_note" rows="3" placeholder="VD: Học viên đã đổi ý, không đăng ký nữa"></textarea></div></div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn danger" data-act="washReqTuChoiLuu" data-args='[${id}]'>Từ chối</button></div>`);
  setTimeout(() => el('wq_tc_note') && el('wq_tc_note').focus(), 50);
}
async function washReqTuChoiLuu(id) {
  const note = el('wq_tc_note').value.trim();
  if (!note) return toast('Nhập lý do từ chối', 'err');
  await guard(() => API.washingRequestReject(id, note));
  closeModal(); toast('Đã từ chối đề nghị'); viewServices();
}
/* ---- Đề nghị học viên tự gửi ở cổng của mình: duyệt là áp từ kỳ sau theo ngày gửi ---- */
function dvAdminPanel(ds, loi, dv) {
  const ten = dv === 'parking' ? 'gửi xe' : 'máy giặt';
  if (loi) return `<div class="bang-tin" style="border-color:var(--red)">${IC.alert} <span>Phần đề nghị ${ten} của học viên chưa tải được: ${esc(loi)}</span></div>`;
  if (!ds.length) return '';
  return `<div class="panel" id="dv_panel_${dv}"><div class="hd"><h2>${dv === 'parking' ? IC.bike : IC.washer} Đề nghị ${ten} từ học viên (${ds.length})</h2></div>
    <div class="table-wrap card-tbl"><table><thead><tr><th>Học viên</th><th>Phòng</th><th>Đề nghị</th><th>Áp dụng</th><th>Ghi chú</th><th>Ngày gửi</th><th></th></tr></thead><tbody>
      ${ds.map(q => `<tr>
        <td data-label="Học viên"><a href="#" data-act="studentDetail" data-args='[${q.student_id}]'><strong>${esc(q.student_name)}</strong></a>${q.student_code ? `<div class="muted" style="font-size:11px">${esc(q.student_code)}</div>` : ''}</td>
        <td data-label="Phòng">${esc(q.room_name || '—')}</td>
        <td data-label="Đề nghị">${q.action === 'register' ? '<span class="badge blue">Đăng ký</span>' : '<span class="badge amber">Hủy</span>'}${q.plate || q.vehicle_plate
          ? ` <strong>${esc(q.plate || q.vehicle_plate)}</strong>${q.vehicle_type ? ` <span class="muted">· ${esc(q.vehicle_type)}</span>` : ''}` : ''}</td>
        <td data-label="Áp dụng">${q.action === 'register' ? 'tính phí từ' : 'tính đến hết'} ${fmtDate(q.effective_date)}</td>
        <td data-label="Ghi chú" class="muted">${esc(q.note || '—')}</td>
        <td data-label="Ngày gửi" class="muted" style="font-size:12px">${fmtDate(String(q.requested_at).slice(0, 10))}</td>
        <td class="num"><div class="rowbtns" style="justify-content:flex-end;gap:4px">
          <button class="btn sm green" data-act="dvDuyet" data-args='[${q.id}]'>${IC.check} Duyệt</button>
          <button class="btn sm danger" data-act="dvTuChoiForm" data-args='[${q.id}]'>Từ chối</button>
        </div></td></tr>`).join('')}
    </tbody></table></div>
    <div class="pad"><div class="hint">${IC.info}<span>Ngày áp dụng chốt theo ngày học viên gửi: đăng ký tính phí từ ngày 1 tháng sau, hủy vẫn tính hết tháng gửi. Duyệt xong, phiếu chưa thu từ kỳ đó được tính lại.</span></div></div>
  </div>`;
}
async function dvDuyet(id) {
  if (!(await xacNhan('Duyệt đề nghị này? Áp dụng đúng ngày ghi trên dòng, phiếu chưa thu từ kỳ đó được tính lại.', { dongY: 'Duyệt' }))) return;
  await guard(() => API.serviceRequestApprove(id, ''));
  await napLai('students'); refreshNotifCounts();
  toast('Đã duyệt đề nghị'); viewServices();
}
function dvTuChoiForm(id) {
  openModal(`
    <div class="mh"><h3>${IC.undo} Từ chối đề nghị của học viên</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb"><div class="field" style="margin:0"><label>Lý do (học viên sẽ thấy ở cổng học viên) ${SAO}</label>
      <textarea id="dv_tc_note" rows="3" placeholder="VD: Bãi xe đã đủ chỗ, đăng ký lại tháng sau"></textarea></div></div>
    <div class="mf"><button class="btn" data-act="modalBack">Hủy</button><button class="btn danger" data-act="dvTuChoiLuu" data-args='[${id}]'>Từ chối</button></div>`);
  setTimeout(() => el('dv_tc_note') && el('dv_tc_note').focus(), 50);
}
async function dvTuChoiLuu(id) {
  const note = el('dv_tc_note').value.trim();
  if (!note) return loiTaiO('dv_tc_note', 'Nhập lý do từ chối');
  await guard(() => API.serviceRequestReject(id, note));
  closeModal(); refreshNotifCounts(); toast('Đã từ chối đề nghị'); viewServices();
}

/* ---------- BÁO CÁO DOANH THU ---------- */
let revYear = curMonth().slice(0, 4);
// Thẻ "Tổng tiền đã lập phiếu <năm>" ở Điều hành phải mở đúng NĂM đó, không giữ năm của lần xem trước.
function doanhThuGo(nam) { if (nam) revYear = String(nam); adminGo('revenue'); }
const REV_SERVICES = [
  ['room', 'Phí lưu trú (tiền phòng)', 'bravo_room'],
  ['electric', 'Phí điện sinh hoạt', 'bravo_electric'],
  ['water', 'Phí nước sinh hoạt', 'bravo_water'],
  ['service', 'Phí dịch vụ chung', 'bravo_service'],
  ['washing', 'Phí máy giặt', 'bravo_washing'],
  ['parking', 'Phí gửi xe máy', 'bravo_parking'],
  ['other', 'Khoản khác', 'bravo_other'],
  ['deposit', 'Tiền cọc', 'bravo_deposit'],
];
// Hai khoản này thường bằng 0 — chỉ chiếm cột khi kỳ nào đó thật sự có phát sinh.
const REV_AN_KHI_0 = ['other', 'deposit'];
let _revData = [];   // doanh thu nam hien hanh — de exportRevenue() tu lay lai (khong nhoi vao data-args)
async function viewRevenue() {
  el('content').innerHTML = '<div class="spinner"></div>';
  let years, data;
  try {
    years = await API.revenueYears();
    if (years.length && !years.includes(revYear)) revYear = years[0];
    data = await API.revenue(revYear);
  } catch (e) { return renderViewError('revenue', e); }
  _revData = data;
  const sum = k => data.reduce((a, m) => a + (+m[k] || 0), 0);
  // Cọc là tiền GIỮ HỘ (trả lại khi trả phòng) — để riêng, không cộng vào doanh thu.
  const cot = REV_SERVICES.filter(([k]) => k !== 'deposit' && (!REV_AN_KHI_0.includes(k) || sum(k)));
  const coc = sum('deposit');
  const grand = sum('total') - coc;
  const thangCuoi = data.length ? data[data.length - 1].month : '';
  const dtThang = m => (+m.total || 0) - (+m.deposit || 0);

  const shortSvc = l => l.replace('Phí ', '').replace(' sinh hoạt', '').replace(' (tiền phòng)', '');
  // Bảng theo tháng
  const monthRows = data.map(m => `<tr>
    <td><strong>${m.month.slice(5)}/${m.month.slice(0, 4)}</strong></td>
    ${cot.map(([k, l]) => `<td class="num" data-label="${shortSvc(l)}">${+m[k] ? moneyN(m[k]) : '<span class="muted">—</span>'}</td>`).join('')}
    <td class="num" data-label="Doanh thu"><strong>${moneyN(dtThang(m))}</strong></td>
    <td class="num rev-coc" data-label="Cọc giữ hộ">${+m.deposit ? moneyN(m.deposit) : '<span class="muted">—</span>'}</td>
  </tr>`).join('');

  // Cơ cấu doanh thu (BL-65: chuyển từ màn Tiền phòng sang đây — đúng nơi phân tích doanh thu)
  const REV_COLOR = { room: 'var(--brand)', electric: '#5f7ea3', water: '#4f8f63', service: '#b5822f', washing: '#9a7bb0', parking: '#c25545', other: '#8a8a8a', deposit: '#6f8f7c' };
  const revMax = Math.max(1, ...REV_SERVICES.map(([k]) => sum(k)));
  const revComp = data.length ? `<div class="panel"><div class="hd"><h2>${IC.coins} Cơ cấu doanh thu — năm ${revYear}</h2><span class="muted" style="font-size:12px">Tỉ trọng theo khoản · không gồm cọc giữ hộ</span></div>
    <div class="pad rev-comp">
      ${cot.map(([k, l]) => { const amt = sum(k); return `<div class="rev-row">
        <div class="rev-lbl">${shortSvc(l)}</div>
        <div class="rev-track"><div class="rev-fill" style="width:${Math.round(amt / revMax * 100)}%;background:${REV_COLOR[k] || 'var(--brand)'}"></div></div>
        <div class="rev-amt"><strong>${money(amt)}</strong> <span class="muted">${Math.round(amt / (grand || 1) * 100)}%</span></div>
      </div>`; }).join('')}
    </div></div>` : '';

  el('content').innerHTML = `
    <div class="cards">
      <div class="stat"><div class="l">${IC.calendar} Năm</div><div class="v sm"><select id="ry" style="font-size:15px;font-weight:600;padding:6px 8px">${(years.length ? years : [revYear]).map(y => `<option value="${y}" ${y === revYear ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
      <div class="stat"><div class="l">${IC.trendingUp} Tổng tiền đã lập phiếu</div><div class="v sm">${money(grand)}
        <div class="sub2" style="font-weight:500">${thangCuoi ? `đã lập tới tháng ${thangCuoi.slice(5)}/${thangCuoi.slice(0, 4)}` : 'chưa lập phiếu nào'}${coc ? ` · cọc giữ hộ ${money(coc)} (không tính doanh thu)` : ''}</div></div></div>
    </div>

    ${revComp}
    <div class="panel"><div class="hd"><h2>${IC.trendingUp} Tiền đã lập phiếu theo tháng — năm ${revYear}</h2>
      <span class="muted" style="font-size:12px">Đơn vị: đồng</span>
      <button class="btn sm" data-act="exportRevenue">${IC.download} Xuất CSV (mở bằng Excel)</button></div>
      <div class="table-wrap card-tbl">
      ${data.length ? `<table><thead><tr><th>Tháng</th>
        ${cot.map(([, l]) => `<th class="num">${shortSvc(l)}</th>`).join('')}
        <th class="num">Doanh thu</th>
        <th class="num rev-coc" title="Tiền giữ hộ, trả lại khi học viên trả phòng — không cộng vào doanh thu">Cọc giữ hộ</th></tr></thead>
        <tbody>${monthRows}
          <tr style="background:var(--bg2)"><td><strong>Cả năm</strong></td>
          ${cot.map(([k, l]) => `<td class="num" data-label="${shortSvc(l)}"><strong>${moneyN(sum(k))}</strong></td>`).join('')}
          <td class="num" data-label="Doanh thu"><strong>${moneyN(grand)}</strong></td>
          <td class="num rev-coc" data-label="Cọc giữ hộ"><strong>${coc ? moneyN(coc) : '—'}</strong></td></tr>
        </tbody></table>` : `<div class="empty">${trongChuaCo('phiếu báo nào trong năm này')}</div>`}
      </div>
      <div class="pad"><div class="hint">${IC.info}<span>Đây là tiền <strong>đã ghi trên phiếu báo</strong>, chưa trừ phần chưa thu — không phải tiền đã về két.
        Cột <strong>Doanh thu</strong> = các khoản bên trái <strong>đã trừ khoản giảm</strong> (phòng trưởng, giảm %) nên nhỏ hơn tổng cộng ngang;
        <strong>cọc giữ hộ</strong> để riêng vì sẽ trả lại khi học viên trả phòng.</span></div></div>
    </div>

    <div class="panel"><div class="hd"><h2>${IC.receipt} Tổng theo dịch vụ (đối chiếu Bravo) — năm ${revYear}</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Mã SP Bravo</th><th>Loại phí</th><th>Dịch vụ</th><th class="num">Tiền phiếu cả năm (đ)</th></tr></thead><tbody>
        ${REV_SERVICES.map(([k, l, codeKey]) => { const v = sum(k); if (!v && REV_AN_KHI_0.includes(k)) return ''; return `<tr>
          <td><strong>${esc(ST.settings[codeKey] || '—')}</strong></td>
          <td class="muted">${esc(ST.settings.bravo_fee_type || '')}</td>
          <td>${l}</td><td class="num">${moneyN(v)}</td></tr>`; }).join('')}
        <tr style="background:var(--bg2)"><td colspan="3"><strong>Tổng tiền phiếu</strong> <span class="muted" style="font-weight:500">(gồm cả cọc)</span></td><td class="num"><strong>${moneyN(grand + coc)}</strong></td></tr>
      </tbody></table></div>
      <div class="pad muted" style="font-size:12.5px">${IC.bulb} Mã sản phẩm Bravo chỉnh trong <a href="#" data-act="adminGo" data-args='["settings"]'>Cài đặt</a>. Số liệu = tổng tiền đã lập phiếu báo, gồm cả tiền cọc thu ở kỳ nhận phòng. Thu tiền thực tế do Bravo quản lý. Số HV xuất cảnh xem ở <a href="#" data-act="adminGo" data-args='["exec"]'>Điều hành</a>.</div>
    </div>`;
  const ry = el('ry'); if (ry) ry.onchange = e => { revYear = e.target.value; viewRevenue(); };
  syncFilterUrl(); // BL-17: năm (đã nắn theo years có dữ liệu) lên URL
}
function exportRevenue() {
  const data = _revData;
  // Cùng luật với bảng trên màn: cọc là cột RIÊNG, không cộng vào Doanh thu.
  const svc = REV_SERVICES.filter(([k]) => k !== 'deposit');
  const head = ['Thang', ...svc.map(x => x[1]), 'Doanh thu', 'Coc giu ho'];
  const dt = m => (+m.total || 0) - (+m.deposit || 0);
  const rows = data.map(m => [m.month, ...svc.map(([k]) => +m[k] || 0), dt(m), +m.deposit || 0]);
  const sum = k => data.reduce((a, m) => a + (+m[k] || 0), 0);
  rows.push(['Ca nam', ...svc.map(([k]) => sum(k)), sum('total') - sum('deposit'), sum('deposit')]);
  const csv = '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `doanh-thu-${revYear}.csv`; a.click();
  toast('Đã xuất file CSV');
}

/* ---------- NHẬT KÝ HỆ THỐNG (AUDIT LOG) ---------- */
const AUDIT_RES = {
  students: 'Học viên', rooms: 'Phòng', vehicles: 'Xe', assets: 'Tài sản',
  invoices: 'Phiếu báo', electric: 'Điện', violations: 'Vi phạm', applications: 'Đơn đăng ký',
  requests: 'Yêu cầu hỗ trợ', settings: 'Cài đặt', facilities: 'Cơ sở', media: 'Ảnh giới thiệu',
  admin: 'Tài khoản', logs: 'Lịch sử ra/vào', reports: 'Báo cáo', me: 'Học viên (tự thao tác)',
};
const AUDIT_SUB = {
  checkin: 'Nhận phòng', checkout: 'Trả phòng', transfer: 'Chuyển phòng', approve: 'Duyệt đơn',
  reject: 'Từ chối', confirm: 'Xác nhận trả phòng', notify: 'Gửi email nhà trường', restore: 'Khôi phục',
  generate: 'Lập phiếu báo hàng loạt', 'generate-one': 'Lập phiếu báo 1 học viên', bulk: 'Lưu chỉ số điện',
  'mark-paid': 'Đánh dấu đã thu', status: 'Đổi trạng thái', recalc: 'Tính lại phiếu báo',
  password: 'Đặt lại mật khẩu', account: 'Cấp tài khoản', deposit: 'Cập nhật cọc',
  'deposit-settle': 'Tất toán cọc', note: 'Ghi chú', types: 'Loại vi phạm', users: 'Tài khoản NV',
  damage: 'Báo hư hỏng', plate: 'Đề nghị sửa biển số', 'plate-requests': 'Đề nghị sửa biển', 'parking-reports': 'Báo cáo bãi xe',
  finish: 'Chốt bãi xe', mark: 'Điểm danh xe', stranger: 'Báo xe lạ',
};
function auditLabel(method, pathStr) {
  const seg = String(pathStr || '').replace(/^\/api\//, '').split('/').filter(Boolean);
  const res = AUDIT_RES[seg[0]] || seg[0] || '—';
  const tail = seg.slice(1).filter(x => !/^\d+$/.test(x));
  const key = tail[tail.length - 1];
  if (key && AUDIT_SUB[key]) return AUDIT_SUB[key] + ' · ' + res;
  const verb = method === 'POST' ? 'Tạo mới' : (method === 'PUT' || method === 'PATCH') ? 'Cập nhật' : method === 'DELETE' ? 'Xóa' : method;
  return verb + ' · ' + res;
}
const AUDIT_MCLR = { POST: 'green', PUT: 'amber', PATCH: 'amber', DELETE: 'red' };
const AUDIT_MVERB = { POST: 'Thêm', PUT: 'Sửa', PATCH: 'Sửa', DELETE: 'Xóa' };  // BL-32: bỏ jargon HTTP method
// Tên trường hiển thị trong nhật ký (thay vì JSON thô của lập trình viên)
const AUDIT_FIELD = {
  name: 'Họ tên', code: 'Mã HV', phone: 'SĐT', parent_phone: 'SĐT phụ huynh', gender: 'Giới tính',
  birth_date: 'Ngày sinh', class_name: 'Lớp', room_id: 'Phòng', check_in_date: 'Ngày vào', check_out_date: 'Ngày trả',
  status: 'Trạng thái', note: 'Ghi chú', admin_note: 'Ghi chú QL', uses_washing: 'Máy giặt', rental_type: 'Hình thức thuê',
  residency_status: 'Tạm trú', contract_status: 'Trạng thái HĐ', contract_no: 'Số HĐ', contract_date: 'Ngày ký HĐ',
  deposit_amount: 'Tiền cọc', deposit_status: 'Trạng thái cọc', deposit_date: 'Ngày đóng cọc',
  hotline: 'Hotline', dorm_name: 'Tên KTX', capacity: 'Sức chứa', monthly_fee: 'Giá phòng', hang: 'Hạng',
  room_type: 'Loại phòng', month: 'Kỳ', total: 'Tổng tiền', reason: 'Lý do', desired_date: 'Ngày mong muốn',
  actual_date: 'Ngày thực tế', title: 'Nội dung', description: 'Mô tả', severity: 'Mức độ', type_name: 'Loại vi phạm',
  student_id: 'Học viên', plate: 'Biển số', sticker: 'Mã dán', vehicle_type: 'Loại xe', on: 'Bật',
};
const auditVal = v => v === '' ? '(trống)' : v === true ? 'có' : v === false ? 'không' : v === null ? '(trống)'
  : (typeof v === 'object' ? JSON.stringify(v) : String(v));
// "[TỪ CHỐI 403] {"name":"x"}" -> badge đỏ + "Họ tên: x"
function auditDetail(d) {
  if (!d) return '<span class="muted">—</span>';
  const m = /^\[TỪ CHỐI (\d+)\]\s*/.exec(d);
  const badge = m ? `<span class="badge red" style="font-size:10px">Từ chối ${m[1]}</span> ` : '';
  const rest = m ? d.slice(m[0].length) : d;
  let o = null; try { o = JSON.parse(rest); } catch (e) {}
  if (!o || typeof o !== 'object') return badge + esc(rest);
  const ks = Object.keys(o);
  if (!ks.length) return badge || '<span class="muted">—</span>';
  return badge + esc(ks.map(k => `${AUDIT_FIELD[k] || k}: ${auditVal(o[k])}`).join(' · '));
}
function fmtDT(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 16).replace('T', ' ');
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
let auditLimit = 200;
let auditFilter = { user: '', from: '', to: '', offset: 0 };
function xoaLocNhatKy() { auditFilter = { user: '', from: '', to: '', offset: 0 }; viewAudit(); }
async function viewAudit() {
  el('topActions').innerHTML = `<button class="btn" data-act="viewAudit">${IC.refresh} Tải lại</button>`;
  el('content').innerHTML = '<div class="spinner"></div>';
  let res;
  try { res = await API.auditLog({ limit: auditLimit, ...auditFilter }); } catch (e) { return renderViewError('audit', e); }
  // Endpoint giờ trả { total, limit, offset, rows } (trước là mảng) để lọc + lật trang được (V2-66).
  const rows = Array.isArray(res) ? res : (res.rows || []);
  const total = Array.isArray(res) ? rows.length : (res.total || 0);
  const offset = auditFilter.offset || 0;

  const body = rows.map(r => {
    const label = auditLabel(r.method, r.path);
    const s = `${r.username} ${label} ${r.detail || ''} ${r.path || ''}`.toLowerCase();
    return `<tr data-s="${esc(s)}">
      <td style="white-space:nowrap">${fmtDT(r.at)}</td>
      <td data-label="Người dùng"><strong>${esc(r.username || '—')}</strong> <span class="badge ${(ROLE_LABEL[r.role] || [])[1] || 'gray'}" style="font-size:10px">${esc((ROLE_LABEL[r.role] || [])[0] || (r.role === 'student' ? 'Học viên' : r.role || '—'))}</span></td>
      <td data-label="Thao tác"><span class="badge ${AUDIT_MCLR[r.method] || 'gray'}" style="font-size:10px">${AUDIT_MVERB[r.method] || r.method}</span> ${esc(label)}</td>
      <td data-label="Chi tiết" class="muted" style="font-size:12px;max-width:420px">${auditDetail(r.detail)}</td>
    </tr>`;
  }).join('');

  const dangLoc = auditFilter.user || auditFilter.from || auditFilter.to;
  const tuTrang = offset + 1, denTrang = offset + rows.length;
  el('content').innerHTML = `
    <div class="cards">
      <div class="stat"><div class="l">${IC.history} Tổng bản ghi ${dangLoc ? '(theo bộ lọc)' : ''}</div><div class="v sm">${total.toLocaleString('vi-VN')}</div></div>
    </div>
    <div class="panel"><div class="hd"><h2>${IC.history} Nhật ký thao tác</h2>
      <div class="flex" style="gap:8px;flex-wrap:wrap">
        <div class="search"><span class="i">${IC.search}</span><input id="auUser" placeholder="Lọc theo người dùng…" value="${esc(auditFilter.user)}"></div>
        <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:4px">Từ <input id="auFrom" style="padding:5px;width:118px"></label>
        <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:4px">Đến <input id="auTo" style="padding:5px;width:118px"></label>
        <button class="btn sm" id="auApply">${IC.search} Lọc</button>
        ${dangLoc ? nutXoaLoc('data-act="xoaLocNhatKy"') : ''}
        <select id="auLimit" style="padding:6px 8px;font-size:13px">
          ${[100, 200, 500].map(n => `<option value="${n}" ${n === auditLimit ? 'selected' : ''}>${n} dòng/trang</option>`).join('')}
        </select>
      </div></div>
      <div class="table-wrap card-tbl">
        ${rows.length ? `<table><thead><tr><th>Thời gian</th><th>Người dùng</th><th>Thao tác</th><th>Chi tiết</th></tr></thead>
          <tbody>${body}</tbody></table>` : `<div class="empty">${dangLoc ? `${trongKhongKhop('bản ghi')} ${nutXoaLoc('data-act="xoaLocNhatKy"')}` : trongChuaCo('nhật ký thao tác nào')}</div>`}
      </div>
      <div class="pad flex" style="justify-content:space-between;align-items:center">
        <span class="muted" style="font-size:12px">${rows.length ? `Đang xem ${tuTrang.toLocaleString('vi-VN')}–${denTrang.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} bản ghi` : ''}</span>
        <div class="flex" style="gap:6px">
          <button class="btn sm ghost" id="auPrev" ${offset <= 0 ? 'disabled' : ''}>← Mới hơn</button>
          <button class="btn sm ghost" id="auNext" ${denTrang >= total ? 'disabled' : ''}>Cũ hơn →</button>
        </div>
      </div>
      <div class="pad muted" style="font-size:12px">${IC.info} Nhật ký ghi lại đăng nhập, mọi thao tác thêm/sửa/xóa, và các lần bị từ chối. Mật khẩu, CCCD, ảnh được ẩn tự động.</div>
    </div>`;
  attachDate(el('auFrom'), auditFilter.from);   // BL-50: lịch VN dd/mm/yyyy thay input type=date native (mm/dd/yyyy Mỹ)
  attachDate(el('auTo'), auditFilter.to);
  const apply = () => { auditFilter = { user: el('auUser').value.trim(), from: el('auFrom').dataset.iso || '', to: el('auTo').dataset.iso || '', offset: 0 }; viewAudit(); };
  el('auApply').onclick = apply;
  el('auUser').addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
  el('auLimit').onchange = e => { auditLimit = +e.target.value; auditFilter.offset = 0; viewAudit(); };
  el('auPrev').onclick = () => { auditFilter.offset = Math.max(0, offset - auditLimit); viewAudit(); };
  el('auNext').onclick = () => { auditFilter.offset = offset + auditLimit; viewAudit(); };
  syncFilterUrl(); // BL-17: người/từ/đến/offset/limit lên URL (chia sẻ đúng trang đang xem)
}

/* ---------- TRUNG TÂM HỖ TRỢ ---------- */
const SUPCAT = { damage: ['Báo hư hỏng', 'gray', IC.wrench], violation: ['Báo vi phạm', 'amber', IC.flag], other: ['Khác — cần hỗ trợ', 'blue', IC.info] };
const supCatBadge = c => { const [l, cl] = SUPCAT[c] || SUPCAT.damage; return `<span class="badge ${cl}">${l}</span>`; };
// Mỗi trang là 1 mục nav riêng (điểm 1 — Sếp): reg · checkout · repair · violations · feedback
