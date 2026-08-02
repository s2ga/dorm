// === app-services-revenue-audit.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
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
  const pill = (k, ico, label) => `<button class="btn sm ${svcTab === k ? 'pri' : ''}" data-act="svcGo" data-args='["${k}"]'>${ico} ${label}</button>`;   // BL-69: bỏ (N) — số đã có ở thẻ KPI
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
  if (svcTab === 'parking') {
    el('svcBody').innerHTML = `<div class="panel"><div class="hd"><h2>${IC.bike} Gửi xe — HV đang ở (<span id="vehCount">${totalVeh}</span> xe)</h2>
      <div class="search"><span class="i">${IC.search}</span><input id="vs" placeholder="Tìm biển số, loại, chủ xe, phòng..." value="${esc(vehSearch)}"></div></div>
      <div class="pad muted" style="font-size:12px">${IC.info} Thêm/sửa xe (biển số, mã dán) trong <strong>Chi tiết học viên</strong>.</div>
      <div class="table-wrap">${totalVeh ? `<table><thead><tr><th>Biển số</th><th>Loại xe</th><th>Mã dán</th><th>Chủ xe</th><th>Phòng</th></tr></thead><tbody>
        ${veh.map(v => `<tr data-s="${esc((v.plate + ' ' + (v.vehicle_type || '') + ' ' + (v.student_name || '') + ' ' + (v.room_name || '') + ' ' + (v.sticker || '')).toLowerCase())}">
          <td><strong>${esc(v.plate || '—')}</strong></td><td>${esc(v.vehicle_type || '—')}</td><td>${esc(v.sticker || '—')}</td>
          <td><a href="#" data-act="studentDetail" data-args='[${v.student_id}]'>${esc(v.student_name)}</a></td><td>${esc(v.room_name || '—')}</td>
        </tr>`).join('')}
        <tr class="no-result" style="display:none"><td colspan="5"><div class="empty">Không tìm thấy xe phù hợp.</div></td></tr>
      </tbody></table>` : `<div class="empty">Chưa có HV đang ở gửi xe. Thêm xe trong <strong>Chi tiết học viên</strong>.</div>`}</div></div>`;
    const vs = el('vs'); if (vs) { vs.addEventListener('input', () => { vehSearch = vs.value; syncFilterUrl(); }); attachRowSearch(vs, 'vehCount'); }
  } else {
    el('svcBody').innerHTML = `<div class="panel"><div class="hd"><h2>${IC.washer} Máy giặt</h2><button class="btn sm pri" data-act="addWashingForm">${IC.plus} Thêm HV dùng máy giặt</button></div>
      <div class="table-wrap">${washUsers.length ? `<table><thead><tr><th>Học viên</th><th>Phòng</th><th>Mã pháp nhân</th><th></th></tr></thead><tbody>
        ${washUsers.map(s => `<tr><td><a href="#" data-act="studentDetail" data-args='[${s.id}]'><strong>${esc(s.name)}</strong></a>${s.code ? `<div class="muted" style="font-size:11px">${esc(s.code)}</div>` : ''}</td><td>${s.room_id ? `<a href="#" data-act="roomDetail" data-args='[${s.room_id}]'>${esc(s.room_name || '—')}</a>` : esc(s.room_name || '—')}</td><td>${legalEntityCell(s.gender)}</td><td class="num"><button class="btn sm ghost" data-act="toggleWashing" data-args='[${s.id}, false]'>${IC.trash} Ngưng</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Chưa có HV đăng ký máy giặt. Bấm "Thêm HV dùng máy giặt".</div>'}</div></div>`;
  }
  syncFilterUrl(); // BL-17: tab dịch vụ (washing/parking) + tìm xe lên URL
}
function addWashingForm() {
  const avail = ST.students.filter(s => !s.uses_washing && isOccupying(s)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
  if (!avail.length) return toast('Mọi học viên đang ở đều đã dùng máy giặt', 'err');
  const opts = avail.map(s => `<option value="${s.id}">${esc(s.name)}${s.code ? ' (' + esc(s.code) + ')' : ''}${s.room_name ? ' — ' + esc(s.room_name) : ''}</option>`).join('');
  openModal(`
    <div class="mh"><h3>${IC.washer} Thêm HV dùng máy giặt</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="field"><label>Chọn học viên</label><select id="wash_stu">${opts}</select></div>
      <div class="hint">${IC.info} Phí máy giặt ${money(+ST.settings.washing_fee || 0)}/tháng sẽ được tính vào hóa đơn từ kỳ kế tiếp.</div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="washAdd">Thêm</button></div>`);
}
async function toggleWashing(id, on) {
  if (!id) return;
  if (!on && !confirm('Ngưng dịch vụ máy giặt cho học viên này?')) return;
  await guard(() => API.setWashing(id, on));
  await napLai('students'); closeModal();
  toast(on ? 'Đã thêm HV dùng máy giặt' : 'Đã ngưng máy giặt');
  if (ST.view === 'services') viewServices();
}

/* ---------- BÁO CÁO DOANH THU ---------- */
let revYear = curMonth().slice(0, 4);
const REV_SERVICES = [
  ['room', 'Phí lưu trú (tiền phòng)', 'bravo_room'],
  ['electric', 'Phí điện sinh hoạt', 'bravo_electric'],
  ['water', 'Phí nước sinh hoạt', 'bravo_water'],
  ['service', 'Phí dịch vụ chung', 'bravo_service'],
  ['washing', 'Phí máy giặt', 'bravo_washing'],
  ['parking', 'Phí gửi xe máy', 'bravo_parking'],
  ['other', 'Khoản khác', 'bravo_other'],
];
let _revData = [];   // doanh thu nam hien hanh — de exportRevenue() tu lay lai (khong nhoi vao data-args)
async function viewRevenue() {
  el('content').innerHTML = '<div class="spinner"></div>';
  const years = await guard(() => API.revenueYears());
  if (years.length && !years.includes(revYear)) revYear = years[0];
  const data = await guard(() => API.revenue(revYear));
  _revData = data;
  const sum = k => data.reduce((a, m) => a + (+m[k] || 0), 0);
  const grand = sum('total'), paid = sum('paid');

  // Bảng theo tháng
  const monthRows = data.map(m => `<tr>
    <td><strong>${m.month.slice(5)}/${m.month.slice(0, 4)}</strong></td>
    ${REV_SERVICES.filter(x => x[0] !== 'other' || sum('other')).map(([k]) => `<td class="num">${+m[k] ? money(m[k]) : '<span class="muted">—</span>'}</td>`).join('')}
    <td class="num"><strong>${money(m.total)}</strong></td>
  </tr>`).join('');

  // Cơ cấu doanh thu (BL-65: chuyển từ màn Tiền phòng sang đây — đúng nơi phân tích doanh thu)
  const REV_COLOR = { room: 'var(--brand)', electric: '#5f7ea3', water: '#4f8f63', service: '#b5822f', washing: '#9a7bb0', parking: '#c25545', other: '#8a8a8a' };
  const revMax = Math.max(1, ...REV_SERVICES.map(([k]) => sum(k)));
  const shortSvc = l => l.replace('Phí ', '').replace(' sinh hoạt', '').replace(' (tiền phòng)', '');
  const revComp = data.length ? `<div class="panel"><div class="hd"><h2>${IC.coins} Cơ cấu doanh thu — năm ${revYear}</h2><span class="muted" style="font-size:12px">Tỉ trọng theo khoản</span></div>
    <div class="pad rev-comp">
      ${REV_SERVICES.filter(x => x[0] !== 'other' || sum('other')).map(([k, l]) => { const amt = sum(k); return `<div class="rev-row">
        <div class="rev-lbl">${shortSvc(l)}</div>
        <div class="rev-track"><div class="rev-fill" style="width:${Math.round(amt / revMax * 100)}%;background:${REV_COLOR[k] || 'var(--brand)'}"></div></div>
        <div class="rev-amt"><strong>${money(amt)}</strong> <span class="muted">${Math.round(amt / (grand || 1) * 100)}%</span></div>
      </div>`; }).join('')}
    </div></div>` : '';

  el('content').innerHTML = `
    <div class="cards">
      <div class="stat"><div class="l">${IC.calendar} Năm</div><div class="v sm"><select id="ry" style="font-size:15px;font-weight:600;padding:6px 8px">${(years.length ? years : [revYear]).map(y => `<option value="${y}" ${y === revYear ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
      <div class="stat"><div class="l">${IC.trendingUp} Tổng dự báo doanh thu năm</div><div class="v sm">${money(grand)}</div></div>
    </div>

    ${revComp}
    <div class="panel"><div class="hd"><h2>${IC.trendingUp} Dự báo doanh thu theo tháng — năm ${revYear}</h2>
      <button class="btn sm" data-act="exportRevenue">${IC.download} Xuất Excel (CSV)</button></div>
      <div class="table-wrap">
      ${data.length ? `<table><thead><tr><th>Tháng</th>
        ${REV_SERVICES.filter(x => x[0] !== 'other' || sum('other')).map(([, l]) => `<th class="num">${l.replace('Phí ', '').replace(' sinh hoạt', '').replace(' (tiền phòng)', '')}</th>`).join('')}
        <th class="num">Tổng</th></tr></thead>
        <tbody>${monthRows}
          <tr style="background:var(--bg2)"><td><strong>Cả năm</strong></td>
          ${REV_SERVICES.filter(x => x[0] !== 'other' || sum('other')).map(([k]) => `<td class="num"><strong>${money(sum(k))}</strong></td>`).join('')}
          <td class="num"><strong>${money(grand)}</strong></td></tr>
        </tbody></table>` : '<div class="empty">Chưa có phiếu báo trong năm này.</div>'}
      </div>
    </div>

    <div class="panel"><div class="hd"><h2>${IC.receipt} Tổng theo dịch vụ (đối chiếu Bravo) — năm ${revYear}</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Mã SP Bravo</th><th>Loại phí</th><th>Dịch vụ</th><th class="num">Tiền phiếu cả năm</th></tr></thead><tbody>
        ${REV_SERVICES.map(([k, l, codeKey]) => { const v = sum(k); if (!v && k === 'other') return ''; return `<tr>
          <td><strong>${esc(ST.settings[codeKey] || '—')}</strong></td>
          <td class="muted">${esc(ST.settings.bravo_fee_type || '')}</td>
          <td>${l}</td><td class="num">${money(v)}</td></tr>`; }).join('')}
        <tr style="background:var(--bg2)"><td colspan="3"><strong>TỔNG TIỀN PHIẾU</strong></td><td class="num"><strong>${money(grand)}</strong></td></tr>
      </tbody></table></div>
      <div class="pad muted" style="font-size:12.5px">${IC.bulb} Mã sản phẩm Bravo chỉnh trong <a href="#" data-act="adminGo" data-args='["settings"]'>Cài đặt</a>. Số liệu = tổng tiền đã lập phiếu báo (chưa gồm cọc). Thu tiền thực tế do Bravo quản lý. Số HV xuất cảnh xem ở <a href="#" data-act="adminGo" data-args='["exec"]'>Điều hành</a>.</div>
    </div>`;
  const ry = el('ry'); if (ry) ry.onchange = e => { revYear = e.target.value; viewRevenue(); };
  syncFilterUrl(); // BL-17: năm (đã nắn theo years có dữ liệu) lên URL
}
function exportRevenue() {
  const data = _revData;
  const cols = REV_SERVICES.map(x => x[1]);
  const head = ['Thang', ...cols, 'Tong'];
  const rows = data.map(m => [m.month, ...REV_SERVICES.map(([k]) => +m[k] || 0), +m.total || 0]);
  const sum = k => data.reduce((a, m) => a + (+m[k] || 0), 0);
  rows.push(['Ca nam', ...REV_SERVICES.map(([k]) => sum(k)), sum('total')]);  // BL-29: bỏ cột paid thừa (head/data không có) -> dòng tổng khớp cột
  const csv = '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `doanh-thu-${revYear}.csv`; a.click();
  toast('Đã xuất file CSV');
}

/* ---------- NHẬT KÝ HỆ THỐNG (AUDIT LOG) ---------- */
const AUDIT_RES = {
  students: 'Học viên', rooms: 'Phòng', vehicles: 'Xe', assets: 'Tài sản',
  invoices: 'Hóa đơn', electric: 'Điện', violations: 'Vi phạm', applications: 'Đơn đăng ký',
  requests: 'Yêu cầu hỗ trợ', settings: 'Cài đặt', facilities: 'Cơ sở', media: 'Ảnh giới thiệu',
  admin: 'Tài khoản', logs: 'Nhật ký ra/vào', reports: 'Báo cáo', me: 'Học viên (tự thao tác)',
};
const AUDIT_SUB = {
  checkin: 'Check-in', checkout: 'Check-out', transfer: 'Chuyển phòng', approve: 'Duyệt đơn',
  reject: 'Từ chối', confirm: 'Xác nhận trả phòng', notify: 'Gửi mail nhà trường', restore: 'Khôi phục',
  generate: 'Lập hóa đơn hàng loạt', 'generate-one': 'Lập hóa đơn 1 HV', bulk: 'Lưu chỉ số điện',
  'mark-paid': 'Đánh dấu đã thu', status: 'Đổi trạng thái', recalc: 'Tính lại hóa đơn',
  password: 'Đặt lại mật khẩu', account: 'Cấp tài khoản', deposit: 'Cập nhật cọc',
  'deposit-settle': 'Tất toán cọc', note: 'Ghi chú', types: 'Loại vi phạm', users: 'Tài khoản NV',
  damage: 'Báo hư hỏng',
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
async function viewAudit() {
  el('topActions').innerHTML = `<button class="btn" data-act="viewAudit">${IC.refresh} Tải lại</button>`;
  el('content').innerHTML = '<div class="spinner"></div>';
  const res = await guard(() => API.auditLog({ limit: auditLimit, ...auditFilter }));
  // Endpoint giờ trả { total, limit, offset, rows } (trước là mảng) để lọc + lật trang được (V2-66).
  const rows = Array.isArray(res) ? res : (res.rows || []);
  const total = Array.isArray(res) ? rows.length : (res.total || 0);
  const offset = auditFilter.offset || 0;

  const body = rows.map(r => {
    const label = auditLabel(r.method, r.path);
    const s = `${r.username} ${label} ${r.detail || ''} ${r.path || ''}`.toLowerCase();
    return `<tr data-s="${esc(s)}">
      <td style="white-space:nowrap">${fmtDT(r.at)}</td>
      <td><strong>${esc(r.username || '—')}</strong> <span class="badge ${r.role === 'admin' ? 'gray' : 'blue'}" style="font-size:10px">${r.role === 'admin' ? 'QTV' : 'NV'}</span></td>
      <td><span class="badge ${AUDIT_MCLR[r.method] || 'gray'}" style="font-size:10px">${AUDIT_MVERB[r.method] || r.method}</span> ${esc(label)}</td>
      <td class="muted" style="font-size:12px;max-width:420px">${auditDetail(r.detail)}</td>
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
        <div class="search"><span class="i">${IC.search}</span><input id="auUser" placeholder="Lọc theo người dùng..." value="${esc(auditFilter.user)}"></div>
        <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:4px">Từ <input id="auFrom" style="padding:5px;width:118px"></label>
        <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:4px">Đến <input id="auTo" style="padding:5px;width:118px"></label>
        <button class="btn sm" id="auApply">${IC.search} Lọc</button>
        ${dangLoc ? `<button class="btn sm ghost" id="auClear">Bỏ lọc</button>` : ''}
        <select id="auLimit" style="padding:6px 8px;font-size:13px">
          ${[100, 200, 500].map(n => `<option value="${n}" ${n === auditLimit ? 'selected' : ''}>${n} dòng/trang</option>`).join('')}
        </select>
      </div></div>
      <div class="table-wrap">
        ${rows.length ? `<table><thead><tr><th>Thời gian</th><th>Người dùng</th><th>Thao tác</th><th>Chi tiết</th></tr></thead>
          <tbody>${body}</tbody></table>` : `<div class="empty">${dangLoc ? 'Không có bản ghi nào khớp bộ lọc.' : 'Chưa có nhật ký thao tác nào.'}</div>`}
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
  if (el('auClear')) el('auClear').onclick = () => { auditFilter = { user: '', from: '', to: '', offset: 0 }; viewAudit(); };
  el('auLimit').onchange = e => { auditLimit = +e.target.value; auditFilter.offset = 0; viewAudit(); };
  el('auPrev').onclick = () => { auditFilter.offset = Math.max(0, offset - auditLimit); viewAudit(); };
  el('auNext').onclick = () => { auditFilter.offset = offset + auditLimit; viewAudit(); };
  syncFilterUrl(); // BL-17: người/từ/đến/offset/limit lên URL (chia sẻ đúng trang đang xem)
}

/* ---------- TRUNG TÂM HỖ TRỢ ---------- */
const SUPCAT = { damage: ['Hư hỏng phòng', 'gray', IC.wrench], violation: ['Báo vi phạm', 'amber', IC.flag], other: ['Khác — cần hỗ trợ', 'blue', IC.info] };
const supCatBadge = c => { const [l, cl] = SUPCAT[c] || SUPCAT.damage; return `<span class="badge ${cl}">${l}</span>`; };
// Mỗi trang là 1 mục nav riêng (điểm 1 — Sếp): reg · checkout · repair · violations · feedback
