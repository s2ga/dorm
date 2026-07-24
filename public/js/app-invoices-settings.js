// === app-invoices-settings.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
// BL-67: đã BỎ invStatusBadge/invActions/setInvStatus — di sản pha QR/tài chính (GĐ2), không nơi gọi.
// Biểu đồ cột mini (sparkline) tiêu thụ điện
function sparkBars(series) {
  const max = Math.max(1, ...series.map(s => s.kwh));
  const w = 9, gap = 3, h = 28;
  const bars = series.map((s, i) => {
    const bh = s.kwh > 0 ? Math.max(2, Math.round(s.kwh / max * h)) : 0;
    const last = i === series.length - 1;
    return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="1.5" fill="${last ? 'var(--brand)' : 'var(--line2)'}"><title>${monthLabel(s.month)}: ${s.kwh} kWh</title></rect>`;
  }).join('');
  return `<svg width="${series.length * (w + gap)}" height="${h}" style="vertical-align:middle;display:block">${bars}</svg>`;
}
function deltaTag(cur, prev) {
  const d = cur - prev;
  if (!prev && !cur) return '<span class="muted">—</span>';
  if (d === 0) return '<span class="muted">= tháng trước</span>';
  const up = d > 0;
  return `<span style="color:${up ? 'var(--red-ink)' : 'var(--green-ink)'};font-weight:600">${up ? '▲' : '▼'} ${Math.abs(d)} kWh</span>`;
}
let _invAll = [];   // hoa don thang hien hanh — de phieuBao/invoiceForm/exportCSV tu lay lai theo id (khong nhoi object vao data-args)
async function viewInvoices() {
  el('topActions').innerHTML = `<button class="btn" data-act="electricForm">${IC.zap} Chỉ số điện</button><button class="btn" data-act="oneInvoiceForm">${IC.plus} HĐ cho 1 HV</button><button class="btn pri" data-act="generateForm">${IC.receipt} Tạo hóa đơn theo tháng</button>`;
  el('content').innerHTML = '<div class="spinner"></div>';
  const months = await guard(() => API.invoiceMonths());
  // Chỉ tự nhảy tới kỳ CÓ hóa đơn khi đang ở kỳ MẶC ĐỊNH (tháng hiện tại) mà nó chưa có hóa đơn.
  // Không ép nữa khi người dùng đã chọn kỳ khác — để chọn được cả kỳ chưa có hóa đơn (BL-53).
  if (months.length && invMonth === curMonth() && !months.includes(invMonth)) invMonth = months[0];
  const all = await guard(() => API.invoices(invMonth));
  _invAll = all;
  let ehist = { months: [], rooms: [] };
  try { ehist = await API.electricHistory(invMonth, 6); } catch {}
  // Kỳ trước — để tính xu hướng cơ cấu doanh thu (▲▼ so kỳ trước)
  let prevAll = [];
  const prevInvMonth = (() => { let [yy, mm] = invMonth.split('-').map(Number); mm--; if (mm === 0) { mm = 12; yy--; } return `${yy}-${String(mm).padStart(2, '0')}`; })();
  try { prevAll = await API.invoices(prevInvMonth); } catch {}
  const elecPanel = ehist.rooms.length ? `<div class="panel"><div class="hd"><h2>${IC.zap} Tiêu thụ điện theo phòng — so với tháng trước</h2><span class="muted" style="font-size:12px">${ehist.months.length} tháng gần nhất · cột cam = tháng này</span></div>
    <div class="table-wrap"><table><thead><tr><th>Phòng</th><th>Xu hướng</th><th class="num">Tháng này</th><th>Chênh lệch</th></tr></thead><tbody>
      ${ehist.rooms.map(r => { const cur = r.series[r.series.length - 1].kwh; const prev = r.series.length > 1 ? r.series[r.series.length - 2].kwh : 0; return `<tr>
        <td><strong>${esc(r.room_name)}</strong></td>
        <td>${sparkBars(r.series)}</td>
        <td class="num"><strong>${cur}</strong> kWh</td>
        <td>${deltaTag(cur, prev)}</td>
      </tr>`; }).join('')}
    </tbody></table></div></div>` : '';
  let list = all.slice();
  if (invFilter === 'paid') list = list.filter(i => i.status === 'paid');
  if (invFilter === 'unpaid') list = list.filter(i => i.status !== 'paid');
  // Tìm kiếm áp dụng bằng ẩn/hiện hàng (attachRowSearch)

  const total = all.reduce((a, i) => a + (+i.total || 0), 0);

  // Cơ cấu doanh thu: tách Tổng theo từng khoản (tiền phòng/điện/nước/DV/giặt/xe) + xu hướng so kỳ trước.
  const REV_COMP = [
    ['Tiền phòng', 'room_charge', 'var(--brand)'], ['Điện', 'electric_charge', '#5f7ea3'],
    ['Nước', 'water_charge', '#4f8f63'], ['Dịch vụ', 'service_charge', '#b5822f'],
    ['Máy giặt', 'washing_charge', '#9a7bb0'], ['Gửi xe', 'parking_charge', '#c25545'],
  ];
  const sumK = (arr, k) => arr.reduce((a, i) => a + (+i[k] || 0), 0);
  const comp = REV_COMP.map(([label, k, color]) => ({ label, color, amount: sumK(all, k), prev: sumK(prevAll, k) }));
  const gross = comp.reduce((a, c) => a + c.amount, 0) || 1;
  const maxComp = Math.max(1, ...comp.map(c => c.amount));
  const discount = sumK(all, 'leader_discount') + sumK(all, 'room_discount');
  const trendPct = (cur, prev) => { if (!prev) return ''; const d = Math.round((cur - prev) / prev * 100); return `<span class="muted" style="font-size:11px;margin-left:5px">${d > 0 ? '▲' : d < 0 ? '▼' : '—'}${d ? ' ' + Math.abs(d) + '%' : ''}</span>`; };
  const revPanel = all.length ? `<div class="panel"><div class="hd"><h2>${IC.coins} Cơ cấu tiền phiếu — ${monthLabel(invMonth)}</h2><span class="muted" style="font-size:12px">${prevAll.length ? `▲▼ so ${monthLabel(prevInvMonth)}` : 'Tách theo từng khoản'}</span></div>
    <div class="pad rev-comp">
      ${comp.map(c => `<div class="rev-row">
        <div class="rev-lbl">${c.label}</div>
        <div class="rev-track"><div class="rev-fill" style="width:${Math.round(c.amount / maxComp * 100)}%;background:${c.color}"></div></div>
        <div class="rev-amt"><strong>${money(c.amount)}</strong> <span class="muted">${Math.round(c.amount / gross * 100)}%</span>${trendPct(c.amount, c.prev)}</div>
      </div>`).join('')}
      ${discount ? `<div class="rev-row"><div class="rev-lbl muted">Giảm trừ</div><div class="rev-track"></div><div class="rev-amt muted">−${money(discount)}</div></div>` : ''}
    </div></div>` : '';

  // #2: Tiền phòng theo phòng — tháng này so kỳ trước (dùng lại all + prevAll, không cần backend).
  const rfCur = {}, rfPrev = {};
  all.forEach(i => { if (i.room_id) { const b = rfCur[i.room_id] || (rfCur[i.room_id] = { name: i.room_name, amt: 0 }); b.amt += (+i.room_charge || 0); } });
  prevAll.forEach(i => { if (i.room_id) rfPrev[i.room_id] = (rfPrev[i.room_id] || 0) + (+i.room_charge || 0); });
  const rfRows = Object.entries(rfCur).map(([rid, v]) => ({ name: v.name, cur: v.amt, prev: rfPrev[rid] || 0 }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi', { numeric: true }));
  const moneyDelta = (cur, prev) => { const d = cur - prev; if (d === 0) return `<span class="muted">—</span>`; return `<span class="muted" style="font-weight:600">${d > 0 ? '▲' : '▼'} ${money(Math.abs(d))}</span>`; };
  const roomFeePanel = rfRows.length ? `<div class="panel"><div class="hd"><h2>${IC.home} Tiền phòng theo phòng — so ${monthLabel(prevInvMonth)}</h2></div>
    <div class="table-wrap card-tbl"><table><thead><tr><th>Phòng</th><th class="num">Tháng này</th><th>Chênh lệch</th></tr></thead><tbody>
      ${rfRows.map(r => `<tr><td data-label="Phòng"><strong>${esc(r.name || '—')}</strong></td><td class="num" data-label="Tháng này">${money(r.cur)}</td><td data-label="Chênh lệch">${moneyDelta(r.cur, r.prev)}</td></tr>`).join('')}
    </tbody></table></div></div>` : '';

  el('content').innerHTML = `
    <div class="cards">
      <div class="stat"><div class="l">${IC.calendar} Kỳ</div><div class="v sm"><input id="im" style="font-size:15px;font-weight:600;padding:6px 8px;width:100%" title="Chọn kỳ (tháng)"></div></div>
      <div class="stat"><div class="l">${IC.receipt} Số phiếu</div><div class="v sm">${all.length}</div></div>
      <div class="stat"><div class="l">Tổng tiền phiếu (dự báo)</div><div class="v sm">${money(total)}</div></div>
    </div>
    ${revPanel}
    <div class="panel"><div class="hd"><h2>Phiếu báo tiền phòng ${monthLabel(invMonth)} (<span id="invCount">${list.length}</span>)</h2>
      <span class="muted" style="font-size:12px">Đơn vị: đồng</span>
      <div class="toolbar">
        <div class="search"><span class="i">${IC.search}</span><input id="invs" placeholder="Tìm tên HV / số phòng..." value="${esc(invSearch)}"></div>
        ${all.length ? `<button class="btn sm" data-act="exportCSV">${IC.download} Xuất Excel (CSV)</button>` : ''}</div></div>
      <div class="table-wrap card-tbl">
      ${all.length === 0 ? `<div class="empty">Chưa có hóa đơn nào cho kỳ này.<br><br><button class="btn pri" data-act="generateForm">${IC.receipt} Tạo hóa đơn</button></div>` :
      list.length ? `<table><thead><tr><th>Học viên</th><th>Phòng</th><th class="num">Ngày ở</th><th class="num">Tiền phòng</th><th class="num">Điện</th><th class="num">Nước</th><th class="num">DV</th><th class="num">Giặt</th><th class="num">Xe</th><th class="num">Giảm</th><th class="num">Tổng</th><th></th></tr></thead><tbody>
        ${list.map(i => `<tr data-s="${esc(((i.student_name || '') + ' ' + (i.student_code || '') + ' ' + (i.room_name || '')).toLowerCase())}">
          <td><strong>${esc(i.student_name)}</strong>${i.student_code ? `<div class="muted" style="font-size:11px">${esc(i.student_code)}</div>` : ''}</td>
          <td data-label="Phòng">${esc(i.room_name || '—')}</td>
          <td class="num" data-label="Ngày ở">${i.days_stayed}</td>
          <td class="num" data-label="Tiền phòng">${moneyN(i.room_charge)}</td>
          <td class="num" data-label="Điện">${moneyN(i.electric_charge)}<div class="muted" style="font-size:10px">${i.electric_kwh || 0} kWh</div></td>
          <td class="num" data-label="Nước">${moneyN(i.water_charge)}</td>
          <td class="num" data-label="DV">${moneyN(i.service_charge)}</td>
          <td class="num" data-label="Giặt">${i.washing_charge ? moneyN(i.washing_charge) : '—'}</td>
          <td class="num" data-label="Xe">${i.parking_charge ? moneyN(i.parking_charge) : '—'}</td>
          <td class="num" data-label="Giảm">${(+i.leader_discount || 0) + (+i.room_discount || 0)
            ? `<span class="badge green" title="${[+i.room_discount ? 'Giảm tiền phòng ' + money(i.room_discount) : '', +i.leader_discount ? 'Giảm phòng trưởng ' + money(i.leader_discount) : ''].filter(Boolean).join(' · ')}">−${moneyN((+i.leader_discount || 0) + (+i.room_discount || 0))}</span>`
            : '—'}</td>
          <td class="num" data-label="Tổng"><strong>${moneyN(i.total)}</strong></td>
          <td class="num"><div class="rowbtns" style="justify-content:flex-end">
            <button class="btn sm pri" data-act="phieuBao" data-args='[${i.id}]'>${IC.fileText} Phiếu báo</button>
            <button class="btn sm ghost" title="Tính lại theo số ngày ở hiện tại" data-act="recalcInv" data-args='[${i.id}]'>${IC.refresh}</button>
            <button class="btn sm ghost" data-act="invoiceForm" data-args='[${i.id}]'>${IC.pencil}</button>
            <button class="btn sm ghost" data-act="delInvoice" data-args='[${i.id}]'>${IC.trash}</button>
          </div></td></tr>`).join('')}
        <tr class="no-result" style="display:none"><td colspan="12"><div class="empty">Không tìm thấy hóa đơn phù hợp.</div></td></tr>
      </tbody></table>` : `<div class="empty">Không có hóa đơn ${invFilter === 'paid' ? 'đã đóng' : 'chưa đóng'} trong kỳ này.</div>`}
    </div></div>
    ${roomFeePanel}
    ${elecPanel}`;
  const im = el('im'); if (im) { attachMonth(im, invMonth); im.onchange = () => { invMonth = im.dataset.ym; viewInvoices(); }; }
  const iv = el('invs'); if (iv) { iv.addEventListener('input', () => { invSearch = iv.value; syncFilterUrl(); }); attachRowSearch(iv, 'invCount'); }
  syncFilterUrl(); // BL-17: kỳ (thang, đã nắn theo tháng có dữ liệu) + tìm kiếm lên URL
}
async function recalcInv(id) { const r = await guard(() => API.recalcInvoice(id)); toast(`Đã tính lại: ${r.days_stayed} ngày ở → ${money(r.total)}`); viewInvoices(); }
async function delInvoice(id) {
  const i = (_invAll || []).find(x => x.id === id) || {};   // BL-30: nêu tên/tổng để tránh xóa nhầm
  const who = [i.student_name, i.room_name].filter(Boolean).join(' · ');
  if (!confirm(`Xóa hóa đơn${who ? ' của ' + who : ''}${i.total != null ? ' (tổng ' + money(i.total) + ')' : ''}?`)) return;
  await guard(() => API.deleteInvoice(id)); await refreshCache(); toast('Đã xóa'); viewInvoices();
}

/* Tạo hóa đơn tự tính cho 1 học viên (VD học viên mới vào giữa tháng) */
function oneInvoiceForm() {
  const opts = ST.students.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'))
    .map(s => `<option value="${s.id}">${esc(s.name)}${s.code ? ' (' + esc(s.code) + ')' : ''}${s.room_name ? ' · ' + esc(s.room_name) : ''}</option>`).join('');
  openModal(`
    <div class="mh"><h3>${IC.plus} Tạo hóa đơn cho 1 học viên</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="hint">${IC.info} Dùng khi có học viên mới vào giữa tháng. Hệ thống <strong>tự tính</strong> theo phòng, số ngày ở và chỉ số điện đã lưu — không ảnh hưởng hóa đơn người khác (người đã đóng sẽ bị khóa).</div>
      <div class="grid2">
        <div class="field"><label>Học viên *</label><select id="oi_stu">${opts}</select></div>
        <div class="field"><label>Kỳ (tháng)</label><input id="oi_month" type="month" value="${invMonth}"></div>
      </div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveOneInvoice">Tạo &amp; xem phiếu báo</button></div>`);
}
async function saveOneInvoice() {
  const student_id = +el('oi_stu').value, month = el('oi_month').value;
  if (!student_id) return toast('Chọn học viên', 'err');
  if (!month) return toast('Chọn kỳ', 'err');
  const r = await guard(() => API.generateOneInvoice({ student_id, month }));
  await refreshCache(); closeModal(); invMonth = month; invFilter = 'all';
  toast(r.created ? 'Đã tạo hóa đơn cho học viên' : 'Đã cập nhật hóa đơn');
  viewInvoices();
  if (r.invoice) { r.invoice.room_name = (roomById(r.invoice.room_id) || {}).name || ''; setTimeout(() => phieuBao(r.invoice), 150); }
}
async function generateForm() {
  el('overlay').classList.add('show');
  el('modal').className = 'modal wide';
  el('modal').innerHTML = `<div class="mb"><div class="spinner"></div></div>`;
  await renderGenerateForm(invMonth);
}
async function renderGenerateForm(month) {
  el('modal').innerHTML = `<div class="mb"><div class="spinner"></div></div>`;   // BL-34: spinner khi đổi kỳ
  const rooms = await guard(() => API.electric(month));
  el('modal').innerHTML = `
    <div class="mh"><h3>${IC.receipt} Tạo hóa đơn tháng</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="field"><label>Kỳ (tháng)</label><input id="g_month" type="month" value="${month}" data-change="onGenMonth"></div>
      <div class="hint">${IC.bulb} Nhập <strong>số cuối công-tơ</strong>. Số đầu tự lấy = số cuối tháng trước (sửa được để test). Tiền điện = (cuối − đầu) × ${money(ST.settings.electric_unit)}, chia đều theo số người ở.</div>
      ${electricTable(rooms)}
      <p class="muted" style="font-size:12px;margin-top:10px">Hóa đơn <strong>chưa đóng</strong> sẽ được <strong>tính lại</strong> theo điện & ngày mới; hóa đơn <strong>đã đóng</strong> được giữ nguyên.</p>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="runGenerate">Lưu số điện & tạo/cập nhật hóa đơn</button></div>`;
}
// Bảng nhập chỉ số điện (số đầu + số cuối đều sửa được)
function electricTable(rooms) {
  if (!rooms.length) return `<div class="empty">Chưa có phòng nào để nhập chỉ số điện cho kỳ này.</div>`;
  return `<div class="table-wrap" style="max-height:min(560px,62vh);overflow:auto"><table><thead><tr><th>Phòng</th><th class="num">Đang ở</th><th class="num">Số đầu</th><th class="num">Số cuối</th><th class="num">Tiêu thụ</th><th class="num">Tiền điện</th></tr></thead><tbody>
    ${rooms.map(r => { const st = +r.reading_start || 0, en = +r.reading_end || 0; const bad = en > 0 && en < st; const kwh = Math.max(0, en - st); return `<tr>
      <td><strong>${esc(r.room_name)}</strong> <span class="muted">${r.gender === 'female' ? 'Nữ' : 'Nam'}</span></td>
      <td class="num">${r.occupancy}</td>
      <td class="num"><input type="number" min="0" step="0.1" data-estart="${r.room_id}" value="${st || ''}" placeholder="0" style="width:90px;text-align:right" data-input="ecalc" data-args='[${r.room_id}]'></td>
      <td class="num"><input type="number" min="0" step="0.1" data-room="${r.room_id}" value="${en || ''}" placeholder="0" style="width:90px;text-align:right${bad ? ';border-color:var(--red);background:var(--red-bg)' : ''}" data-input="ecalc" data-args='[${r.room_id}]'></td>
      <td class="num" id="ek_${r.room_id}">${bad ? '<span class="err-inline" title="Số cuối nhỏ hơn số đầu — sửa lại">Số cuối &lt; số đầu</span>' : kwh}</td>
      <td class="num" id="em_${r.room_id}">${bad ? '—' : money(kwh * (+ST.settings.electric_unit || 0))}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function ecalc(rid) {
  const enInp = document.querySelector(`[data-room="${rid}"]`);
  const st = +document.querySelector(`[data-estart="${rid}"]`).value || 0;
  const en = +enInp.value || 0;
  const bad = en > 0 && en < st;   // BL-34: số cuối < số đầu -> báo lỗi thay vì nắn ngầm về 0
  enInp.style.borderColor = bad ? 'var(--red)' : '';
  enInp.style.background = bad ? 'var(--red-bg)' : '';
  const ek = el('ek_' + rid), em = el('em_' + rid);
  if (bad) { ek.innerHTML = '<span class="err-inline" title="Số cuối nhỏ hơn số đầu — sửa lại">Số cuối &lt; số đầu</span>'; em.textContent = '—'; return; }
  const kwh = Math.max(0, en - st);
  ek.textContent = kwh;
  em.textContent = money(kwh * (+ST.settings.electric_unit || 0));
}
function readElectricInputs() {
  return [...document.querySelectorAll('#modal input[data-room]')].map(inp => ({
    room_id: +inp.dataset.room,
    reading_end: +inp.value || 0,
    reading_start: +(document.querySelector(`[data-estart="${inp.dataset.room}"]`)?.value) || 0,
  }));
}
// BL-34: phòng có "số cuối < số đầu" (chỉ số điện sai) -> chặn lưu/lập hóa đơn tới khi sửa
function badElectricRooms() {
  return [...document.querySelectorAll('#modal input[data-room]')].filter(inp => {
    const en = +inp.value || 0;
    const st = +(document.querySelector(`[data-estart="${inp.dataset.room}"]`)?.value) || 0;
    return en > 0 && en < st;
  });
}
/* Màn hình nhập chỉ số điện độc lập (lưu, không tạo hóa đơn) */
let elecMonth = curMonth();
async function electricForm() {
  el('overlay').classList.add('show'); el('modal').className = 'modal wide';
  el('modal').innerHTML = `<div class="mb"><div class="spinner"></div></div>`;
  await renderElectricForm(elecMonth);
}
async function renderElectricForm(month) {
  elecMonth = month;
  el('modal').innerHTML = `<div class="mb"><div class="spinner"></div></div>`;   // BL-34: spinner khi đổi kỳ
  const rooms = await guard(() => API.electric(month));
  el('modal').innerHTML = `
    <div class="mh"><h3>${IC.zap} Chỉ số điện theo tháng</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="field"><label>Kỳ (tháng)</label><input id="e_month" type="month" value="${month}" data-change="onElecMonth"></div>
      <div class="hint">Nhập số đầu (lần đầu để test) và số cuối. Tháng sau số đầu sẽ tự nối tiếp. Bấm Lưu để ghi lại — dùng khi tạo hóa đơn.</div>
      ${electricTable(rooms)}
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button><button class="btn pri" data-act="saveElectric">Lưu chỉ số điện</button></div>`;
}
async function saveElectric() {
  if (badElectricRooms().length) return toast('Có phòng "số cuối < số đầu" — sửa lại chỉ số điện trước khi lưu', 'err');
  const readings = readElectricInputs();
  await guard(() => API.saveElectric({ month: el('e_month').value, readings }));
  closeModal(); toast('Đã lưu chỉ số điện');
}
async function runGenerate() {
  const month = el('g_month').value; if (!month) return toast('Chọn kỳ', 'err');
  if (badElectricRooms().length) return toast('Có phòng "số cuối < số đầu" — sửa lại chỉ số điện trước khi lập hóa đơn', 'err');
  const readings = readElectricInputs();
  // Bước 1: xem trước (dry-run) — tính nhưng KHÔNG lưu
  const pv = await guard(() => API.generateInvoices({ month, readings, preview: true }));
  const msg = `Kỳ ${month} — ${pv.total} học viên ở trong kỳ:\n`
    + `• Tạo mới: ${pv.created}\n`
    + `• Cập nhật (chưa thu): ${pv.updated}\n`
    + `• Bỏ qua (đã đóng, khóa): ${pv.skipped}\n\n`
    + `Tiếp tục lập hóa đơn? (Chạy lại bao nhiêu lần cũng được — HV mới vào giữa tháng sẽ được tạo bù, hóa đơn đã thu không bị đụng.)`;
  if (!confirm(msg)) return;
  // Bước 2: lập thật
  const r = await guard(() => API.generateInvoices({ month, readings }));
  await refreshCache(); closeModal(); invMonth = month; invFilter = 'all';
  toast(`Đã tạo ${r.created} · cập nhật ${r.updated || 0}${r.skipped ? ` · bỏ qua ${r.skipped} (đã đóng)` : ''} hóa đơn`);
  viewInvoices();
}
function invoiceForm(id) {
  let i = _invAll.find(x => x.id === id) || { student_id: '', month: invMonth, days_stayed: 0, room_charge: 0, electric_kwh: 0, electric_charge: 0, water_charge: 0, service_charge: 0, washing_charge: 0, parking_charge: 0, other_charge: 0, other_note: '' };
  const opts = ST.students.map(s => `<option value="${s.id}" ${i.student_id === s.id ? 'selected' : ''}>${esc(s.name)}${s.code ? ' (' + esc(s.code) + ')' : ''}</option>`).join('');
  const f = (lbl, key, extra = '') => `<div class="field"><label>${lbl}</label><input id="i_${key}" type="number" min="0" value="${esc(i[key] || 0)}" ${extra}></div>`;
  openModal(`
    <div class="mh"><h3>${id ? 'Sửa hóa đơn' : 'Thêm hóa đơn lẻ'}</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="grid2">
        <div class="field"><label>Học viên *</label><select id="i_stu" ${id ? 'disabled' : ''}>${opts}</select></div>
        <div class="field"><label>Kỳ</label><input id="i_month" type="month" value="${i.month}"></div>
      </div>
      <div class="grid2">${f('Số ngày ở', 'days_stayed')}${f('Tiền phòng', 'room_charge')}</div>
      <div class="grid2">${f('Tiền điện', 'electric_charge')}${f('Nước', 'water_charge')}</div>
      <div class="grid2">${f('Dịch vụ', 'service_charge')}${f('Máy giặt', 'washing_charge')}</div>
      <div class="grid2">${f('Gửi xe', 'parking_charge')}${f('Khoản khác', 'other_charge')}</div>
      <div class="field"><label>Ghi chú khoản khác</label><input id="i_other_note" value="${esc(i.other_note || '')}"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveInvoice" data-args='[${id || 0}]'>Lưu</button></div>`, true);
}
async function saveInvoice(id) {
  const g = k => +el('i_' + k).value || 0;
  const body = { student_id: +el('i_stu').value, month: el('i_month').value, days_stayed: g('days_stayed'),
    room_charge: g('room_charge'), electric_charge: g('electric_charge'), water_charge: g('water_charge'),
    service_charge: g('service_charge'), washing_charge: g('washing_charge'), parking_charge: g('parking_charge'),
    other_charge: g('other_charge'), other_note: el('i_other_note').value.trim() };
  if (!body.student_id) return toast('Chọn học viên', 'err');
  await guard(() => id ? API.updateInvoice(id, body) : API.createInvoice(body));
  await refreshCache(); closeModal(); invMonth = body.month; toast('Đã lưu hóa đơn'); viewInvoices();
}
async function phieuBao(inv) {
  if (typeof inv !== 'object') inv = _invAll.find(x => x.id === +inv);  // nut truyen id; noi khac (sau khi sinh HD) truyen thang object
  if (!inv) return toast('Không tìm thấy hóa đơn', 'err');
  const s = studentById(inv.student_id) || {};
  const room = roomById(s.room_id) || {};
  const fac = ST.facilities.find(f => f.id === room.facility_id) || {};
  const set = ST.settings;
  let er = null; try { er = (await API.electric(inv.month)).find(x => x.room_id === s.room_id); } catch {}
  const unit = +set.electric_unit || 0;
  const occ = ST.students.filter(x => x.room_id === s.room_id && isOccupying(x)).length || 1;

  const rows = [];
  let stt = 0;
  const row = (khoan, ct, tt) => rows.push(`<tr><td>${++stt}</td><td><strong>${khoan}</strong></td><td>${ct}</td><td class="n">${money(tt)}</td></tr>`);
  row('Tiền phòng', `${inv.days_stayed} ngày ở · ${RENTAL_LABEL[s.rental_type] || 'Thuê ghép'}`, inv.room_charge);
  row('Tiền điện', er ? `CS ${er.reading_start}→${er.reading_end} · ${inv.electric_kwh} kWh × ${money(unit)} ÷ ${occ} người` : `${inv.electric_kwh} kWh × ${money(unit)}`, inv.electric_charge);
  row('Tiền nước', `${money(set.water_fee)}/người/tháng`, inv.water_charge);
  row('Phí dịch vụ', 'Wifi + Rác + An ninh trật tự', inv.service_charge);
  if (+inv.washing_charge) row('Máy giặt', `${money(set.washing_fee)}/tháng`, inv.washing_charge);
  if (+inv.parking_charge) row('Gửi xe', `${money(set.parking_fee)}/xe`, inv.parking_charge);
  if (+inv.other_charge) row(inv.other_note || 'Khoản khác', '', inv.other_charge);
  // Các khoản GIẢM đứng riêng, ghi số âm — người đọc thấy rõ được ưu đãi gì, vì sao tổng thấp hơn
  if (+inv.room_discount) row('Giảm tiền phòng', `Ưu đãi riêng ${+s.room_fee_discount_pct || 0}% tiền phòng`, -inv.room_discount);
  if (+inv.leader_discount) row('Giảm phòng trưởng', 'Miễn tiền nước + phí dịch vụ', -inv.leader_discount);

  openModal(`
    <div class="mh rc-noprint"><h3>${IC.fileText} Phiếu báo tiền phòng</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb"><div id="receiptArea"><div class="receipt">
      <div class="rc-head">
        <h2>${esc(set.dorm_name || 'Ký túc xá')}</h2>
        <div class="addr">${esc(fac.address || '')}${set.hotline ? ' · Hotline: ' + esc(set.hotline) : ''}</div>
      </div>
      <div class="rc-title">PHIẾU BÁO TIỀN PHÒNG — ${monthLabel(inv.month).toUpperCase()}</div>
      <div class="rc-info">
        <div><b>Họ và tên:</b> ${esc(s.name)}</div>
        <div><b>Phòng:</b> ${esc(inv.room_name || '—')} (Hạng ${esc(room.hang || '')}) &nbsp;&nbsp; <b style="min-width:0">MSHV:</b> ${esc(s.code || '—')} &nbsp;&nbsp; <b style="min-width:0">Lớp:</b> ${esc(s.class_name || '—')}</div>
        <div><b>Ngày nhận phòng:</b> ${fmtDate(s.check_in_date)}</div>
      </div>
      <table><thead><tr><th style="width:36px">STT</th><th>Khoản thu</th><th>Chi tiết</th><th class="n">Thành tiền (đồng)</th></tr></thead><tbody>
        ${rows.join('')}
        <tr class="rc-total"><td colspan="3">TỔNG CỘNG PHẢI NỘP</td><td class="n">${money(inv.total)}</td></tr>
      </tbody></table>
      <div class="rc-note">
        ${IC.creditCard} Thanh toán qua <strong>mã QR</strong> do quản lý gửi trên Zalo. Hạn đóng: <strong>ngày ${set.due_day_from || 1}–${set.due_day_to || 5}</strong> hàng tháng.<br>
        ${IC.pin} Nếu có sai sót, vui lòng báo lại trước ngày 05. Xin cảm ơn!
      </div>
    </div></div></div>
    <div class="mf rc-noprint">
      <button class="btn" data-act="closeModal">Đóng</button>
      <button class="btn" data-act="doPrint">${IC.printer} In phiếu</button>
      <button class="btn pri" data-act="downloadPhieuBao" data-args='["phieu-bao-${esc(String(s.code || inv.student_id))}-${inv.month}"]'>${IC.download} Tải phiếu báo</button>
    </div>`, true);
}
// Tải phiếu báo dưới dạng file HTML tự chứa (không in) — mở ra đúng định dạng, tự lưu PDF nếu muốn
function downloadPhieuBao(fname) {
  const inner = el('receiptArea') ? el('receiptArea').innerHTML : '';
  const css = `<style>
    body{margin:0;padding:24px;background:#fff}
    .receipt{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#2a251f;max-width:620px;margin:0 auto}
    .receipt .rc-head{text-align:center;border-bottom:2px solid #b8863b;padding-bottom:16px;margin-bottom:16px}
    .receipt .rc-head h2{margin:0;font-size:24px;color:#2a251f;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
    .receipt .rc-head .addr{font-size:12.5px;color:#6a6055;margin-top:5px}
    .receipt .rc-title{text-align:center;font-size:15px;font-weight:700;margin:6px 0 16px;letter-spacing:.03em;text-transform:uppercase;color:#8a6528}
    .receipt .rc-info{font-size:13.5px;line-height:1.95}
    .receipt .rc-info b{display:inline-block;min-width:120px;color:#4a443c}
    .receipt table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px}
    .receipt th,.receipt td{border:1px solid #e2d8ca;padding:9px 11px;text-align:left}
    .receipt th{background:#f5ecd9;font-size:12px;color:#4a443c}
    .receipt td.n,.receipt th.n{text-align:right}
    .receipt .rc-total{background:#fbf4e8}
    .receipt .rc-total td{font-weight:800;font-size:15px;color:#8a6528}
    .receipt .rc-note{font-size:12.5px;color:#6a6055;margin-top:14px;border-top:1px dashed #d8cdbd;padding-top:10px}
    .receipt .rc-note svg{width:15px;height:15px;vertical-align:-2px}
  </style>`;
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(fname)}</title>${css}</head><body>${inner}</body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  a.download = fname + '.html'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Đã tải phiếu báo');
}
// Ô CSV an toàn với Excel: chặn CSV injection — tên bắt đầu bằng = + - @ (hoặc tab/CR) sẽ chạy như
// CÔNG THỨC khi mở bằng Excel. Người ngoài tự nhập tên ở /dang-ky nên đây là đường tấn công thật (TP-26).
// Thêm dấu ' phía trước để Excel coi là văn bản, rồi bọc ngoặc kép + nhân đôi " như cũ.
function csvCell(c) {
  let s = String(c == null ? '' : c);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function exportCSV() {
  const rows = _invAll.filter(i => invFilter === 'paid' ? i.status === 'paid' : invFilter === 'unpaid' ? i.status !== 'paid' : true); // dung danh sach dang loc (nhu luc render)
  const head = ['Ho ten', 'Ma HV', 'Phong', 'Ky', 'So ngay o', 'Tien phong', 'Dien (kWh)', 'Tien dien', 'Nuoc', 'Dich vu', 'May giat', 'Gui xe', 'Khac', 'Giam tien phong', 'Giam phong truong', 'Tong'];
  const data = rows.map(i => [i.student_name, i.student_code || '', i.room_name || '', i.month, i.days_stayed, i.room_charge, i.electric_kwh, i.electric_charge, i.water_charge, i.service_charge, i.washing_charge, i.parking_charge, i.other_charge, i.room_discount || 0, i.leader_discount || 0, i.total]);
  const csv = '﻿' + [head, ...data].map(r => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `tien-phong-${invMonth}.csv`; a.click();
  toast('Đã xuất file CSV');
}

/* ---------- CÀI ĐẶT ---------- */
let settingsTab = 'gia'; // nhóm cài đặt đang mở (trang dài -> gom thành menu, mỗi lần hiện 1 nhóm)
function viewSettings() {
  const s = ST.settings;
  // Số tiền 7 chữ số rất dễ gõ dư/thiếu số 0 -> hiện luôn bản đã phân cách nghìn ngay dưới ô, cập nhật khi gõ
  const fee = (lbl, key, note = '') => `<div class="field"><label>${lbl} ${note ? `<span class="opt">${note}</span>` : ''}</label><input id="set_${key}" type="number" min="0" value="${esc(s[key] || 0)}" data-input="feeHint" data-args='["${key}"]'><div class="sub2" id="hint_${key}" style="margin-top:4px">${money(s[key] || 0)}</div></div>`;
  // Menu gom nhóm: mọi panel VẪN nằm trong DOM (chỉ ẩn bằng [hidden]) để nút "Lưu" đọc field chéo
  // panel (vd saveSettings đọc cả phiếu báo + đơn giá + ngưỡng) và loadAdminUsers/loadDataHealth vẫn chạy.
  const SET_TABS = [
    ['gia', 'Đơn giá & tính tiền', IC.banknote],
    ['coso', 'Cơ sở & tài sản', IC.building],
    ['gioithieu', 'Trang giới thiệu', IC.filePen],
    ['vipham', 'Vi phạm & Email', IC.inbox],
    ['baomat', 'Bảo mật & người dùng', IC.shield],
    ['hethong', 'Hệ thống & dữ liệu', IC.clipboard],
  ];
  if (!SET_TABS.some(t => t[0] === settingsTab)) settingsTab = 'gia';
  const setNav = `<div class="pill-row set-nav">${SET_TABS.map(([id, label, ic]) =>
    `<button class="btn sm ${settingsTab === id ? 'pri' : ''}" data-tab="${id}" data-act="settingsGo" data-args='["${id}"]'>${ic} ${label}</button>`).join('')}</div>`;
  const grpOpen = id => `<div class="set-group" data-setgroup="${id}"${settingsTab === id ? '' : ' hidden'}>`;
  el('content').innerHTML = setNav + `
    ${grpOpen('gia')}
    <div class="panel"><div class="hd"><h2>${IC.home} Thông tin hiển thị trên phiếu báo</h2></div><div class="pad">
      <div class="field"><label>Tên ký túc xá</label><input id="set_dorm_name" value="${esc(s.dorm_name || '')}"></div>
      <div class="grid2">
        <div class="field"><label>Hạn đóng tiền — từ ngày</label><input id="set_due_day_from" type="number" min="1" max="31" value="${esc(s.due_day_from ?? 1)}"></div>
        <div class="field"><label>Hạn đóng tiền — đến ngày</label><input id="set_due_day_to" type="number" min="1" max="31" value="${esc(s.due_day_to ?? 5)}"></div>
      </div>
      <p class="muted" style="font-size:12px;margin:0">${IC.info} Tên KTX + hạn đóng hiện trên <strong>phiếu báo</strong>. Địa chỉ lấy theo từng cơ sở (mục Cơ sở); hotline ở mục <strong>Trang giới thiệu</strong>.</p>
    </div></div>
    <div class="panel"><div class="hd"><h2>${IC.banknote} Đơn giá & quy tắc tính tiền</h2></div><div class="pad">
      <div class="grid2">
        ${fee('Tiền phòng', 'room_fee', '/người/tháng')}
        ${fee('Cọc', 'deposit_fee', 'khi nhận phòng')}
      </div>
      <div class="grid2">
        ${fee('Nước', 'water_fee', '/người/tháng')}
        ${fee('Điện', 'electric_unit', '/kWh')}
      </div>
      <div class="grid2">
        ${fee('Dịch vụ', 'service_fee', '/người/tháng')}
        ${fee('Máy giặt', 'washing_fee', '/tháng')}
      </div>
      <div class="grid2">
        ${fee('Gửi xe', 'parking_fee', '/xe/tháng')}
        <div></div>
      </div>
      <div style="font-weight:600;font-size:13px;margin:6px 0 10px">${IC.home} Giá thuê nguyên phòng theo hạng</div>
      <div class="grid2">
        ${fee('Hạng A', 'room_price_A', '/phòng/tháng')}
        ${fee('Hạng B', 'room_price_B', '/phòng/tháng')}
      </div>
      <div class="grid2">
        ${fee('Hạng C', 'room_price_C', '/phòng/tháng')}
        ${fee('Hạng D', 'room_price_D', '/phòng/tháng')}
      </div>
      <div class="grid2">
        <div class="field"><label>Tháng lẻ: ở trên (ngày) → tính 50%</label><input id="set_partial_half_min" type="number" min="0" value="${esc(s.partial_half_min)}"></div>
        <div class="field"><label>Tháng lẻ: ở trên (ngày) → tính 100%</label><input id="set_partial_full_min" type="number" min="0" value="${esc(s.partial_full_min)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Pháp nhân phòng Nữ</label><input id="set_legal_female" value="${esc(s.legal_female || 'E2')}"></div>
        <div class="field"><label>Pháp nhân phòng Nam</label><input id="set_legal_male" value="${esc(s.legal_male || 'S2')}"></div>
      </div>
      <button class="btn pri" data-act="saveSettings">Lưu cài đặt</button>
    </div></div>

    <div class="panel"><div class="hd"><h2>${IC.alert} Ngưỡng nhắc / nghiệp vụ</h2></div><div class="pad">
      <div class="hint">${IC.info} Các mốc nhắc việc & quy tắc — chỉnh ở đây, không cần sửa code. Lưu chung nút "Lưu cài đặt" ở trên.</div>
      <div class="grid2">
        <div class="field"><label>Nhắc khi ở quá <span class="opt">(ngày) chưa ký HĐ / chưa tạm trú / chưa lập phiếu</span></label><input id="set_overdue_remind_days" type="number" min="1" value="${esc(s.overdue_remind_days ?? 7)}"></div>
        <div class="field"><label>Ngưỡng thuê ghép ngắn hạn <span class="opt">(ở dưới N ngày = ngắn hạn, chỉ ký phiếu)</span></label><input id="set_shortterm_max_days" type="number" min="1" value="${esc(s.shortterm_max_days ?? 60)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Hoàn cọc: báo trước tối thiểu <span class="opt">(ngày)</span></label><input id="set_deposit_notice_min_days" type="number" min="0" value="${esc(s.deposit_notice_min_days ?? 30)}"></div>
        <div class="field"><label>Hệ số phí tháng lẻ mức "nửa" <span class="opt">(0–1, vd 0.5)</span></label><input id="set_partial_half_factor" type="number" min="0" max="1" step="0.05" value="${esc(s.partial_half_factor ?? 0.5)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>HV tự xin trả phòng: xa nhất <span class="opt">(ngày tới)</span></label><input id="set_checkout_max_future_days" type="number" min="1" value="${esc(s.checkout_max_future_days ?? 365)}"></div>
        <div class="field"><label>Trần ảnh CCCD <span class="opt">(MB, ≤ 15)</span></label><input id="set_max_cccd_mb" type="number" min="1" max="15" value="${esc(s.max_cccd_mb ?? 12)}"></div>
      </div>
      <div style="font-weight:600;font-size:13px;margin:6px 0 8px">${IC.bed} Trần giường theo hạng phòng <span class="opt" style="font-weight:400">(sức chứa tối đa cho phép nhập)</span></div>
      <div class="grid2">
        <div class="field"><label>Hạng A</label><input id="set_room_cap_A" type="number" min="1" max="20" value="${esc(s.room_cap_A ?? 8)}"></div>
        <div class="field"><label>Hạng B</label><input id="set_room_cap_B" type="number" min="1" max="20" value="${esc(s.room_cap_B ?? 8)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Hạng C</label><input id="set_room_cap_C" type="number" min="1" max="20" value="${esc(s.room_cap_C ?? 8)}"></div>
        <div class="field"><label>Hạng D</label><input id="set_room_cap_D" type="number" min="1" max="20" value="${esc(s.room_cap_D ?? 8)}"></div>
      </div>
      <button class="btn pri" data-act="saveSettings">Lưu cài đặt</button>
    </div></div>

    <div class="panel"><div class="hd"><h2>${IC.receipt} Mã sản phẩm Bravo (đối chiếu doanh thu)</h2></div><div class="pad">
      <div class="field"><label>Loại phí chung</label><input id="set_bravo_fee_type" value="${esc(s.bravo_fee_type || '')}" placeholder="T0704" style="max-width:200px"></div>
      <div class="grid2">
        <div class="field"><label>Phí lưu trú (tiền phòng)</label><input id="set_bravo_room" value="${esc(s.bravo_room || '')}" placeholder="GP00180"></div>
        <div class="field"><label>Phí điện</label><input id="set_bravo_electric" value="${esc(s.bravo_electric || '')}" placeholder="GP00184"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Phí nước</label><input id="set_bravo_water" value="${esc(s.bravo_water || '')}" placeholder="GP00181"></div>
        <div class="field"><label>Phí dịch vụ chung</label><input id="set_bravo_service" value="${esc(s.bravo_service || '')}" placeholder="GP00183"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Phí gửi xe</label><input id="set_bravo_parking" value="${esc(s.bravo_parking || '')}" placeholder="GP00182"></div>
        <div class="field"><label>Phí máy giặt</label><input id="set_bravo_washing" value="${esc(s.bravo_washing || '')}" placeholder="GP00197"></div>
      </div>
      <button class="btn pri" data-act="saveBravo">Lưu mã Bravo</button>
    </div></div>
    </div>

    ${grpOpen('coso')}
    <div class="panel"><div class="hd"><h2>${IC.building} Cơ sở ký túc xá</h2><button class="btn sm" data-act="facilityForm">${IC.plus} Thêm cơ sở</button></div>
      <div class="table-wrap"><table><thead><tr><th>Tên</th><th>Địa chỉ</th><th class="num">Số phòng</th><th></th></tr></thead><tbody>
        ${ST.facilities.map(f => `<tr><td><strong>${esc(f.name)}</strong></td><td class="muted">${esc(f.address || '')}</td><td class="num">${f.room_count}</td>
          <td class="num"><div class="rowbtns" style="justify-content:flex-end"><button class="btn sm" data-act="facilityForm" data-args='[${f.id}]'>Sửa</button><button class="btn sm danger" data-act="delFacility" data-args='[${f.id}]'>Xóa</button></div></td></tr>`).join('')}
      </tbody></table></div>
    </div>

    <div class="panel"><div class="hd"><h2>${IC.armchair} Tài sản / trang thiết bị trong phòng</h2><button class="btn sm" data-act="assetForm">${IC.plus} Thêm tài sản</button></div>
      <div class="table-wrap"><table><thead><tr><th>Tên tài sản</th><th>Loại</th><th>ĐVT</th><th class="num">SL</th><th class="num">Phí bồi hoàn</th><th></th></tr></thead><tbody>
        ${ST.assets.map(a => `<tr>
          <td><strong>${esc(a.name)}</strong></td>
          <td>${a.category === 'person' ? '<span class="badge blue">Theo người</span>' : '<span class="badge gray">Cố định</span>'}</td>
          <td>${esc(a.unit)}</td><td class="num">${a.quantity}</td><td class="num">${a.fee ? money(a.fee) : '<span class="muted">—</span>'}</td>
          <td class="num"><div class="rowbtns" style="justify-content:flex-end"><button class="btn sm" data-act="assetForm" data-args='[${a.id}]'>Sửa</button><button class="btn sm ghost" data-act="delAsset" data-args='[${a.id}]'>${IC.trash}</button></div></td>
        </tr>`).join('')}
      </tbody></table></div>
      <div class="pad muted" style="font-size:12.5px">${IC.bulb} Phí bồi hoàn dùng để khấu trừ vào cọc khi học viên trả phòng (nếu tài sản hư/mất/không vệ sinh).</div>
    </div>
    </div>

    ${grpOpen('gioithieu')}
    <div class="panel"><div class="hd"><h2>${IC.filePen} Nội dung trang giới thiệu</h2><a class="btn sm" href="/dang-ky" target="_blank">Xem trang</a></div><div class="pad">
      <div class="hint">${IC.info} Chỉnh tiêu đề &amp; mô tả từng mục ở trang đăng ký công khai. Để trống sẽ dùng nội dung mặc định.</div>
      ${INTRO_FIELDS.map(([k, label, t]) => `<div class="field"><label>${label}</label>${t === 'ta' ? `<textarea id="set_${k}" rows="2">${esc(s[k] || '')}</textarea>` : `<input id="set_${k}" value="${esc(s[k] || '')}">`}</div>`).join('')}
      <button class="btn pri" data-act="saveIntro">Lưu nội dung</button>
    </div></div>

    <div class="panel"><div class="hd"><h2>${IC.building} Ảnh khu nội trú (trang giới thiệu)</h2></div><div class="pad">
      <div class="hint">${IC.info} Ảnh hiển thị ở <strong>trang đăng ký công khai</strong> cho học viên xem. Chọn ảnh từ máy — lưu ngay, <strong>không cần sửa code</strong>. Nên dùng ảnh ngang, dung lượng < 1MB để tải nhanh.</div>
      <div class="media-grid">
        ${INTRO_MEDIA.map(([key, label]) => `<div class="media-slot">
          <div class="media-thumb"><img src="/api/public/image/${key}?t=${Date.now()}" alt="" data-err="onImgFallback"><div class="media-empty" style="display:none">${IC.building}<span>Chưa có ảnh</span></div></div>
          <div class="media-info">${key === 'hero' ? `<strong>${label}</strong><div class="muted" style="font-size:11px">Ảnh nền — không có nhãn</div>` : `<label style="font-size:11px;color:var(--muted);font-weight:600">Nhãn hiển thị</label><input id="set_imgcap_${key}" value="${esc(s['imgcap_' + key] || label)}" placeholder="VD: ${esc(label)}">`}</div>
          <div class="rowbtns">
            <label class="btn sm">${IC.download} Chọn ảnh<input type="file" accept="image/*" style="display:none" data-change="onIntroMedia" data-mkey="${key}"></label>
            <button class="btn sm ghost" title="Xóa ảnh" data-act="removeIntroMedia" data-args='["${key}"]'>${IC.trash}</button>
          </div>
        </div>`).join('')}
      </div>
      <button class="btn pri" style="margin-top:14px" data-act="saveImgCaptions">Lưu nhãn ảnh</button>
    </div></div>
    </div>

    ${grpOpen('vipham')}
    <div class="panel"><div class="hd"><h2>${IC.alert} Loại vi phạm / nhắc nhở</h2><button class="btn sm" data-act="vtypeForm">${IC.plus} Thêm loại</button></div>
      <div class="table-wrap"><table><thead><tr><th>Tên loại vi phạm</th><th>Mức độ</th><th></th></tr></thead><tbody>
        ${(ST.vtypes || []).map(t => `<tr>
          <td><strong>${esc(t.name)}</strong>${t.active === false ? ' <span class="badge gray">Ẩn</span>' : ''}</td>
          <td>${vioSevBadge(t.severity)}</td>
          <td class="num"><div class="rowbtns" style="justify-content:flex-end"><button class="btn sm" data-act="vtypeForm" data-args='[${t.id}]'>Sửa</button><button class="btn sm ghost" data-act="delVtype" data-args='[${t.id}]'>${IC.trash}</button></div></td>
        </tr>`).join('')}
      </tbody></table></div>
      <div class="pad muted" style="font-size:12.5px">${IC.bulb} Dùng khi ghi nhận vi phạm cho học viên. Đến ngưỡng cấu hình bên dưới, hệ thống gửi email nhà trường.</div>
    </div>

    <div class="panel"><div class="hd"><h2>${IC.inbox} Nhà trường & Email (SMTP)</h2></div><div class="pad">
      <div class="grid2">
        <div class="field"><label>Tên nhà trường</label><input id="set_school_name" value="${esc(s.school_name || '')}" placeholder="VD: Trường Nhật ngữ ..."></div>
        <div class="field"><label>Email nhà trường <span class="opt">(nhận thông báo vi phạm)</span></label><input id="set_school_email" value="${esc(s.school_email || '')}" placeholder="daotao@truong.edu.vn"></div>
      </div>
      <div class="field"><label>Gửi email khi vi phạm đủ <span class="opt">(số lần)</span></label><input id="set_violation_mail_threshold" type="number" min="1" value="${esc(s.violation_mail_threshold || 3)}" style="max-width:120px"></div>
      <div class="hint">${IC.info} Điền cấu hình SMTP để hệ thống tự gửi email. Gmail: host <strong>smtp.gmail.com</strong> · port <strong>587</strong> · secure <strong>false</strong> · mật khẩu dùng <strong>App Password</strong> (không dùng mật khẩu đăng nhập thường).</div>
      <div class="grid2">
        <div class="field"><label>SMTP host</label><input id="set_smtp_host" value="${esc(s.smtp_host || '')}" placeholder="smtp.gmail.com"></div>
        <div class="field"><label>Port</label><input id="set_smtp_port" value="${esc(s.smtp_port || '587')}" placeholder="587"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Tài khoản (user)</label><input id="set_smtp_user" value="${esc(s.smtp_user || '')}" placeholder="email gửi đi"></div>
        <div class="field"><label>Mật khẩu (App Password) ${s.smtp_pass_set ? '<span class="badge green" style="font-size:10px">Đã lưu</span>' : ''}</label><input id="set_smtp_pass" type="password" value="" placeholder="${s.smtp_pass_set ? '•••••• (để trống nếu giữ nguyên)' : 'Nhập App Password'}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Người gửi <span class="opt">(from)</span></label><input id="set_smtp_from" value="${esc(s.smtp_from || '')}" placeholder="Ban quản lý KTX"></div>
        <div class="field"><label>Bảo mật (secure)</label><select id="set_smtp_secure"><option value="false" ${s.smtp_secure !== 'true' ? 'selected' : ''}>false — STARTTLS (port 587)</option><option value="true" ${s.smtp_secure === 'true' ? 'selected' : ''}>true — SSL/TLS (port 465)</option></select></div>
      </div>
      <div class="hint" style="font-size:12px">${IC.lock} Vì bảo mật, mật khẩu SMTP <strong>không bao giờ được trả về</strong>. Để trống ô mật khẩu khi lưu nếu muốn giữ nguyên mật khẩu đã lưu.</div>
      <div class="rowbtns" style="margin-top:6px">
        <button class="btn pri" data-act="saveMailSettings">Lưu cấu hình email</button>
        <button class="btn" id="smtpTestBtn" data-act="testSmtpConnection">${IC.mail} Kiểm tra kết nối</button>
        <span id="smtpTestResult" class="muted" style="font-size:12.5px;align-self:center"></span>
      </div>
    </div></div>
    </div>

    ${grpOpen('baomat')}
    <div class="panel"><div class="hd"><h2>${IC.shield} Đăng nhập bằng tài khoản Microsoft (SSO)</h2>
      <span class="muted" style="font-size:12px">${s.sso_enabled === 'true' && s.sso_tenant_id && s.sso_client_id ? '<span class="badge green">Đang bật</span>' : '<span class="badge gray">Đang tắt</span>'}</span></div><div class="pad">
      <div class="hint">${IC.info} Lấy 3 thông số ở <strong>Azure Portal → Microsoft Entra ID → App registrations</strong>.
        Khi đăng ký ứng dụng phải khai đúng <strong>Redirect URI</strong>:
        <code>${esc(location.origin)}/api/auth/sso/callback</code> và cấp quyền <code>openid profile email</code>.
        Đủ 3 thông số + bật lên thì nút "Đăng nhập bằng Microsoft" mới hiện ở màn đăng nhập.</div>
      <div class="hint" style="font-size:12px">${IC.lock} Nếu máy chủ có biến môi trường <code>AZURE_TENANT_ID</code> / <code>AZURE_CLIENT_ID</code> / <code>AZURE_CLIENT_SECRET</code> thì
        <strong>ENV được ưu tiên</strong> hơn giá trị điền ở đây (môi trường thật nên giữ bí mật ở ENV, không nằm trong CSDL).</div>
      <div class="grid2">
        <div class="field"><label>Bật đăng nhập Microsoft</label><select id="set_sso_enabled">
          <option value="false" ${s.sso_enabled !== 'true' ? 'selected' : ''}>Tắt</option>
          <option value="true" ${s.sso_enabled === 'true' ? 'selected' : ''}>Bật</option>
        </select></div>
        <div class="field"><label>Chỉ nhận email thuộc tên miền <span class="opt">(cách nhau dấu phẩy — để trống = mọi email trong tenant)</span></label>
          <input id="set_sso_allowed_domains" value="${esc(s.sso_allowed_domains || '')}" placeholder="esuhai.com, esuhai.vn"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Tenant ID (Directory ID)</label><input id="set_sso_tenant_id" value="${esc(s.sso_tenant_id || '')}" placeholder="vd 72f988bf-86f1-41af-91ab-..."></div>
        <div class="field"><label>Client ID (Application ID)</label><input id="set_sso_client_id" value="${esc(s.sso_client_id || '')}" placeholder="vd 11111111-2222-3333-..."></div>
      </div>
      <div class="field"><label>Client Secret <span class="opt">(tuỳ chọn)</span> ${s.sso_client_secret_set ? '<span class="badge green" style="font-size:10px">Đã lưu</span>' : ''}</label>
        <input id="set_sso_client_secret" type="password" value="" placeholder="${s.sso_client_secret_set ? '•••••• (để trống nếu giữ nguyên)' : 'Để trống nếu dùng public client (PKCE)'}"></div>
      <div class="hint" style="font-size:12px">${IC.lock} Client Secret <strong>không bao giờ được trả về</strong> giao diện. Để trống khi lưu = giữ nguyên cái đã lưu (nếu có).
        <br>${IC.info} <strong>Có thể bỏ trống hẳn</strong> — chỉ cần Tenant ID + Client ID — nếu app trên Azure bật <strong>"Allow public client flows"</strong>. Khi đó đăng nhập dựa trên <strong>PKCE</strong> thay cho secret (app server nên dùng secret; chỉ bỏ khi bạn hiểu đánh đổi bảo mật).</div>
      <div class="rowbtns" style="margin-top:6px"><button class="btn pri" data-act="saveSsoSettings">Lưu cấu hình Microsoft</button></div>
    </div></div>

    <div class="panel" id="usersPanel"><div class="hd"><h2>${IC.shield} Người dùng & phân quyền</h2><button class="btn sm" data-act="userForm">${IC.plus} Thêm nhân viên</button></div>
      <div class="table-wrap"><table><thead><tr><th>Tên đăng nhập</th><th>Họ tên</th><th>Vai trò</th><th>Cơ sở</th><th></th></tr></thead>
        <tbody id="usrRows"><tr><td colspan="5"><div class="spinner"></div></td></tr></tbody></table></div>
      <div class="pad muted" style="font-size:12.5px">${IC.bulb} <strong>Quản trị viên</strong> có toàn quyền (kể cả Điều hành, Doanh thu, Nhật ký, Cài đặt). <strong>Nhân viên</strong> chỉ thao tác nghiệp vụ (Học viên, Phòng, Xe, Check-in/out, Tiền phòng, Tiếp nhận & Hỗ trợ) và đều được ghi vào Nhật ký.</div>
    </div>

    <div class="panel"><div class="hd"><h2>${IC.key} Tài khoản của bạn</h2></div><div class="pad">
      <button class="btn" data-act="changePwd">${IC.key} Đổi mật khẩu</button>
    </div></div>
    </div>

    ${grpOpen('hethong')}
    ${dataHealthBlock()}
    ${rulesDocBlock()}
    </div>`;
  loadAdminUsers();
  refreshRulesDocStatus();
  loadDataHealth();
}
// Menu Cài đặt: đổi nhóm đang hiện, KHÔNG vẽ lại (giữ ảnh đã tải, không chạy lại loadAdminUsers/loadDataHealth).
function settingsGo(t) {
  settingsTab = t;
  document.querySelectorAll('#content .set-group').forEach(g => { g.hidden = g.dataset.setgroup !== t; });
  document.querySelectorAll('#content .set-nav button').forEach(b => b.classList.toggle('pri', b.dataset.tab === t));
  window.scrollTo({ top: 0 });
}
// Bấm thông báo "N tài khoản Microsoft chờ duyệt" -> vào Cài đặt và CUỘN THẲNG tới mục Người dùng
// (không phải scroll tay). viewSettings dựng #usersPanel đồng bộ nên chỉ cần đợi 1-2 frame cho vẽ xong.
function gotoUsers() {
  settingsTab = 'baomat'; // mục Người dùng nằm trong nhóm "Bảo mật & người dùng"
  adminGo('settings');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const p = el('usersPanel'); if (!p) return;
    p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    p.classList.add('flash'); setTimeout(() => p.classList.remove('flash'), 1600);
  }));
}
/* ---------- Quản lý tài khoản nhân viên (chỉ quản trị) ---------- */
const ROLE_LABEL = { admin: ['Quản trị viên', 'gray'], staff: ['Nhân viên', 'blue'], maintenance: ['Bảo trì', 'amber'] };
async function loadAdminUsers() {
  const box = el('usrRows'); if (!box) return;
  let users = [];
  try { users = await API.adminUsers(); } catch (e) { box.innerHTML = `<tr><td colspan="5" class="muted">${esc(e.message)}</td></tr>`; return; }
  const me = Auth.user.id;
  box.innerHTML = users.map(u => {
    const [rl, rc] = ROLE_LABEL[u.role] || [u.role, 'gray'];
    // Tài khoản do đăng nhập Microsoft tự tạo, chưa duyệt: phải ĐẬP VÀO MẮT admin, kèm email để
    // đối chiếu người thật. Duyệt = bấm "Sửa" rồi gán vai + cơ sở (server tự bật approved).
    const cho = u.approved === false;
    return `<tr${cho ? ' style="background:var(--bg2)"' : ''}>
      <td><strong>${esc(u.username)}</strong>${u.id === me ? ' <span class="badge amber" style="font-size:10px">Bạn</span>' : ''}
        ${u.auth_provider && u.auth_provider !== 'local' ? `<span class="badge blue" style="font-size:10px" title="Đăng nhập bằng Microsoft">${esc(u.auth_provider === 'sso' ? 'Microsoft' : 'MK + Microsoft')}</span>` : ''}
        ${u.email ? `<div class="muted" style="font-size:11px">${esc(u.email)}</div>` : ''}</td>
      <td>${esc(u.full_name || '—')}</td>
      <td>${cho ? '<span class="badge amber" title="Tự tạo qua Microsoft — bấm Sửa để gán vai + cơ sở, gán xong là duyệt">⏳ Chờ duyệt</span>' : `<span class="badge ${rc}">${rl}</span>`}</td>
      <td>${u.facility_id ? esc(u.facility_name || facilityName(u.facility_id)) : '<span class="badge gray" title="Điều hành — thấy tất cả cơ sở">Tất cả</span>'}</td>
      <td class="num"><div class="rowbtns" style="justify-content:flex-end">
        <button class="btn sm" data-act="userForm" data-args='[${u.id}]'>Sửa</button>
        <button class="btn sm" data-act="resetUserPwForm" data-args='[${u.id}]'>${IC.key} MK</button>
        ${u.id === me ? '' : `<button class="btn sm ghost" title="Xóa" data-act="delUserRow" data-args='[${u.id}]' data-uname="${esc(u.username)}">${IC.trash}</button>`}
      </div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">Chưa có tài khoản.</td></tr>';
  window._usrCache = users;
}
function userForm(id) {
  const u = id ? (window._usrCache || []).find(x => x.id === id) : { username: '', full_name: '', role: 'staff' };
  if (id && !u) return;
  const roleOpt = (v, l) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`;
  openModal(`
    <div class="mh"><h3>${id ? 'Sửa tài khoản' : 'Thêm nhân viên'}</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="field"><label>Tên đăng nhập *</label><input id="u_username" value="${esc(u.username)}" ${id ? 'disabled' : ''} placeholder="vd: nhanvien01"></div>
      <div class="field"><label>Họ tên</label><input id="u_full" value="${esc(u.full_name || '')}" placeholder="Nguyễn Văn A"></div>
      <div class="field"><label>Vai trò</label><select id="u_role">${roleOpt('staff', 'Nhân viên — thao tác nghiệp vụ')}${roleOpt('maintenance', 'Bảo trì / An ninh — xử lý báo hư hỏng')}${roleOpt('admin', 'Quản trị viên — toàn quyền')}</select></div>
      <div class="field"><label>Cơ sở phụ trách</label><select id="u_facility">
        <option value="">Tất cả cơ sở (điều hành)</option>
        ${(ST.facilities || []).map(f => `<option value="${f.id}" ${u.facility_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
      </select><div class="sub2" style="margin-top:4px">Để "Tất cả cơ sở" = điều hành, thấy &amp; quản lý mọi cơ sở. Chọn một cơ sở = chỉ thấy dữ liệu cơ sở đó.</div></div>
      ${id ? '' : `<div class="field"><label>Mật khẩu *</label><input id="u_pass" type="text" placeholder="Tối thiểu 6 ký tự"></div>`}
      ${id === Auth.user.id ? `<div class="hint">${IC.info} Bạn không thể tự hạ quyền chính mình.</div>` : ''}
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveUser" data-args='[${id || 0}]'>Lưu</button></div>`);
}
async function saveUser(id) {
  const body = { full_name: el('u_full').value.trim(), role: el('u_role').value, facility_id: el('u_facility').value };
  if (!id) { body.username = el('u_username').value.trim(); body.password = el('u_pass').value.trim(); if (body.password.length < 6) return toast('Mật khẩu tối thiểu 6 ký tự', 'err'); }
  await guard(() => id ? API.updateUser(id, body) : API.createUser(body));
  closeModal(); toast(id ? 'Đã cập nhật tài khoản' : 'Đã tạo tài khoản'); loadAdminUsers();
}
function resetUserPwForm(id) {
  const u = (window._usrCache || []).find(x => x.id === id);
  openModal(`
    <div class="mh"><h3>Đặt lại mật khẩu</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <p class="muted" style="margin-top:0">Tài khoản: <strong>${esc(u ? u.username : '')}</strong></p>
      <div class="field"><label>Mật khẩu mới *</label><input id="u_newpass" type="text" placeholder="Tối thiểu 6 ký tự"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="doResetUserPw" data-args='[${id}]'>Đổi mật khẩu</button></div>`);
}
async function doResetUserPw(id) {
  const pw = el('u_newpass').value.trim();
  if (pw.length < 6) return toast('Mật khẩu tối thiểu 6 ký tự', 'err');
  await guard(() => API.resetUserPw(id, pw));
  closeModal(); toast('Đã đổi mật khẩu');
}
async function delUser(id, name) {
  if (!confirm(`Xóa tài khoản "${name}"? Không thể hoàn tác.`)) return;
  await guard(() => API.deleteUser(id));
  toast('Đã xóa tài khoản'); loadAdminUsers();
}
/* Ảnh trang giới thiệu (upload trong Cài đặt) */
function uploadIntroMedia(key, input) {
  const f = input.files[0]; if (!f) return;
  if (f.size > 6 * 1024 * 1024) { input.value = ''; return toast('Ảnh quá lớn (tối đa 6MB)', 'err'); }
  const r = new FileReader();
  r.onload = async () => {
    try {
      await guard(() => API.uploadMedia(key, r.result));
      toast('Đã cập nhật ảnh'); viewSettings();
    } catch (e) { input.value = ''; }
  };
  r.readAsDataURL(f);
}
async function removeIntroMedia(key) {
  if (!confirm('Xóa ảnh này? Trang giới thiệu sẽ hiện ô mẫu.')) return;
  await guard(() => API.deleteMedia(key)); toast('Đã xóa ảnh'); viewSettings();
}

/* Nội quy ký túc xá (PDF) — học viên xem ở trang "Phòng của tôi" */
function uploadRulesDoc(input) {
  const f = input.files[0]; if (!f) return;
  if (f.type !== 'application/pdf') { input.value = ''; return toast('Chỉ nhận file PDF', 'err'); }
  if (f.size > 15 * 1024 * 1024) { input.value = ''; return toast('File quá lớn (tối đa 15MB)', 'err'); }
  const r = new FileReader();
  r.onload = async () => {
    try { await guard(() => API.uploadDoc('noi-quy', r.result)); toast('Đã cập nhật nội quy'); viewSettings(); }
    catch (e) { input.value = ''; }
  };
  r.readAsDataURL(f);
}
async function removeRulesDoc() {
  if (!confirm('Xóa file nội quy?\n\nHọc viên sẽ không còn thấy mục "Nội quy ký túc xá" trong trang Phòng của tôi.')) return;
  await guard(() => API.deleteMedia('noi-quy')); toast('Đã xóa nội quy'); viewSettings();
}
/* ---- Tình trạng dữ liệu ----
   CSDL có tuyến phòng thủ chặn rác (tiền âm, trùng mã, trùng CCCD...). Nhưng ràng buộc CHỈ áp được
   khi dữ liệu đang sạch — chỗ nào còn vi phạm thì ràng buộc đó nằm im. Màn này bày ra ĐÍCH DANH
   bản ghi cần sửa; không có nó thì ràng buộc trượt trong im lặng và ai cũng tưởng đã được bảo vệ. */
function dataHealthBlock() {
  return `<div class="panel"><div class="hd"><h2>${IC.shield} Tình trạng dữ liệu</h2>
    <button class="btn sm" data-act="loadDataHealth">${IC.refresh} Kiểm tra lại</button></div>
    <div class="pad" id="dataHealth"><span class="muted">Đang kiểm tra...</span></div></div>`;
}
async function loadDataHealth() {
  const box = el('dataHealth'); if (!box) return;
  box.innerHTML = '<span class="muted">Đang kiểm tra...</span>';
  let d; try { d = await API.dataHealth(); } catch (e) { box.innerHTML = `<span class="muted">Không kiểm tra được: ${esc(e.message)}</span>`; return; }

  if (d.sach) {
    box.innerHTML = `<div class="hint" style="margin:0">${IC.checkCircle}<span><strong>Dữ liệu sạch.</strong>
      Toàn bộ ràng buộc bảo vệ đang hoạt động — không rác nào lọt vào được, kể cả gọi thẳng API.</span></div>`;
    return;
  }
  const loi = d.checks.filter(c => c.so_luong > 0);
  box.innerHTML = `
    ${d.guards.length ? `<div class="hint" style="margin:0 0 16px;border-color:var(--red);background:var(--red-bg)">${IC.alert}<span>
      <strong>${d.guards.length} ràng buộc bảo vệ đang TẮT</strong> vì dữ liệu bên dưới còn vi phạm:
      ${d.guards.map(g => `<code>${esc(g.ten)}</code>`).join(' · ')}.
      Sửa xong các mục bên dưới thì ràng buộc <strong>tự bật lại</strong> — không cần báo em.</span></div>` : ''}
    ${loi.map(c => `
      <div style="margin-bottom:18px">
        <h4 class="asset-h" style="color:var(--red-ink)">${IC.alert} ${esc(c.ten)} — ${c.so_luong} chỗ</h4>
        <p class="muted" style="margin:0 0 8px;font-size:13px">${esc(c.vi_sao)}<br><strong>Cách sửa:</strong> ${esc(c.cach_sua)}</p>
        <div class="table-wrap"><table><thead><tr><th>Trùng ở</th><th>Cụ thể</th></tr></thead><tbody>
          ${c.rows.map(r => `<tr><td><strong>${esc(r.khoa || '—')}</strong></td><td>${esc(r.chi_tiet || '')}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`).join('')}
    ${!loi.length ? `<div class="hint" style="margin:0">${IC.checkCircle}<span>Không tìm thấy dữ liệu vi phạm nào ở các mục đang kiểm.</span></div>` : ''}`;
}

// viewSettings() là hàm đồng bộ, không đợi API được -> vẽ khung trước, hỏi trạng thái file sau.
function rulesDocBlock() {
  return `<div class="panel"><div class="hd"><h2>${IC.clipboard} Nội quy ký túc xá</h2></div><div class="pad">
    <div class="flex" style="justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div id="rulesDocStatus" class="muted">Đang kiểm tra...</div>
      <div class="rowbtns" id="rulesDocBtns">
        <label class="btn sm pri" style="cursor:pointer;margin:0">${IC.plus} Tải file PDF
          <input type="file" accept="application/pdf" style="display:none" data-change="onRulesDoc"></label>
      </div>
    </div>
    <div class="hint" style="margin:14px 0 0">${IC.info}<span>File PDF, tối đa 15MB. Học viên xem ở trang
      <strong>Phòng của tôi</strong>; người đang tìm hiểu cũng đọc được trước khi đăng ký.</span></div>
  </div></div>`;
}
async function refreshRulesDocStatus() {
  const st = el('rulesDocStatus'), bt = el('rulesDocBtns');
  if (!st || !bt) return;
  // Hỏi danh sách media (đã có sẵn 'noi-quy') thay vì đi thử gọi file — thử gọi thì chưa có file
  // là console đỏ một dòng 404 mỗi lần mở Cài đặt.
  let m = null;
  try { m = (await API.mediaList()).find(x => x.key === 'noi-quy'); } catch {}
  const up = !!(m && m.uploaded);
  st.innerHTML = up ? `${IC.checkCircle} Đã tải lên${m.updated_at ? ` <span class="muted">— cập nhật ${fmtDate(String(m.updated_at).slice(0, 10))}</span>` : ''} — học viên xem được ở trang <strong>Phòng của tôi</strong>.`
    : 'Chưa có file. Học viên sẽ không thấy mục Nội quy.';
  st.className = up ? '' : 'muted';
  bt.innerHTML = `${up ? `<a class="btn sm" href="/api/public/doc/noi-quy" target="_blank" rel="noopener">Xem</a>
      <button class="btn sm ghost" title="Xóa file nội quy" data-act="removeRulesDoc">${IC.trash}</button>` : ''}
    <label class="btn sm pri" style="cursor:pointer;margin:0">${IC.plus} ${up ? 'Thay file' : 'Tải file PDF'}
      <input type="file" accept="application/pdf" style="display:none" data-change="onRulesDoc"></label>`;
}
async function saveIntro() {
  const body = {};
  INTRO_FIELDS.forEach(([k]) => body[k] = el('set_' + k).value);
  await guard(() => API.updateSettings(body));
  await refreshCache(); toast('Đã lưu nội dung trang giới thiệu'); // BL-24: không re-render, giữ input panel khác
}
async function saveImgCaptions() {
  const body = {};
  INTRO_MEDIA.forEach(([key]) => { const inp = el('set_imgcap_' + key); if (inp) body['imgcap_' + key] = inp.value; });
  await guard(() => API.updateSettings(body));
  await refreshCache(); toast('Đã lưu nhãn ảnh'); viewSettings();
}
function vtypeForm(id) {
  const t = id ? (ST.vtypes || []).find(x => x.id === id) : { name: '', severity: 'minor', active: true };
  const sevOpt = (v, l) => `<option value="${v}" ${t.severity === v ? 'selected' : ''}>${l}</option>`;
  openModal(`
    <div class="mh"><h3>${id ? 'Sửa loại vi phạm' : 'Thêm loại vi phạm'}</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="field"><label>Tên loại vi phạm *</label><input id="vt_name" value="${esc(t.name)}" placeholder="VD: Về trễ giờ quy định"></div>
      <div class="grid2">
        <div class="field"><label>Mức độ</label><select id="vt_sev">${sevOpt('minor', 'Nhẹ')}${sevOpt('major', 'Nặng')}${sevOpt('severe', 'Nghiêm trọng')}</select></div>
        ${id ? `<div class="field"><label>Trạng thái</label><select id="vt_active"><option value="1" ${t.active !== false ? 'selected' : ''}>Đang dùng</option><option value="0" ${t.active === false ? 'selected' : ''}>Ẩn</option></select></div>` : ''}
      </div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveVtype" data-args='[${id || 0}]'>Lưu</button></div>`);
  setTimeout(() => el('vt_name').focus(), 50);
}
async function saveVtype(id) {
  const body = { name: el('vt_name').value.trim(), severity: el('vt_sev').value, active: id ? el('vt_active').value === '1' : true };
  if (!body.name) return toast('Nhập tên loại vi phạm', 'err');
  await guard(() => id ? API.updateVType(id, body) : API.createVType(body));
  await refreshCache(); closeModal(); toast('Đã lưu loại vi phạm'); viewSettings();
}
async function delVtype(id) { if (!confirm('Xóa loại vi phạm này?')) return; await guard(() => API.deleteVType(id)); await refreshCache(); toast('Đã xóa'); viewSettings(); }
async function saveSsoSettings() {
  const body = {
    sso_enabled: el('set_sso_enabled').value,
    sso_tenant_id: el('set_sso_tenant_id').value.trim(),
    sso_client_id: el('set_sso_client_id').value.trim(),
    sso_allowed_domains: el('set_sso_allowed_domains').value.trim(),
  };
  // Chỉ gửi secret khi người dùng THỰC SỰ nhập — để trống nghĩa là giữ nguyên cái đã lưu.
  const sec = el('set_sso_client_secret').value;
  if (sec.trim()) body.sso_client_secret = sec;
  if (body.sso_enabled === 'true' && !(body.sso_tenant_id && body.sso_client_id)) {
    return toast('Bật SSO cần ít nhất Tenant ID + Client ID', 'err');
  }
  await guard(() => API.updateSettings(body));
  await refreshCache(); toast('Đã lưu cấu hình đăng nhập Microsoft'); // BL-24: không re-render, giữ input panel khác
}
async function saveMailSettings() {
  const body = {
    school_name: el('set_school_name').value.trim(),
    school_email: el('set_school_email').value.trim(),
    violation_mail_threshold: +el('set_violation_mail_threshold').value || 3,
    smtp_host: el('set_smtp_host').value.trim(),
    smtp_port: el('set_smtp_port').value.trim() || '587',
    smtp_secure: el('set_smtp_secure').value,
    smtp_user: el('set_smtp_user').value.trim(),
    smtp_pass: el('set_smtp_pass').value,
    smtp_from: el('set_smtp_from').value.trim(),
  };
  await guard(() => API.updateSettings(body));
  await refreshCache(); toast('Đã lưu cấu hình email'); // BL-24: không re-render, giữ input panel khác
}
async function testSmtpConnection() {
  const btn = el('smtpTestBtn'), out = el('smtpTestResult');
  const body = {
    smtp_host: el('set_smtp_host').value.trim(),
    smtp_port: el('set_smtp_port').value.trim() || '587',
    smtp_secure: el('set_smtp_secure').value,
    smtp_user: el('set_smtp_user').value.trim(),
    smtp_pass: el('set_smtp_pass').value, // để trống -> server dùng mật khẩu đã lưu
  };
  if (btn) { btn.disabled = true; }
  if (out) { out.className = 'muted'; out.style.fontSize = '12.5px'; out.textContent = 'Đang kiểm tra...'; }
  try {
    const r = await API.testSmtp(body);
    if (out) {
      if (r.ok) { out.style.color = 'var(--green)'; out.textContent = '✔ Kết nối SMTP thành công'; }
      else { out.style.color = 'var(--red)'; out.textContent = '✖ ' + (r.reason || 'Không kết nối được'); }
    }
  } catch (e) {
    if (out) { out.style.color = 'var(--red)'; out.textContent = '✖ ' + e.message; }
  } finally { if (btn) btn.disabled = false; }
}
function assetForm(id) {
  const a = id ? ST.assets.find(x => x.id === id) : { name: '', unit: 'Cái', category: 'fixed', quantity: 1, fee: 0, note: '' };
  openModal(`
    <div class="mh"><h3>${id ? 'Sửa tài sản' : 'Thêm tài sản'}</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="field"><label>Tên tài sản *</label><input id="as_name" value="${esc(a.name)}" placeholder="VD: Remote máy lạnh"></div>
      <div class="grid2">
        <div class="field"><label>Loại</label><select id="as_cat"><option value="person" ${a.category === 'person' ? 'selected' : ''}>Theo người</option><option value="fixed" ${a.category === 'fixed' ? 'selected' : ''}>Cố định trong phòng</option></select></div>
        <div class="field"><label>Đơn vị tính</label><input id="as_unit" value="${esc(a.unit)}" placeholder="Cái / Lần..."></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Số lượng</label><input id="as_qty" type="number" min="0" value="${esc(a.quantity)}"></div>
        <div class="field"><label>Phí bồi hoàn <span class="opt">(đồng)</span></label><input id="as_fee" type="number" min="0" value="${esc(a.fee)}"></div>
      </div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveAsset" data-args='[${id || 0}]'>Lưu</button></div>`);
  setTimeout(() => el('as_name').focus(), 50);
}
async function saveAsset(id) {
  const body = { name: el('as_name').value.trim(), category: el('as_cat').value, unit: el('as_unit').value.trim() || 'Cái', quantity: +el('as_qty').value || 0, fee: +el('as_fee').value || 0 };
  if (!body.name) return toast('Nhập tên tài sản', 'err');
  await guard(() => id ? API.updateAsset(id, body) : API.createAsset(body));
  await refreshCache(); closeModal(); toast('Đã lưu tài sản'); viewSettings();
}
async function delAsset(id) { if (!confirm('Xóa tài sản này?')) return; await guard(() => API.deleteAsset(id)); await refreshCache(); toast('Đã xóa'); viewSettings(); }
async function saveBravo() {
  const keys = ['bravo_fee_type', 'bravo_room', 'bravo_electric', 'bravo_water', 'bravo_service', 'bravo_parking', 'bravo_washing'];
  const body = {}; keys.forEach(k => body[k] = el('set_' + k).value.trim());
  await guard(() => API.updateSettings(body));
  await refreshCache(); toast('Đã lưu mã Bravo'); // BL-24: không re-render, giữ input panel khác
}
function feeHint(key) { const h = el('hint_' + key), i = el('set_' + key); if (h && i) h.textContent = money(i.value || 0); }
async function saveSettings() {
  const keys = ['room_fee', 'deposit_fee', 'water_fee', 'electric_unit', 'service_fee', 'washing_fee', 'parking_fee', 'partial_half_min', 'partial_full_min', 'room_price_A', 'room_price_B', 'room_price_C', 'room_price_D'];
  const body = {}; keys.forEach(k => body[k] = +el('set_' + k).value || 0);
  body.legal_female = el('set_legal_female').value.trim() || 'E2';
  body.legal_male = el('set_legal_male').value.trim() || 'S2';
  body.dorm_name = el('set_dorm_name').value.trim() || 'Ký túc xá';
  // Ngưỡng nhắc / nghiệp vụ (Đợt 3) — gửi RAW (chuỗi) để backend validate khoảng + giữ số thập phân (0.5).
  ['overdue_remind_days', 'shortterm_max_days', 'deposit_notice_min_days', 'partial_half_factor',
    'room_cap_A', 'room_cap_B', 'room_cap_C', 'room_cap_D', 'checkout_max_future_days', 'max_cccd_mb',
    'due_day_from', 'due_day_to']
    .forEach(k => { const inp = el('set_' + k); if (inp) body[k] = inp.value; });
  // hotline giờ nằm ở mục "Trang giới thiệu" (lưu qua saveIntro)
  await guard(() => API.updateSettings(body));
  // BL-24: KHÔNG re-render toàn trang sau khi lưu — giữ input đang gõ ở các panel khác (mọi panel
  // đều nằm trong DOM). Giá trị hiển thị đã là giá trị vừa gõ = giá trị đã lưu, không cần vẽ lại.
  await refreshCache(); toast('Đã lưu cài đặt');
}
function facilityForm(id) {
  const f = id ? ST.facilities.find(x => x.id === id) : { name: '', address: '' };
  openModal(`
    <div class="mh"><h3>${id ? 'Sửa cơ sở' : 'Thêm cơ sở'}</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="field"><label>Tên cơ sở *</label><input id="fc_name" value="${esc(f.name)}" placeholder="VD: Cơ sở 2"></div>
      <div class="field"><label>Địa chỉ</label><input id="fc_addr" value="${esc(f.address || '')}"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveFacility" data-args='[${id || 0}]'>Lưu</button></div>`);
  setTimeout(() => el('fc_name').focus(), 50);
}
async function saveFacility(id) {
  const body = { name: el('fc_name').value.trim(), address: el('fc_addr').value.trim() };
  if (!body.name) return toast('Nhập tên cơ sở', 'err');
  await guard(() => id ? API.updateFacility(id, body) : API.createFacility(body));
  await refreshCache(); closeModal(); toast('Đã lưu cơ sở'); viewSettings();
}
async function delFacility(id) {
  const f = (ST.facilities || []).find(x => x.id === id) || {};   // BL-30 + BL-35[11a]: nêu tên + cảnh báo dây chuyền
  if (!confirm(`Xóa cơ sở "${f.name || ''}"${f.room_count ? ` — đang có ${f.room_count} phòng, xóa có thể ảnh hưởng dữ liệu liên quan` : ''}?`)) return;
  await guard(() => API.deleteFacility(id)); await refreshCache(); toast('Đã xóa'); viewSettings();
}

/* ---------- ĐỔI MẬT KHẨU ---------- */
function changePwd() {
  openModal(`
    <div class="mh"><h3>${IC.key} Đổi mật khẩu</h3><button class="x" aria-label="Đóng" data-act="closeModal">×</button></div>
    <div class="mb">
      <div class="field"><label>Mật khẩu mới <span class="opt">(tối thiểu 6 ký tự)</span></label><input id="cp_new" type="password"></div>
      <div class="field"><label>Nhập lại mật khẩu mới</label><input id="cp_new2" type="password"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="doChangePwd">Đổi mật khẩu</button></div>`);
}
async function doChangePwd() {
  const n1 = el('cp_new').value, n2 = el('cp_new2').value;
  if (n1.length < 6) return toast('Mật khẩu mới tối thiểu 6 ký tự', 'err');
  if (n1 !== n2) return toast('Nhập lại mật khẩu không khớp', 'err');
  await guard(() => API.changePassword(n1));
  closeModal(); toast('Đã đổi mật khẩu');
}

