// === app-rooms-students.js — tach tu app.js (CHANG 4 refactor). Classic script, GIU global scope cho onclick. ===
// KHONG doi thu tu nap trong index.html; boot()/chong-bam/click-listener nam o app-portals-boot.js (cuoi).
async function viewRooms() {
  // Nút chuyển qua/lại "phòng đã xoá" nay ở HÀNG NÚT TRÊN, cạnh "Thêm phòng" (trước nó nằm trong
  // thanh công cụ của panel, lẫn với ô tìm kiếm). Cùng MỘT VỊ TRÍ đổi nhãn theo chế độ đang xem:
  // bấm đi và bấm về là cùng chỗ, không phải đi tìm nút quay lại ở nơi khác.
  el('topActions').innerHTML = roomShowDeleted
    ? `<button class="btn" data-act="roomDel" data-args='[false]'>← Danh sách phòng</button>`
    : `<button class="btn pri" data-act="roomForm">${IC.plus} Thêm phòng</button>
       <button class="btn" data-act="roomDel" data-args='[true]'>${IC.trash} Đã xóa</button>`;
  const list = roomShowDeleted ? await guard(() => API.rooms(true)) : ST.rooms;
  const del = roomShowDeleted;
  el('content').innerHTML = `
    <div class="panel"><div class="hd">
      <h2>${del ? 'Phòng đã xóa' : 'Danh sách phòng'} (<span id="roomCount">${list.length}</span>)</h2>
      <div class="toolbar">
        <div class="search"><span class="i">${IC.search}</span><input id="rs" placeholder="Tìm phòng, tầng, giới tính..." value="${esc(roomSearch)}"></div>
      </div>
    </div>
      ${/* Gợi ý phải NGẮN: nó nằm chắn giữa ô tìm kiếm và phòng đầu tiên, dài dòng là đẩy danh sách
            xuống dưới màn. Việc "bấm để xem chi tiết" đã có mũi tên ‹ ở mỗi hàng nói hộ; chỉ cử chỉ
            xoá là không tự nói ra được, nên giữ đúng câu đó. */''}
      ${del || !list.length ? '' : `<div class="hint only-touch" style="margin:12px 12px 0">${IC.info}<span><strong>Giữ</strong> hoặc <strong>kéo ngang</strong> một hàng để xoá phòng.</span></div>`}
    <div class="table-wrap card-tbl">
      ${list.length ? `<table><thead><tr><th>Phòng</th><th>Loại</th><th class="num">Đang ở</th><th>${IC.star} Phòng trưởng</th><th class="num">Giá thuê</th><th></th></tr></thead><tbody>
      ${list.map(r => { const full = r.occupancy >= r.capacity && r.capacity > 0; return `<tr data-s="${esc((r.name + ' ' + genderLabel(r.gender) + ' tầng' + r.floor + ' hạng' + (r.hang || 'b')).toLowerCase())}"${del ? ''
        // Cả hàng bấm được. KHÔNG đặt role="button" lên <tr>: role đó lược hết <td> con với trình đọc
        // màn hình; bàn phím đi bằng .stu-name bên dưới. data-del/data-delid: cử chỉ giữ/kéo để xoá trên
        // điện thoại (app-actions.js), ở đó nút thùng rác bị ẩn.
        : ` data-act="roomDetail" data-args='[${r.id}]' title="Xem chi tiết phòng — ai đang ở" data-del="delRoom" data-delid="${r.id}"`}>
        ${/* Phòng ĐÃ XOÁ: để trần, không khoác .stu-name — class đó có cursor:pointer + gạch chân khi rê,
              trông bấm được mà bấm không ra gì (hàng đã xoá không có data-act). */''}
        <td><div class="flex${del ? '' : ' stu-name'}"${del ? '' : ` data-act="roomDetail" data-args='[${r.id}]' role="button" tabindex="0" title="Xem chi tiết phòng — ai đang ở"`}><div><strong>${esc(r.name)}</strong>${r.upcoming ? ` <span class="badge blue" title="Sắp vào">+${r.upcoming}</span>` : ''}
          <div class="sub2">Tầng ${r.floor || '—'}</div>${r.note ? `<div class="sub2" style="white-space:pre-wrap;margin-top:3px">${esc(r.note)}</div>` : ''}</div>
          ${del ? '' : `<span class="row-chev" aria-hidden="true">${IC.chevronRight}</span>`}</div></td>
        <td class="ct-gon" data-label="Loại"><span>${r.gender === 'female' ? '<span class="badge sage">Nữ</span>' : '<span class="badge blue">Nam</span>'} <span class="badge gray">Hạng ${esc(r.hang || 'B')}</span> ${roomTypeBadge(r)}</span></td>
        <td class="num ct-gon" data-label="Đang ở">${roomIsShared(r) ? `<span class="badge ${full ? 'amber' : r.occupancy ? 'green' : 'gray'}">${r.occupancy}/${r.capacity || 0}</span>` : `<span class="badge gray">${r.occupancy} người</span>`}</td>
        ${/* data-trong: ô rỗng thì ở chế độ thẻ (điện thoại) ẩn hẳn dòng — "PHÒNG TRƯỞNG —" không
              đáng chiếm một dòng, không hiện tức là chưa cử. Máy tính vẫn giữ cột cho thẳng hàng. */''}
        <td data-label="Phòng trưởng"${leaderOf(r.id) ? '' : ' data-trong="1"'}>${leaderCell(r)}</td>
        ${/* bọc giá trị trong MỘT thẻ: ở chế độ thẻ, td[data-label] là flex space-between nên nhiều
             con sẽ bị xé ra hai đầu ("1.200.000" một bên, "/người" bên kia) */''}
        <td class="num" data-label="Giá thuê"><span>${money(+r.monthly_fee > 0 ? r.monthly_fee : ST.settings.room_fee)}${roomIsShared(r) ? '<span class="muted">/người</span>' : ''}${roomType(r) === 'whole' ? `<div class="sub2">Nguyên phòng: ${money(ST.settings['room_price_' + (r.hang || 'B')])}</div>` : ''}</span></td>
        <td class="num"><div class="rowbtns" style="justify-content:flex-end">
          ${del ? `<button class="btn sm green" data-act="restoreRoom" data-args='[${r.id}]'>${IC.undo} Khôi phục</button>`
                // Sửa phòng + cử phòng trưởng đã có trong card Chi tiết phòng -> bỏ 2 nút khỏi hàng.
                // Nút xoá còn lại chỉ hiện trên máy tính (.row-del ẩn ở ≤620px); điện thoại dùng cử chỉ.
                : `<button class="btn sm ghost row-del" title="Xoá phòng" data-act="delRoom" data-args='[${r.id}]'>${IC.trash}</button>`}
        </div></td></tr>`; }).join('')}
      <tr class="no-result" style="display:none"><td colspan="6"><div class="empty">Không tìm thấy phòng phù hợp.</div></td></tr>
      </tbody></table>` : `<div class="empty">${del ? 'Không có phòng đã xóa.' : `Chưa có phòng nào. Bấm <strong>${IC.plus} Thêm phòng</strong>.`}</div>`}
    </div></div>`;
  const rs = el('rs'); if (rs) { rs.addEventListener('input', () => roomSearch = rs.value); attachRowSearch(rs, 'roomCount'); }
}
/* ---------- CHI TIẾT PHÒNG ----------
   Bấm vào phòng ở danh sách -> xem phòng đó ĐANG CÓ NHỮNG AI. Trước đây bấm vào phòng không ra gì:
   muốn biết phòng 104 có ai thì phải sang màn Học viên rồi lọc theo phòng, dù "phòng này" và "ai
   trong phòng này" là MỘT câu hỏi.
   Số liệu lấy từ ST.students (đã nạp sẵn, không gọi thêm API) và dùng ĐÚNG công thức của cột "Đang ở"
   ở danh sách phòng — isOccupying = staying|leaving, khớp câu SQL occupancy trong rooms.go — nên con
   số ở danh sách và số dòng trong đây không bao giờ lệch nhau. */
function roomDetail(id) {
  const r = roomById(id);
  if (!r) return toast('Không tìm thấy phòng này', 'err');
  const dsDangO = ST.students.filter(s => s.room_id === id && isOccupying(s));
  const dsSapVao = ST.students.filter(s => s.room_id === id && liveStatus(s) === 'upcoming');
  const cap = +r.capacity || 0, shared = roomIsShared(r);
  const conTrong = Math.max(0, cap - dsDangO.length);
  const vuot = shared && cap > 0 && dsDangO.length > cap;
  const L = leaderOf(id);
  const giaGhep = +r.monthly_fee > 0 ? r.monthly_fee : ST.settings.room_fee;

  // Dòng người ở: bấm vào đi thẳng sang chi tiết học viên (không phải quay ra màn Học viên tìm lại)
  const dong = s => `<tr data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Xem chi tiết học viên">
    <td><div class="flex" style="gap:8px;align-items:center"><span class="avatar">${esc(initials(s.name))}</span>
      <div><strong>${esc(s.name)}</strong>${s.is_leader && isOccupying(s) ? ` <span class="badge amber">${IC.star} Phòng trưởng</span>` : ''}
        <div class="sub2">${esc(s.code || 'chưa có mã')}${s.class_name ? ' · ' + esc(s.class_name) : ''}${s.phone ? ' · ' + esc(s.phone) : ''}</div></div></div></td>
    <td>${fmtDate(s.check_in_date)}</td>
    <td>${s.check_out_date ? fmtDate(s.check_out_date) : '<span class="muted">—</span>'}</td>
    <td>${statusBadge(s)}</td></tr>`;
  const bang = ds => `<div class="table-wrap"><table><thead><tr><th>Học viên</th><th>Ngày vào</th><th>Ngày trả</th><th>Trạng thái</th></tr></thead><tbody>
    ${ds.map(dong).join('')}</tbody></table></div>`;

  openModal(`
    <div class="mh"><h3>${IC.home} Phòng ${esc(r.name)}
      <span class="badge ${r.gender === 'female' ? 'sage' : 'blue'}">${genderLabel(r.gender)}</span>
      <span class="badge gray">Hạng ${esc(r.hang || 'B')}</span> ${roomTypeBadge(r)}</h3>
      ${''/* modalBack: màn này mở được như lớp con (từ bảng Chỉ số điện) nên phải lùi một lớp. */}
      <button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="cards" style="margin-bottom:16px">
        <div class="stat"><div class="l">Đang ở</div><div class="v sm">${shared
          ? `<span class="badge ${vuot ? 'amber' : dsDangO.length ? 'green' : 'gray'}">${dsDangO.length}/${cap}</span>${conTrong ? `<div class="sub2">còn ${conTrong} giường trống</div>` : ''}`
          : `<span class="badge gray">${dsDangO.length} người</span>`}</div></div>
        <div class="stat"><div class="l">Giá thuê${shared ? ' / người' : ''}</div><div class="v sm">${money(giaGhep)}${roomType(r) === 'whole' ? `<div class="sub2">Nguyên phòng: ${money(ST.settings['room_price_' + (r.hang || 'B')])}</div>` : ''}</div></div>
        <div class="stat"><div class="l">Phòng trưởng</div><div class="v sm">${L ? `<span class="hd-ref" data-act="studentDetail" data-args='[${L.id}]' role="button" tabindex="0" title="Xem chi tiết học viên">${IC.star} ${esc(L.name)}</span>` : '<span class="muted">Chưa cử</span>'}</div></div>
      </div>
      <p><strong>Tầng:</strong> ${r.floor || roomFloorOf(r.name)} &nbsp;•&nbsp; <strong>Sức chứa:</strong> ${cap || '—'} giường &nbsp;•&nbsp; <strong>Pháp nhân:</strong> ${esc(legalEntity(r.gender))}${showFacilityUI() ? ` &nbsp;•&nbsp; <strong>Cơ sở:</strong> ${esc(facilityName(r.facility_id))}` : ''}</p>
      ${r.note ? `<p style="white-space:pre-wrap"><strong>Ghi chú:</strong> ${esc(r.note)}</p>` : ''}
      ${vuot ? `<div class="bang-tin" style="background:var(--amber-bg);border-color:var(--amber-ink);color:var(--amber-ink)">${IC.alert}
        <span><strong>Đang vượt sức chứa</strong> (${dsDangO.length} người / ${cap} giường). Nghiệp vụ CHO PHÉP việc này —
        thường là xếp người vào chờ bạn cũ xuất cảnh — nên đây chỉ là nhắc để bạn biết, không phải lỗi.</span></div>` : ''}

      <div class="panel" style="margin-top:12px"><div class="hd"><h2 style="font-size:14px">${IC.users} Người đang ở (${dsDangO.length})</h2></div>
        ${dsDangO.length ? bang(dsDangO) : '<div class="pad"><p class="muted" style="margin:0">Phòng đang trống — chưa có ai ở.</p></div>'}
      </div>

      ${dsSapVao.length ? `<div class="panel"><div class="hd"><h2 style="font-size:14px">${IC.calendar} Sắp vào (${dsSapVao.length})</h2></div>
        ${bang(dsSapVao)}
      </div>` : ''}
    </div>
    <div class="mf">
      ${/* Xoá phòng CÓ MẶT ở đây để trên điện thoại còn một đường THẤY ĐƯỢC: ngoài kia nút thùng rác
           bị ẩn, chỉ còn cử chỉ giữ/kéo — ai không đọc dòng gợi ý thì coi như hết đường. */''}
      <button class="btn danger" data-act="delRoom" data-args='[${id}]'>${IC.trash} Xoá phòng</button>
      <button class="btn" data-act="leaderForm" data-args='[${id}]'>${IC.star} Phòng trưởng</button>
      <button class="btn" data-act="roomForm" data-args='[${id}]'>${IC.pencil} Sửa phòng</button>
      <button class="btn pri" data-act="closeModal">Đóng</button>
    </div>`, true);
}

/* ---- Phòng trưởng ----
   Mỗi phòng 1 phòng trưởng giúp BQL quản lý trong phòng, đổi lại được miễn tiền nước + phí dịch vụ
   (tính theo số ngày làm — xem billing.leaderDiscount). */
const leaderOf = roomId => ST.students.find(s => s.room_id === roomId && s.is_leader && isOccupying(s));
function leaderCell(r) {
  const L = leaderOf(r.id);
  return L ? `<span class="badge amber">${IC.star} ${esc(L.name)}</span>` : '<span class="muted">—</span>';
}
function leaderForm(roomId) {
  const r = ST.rooms.find(x => x.id === roomId) || {};
  const cur = leaderOf(roomId);
  const inRoom = ST.students.filter(s => s.room_id === roomId && isOccupying(s));
  openModal(`
    <div class="mh"><h3>${IC.star} Phòng trưởng: ${esc(r.name || '')}</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      ${!inRoom.length ? '<p class="muted">Phòng này chưa có ai ở — chưa cử phòng trưởng được.</p>' : `
      <div class="field"><label>Chọn phòng trưởng</label><select id="l_stu">
        ${inRoom.map(s => `<option value="${s.id}" ${cur && cur.id === s.id ? 'selected' : ''}>${esc(s.name)}${cur && cur.id === s.id ? ' — đang làm' : ''}</option>`).join('')}
      </select></div>
      <div class="field"><label>Nhận nhiệm vụ từ ngày</label><input id="l_date"></div>
      <div class="field"><label>Ghi chú</label><input id="l_note" placeholder="VD: cử thay bạn A xuất cảnh..."></div>
      <div class="hint">${IC.info}<span>Phòng trưởng được <strong>miễn tiền nước và phí dịch vụ</strong>, tính theo <strong>số ngày làm</strong>:
        đổi người giữa tháng thì mỗi bạn được giảm theo phần của mình, không ai được trọn cả tháng.
        Người đang làm sẽ tự kết thúc nhiệm kỳ vào hôm trước ngày này.</span></div>`}
    </div>
    <div class="mf">
      ${cur ? `<button class="btn danger" data-act="unsetLeader" data-args='[${roomId}]'>Miễn nhiệm ${esc(cur.name)}</button>` : ''}
      <button class="btn" data-act="closeModal">Hủy</button>
      ${inRoom.length ? `<button class="btn pri" data-act="doSetLeader" data-args='[${roomId}]'>Cử làm phòng trưởng</button>` : ''}
    </div>`);
  attachDate(el('l_date'), today());
}
async function doSetLeader(roomId) {
  const student_id = el('l_stu').value;
  if (!student_id) return toast('Chọn học viên', 'err');
  const r = await guard(() => API.setLeader(roomId, { student_id: +student_id, date: el('l_date').dataset.iso, note: el('l_note').value.trim() }));
  await refreshCache(); closeModal();
  const n = r && r.recalced ? r.recalced.length : 0;
  toast(r && r.already ? 'Bạn này đang là phòng trưởng rồi'
    : n ? `Đã cử phòng trưởng · tính lại ${n} phiếu` : 'Đã cử phòng trưởng');
  adminGo(ST.view);
}
async function unsetLeader(roomId) {
  const cur = leaderOf(roomId);
  if (!confirm(`Miễn nhiệm phòng trưởng ${cur ? cur.name : ''}?\n\nTừ hôm nay bạn ấy không còn được miễn tiền nước và phí dịch vụ nữa.`)) return;
  await guard(() => API.unsetLeader(roomId, today()));
  await refreshCache(); closeModal(); toast('Đã miễn nhiệm phòng trưởng'); adminGo(ST.view);
}

function facilityOptions(sel) {
  return ST.facilities.map(f => `<option value="${f.id}" ${sel === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
}
function roomForm(id) {
  // Phòng MỚI: monthly_fee = 0 = "đi theo giá mặc định của hệ thống" (số tiền hôm nay y như cũ, vì
  // trước đây điền sẵn đúng giá mặc định — chỉ khác là sau này đổi giá ở Cài đặt thì phòng mới cũng
  // đổi theo, thay vì bị ghim ngay từ lúc tạo). Ô nhập vẫn cho gõ số nếu muốn giá riêng.
  const r = id ? roomById(id) : { name: '', floor: 1, gender: 'female', hang: 'B', capacity: HANG_CAP.B, monthly_fee: 0, note: '', facility_id: (ST.facilities[0] || {}).id };
  openModal(`
    <div class="mh"><h3>${id ? 'Sửa phòng' : 'Thêm phòng'}</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="grid2">
        <div class="field"><label>Tên / số phòng *</label><input id="f_name" value="${esc(r.name)}" placeholder="VD: 104" data-input="onFloorDisp"></div>
        <div class="field"><label>Cơ sở</label><select id="f_fac">${facilityOptions(r.facility_id)}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Tầng <span class="opt">(tự tính từ số phòng)</span></label><input id="f_floor_disp" readonly value="Tầng ${roomFloorOf(r.name)}" style="background:var(--bg2);color:var(--muted)"></div>
        <div class="field"><label>Giới tính (pháp nhân tự gán)</label><select id="f_gender" data-change="onLgHintGender">
          <option value="female" ${r.gender === 'female' ? 'selected' : ''}>Nữ (tầng 1–2)</option>
          <option value="male" ${r.gender === 'male' ? 'selected' : ''}>Nam (tầng 3–4)</option>
        </select><div class="muted" id="lgHint" style="font-size:12px;margin-top:4px">Pháp nhân: ${esc(legalEntity(r.gender))}</div></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Hạng phòng</label><select id="f_hang" data-change="onFCapFromType">${HANGS.map(hh => `<option value="${hh}" ${(r.hang || 'B') === hh ? 'selected' : ''}>Hạng ${hh} — ${HANG_CAP[hh]} giường · nguyên phòng ${money(ST.settings['room_price_' + hh])}</option>`).join('')}</select></div>
        <div class="field"><label>Sức chứa (giường) <span class="opt">(tự điền theo hạng)</span></label><input id="f_cap" type="number" min="0" value="${esc(r.capacity)}"></div>
      </div>
      ${(() => {
        // monthly_fee = 0 (hoặc rỗng) KHÔNG phải miễn phí: billing chỉ dùng nó khi > 0, còn lại lấy
        // room_fee ở Cài đặt. KHÔNG điền sẵn giá mặc định vào ô — lưu lại là ghim giá riêng cho phòng,
        // từ đó đổi giá ở Cài đặt không còn ăn vào phòng này nữa.
        const macDinh = +ST.settings.room_fee || 0;
        const rieng = +r.monthly_fee > 0 ? +r.monthly_fee : 0;
        return `<div class="field"><label>Giá thuê ghép / người / tháng <span class="opt">(đồng)</span></label>
          <input id="f_mfee" type="number" min="0" value="${rieng || ''}" placeholder="${macDinh || ''}">
          <div class="sub2" style="margin-top:4px">Đang áp dụng: <strong>${money(rieng || macDinh)}</strong> /người/tháng — ${rieng
            ? 'giá <strong>riêng của phòng này</strong>. Xoá trống ô để quay về giá mặc định của hệ thống.'
            : 'giá <strong>mặc định của hệ thống</strong> (Cài đặt → Giá &amp; phí). Để trống = luôn đi theo giá mặc định; nhập số = ghim giá riêng cho phòng này.'}</div>
        </div>`;
      })()}
      <div class="field"><label>Loại phòng</label><select id="f_rtype">
        ${Object.keys(ROOM_TYPE).map(k => `<option value="${k}" ${roomType(r) === k ? 'selected' : ''}>${ROOM_TYPE[k][0]}</option>`).join('')}
      </select><div class="muted" style="font-size:11.5px;margin-top:4px">${IC.info} "Thuê nguyên phòng / An ninh / Nhân viên công tác" sẽ <strong>không tính vào giường trống</strong> cho thuê ghép.</div></div>
      <div class="field"><label>Ghi chú <span class="opt">(mỗi dòng một ghi chú)</span></label><textarea id="f_note" rows="3">${esc(r.note || '')}</textarea></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveRoom" data-args='[${id || 0}]'>Lưu</button></div>`);
  setTimeout(() => el('f_name').focus(), 50);
}
async function saveRoom(id) {
  const body = { name: el('f_name').value.trim(), facility_id: +el('f_fac').value || null,
    gender: el('f_gender').value, hang: el('f_hang').value, capacity: +el('f_cap').value || 0, monthly_fee: +el('f_mfee').value || 0, note: el('f_note').value.trim(), room_type: el('f_rtype').value };
  if (!body.name) return toast('Nhập tên phòng', 'err');
  await guard(() => id ? API.updateRoom(id, body) : API.createRoom(body));
  await napLai('rooms', 'students'); closeModal(); toast('Đã lưu phòng'); viewRooms();
}
// GỌI TÊN phòng trong câu hỏi: trên điện thoại việc này phát từ CỬ CHỈ (giữ / kéo ngang) nên người
// ta cần thấy mình đang xoá đúng phòng nào, chứ "phòng này" thì không đối chiếu được với cái gì.
async function delRoom(id) {
  const r = roomById(id);
  if (!confirm(`Xoá phòng ${r ? r.name : ''}?\n\n(Có thể khôi phục lại trong mục "Đã xóa")`)) return;
  await guard(() => API.deleteRoom(id)); await napLai('rooms', 'students');
  closeModal();   // khi xoá từ card Chi tiết phòng: đóng card lại, không để nó đứng đó tả phòng vừa xoá
  toast('Đã xóa phòng'); viewRooms();
}
async function restoreRoom(id) { await guard(() => API.restoreRoom(id)); await napLai('rooms', 'students'); toast('Đã khôi phục phòng'); viewRooms(); }
const roomFloorOf = n => { const m = String(n || '').match(/\d/); return m ? m[0] : '—'; };

/* ---------- HỌC VIÊN ---------- */
let stuSearch = '', stuFilter = 'all', stuSort = { key: '', dir: 1 }, stuFacilityFilter = 0;
// Đa cơ sở: điều hành (Auth.user.facility_id null) thấy nhiều cơ sở -> hiện bộ chọn + nhãn cơ sở.
// Quản lý/bảo trì đã bị backend ép theo cơ sở mình nên KHÔNG cần bộ chọn.
const isExecutiveUser = () => !Auth.user || Auth.user.facility_id == null;
const showFacilityUI = () => isExecutiveUser() && (ST.facilities || []).length > 1;
function stuSortVal(s) {
  switch (stuSort.key) {
    case 'name': return (s.name || '').toLowerCase();
    case 'room': return (s.room_name || '').toLowerCase();
    case 'contract': return ['done', 'scanned', 'unsigned', 'none'].indexOf(s.contract_status);
    case 'deposit': return ['held', 'refunded', 'forfeited', 'none'].indexOf(s.deposit_status);
    case 'status': return ['upcoming', 'staying', 'leaving', 'left'].indexOf(liveStatus(s));
    default: return 0;
  }
}
// Nhãn cho dải "Đang lọc" ở màn Học viên (khi vào kèm bộ lọc từ drill-down Tổng quan/Dịch vụ).
// Đã bỏ hàng chip lọc nhanh vì TRÙNG: mọi lọc đã có ở phễu cột, hoặc ở Tổng quan (tạm trú/bàn giao)
// và màn Dịch vụ (máy giặt). Giữ logic stuFilter (drill-down vẫn dùng) + dải này để thấy & bỏ bộ lọc đang áp.
const STU_FILTER_LABELS = {
  in: 'Đang ở', upcoming: 'Sắp vào', leaving: 'Sắp trả', out: 'Đã trả',
  departure: 'Xuất cảnh', departure_expected: 'Dự kiến xuất cảnh',
  noresi: 'Chưa tạm trú', resi_overdue: 'Chưa tạm trú (quá hạn)', resi_processing: 'Tạm trú: đang xử lý', resi_registered: 'Đã có tạm trú',
  nocontract: 'HĐ chưa ký', nocontract_ghep: 'Thuê ghép chưa ký HĐ', nocontract_phong: 'Thuê nguyên phòng chưa ký HĐ',
  handover_pending: 'Chưa ký phiếu bàn giao', washing: 'Dùng máy giặt', nodeposit: 'Chưa đóng cọc',
  checkin_today: 'Nhận phòng hôm nay', checkout_today: 'Trả phòng hôm nay',
};
const STU_PAGE_SIZE = 50; // BL-12: số học viên mỗi trang (phân trang lớp DOM, giữ tìm kiếm/phễu cột)
function viewStudents() {
  el('topActions').innerHTML = `<button class="btn" data-act="showDeletedStudents">${IC.lock} Đã khoá</button><button class="btn pri" data-act="adminGo" data-args='["reg"]'>${IC.filePen} Đăng ký / duyệt đơn</button>`;
  let list = ST.students.slice();
  if (stuFilter === 'in') list = list.filter(isOccupying);
  if (stuFilter === 'upcoming') list = list.filter(s => liveStatus(s) === 'upcoming');
  if (stuFilter === 'out') list = list.filter(s => liveStatus(s) === 'left');
  if (stuFilter === 'noresi') list = list.filter(s => isOccupying(s) && s.residency_status !== 'registered');
  if (stuFilter === 'nocontract') list = list.filter(contractPending);
  if (stuFilter === 'nocontract_ghep') list = list.filter(s => contractPending(s) && studentRoomKind(s) === 'shared');
  if (stuFilter === 'nocontract_phong') list = list.filter(s => contractPending(s) && studentRoomKind(s) === 'whole');
  if (stuFilter === 'washing') list = list.filter(s => isOccupying(s) && s.uses_washing);
  if (stuFilter === 'nodeposit') list = list.filter(s => isOccupying(s) && s.deposit_status === 'none');
  if (stuFilter === 'handover_pending') list = list.filter(handoverPending);
  if (stuFilter === 'leaving') list = list.filter(s => liveStatus(s) === 'leaving');
  if (stuFilter === 'departure') list = list.filter(s => s.check_out_date && DEPARTURE_REASONS.includes(s.checkout_reason));
  if (stuFilter === 'departure_expected') { list = list.filter(willDepartSoon).sort((a, b) => nextDepartureDate(a).localeCompare(nextDepartureDate(b))); }
  if (stuFilter === 'resi_overdue') list = list.filter(s => isOccupying(s) && s.residency_status === 'unregistered' && stayDays(s) > overdueDays());
  if (stuFilter === 'resi_processing') list = list.filter(s => isOccupying(s) && s.residency_status === 'processing');
  if (stuFilter === 'resi_registered') list = list.filter(s => isOccupying(s) && s.residency_status === 'registered');
  if (stuFilter === 'checkin_today') list = list.filter(s => s.check_in_date && s.check_in_date.slice(0, 10) === today());
  if (stuFilter === 'checkout_today') list = list.filter(s => s.check_out_date && s.check_out_date.slice(0, 10) === today());
  // Đa cơ sở: dữ liệu đã được lọc theo bộ chọn cơ sở toàn cục (ST.facilityFilter → API.setFacility) ở
  // refreshCache, nên ST.students ở đây đã đúng phạm vi. Badge cơ sở hiện dưới tên khi xem "Tất cả cơ sở".
  // Tìm kiếm áp dụng bằng ẩn/hiện hàng (attachRowSearch) — không lọc dựng lại ở đây
  const vthr = (ST.settings && +ST.settings.violation_mail_threshold) || 3;
  if (stuSort.key) list = list.slice().sort((a, b) => { const x = stuSortVal(a), y = stuSortVal(b); return (x < y ? -1 : x > y ? 1 : 0) * stuSort.dir; });
  const sTh = (key, label, cls, attrs) => `<th class="sortable${cls ? ' ' + cls : ''}${stuSort.key === key ? (stuSort.dir === 1 ? ' asc' : ' desc') : ''}" data-sort="${key}"${attrs ? ' ' + attrs : ''}>${label}<span class="sort-ar">${stuSort.key === key ? (stuSort.dir === 1 ? '▲' : '▼') : ''}</span></th>`;
  const xcOf = s => s.expected_departure || (DEPARTURE_REASONS.includes(s.checkout_reason) && s.check_out_date ? s.check_out_date : '');
  const hasXC = list.some(xcOf); // không ai có ngày dự kiến xuất cảnh -> ẩn cột cho đỡ rỗng
  const nCols = hasXC ? 7 : 6;
  el('content').innerHTML = `
    ${stuFilter !== 'all' ? `<div class="pill-row" style="align-items:center">
      <span class="muted" style="font-size:13px">Đang lọc:</span>
      <span class="badge gray" style="font-size:13px">${esc(STU_FILTER_LABELS[stuFilter] || stuFilter)}</span>
      <button class="btn sm ghost" data-act="stuGo" data-args='["all"]' title="Bỏ lọc, xem tất cả học viên">✕ Bỏ lọc</button>
    </div>` : ''}
    <div class="panel"><div class="hd"><h2>Học viên (<span id="stuCount">${list.length}</span>)</h2>
      <div class="search"><span class="i">${IC.search}</span><input id="ss" placeholder="Tìm tên, mã, lớp, SĐT, số phòng..." value="${esc(stuSearch)}"></div>
    </div><div class="table-wrap card-tbl">
      ${/* Thứ tự cột: Trạng thái đứng ngay sau Phòng. Hai ô này đều ngắn nên ở chế độ THẺ (điện thoại)
            chúng nằm chung một dòng (.ct-gon) thay vì mỗi thứ một dòng — thẻ thấp đi, xem được nhiều
            người hơn trong một màn. Trên máy tính thì đây cũng là thứ tự dễ đọc hơn: ở phòng nào và
            đang ở hay đã trả là hai câu hỏi đi liền nhau. */''}
      ${list.length ? `<table><thead><tr>${sTh('name', 'Học viên')}${sTh('room', 'Phòng', '', 'data-filt="list"')}${sTh('status', 'Trạng thái')}${sTh('contract', 'Hợp đồng')}${sTh('deposit', 'Cọc')}${hasXC ? '<th>Dự kiến XC</th>' : ''}<th></th></tr></thead><tbody>
      ${list.map(s => {
        const flags = `${isOccupying(s) && s.residency_status !== 'registered' ? `<span title="Chưa đăng ký tạm trú"> ${IC.flag}</span>` : ''}${s.uses_washing ? `<span title="Máy giặt"> ${IC.washer}</span>` : ''}${s.vehicle_count ? `<span title="Xe gửi"> ${IC.bike}${s.vehicle_count}</span>` : ''}${s.violation_count ? `<span title="Vi phạm ${s.violation_count} lần" style="color:${s.violation_count >= vthr ? 'var(--red-ink)' : 'var(--amber-ink)'}"> ${IC.alert}${s.violation_count}</span>` : ''}`;
        const ds = esc((s.name + ' ' + (s.code || '') + ' ' + (s.phone || '') + ' ' + (s.class_name || '') + ' ' + (s.room_name || '')).toLowerCase());
        return `<tr data-s="${ds}">
        <td><div class="flex stu-name" data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Xem chi tiết học viên"><span class="avatar">${esc(initials(s.name))}</span><div>
          <strong>${esc(s.name)}</strong> <span class="badge ${s.gender === 'female' ? 'sage' : 'blue'}">${genderLabel(s.gender)}</span>${s.login_username ? ` <span title="Có tài khoản">${IC.key}</span>` : ''}
          <div class="sub2">${esc(s.code || '—')}${s.class_name ? ' · ' + esc(s.class_name) : ''}${showFacilityUI() && s.facility_id ? ` · <span class="badge gray" style="font-size:10px">${esc(facilityName(s.facility_id))}</span>` : ''}${flags}</div>
        </div><span class="row-chev" aria-hidden="true">${IC.chevronRight}</span></div></td>
        <td class="ct-gon" data-label="Phòng">${s.room_name ? `<span class="hd-ref" data-act="roomDetail" data-args='[${s.room_id}]' role="button" tabindex="0" title="Xem chi tiết phòng — ai đang ở"><strong>${esc(s.room_name)}</strong></span>` : `<button class="btn sm" style="white-space:nowrap" title="Xếp phòng cho học viên này" data-act="transferForm" data-args='[${s.id}]'>${IC.transfer} Xếp phòng</button>`}${s.rental_type === 'phong' ? '<div class="sub2">Thuê nguyên phòng</div>' : ''}</td>
        <td class="ct-gon" data-label="Trạng thái">${statusBadge(s)}</td>
        <td data-label="Hợp đồng"><span class="badge ${CONTRACT_BADGE[s.contract_status] || 'gray'}">${CONTRACT_LABEL[s.contract_status] || '—'}</span>${s.contract_no ? `<div class="sub2">${esc(s.contract_no)}</div>` : hdThamChieu(s)}</td>
        <td data-label="Cọc">${depositBadge(s)}${s.deposit_status === 'none' && isOccupying(s) ? ` <button class="btn sm ghost" style="white-space:nowrap" title="Ghi nhận đóng cọc" data-act="depositForm" data-args='[${s.id}]'>＋ Thu cọc</button>` : ''}</td>
        ${hasXC ? `<td class="muted" data-label="Dự kiến XC" style="font-size:12px;white-space:nowrap">${xcOf(s) ? fmtDate(xcOf(s)) : '—'}</td>` : ''}
        <td class="num"><div class="rowbtns" style="justify-content:flex-end">
          ${isOccupying(s) ? `<button class="btn sm danger" data-act="checkOutForm" data-args='[${s.id}]'>Check-out</button>` : `<button class="btn sm" title="Nhận lại học viên đã trả phòng" data-act="checkInForm" data-args='[${s.id}]'>Check-in</button>`}
        </div></td></tr>`; }).join('')}
      <tr class="no-result" style="display:none"><td colspan="${nCols}"><div class="empty">Không tìm thấy học viên phù hợp.</div></td></tr>
      </tbody></table>` : `<div class="empty">Không có học viên phù hợp.</div>`}
    </div><div id="stuPager" class="pager"></div></div>`;
  const ss = el('ss'); if (ss) { ss.addEventListener('input', () => { stuSearch = ss.value; syncFilterUrl(); }); attachRowSearch(ss, 'stuCount', { numWord: true }); }  // BL-56: gõ số phòng ra đúng phòng
  if (list.length) enablePaging(ss, 'stuPager', STU_PAGE_SIZE); // BL-12: phân trang danh sách học viên
  document.querySelectorAll('#content th.sortable').forEach(th => {
    th.onclick = e => {
      if (e.target.classList.contains('rz-handle')) return; // đang kéo giãn cột
      const k = th.dataset.sort;
      if (stuSort.key === k) stuSort.dir *= -1; else { stuSort.key = k; stuSort.dir = 1; }
      viewStudents();
    };
  });
  syncFilterUrl(); // BL-17: bộ lọc (f) + sắp xếp (sort) lên URL
}
function depositBadge(s) {
  if (s.deposit_status === 'held') return '<span class="badge amber">Đang giữ</span>';
  if (s.deposit_status === 'refunded') return '<span class="badge green">Đã hoàn</span>';
  if (s.deposit_status === 'forfeited') return '<span class="badge gray">Không hoàn</span>';
  return '<span class="muted">—</span>';
}
function roomOptions(sel, gender) {
  // Chỉ xếp học viên vào phòng CHO THUÊ GHÉP (giữ lại phòng đang chọn nếu là phòng đặc biệt)
  const rooms = ST.rooms.filter(r => (!gender || r.gender === gender) && (roomIsShared(r) || r.id === sel));
  return `<option value="">— Chưa xếp phòng —</option>` + rooms.map(r => {
    // Phòng đầy KHÔNG bị khoá: vượt sức chứa là CỐ Ý (HV vào chờ bạn xuất cảnh) — chỉ ghi nhãn "đầy",
    // cảnh báo + xác nhận khi LƯU qua withOverloadConfirm (doApprove/doCheckIn/studentForm). Xem BL-61.
    const full = r.occupancy >= r.capacity && sel !== r.id;
    return `<option value="${r.id}" ${sel === r.id ? 'selected' : ''}>${esc(r.name)} · Tầng ${r.floor} (${r.occupancy}/${r.capacity || 0})${full ? ' - đầy' : ''}</option>`;
  }).join('');
}
// BL-86: CCCD 2 mặt (đồng bộ form đăng ký) — ghi cột cccd_front/cccd_back, không phải cột cũ cccd_image.
let _cccdFront = null, _cccdBack = null, _cccdFrontChanged = false, _cccdBackChanged = false;
function previewCccd(input, side) {
  const f = input.files[0]; if (!f) return;
  if (f.size > cccdMaxBytes()) { input.value = ''; return toast(`Ảnh CCCD quá lớn (tối đa ${cccdMaxBytes() / 1024 / 1024}MB)`, 'err'); }
  const r = new FileReader();
  r.onload = () => {
    if (side === 'back') { _cccdBack = r.result; _cccdBackChanged = true; }
    else { _cccdFront = r.result; _cccdFrontChanged = true; }
    el(side === 'back' ? 'cccdBackPrev' : 'cccdFrontPrev').innerHTML = `<img src="${r.result}" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--line)">`;
  };
  r.readAsDataURL(f);
}
async function studentForm(id) {
  const s = id ? await guard(() => API.student(id)) : { name: '', code: '', gender: 'female', phone: '', id_card: '', room_id: '', check_in_date: today(), note: '', uses_washing: false, rental_type: 'ghep', residency_status: 'unregistered', contract_status: 'unsigned', class_name: '', birth_date: '', contract_no: '', contract_date: '', class_start_date: '', expected_departure: '', parent_phone: '' };
  window._svV = s._v || null;   // ghi nhớ hồ sơ này ở phiên bản nào lúc mình MỞ form
  _cccdFront = null; _cccdBack = null; _cccdFrontChanged = false; _cccdBackChanged = false;
  const opt = (val, cur, label) => `<option value="${val}" ${cur === val ? 'selected' : ''}>${label}</option>`;
  // Ngày trả phòng chỉ đặt/đổi được sang ngày tương lai — đã qua thì phiếu đã phát, công-tơ đã chốt.
  const coHienTai = (s.check_out_date || '').slice(0, 10);
  const daRoi = !!coHienTai && coHienTai <= today();
  openModal(`
    <div class="mh"><h3>${id ? 'Sửa học viên' : 'Thêm học viên'}</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="grid2">
        <div class="field"><label>Họ tên *</label><input id="f_name" value="${esc(s.name)}" placeholder="Nguyễn Văn A"></div>
        <div class="field"><label>Mã học viên (MSHV)</label><input id="f_code" value="${esc(s.code || '')}" placeholder="TXTS-S25..."></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Lớp</label><input id="f_class" value="${esc(s.class_name || '')}" placeholder="Esu684"></div>
        <div class="field"><label>Ngày sinh</label><input id="f_birth"></div>
      </div>
      <div class="field"><label>Email công ty <span class="opt">(để học viên đăng nhập bằng tài khoản Microsoft)</span></label>
        <input id="f_email" type="email" value="${esc(s.email || '')}" placeholder="hoten@esuhai.com">
        <div class="sub2" style="margin-top:4px">${IC.info} Điền đúng email này thì lần đầu học viên bấm "Đăng nhập bằng Microsoft" là vào thẳng, <strong>không phải chờ admin duyệt</strong>. Bỏ trống cũng được — khi đó admin duyệt tay ở màn Cài đặt → Người dùng.</div></div>
      <div class="grid2">
        <div class="field"><label>Giới tính</label><select id="f_gender" data-change="onFRoomFromGender">
          ${opt('female', s.gender, 'Nữ')}${opt('male', s.gender, 'Nam')}</select></div>
        <div class="field"><label>Số điện thoại</label><input id="f_phone" value="${esc(s.phone || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Ngày khai giảng</label><input id="f_cstart"></div>
        <div class="field"><label>Dự kiến xuất cảnh</label><input id="f_departure"></div>
      </div>
      <div class="field"><label>SĐT phụ huynh <span class="opt">(liên hệ khẩn cấp)</span></label><input id="f_pphone" value="${esc(s.parent_phone || '')}"></div>
      <div class="grid2">
        <div class="field"><label>Phòng</label><select id="f_room">${roomOptions(s.room_id, s.gender)}</select></div>
        <div class="field"><label>Hình thức thuê</label><select id="f_rental">
          ${opt('ghep', s.rental_type, 'Thuê ghép (giá/người)')}${opt('phong', s.rental_type, 'Thuê nguyên phòng (giá theo hạng)')}</select></div>
      </div>
      <div class="field"><label>Giảm giá <span class="opt">(% mỗi khoản — để trống nếu thu đủ)</span></label>
        <div class="giam-grid">
          ${GIAM_O.map(([k, id2, nhan]) => `<label class="giam-o"><span>${nhan}</span>
            <input id="${id2}" type="number" min="0" max="100" step="1" placeholder="0"
              value="${+s[k] > 0 ? +s[k] : ''}"><span class="dv">%</span></label>`).join('')}
        </div>
        <div class="hint">${IC.info}<span>Dùng cho các ca lẻ, vd quản lý ký túc xá ở phòng 104 giảm <strong>50%</strong>
          tiền phòng, hay người ở phòng nhân viên được <strong>miễn 100%</strong> tiền phòng nhưng vẫn trả nước/điện/dịch vụ.
          Công thức tính tiền không đổi — phiếu vẫn ghi đủ từng khoản, kèm dòng giảm riêng. Bỏ trống = thu đủ.</span></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Ngày vào (check-in)</label><input id="f_in"></div>
        <div class="field"><label>Tạm trú</label><select id="f_residency">
          ${opt('unregistered', s.residency_status, 'Chưa đăng ký')}${opt('processing', s.residency_status, 'Đang xử lý')}${opt('registered', s.residency_status, 'Đã đăng ký')}</select></div>
      </div>
      <div class="field"><label>Ngày trả phòng ${daRoi ? '' : '<span class="opt">(báo trước — để trống nếu chưa báo)</span>'}</label>
        ${daRoi
    ? `<input value="${esc(fmtDate(coHienTai))}" readonly title="Đã trả phòng — ngày đã qua không sửa được ở đây">`
    : '<input id="f_out">'}</div>

      <div style="background:var(--bg2);padding:12px;border-radius:10px;margin-bottom:14px">
        <div style="font-weight:600;font-size:13px;margin-bottom:10px">${IC.fileText} Hợp đồng</div>
        <div class="grid2">
          <div class="field" style="margin:0 0 12px"><label>Số HĐ <span class="opt">(nhập tay · ⚡ gợi ý số kế tiếp)</span></label>
            <div class="flex" style="gap:6px"><input id="f_cno" value="${esc(s.contract_no || '')}" placeholder="03/2026/HDKTX-E2" style="flex:1">
            <button type="button" class="btn sm" data-act="suggestContractNo" title="Gợi ý số HĐ kế tiếp (nối tiếp số đã có)">${IC.zap}</button></div></div>
          <div class="field" style="margin:0 0 12px"><label>Ngày ký HĐ</label><input id="f_cdate"></div>
        </div>
        <div class="field" style="margin:0 0 12px"><label>Tình trạng HĐ</label><select id="f_cstatus">
          ${['done', 'scanned', 'unsigned', 'none', 'handover'].map(k => opt(k, s.contract_status || 'unsigned', CONTRACT_LABEL[k])).join('')}</select></div>
        <div class="hint" style="margin:0;font-size:11.5px">${IC.info} Thuê <strong>trên ${shortTermMaxDays()} ngày</strong> (ghép hoặc nguyên phòng) → ký <strong>HĐ thuê phòng</strong>. Thuê <strong>dưới ${shortTermMaxDays()} ngày</strong> hoặc <strong>nhân viên công tác</strong> → ký <strong>phiếu đăng ký & bàn giao</strong>. Phòng an ninh không cần ký gì.</div>
        <div class="field" style="margin:0"><label>Ảnh CCCD <span class="opt">(2 mặt — chụp/chọn ảnh)</span></label>
          <div class="grid2">
            <div><div class="muted" style="font-size:12px;margin-bottom:4px">Mặt trước</div>
              <input type="file" id="f_cccd_front" accept="image/*" data-change="onCccdFront">
              <div id="cccdFrontPrev" style="margin-top:6px">${s.cccd_front ? `<img src="${s.cccd_front}" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--line)">` : ''}</div></div>
            <div><div class="muted" style="font-size:12px;margin-bottom:4px">Mặt sau</div>
              <input type="file" id="f_cccd_back" accept="image/*" data-change="onCccdBack">
              <div id="cccdBackPrev" style="margin-top:6px">${s.cccd_back ? `<img src="${s.cccd_back}" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--line)">` : ''}</div></div>
          </div>
          ${!s.cccd_front && !s.cccd_back && s.cccd_image ? `<div style="margin-top:8px"><div class="muted" style="font-size:12px;margin-bottom:4px">${IC.info} Ảnh cũ (1 mặt) — tải 2 mặt ở trên để cập nhật:</div><img src="${s.cccd_image}" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--line)"></div>` : ''}
        </div>
      </div>

      ${!id ? `
      <label class="check"><input type="checkbox" id="f_dep" checked> ${IC.lock} Đã đóng cọc ${money(ST.settings.deposit_fee)} khi nhận phòng</label>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="f_login" data-change="onLoginBoxToggle"> ${IC.key} Tạo tài khoản đăng nhập</label>
      <div id="loginBox" style="display:none;background:var(--bg2);padding:12px;border-radius:10px;margin-top:8px">
        <div class="grid2">
          <div class="field" style="margin:0"><label>Tên đăng nhập <span class="opt">(trống = mã HV)</span></label><input id="f_luser"></div>
          <div class="field" style="margin:0"><label>Mật khẩu</label><input id="f_lpass" type="text" placeholder="tối thiểu 6 ký tự"></div>
        </div>
      </div>` : ''}
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveStudent" data-args='[${id || 0}]'>Lưu</button></div>`, true);
  attachDate(el('f_birth'), s.birth_date, { max: today() });
  attachDate(el('f_cstart'), s.class_start_date);
  attachDate(el('f_departure'), s.expected_departure);
  attachDate(el('f_in'), s.check_in_date || today());
  attachDate(el('f_cdate'), s.contract_date);
  attachDate(el('f_out'), daRoi ? '' : coHienTai, { min: addDays(today(), 1) });
  setTimeout(() => el('f_name').focus(), 50);
}
async function saveStudent(id) {
  const body = {
    name: el('f_name').value.trim(), code: el('f_code').value.trim(), class_name: el('f_class').value.trim(),
    email: el('f_email').value.trim().toLowerCase(),
    birth_date: el('f_birth').dataset.iso || null, gender: el('f_gender').value, phone: el('f_phone').value.trim(),
    room_id: el('f_room').value || null, rental_type: el('f_rental').value, check_in_date: el('f_in').dataset.iso,
    // Ô vắng mặt (HV đã trả phòng) -> KHÔNG gửi field, để server giữ nguyên ngày cũ.
    ...(el('f_out') ? { check_out_date: el('f_out').dataset.iso || null } : {}),
    ...Object.fromEntries(GIAM_O.map(([k, id2]) => [k, +el(id2).value || 0])),
    // Số hiệu phiên bản đọc lúc MỞ form. Server so lại: khác nghĩa là người khác vừa sửa
    // trong lúc mình đang điền -> báo cho biết thay vì đè mất công của họ.
    _v: window._svV || undefined,
    residency_status: el('f_residency').value, contract_no: el('f_cno').value.trim(),
    contract_date: el('f_cdate').dataset.iso || null, contract_status: el('f_cstatus').value,
    class_start_date: el('f_cstart').dataset.iso || null, expected_departure: el('f_departure').dataset.iso || null,
    parent_phone: el('f_pphone').value.trim(),
    // note + uses_washing KHÔNG gửi: máy giặt do màn Dịch vụ quản, ghi chú đã bỏ khỏi form.
    // Không gửi field = máy chủ giữ nguyên giá trị cũ, không phải xoá trắng.
  };
  if (!body.name) return toast('Nhập họ tên', 'err');
  if (!id) {
    body.deposit_paid = el('f_dep').checked;
    if (el('f_login').checked) { body.create_login = true; body.login_username = el('f_luser').value.trim(); body.login_password = el('f_lpass').value.trim(); }
  }
  // Chỉ gửi mặt ảnh NÀO vừa chọn — không gửi = giữ nguyên ảnh cũ trên máy chủ.
  if (_cccdFrontChanged) body.cccd_front = _cccdFront;
  if (_cccdBackChanged) body.cccd_back = _cccdBack;
  // Hai lớp hỏi lại của server, đều trả 409:
  //   - TRÙNG hồ sơ (mã HV/CCCD đã có) -> chỉ đường sang Chuyển phòng / Check-in lại
  //   - Phòng QUÁ TẢI -> hỏi có xếp nữa không (đồng ý thì ghi nhật ký)
  const saved = await guard(() => withDuplicateGuide(() => withOverloadConfirm(ok =>
    id ? API.updateStudent(id, { ...body, confirm_overload: ok }) : API.createStudent({ ...body, confirm_overload: ok }))));
  if (saved === null) return; // người dùng bấm Hủy, hoặc đã được chỉ sang hồ sơ cũ
  await refreshCache(); closeModal(); toast('Đã lưu học viên'); viewStudents();
}
// Gợi ý số HĐ KẾ TIẾP = MAX số đã có (cùng năm + pháp nhân, parse từ chính số HĐ) + 1 (backend).
// NỐI TIẾP số có sẵn, KHÔNG đụng/đánh lại số cũ. (Đã BỎ nút "đánh lại toàn bộ HĐ theo ngày ký" 23/07
// vì đếm/đánh lại từ đầu làm SAI số các HĐ đã có số — nhất là 97 HĐ có số nhưng chưa có ngày ký.)
async function suggestContractNo() {
  const gender = el('f_gender') ? el('f_gender').value : 'female';
  const date = (el('f_cdate') && el('f_cdate').dataset.iso) || today();
  const r = await guard(() => API.contractNoNext(gender, date));
  if (r && r.contract_no) { el('f_cno').value = r.contract_no; toast('Số HĐ gợi ý: ' + r.contract_no); }
}
async function suggestApCno(gender) {
  const date = (el('ap_cdate') && el('ap_cdate').dataset.iso) || today();
  const r = await guard(() => API.contractNoNext(gender, date));
  if (r && r.contract_no) { el('ap_cno').value = r.contract_no; toast('Số HĐ gợi ý: ' + r.contract_no); }
}
async function studentDetail(id) {
  const s = await guard(() => API.student(id));
  let invs = [], stays = null;
  // BL-11: server lọc theo student_id (không kéo 500 dòng nhật ký / toàn bộ hoá đơn mọi kỳ rồi .filter).
  try { invs = await API.invoices({ student_id: id }); } catch {}
  try { stays = ((await API.stays(id)) || {}).stays || []; } catch {}
  const vehicles = s.vehicles || [];
  window._detailVehicles = vehicles;
  window._detailStudent = s;   // form xe lấy ngày nhận/trả phòng làm khoảng hiệu lực mặc định
  const vios = s.violations || [];
  const vthr = (ST.settings && +ST.settings.violation_mail_threshold) || 3;
  openModal(`
    <div class="mh"><h3>${esc(s.name)} <span class="badge ${s.gender === 'female' ? 'sage' : 'blue'}">${genderLabel(s.gender)}</span> ${statusBadge(s)}${s.deleted_at ? ` <span class="badge red">${IC.lock} Đã khoá</span>` : ''}</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      ${s.deleted_at ? `<div class="bang-tin" style="margin-top:0;border-color:var(--red-ink)">${IC.lock} <span>Hồ sơ này <strong>đang bị khoá</strong> từ ${fmtDate(String(s.deleted_at).slice(0, 10))} — bị ẩn khỏi danh sách và tài khoản không đăng nhập được. Dữ liệu vẫn còn nguyên.
        <div class="rowbtns" style="margin-top:10px"><button class="btn sm green" data-act="restoreStudentAndReload" data-args='[${s.id}]'>${IC.undo} Mở khoá hồ sơ này</button></div></span></div>` : ''}
      <div class="cards" style="margin-bottom:16px">
        <div class="stat"><div class="l">Phòng</div><div class="v sm">${s.room_id ? `<span class="hd-ref" data-act="roomDetail" data-args='[${s.room_id}]' role="button" tabindex="0" title="Xem chi tiết phòng — ai đang ở">${esc(s.room_name || '—')}</span>` : esc(s.room_name || '—')}${s.room_hang ? ` <span class="badge gray">${s.room_hang}</span>` : ''}</div></div>
        <div class="stat"><div class="l">Hình thức</div><div class="v sm">${RENTAL_LABEL[s.rental_type] || 'Thuê ghép'}</div></div>
        <div class="stat"><div class="l">Tạm trú</div><div class="v sm">${resiBadge(s.residency_status)}</div></div>
      </div>
      <p><strong>Mã HV:</strong> ${esc(s.code || '—')} &nbsp;•&nbsp; <strong>Lớp:</strong> ${esc(s.class_name || '—')} &nbsp;•&nbsp; <strong>Ngày sinh:</strong> ${fmtDate(s.birth_date)}</p>
      <p><strong>SĐT:</strong> ${esc(s.phone || '—')} &nbsp;•&nbsp; <strong>SĐT phụ huynh:</strong> ${esc(s.parent_phone || '—')}</p>
      <p><strong>Khai giảng:</strong> ${fmtDate(s.class_start_date)} &nbsp;•&nbsp; <strong>Dự kiến xuất cảnh:</strong> ${fmtDate(s.expected_departure)}</p>
      <p><strong>Ngày vào:</strong> ${fmtDate(s.check_in_date)} ${s.check_out_date ? ` &nbsp;•&nbsp; <strong>Ngày trả:</strong> ${fmtDate(s.check_out_date)}` : ''}</p>
      <p><strong>Tài khoản:</strong> ${s.login_username ? `<span class="badge blue">${IC.key} ${esc(s.login_username)}</span>` : '<span class="muted">Chưa có</span>'}
        <button class="btn sm" style="margin-left:8px" data-act="accountForm" data-args='[${s.id}, ${JSON.stringify(s.code || s.phone || "")}]'>${s.login_username ? 'Đặt lại MK' : 'Tạo tài khoản'}</button></p>

      <div class="panel" style="margin-top:12px"><div class="hd"><h2 style="font-size:14px">${IC.fileText} Hợp đồng</h2></div><div class="pad">
        <p style="margin:0">Số HĐ: <strong>${esc(s.contract_no || '—')}</strong> · Ngày ký: ${fmtDate(s.contract_date)} · <span class="badge ${CONTRACT_BADGE[s.contract_status] || 'gray'}">${CONTRACT_LABEL[s.contract_status] || '—'}</span></p>
        ${s.contract_no ? '' : hdThamChieu(s, true)}
        ${contractPending(s) ? `<div class="bang-tin" style="margin:10px 0 0;background:var(--amber-bg);border-color:var(--amber-ink);color:var(--amber-ink)">${IC.alert} <strong>Chưa ký HĐ:</strong> thuê trên ${shortTermMaxDays()} ngày — cần ký <strong>hợp đồng thuê phòng</strong>.</div>`
          : handoverPending(s) ? `<div class="bang-tin" style="margin:10px 0 0">${IC.info} Cần <strong>ký phiếu đăng ký & bàn giao phòng</strong> (thuê ngắn hạn hoặc nhân viên công tác) — đặt tình trạng HĐ = "Đã ký phiếu bàn giao".</div>` : ''}
        ${(s.cccd_front || s.cccd_back || s.cccd_image) ? `<div style="margin-top:10px"><div class="muted" style="font-size:12px;margin-bottom:4px">Ảnh CCCD:</div><div style="display:flex;gap:8px;flex-wrap:wrap">
          ${s.cccd_front ? `<img src="${s.cccd_front}" title="Mặt trước" style="max-width:48%;max-height:180px;border-radius:8px;border:1px solid var(--line)">` : ''}
          ${s.cccd_back ? `<img src="${s.cccd_back}" title="Mặt sau" style="max-width:48%;max-height:180px;border-radius:8px;border:1px solid var(--line)">` : ''}
          ${!s.cccd_front && !s.cccd_back && s.cccd_image ? `<img src="${s.cccd_image}" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--line)">` : ''}
        </div></div>` : '<p class="muted" style="margin:8px 0 0;font-size:12px">Chưa có ảnh CCCD</p>'}
      </div></div>

      <div class="panel"><div class="hd"><h2 style="font-size:14px">${IC.bike} Xe (${vehicles.length})</h2><button class="btn sm" data-act="vehicleForm" data-args='[0, ${s.id}]'>${IC.plus} Thêm xe</button></div><div class="pad">
        ${vehicles.length ? vehicles.map(v => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)">
          <div><strong>${esc(v.plate || '—')}</strong> <span class="muted">${esc(v.vehicle_type || '')}</span>${v.sticker ? ` · mã dán: ${esc(v.sticker)}` : ''}${v.to_date && String(v.to_date).slice(0, 10) < today() ? ' <span class="badge gray">đã ngừng gửi</span>' : ''}
            <div class="sub2">${IC.calendar} ${fmtDate(v.from_date)} → ${v.to_date ? fmtDate(v.to_date) : 'còn gửi'}${v.note ? ' · ' + esc(v.note) : ''}</div></div>
          <div class="rowbtns"><button class="btn sm ghost" data-act="vehicleForm" data-args='[${v.id}, ${s.id}]'>${IC.pencil}</button><button class="btn sm ghost" data-act="delVehicle" data-args='[${v.id}, ${s.id}]'>${IC.trash}</button></div>
        </div>`).join('') : '<p class="muted" style="margin:0">Chưa có xe.</p>'}
      </div></div>

      <div class="panel"><div class="hd"><h2 style="font-size:14px">${IC.lock} Tiền cọc</h2></div><div class="pad">
        <p style="margin:0 0 10px">Trạng thái: ${depositBadge(s)} ${s.deposit_amount ? `· <strong>${money(s.deposit_amount)}</strong>` : ''} ${s.deposit_date ? `· đóng ${fmtDate(s.deposit_date)}` : ''} ${s.deposit_refund_date ? `· xử lý ${fmtDate(s.deposit_refund_date)}` : ''}</p>
        ${+s.deposit_deduction ? `<p style="margin:0 0 10px;color:var(--red)">Khấu trừ hư hao: <strong>${money(s.deposit_deduction)}</strong>${s.deposit_deduction_note ? ` (${esc(s.deposit_deduction_note)})` : ''} · Hoàn thực tế: <strong>${money((+s.deposit_amount || 0) - (+s.deposit_deduction || 0))}</strong></p>` : ''}
        ${s.deposit_account ? `<p style="margin:0 0 10px" class="muted">Hoàn về: ${esc(s.deposit_account)} — ${esc(s.deposit_bank)}</p>` : ''}
        <div class="rowbtns">
          ${s.deposit_status === 'none' ? `<button class="btn sm" data-act="depositForm" data-args='[${s.id}]'>Ghi nhận đóng cọc</button>` : ''}
          ${s.deposit_status === 'held' ? `<button class="btn sm green" data-act="refundForm" data-args='[${s.id}]'>Hoàn cọc</button><button class="btn sm danger" data-act="settleDeposit" data-args='[${s.id},"forfeit"]'>Không hoàn (giữ cọc)</button>` : ''}
          ${s.deposit_status === 'refunded' || s.deposit_status === 'forfeited' ? `<button class="btn sm" data-act="depositForm" data-args='[${s.id}]'>Điều chỉnh</button>` : ''}
        </div>
      </div></div>

      <div class="panel"><div class="hd"><h2 style="font-size:14px">${IC.alert} Vi phạm / Nhắc nhở (${vios.length})</h2>
        <div class="rowbtns">
          ${vios.length >= vthr && !vios.some(v => v.notified_school) ? `<button class="btn sm danger" data-act="notifySchool" data-args='[${s.id}]'>${IC.inbox} Gửi mail nhà trường</button>` : ''}
          <button class="btn sm pri" data-act="violationForm" data-args='[${s.id}]'>${IC.plus} Ghi nhận</button>
        </div></div><div class="pad">
        ${vios.length >= vthr ? `<div class="bang-tin" style="background:var(--red-bg);border-color:#e3b8ad;color:var(--red-ink)">${IC.alert} Học viên đã vi phạm <strong>${vios.length} lần</strong> (≥ ${vthr})${vios.some(v => v.notified_school) ? ' — đã gửi mail nhà trường' : ' — cần thông báo nhà trường'}.</div>` : ''}
        ${vios.length ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Loại vi phạm</th><th>Mức độ</th><th class="num">Lần</th><th></th></tr></thead><tbody>
          ${vios.map(v => `<tr><td>${fmtDate(v.date)}</td><td><strong>${esc(v.type_name)}</strong>${v.note ? `<div class="muted" style="font-size:12px">${esc(v.note)}</div>` : ''}</td><td>${vioSevBadge(v.severity)}</td><td class="num"><span class="badge ${v.level >= vthr ? 'red' : 'gray'}">${v.level}</span></td><td class="num"><button class="btn sm ghost" data-act="delViolation" data-args='[${v.id}, ${s.id}]'>${IC.trash}</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted" style="margin:0">Chưa có vi phạm.</p>'}
      </div></div>

      <h4 style="margin:18px 0 8px">${IC.receipt} Phiếu báo tiền phòng</h4>
      ${invs.length ? `<div class="table-wrap"><table><thead><tr><th>Kỳ</th><th class="num">Tổng tiền phiếu</th></tr></thead><tbody>
        ${invs.map(i => `<tr><td>${monthLabel(i.month)}</td><td class="num"><strong>${money(i.total)}</strong></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Chưa có phiếu báo.</p>'}
      <h4 style="margin:18px 0 8px">${IC.history} Lịch sử ở (ra/vào)</h4>
      ${lichSuOHTML(stays)}
    </div>
    <div class="mf">
      <button class="btn" data-act="studentForm" data-args='[${s.id}]'>${IC.pencil} Sửa</button>
      ${isOccupying(s) ? `<button class="btn" data-act="transferForm" data-args='[${s.id}]'>${IC.transfer} Chuyển phòng</button>` : ''}
      ${isOccupying(s) ? `<button class="btn danger" data-act="checkOutForm" data-args='[${s.id}]'>Check-out</button>` : `<button class="btn green" data-act="checkInForm" data-args='[${s.id}]'>Check-in lại</button>`}
      <button class="btn danger" data-act="delStudent" data-args='[${s.id}]'>${IC.trash} Xóa</button>
    </div>`, true);
}
// Lịch sử ở đọc từ room_stays — nguồn sự thật về ở/rời (thứ tính tiền dùng). Nhật ký chỉ bổ sung
// ghi chú; mốc không có nhật ký được gắn nhãn "ghi từ hồ sơ" thay vì im lặng bỏ trống.
function lichSuOHTML(stays) {
  if (stays == null) return `<div class="bang-tin">${IC.alert} Không đọc được lịch sử ở — tải lại trang rồi thử lại.</div>`;
  if (!stays.length) return '<p class="muted">Chưa có.</p>';
  const tuHoSo = '<span class="badge gray" title="Mốc này ghi thẳng vào hồ sơ, không qua nút Check-in/Check-out nên không có nhật ký thao tác">ghi từ hồ sơ</span>';
  const moc = (ngay, log) => `${fmtDate(ngay)}${log == null ? ' ' + tuHoSo : (log ? `<div class="sub2">${esc(log)}</div>` : '')}`;
  return `<div class="table-wrap"><table><thead><tr><th>Phòng</th><th>Vào</th><th>Rời</th></tr></thead><tbody>
    ${stays.map(t => `<tr>
      <td>${t.room_id ? `<span class="hd-ref" data-act="roomDetail" data-args='[${t.room_id}]' role="button" tabindex="0" title="Xem chi tiết phòng">${esc(t.room_name || '—')}</span>` : esc(t.room_name || '—')}</td>
      <td>${moc(t.from_date, t.log_vao)}</td>
      <td>${t.to_date ? moc(t.to_date, t.log_ra) : '<span class="badge green">đang ở</span>'}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}
/* Xe */
function vehicleForm(vid, studentId) {
  const s = window._detailStudent || {};
  let v = { plate: '', vehicle_type: '', sticker: '', note: '', from_date: s.check_in_date, to_date: s.check_out_date };
  if (vid) { const d = (window._detailVehicles || []).find(x => x.id === vid); if (d) v = d; }
  openModal(`
    <div class="mh"><h3>${vid ? 'Sửa xe' : 'Thêm xe'}</h3><button class="x" data-act="studentDetail" data-args='[${studentId}]'>×</button></div>
    <div class="mb">
      <div class="grid2">
        <div class="field"><label>Biển số</label><input id="v_plate" value="${esc(v.plate || '')}" placeholder="63-B4 508.58"></div>
        <div class="field"><label>Loại xe</label><input id="v_type" value="${esc(v.vehicle_type || '')}" placeholder="Xe số / Xe ga..."></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Mã dán xe</label><input id="v_sticker" value="${esc(v.sticker || '')}" placeholder="201.1"></div>
        <div class="field"><label>Ghi chú</label><input id="v_note" value="${esc(v.note || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Hiệu lực từ</label><input id="v_from"></div>
        <div class="field"><label>Đến ngày <span class="opt">(để trống = còn gửi)</span></label><input id="v_to"></div>
      </div>
      <div class="hint">${IC.bulb} Phí gửi xe (${money(ST.settings.parking_fee)}/xe/tháng) tính cho THÁNG NÀO khoảng hiệu lực chạm tới.
        Mặc định lấy theo ngày nhận phòng${s.check_out_date ? ' và ngày trả phòng' : ' (chưa trả phòng nên để ngỏ)'} của học viên — sửa được nếu xe đăng ký muộn hơn hoặc ngừng gửi sớm hơn.</div>
    </div>
    <div class="mf"><button class="btn" data-act="studentDetail" data-args='[${studentId}]'>Hủy</button><button class="btn pri" data-act="saveVehicle" data-args='[${vid || 0}, ${studentId}]'>Lưu</button></div>`);
  attachDate(el('v_from'), (v.from_date || '').slice(0, 10));
  attachDate(el('v_to'), (v.to_date || '').slice(0, 10));
}
async function saveVehicle(vid, studentId) {
  const from = el('v_from').dataset.iso || null, to = el('v_to').dataset.iso || null;
  if (from && to && to < from) return toast('Ngày ngừng gửi trước ngày bắt đầu', 'err');
  const body = {
    student_id: studentId, plate: el('v_plate').value.trim(), vehicle_type: el('v_type').value.trim(),
    sticker: el('v_sticker').value.trim(), note: el('v_note').value.trim(), from_date: from, to_date: to,
  };
  await guard(() => vid ? API.updateVehicle(vid, body) : API.createVehicle(body));
  await refreshCache(); toast('Đã lưu xe'); studentDetail(studentId);
}
async function delVehicle(vid, studentId) {
  const v = (window._detailVehicles || []).find(x => x.id === vid) || {};
  if (!confirm(`Xóa hẳn xe ${v.plate || 'này'}?\n\n`
    + `• Dùng khi bản ghi NHẬP NHẦM. Xóa là mất hẳn, KHÔNG khôi phục được.\n`
    + `• Học viên ngừng gửi xe thì ĐỪNG xóa — bấm ${'✎'} rồi điền "Đến ngày". Xe vẫn nằm trong hồ sơ và phí tính đúng tới ngày đó.`)) return;
  await guard(() => API.deleteVehicle(vid)); await refreshCache(); toast('Đã xóa hẳn xe'); studentDetail(studentId);
}
/* Người này đã có hồ sơ rồi — hiện lỗi kèm NÚT ĐI THẲNG tới việc họ thực sự cần làm.
   Đây là chỗ đã gây thu dư 5.709.087đ trong tháng 07/2026: nhân viên tạo hồ sơ mới khi
   học viên chuyển phòng, nên người đó có 2 hồ sơ và nhận 2 phiếu. */
function duplicateModal(d) {
  const s = d.existing || {};
  const dangO = s.status === 'in';
  openModal(`
    <div class="mh"><h3>${IC.alert} Bạn này đã có hồ sơ</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="bang-tin" style="margin:0 0 16px"><span>${esc(d.error)}</span></div>
      <div class="asset-item" style="padding:14px">
        <div>${s.id ? `<div class="hd-ref" style="font-weight:700" data-close data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Xem chi tiết hồ sơ">${esc(s.name || '')}</div>` : `<div style="font-weight:700">${esc(s.name || '')}</div>`}
          <div class="sub2">${s.code ? 'Mã HV: ' + esc(s.code) : ''}${(() => { if (!s.room_name) return ''; const r = ST.rooms.find(x => x.name === s.room_name); return r ? ` · Phòng <span class="hd-ref" data-close data-act="roomDetail" data-args='[${r.id}]' role="button" tabindex="0" title="Xem chi tiết phòng">${esc(s.room_name)}</span>` : ' · Phòng ' + esc(s.room_name); })()}</div></div>
        ${dangO ? '<span class="badge green">Đang ở</span>' : '<span class="badge gray">Đã trả phòng</span>'}
      </div>
    </div>
    <div class="mf">
      <button class="btn" data-act="closeModal">Đóng</button>
      ${s.id ? (dangO
        ? `<button class="btn" data-close data-act="studentForm" data-args='[${s.id}]'>Xem hồ sơ</button>
           <button class="btn pri" data-close data-act="transferForm" data-args='[${s.id}]'>${IC.transfer} Chuyển phòng cho bạn ấy</button>`
        : `<button class="btn pri" data-close data-act="checkInForm" data-args='[${s.id}]'>${IC.doorOpen} Check-in lại cho bạn ấy</button>`) : ''}
    </div>`);
}

/* Ô chốt chỉ số công-tơ, dùng chung cho Trả phòng và Chuyển phòng.
   KHÔNG bắt buộc: bỏ trống thì app quay về chia tiền điện cả tháng theo số ngày ở (như trước). */
function meterField(id, roomName, verb) {
  return `<div class="field">
    <label>Chỉ số công-tơ phòng ${esc(roomName || '')} hôm ${verb} <span class="muted">— không bắt buộc</span></label>
    <input id="${id}" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Số trên đồng hồ điện, VD: 1234.5">
    <div class="hint">${IC.info}<span>Nhập số này thì tiền điện dùng <strong>trước</strong> và <strong>sau</strong> hôm đó được tách riêng — ai dùng nấy trả.
    Bỏ trống thì app chia tiền điện cả tháng theo số ngày ở của từng người.</span></div>
  </div>`;
}

/* Chuyển phòng */
function transferForm(id) {
  const s = studentById(id);
  const chuaXep = !s.room_id; // BL-87: HV chưa có phòng -> "Xếp phòng" (lần đầu), không phải "Chuyển phòng"
  openModal(`
    <div class="mh"><h3>${IC.transfer} ${chuaXep ? 'Xếp phòng' : 'Chuyển phòng'}: ${esc(s.name)}</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      ${chuaXep ? '' : `<p class="muted">Phòng hiện tại: <span class="hd-ref" data-act="roomDetail" data-args='[${s.room_id}]' role="button" tabindex="0" title="Xem chi tiết phòng — ai đang ở"><strong>${esc(s.room_name || '—')}</strong></span></p>`}
      <div class="grid2">
        <div class="field"><label>${chuaXep ? 'Xếp vào phòng' : 'Phòng mới'}</label><select id="t_room">${roomOptions('', s.gender)}</select></div>
        <div class="field"><label>Ngày ${chuaXep ? 'xếp' : 'chuyển'}</label><input id="t_date"></div>
      </div>
      <div class="field"><label>Ghi chú</label><input id="t_note" placeholder="${chuaXep ? 'Ghi chú (tuỳ chọn)...' : 'Lý do chuyển...'}"></div>
      ${s.room_id ? meterField('t_meter', s.room_name, 'chuyển đi') : ''}
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="doTransfer" data-args='[${id}]'>${chuaXep ? 'Xếp phòng' : 'Chuyển'}</button></div>`);
  attachDate(el('t_date'), today());
}
async function doTransfer(id) {
  const room_id = el('t_room').value; if (!room_id) return toast('Chọn phòng mới', 'err');
  const meter = el('t_meter') ? el('t_meter').value.trim() : '';
  const moved = await guard(() => withOverloadConfirm(ok =>
    API.transfer(id, { room_id, date: el('t_date').dataset.iso, note: el('t_note').value.trim(), meter_reading: meter || undefined, confirm_overload: ok })));
  if (moved === null) return;
  await refreshCache(); closeModal();
  const n = moved.recalced ? moved.recalced.length : 0;
  toast(n ? `Đã chuyển phòng · tính lại tiền điện cho ${n} phiếu` : 'Đã chuyển phòng');
  adminGo(ST.view);
}
/* Hoàn cọc kèm khấu trừ hư hao tài sản + STK */
async function refundForm(id) {
  // BL-78: số tài khoản hoàn cọc không còn nằm trong danh sách -> lấy từ hồ sơ chi tiết.
  const s = (await guard(() => API.student(id))) || {};
  const deposit = +s.deposit_amount || 0;
  const assetRow = a => `<tr>
    <td>${esc(a.name)} <span class="muted" style="font-size:11px">(${esc(a.unit)})</span></td>
    <td class="num"><input type="number" min="0" step="1" data-dqty="${a.id}" value="0" style="width:64px;text-align:right" data-input="dedCalc"></td>
    <td class="num"><input type="number" data-dfee="${a.id}" data-dname="${esc(a.name)}" value="${+a.fee || 0}" style="width:110px;text-align:right;background:var(--bg2,#f5f5f5)" readonly title="Phí bồi hoàn lấy từ danh mục tài sản — sửa trong mục Cài đặt"></td>
    <td class="num" id="dl_${a.id}">0</td>
  </tr>`;
  const person = ST.assets.filter(a => a.category === 'person');
  const fixed = ST.assets.filter(a => a.category === 'fixed');
  openModal(`
    <div class="mh"><h3>${IC.handCoins} Hoàn cọc: ${esc(s.name || '')}</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="hint">Tick số lượng tài sản <strong>hư hao / mất / không vệ sinh</strong> để khấu trừ vào cọc. Có thể sửa đơn giá bồi hoàn.</div>
      <div class="table-wrap" style="max-height:280px;overflow:auto"><table><thead><tr><th>Tài sản</th><th class="num">SL hư/mất</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th></tr></thead><tbody>
        ${person.length ? `<tr><td colspan="4" style="background:#fbeee3;font-weight:700;font-size:12px">Trang thiết bị theo người</td></tr>${person.map(assetRow).join('')}` : ''}
        ${fixed.length ? `<tr><td colspan="4" style="background:#fbeee3;font-weight:700;font-size:12px">Trang thiết bị cố định</td></tr>${fixed.map(assetRow).join('')}` : ''}
      </tbody></table></div>
      <div style="background:var(--bg2);padding:14px;border-radius:10px;margin:14px 0;font-size:14px">
        <div style="display:flex;justify-content:space-between"><span>Tiền cọc:</span><strong>${money(deposit)}</strong></div>
        <div style="display:flex;justify-content:space-between;color:var(--red)"><span>Khấu trừ hư hao:</span><strong id="dedTotal">0</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:16px;margin-top:6px;padding-top:8px;border-top:1px solid var(--line)"><span><strong>Hoàn thực tế:</strong></span><strong id="dedRefund" data-deposit="${deposit}" style="color:var(--green)">${money(deposit)}</strong></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Số tài khoản</label><input id="r_acc" value="${esc(s.deposit_account || '')}"></div>
        <div class="field"><label>Ngân hàng</label><input id="r_bank" value="${esc(s.deposit_bank || '')}" placeholder="VIETCOMBANK - ..."></div>
      </div>
      <div class="field"><label>Ngày hoàn</label><input id="r_date"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn green" data-act="doRefund" data-args='[${id}, ${deposit}]'>Xác nhận hoàn cọc</button></div>`, true);
  attachDate(el('r_date'), today());
  dedCalc();
}
function dedCalc() {
  let total = 0;
  document.querySelectorAll('#modal input[data-dqty]').forEach(q => {
    const id = q.dataset.dqty;
    const fee = +document.querySelector(`[data-dfee="${id}"]`).value || 0;
    const line = (+q.value || 0) * fee;
    total += line;
    el('dl_' + id).textContent = money(line);
  });
  const deposit = +(el('dedRefund').dataset.deposit || 0);
  el('dedTotal').textContent = money(total);
  el('dedRefund').textContent = money(Math.max(0, deposit - total));
  el('dedTotal').dataset.total = total;
}
async function doRefund(id, deposit) {
  // Gửi DANH SÁCH { asset_id, quantity } — server tự tra phí bồi hoàn thật từ danh mục và tự tính.
  // Không gửi con số tự nhân ở máy khách nữa (V2-30).
  let total = 0; const deductions = [];
  document.querySelectorAll('#modal input[data-dqty]').forEach(q => {
    const qty = +q.value || 0; if (!qty) return;
    const feeEl = document.querySelector(`[data-dfee="${q.dataset.dqty}"]`);
    total += qty * (+feeEl.value || 0);   // chỉ để hiện toast, không phải con số quyết định
    deductions.push({ asset_id: +q.dataset.dqty, quantity: qty });
  });
  await guard(() => API.settleDeposit(id, {
    action: 'refund', account: el('r_acc').value.trim(), bank: el('r_bank').value.trim(), date: el('r_date').dataset.iso,
    deductions,
  }));
  await refreshCache(); closeModal();
  toast(total ? `Đã hoàn cọc (trừ ${money(total)} hư hao)` : 'Đã hoàn cọc');
  studentDetailRefresh(id);
}
async function delStudent(id) {
  // Phải nói rõ xoá AI. "Xóa học viên này?" thì bấm nhầm dòng cũng không biết mình sắp xoá ai —
  // nhất là trên điện thoại, các nút san sát nhau.
  const s = studentById(id) || {};
  const ai = [s.name, s.code && `mã ${s.code}`, s.room_name && `phòng ${s.room_name}`].filter(Boolean).join(' · ');
  if (!confirm(`Xóa ${ai || 'học viên này'}?\n\nĐây là xóa mềm — khôi phục lại được trong mục "Đã xóa".`)) return;
  await guard(() => API.deleteStudent(id)); await refreshCache(); closeModal();
  toast(`Đã xóa ${s.name || 'học viên'} (khôi phục được)`); viewStudents();
}
// Thùng rác học viên: xem danh sách đã xóa mềm + khôi phục
// Danh sách HV ĐÃ KHOÁ (hồ sơ ẩn khỏi danh sách + tài khoản không đăng nhập được — KHÔNG xoá dữ liệu).
// Bấm vào hàng để xem CHI TIẾT hồ sơ trước khi quyết định mở khoá (trước đây chỉ có tên/mã/phòng nên
// không đủ căn cứ để dám mở lại).
async function showDeletedStudents() {
  const list = await guard(() => API.students(true));
  openModal(`
    <div class="mh"><h3>${IC.lock} Học viên đã khoá (${list.length})</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      ${list.length ? `<div class="hint" style="margin-top:0">${IC.info} Bấm vào một dòng để xem <strong>chi tiết hồ sơ</strong> (phòng, hợp đồng, cọc, ngày ở, vi phạm…) rồi mở khoá ngay trong đó.</div>
      <div class="table-wrap"><table><thead><tr><th>Học viên</th><th>Mã</th><th>Phòng</th><th></th></tr></thead><tbody>
        ${list.map(s => `<tr style="cursor:pointer" title="Xem chi tiết hồ sơ" data-act="studentDetail" data-args='[${s.id}]'>
          <td><strong>${esc(s.name)}</strong>${s.class_name ? ` <span class="muted">· ${esc(s.class_name)}</span>` : ''}</td>
          <td>${esc(s.code || '—')}</td><td>${s.room_id ? `<span class="hd-ref" data-act="roomDetail" data-args='[${s.room_id}]' role="button" tabindex="0" title="Xem chi tiết phòng">${esc(s.room_name || '—')}</span>` : '—'}</td>
          <td class="num"><div class="rowbtns" style="justify-content:flex-end">
            <button class="btn sm" data-act="studentDetail" data-args='[${s.id}]'>Chi tiết</button>
            <button class="btn sm green" data-act="restoreStudentAndReload" data-args='[${s.id}]'>${IC.undo} Mở khoá</button>
          </div></td>
        </tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Không có học viên nào bị khoá.</div>'}
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`, true);
}
async function restoreStudentAndReload(id) {
  await guard(() => API.restoreStudent(id));
  await refreshCache(); closeModal(); toast('Đã mở khoá học viên'); viewStudents();
}
// Admin tạo ĐƠN ĐĂNG KÝ hộ học viên (thay cho việc thêm học viên trực tiếp).
// Đơn vào trạng thái "Chờ duyệt" -> admin bấm "Thêm vào phòng" để tạo học viên.
function appForm() {
  const facOpts = (ST.facilities || []).map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  openModal(`
    <div class="mh"><h3>${IC.filePen} Tạo đơn đăng ký</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="hint">${IC.info} Đơn tạo ở đây vào danh sách <strong>Đăng ký ở nội trú</strong> ở trạng thái <strong>Chờ duyệt</strong>. Bấm <strong>“Thêm vào phòng”</strong> để duyệt & tạo học viên.</div>
      <div class="grid2">
        <div class="field"><label>Họ và tên *</label><input id="ap_name" placeholder="Nguyễn Văn A"></div>
        <div class="field"><label>SĐT *</label><input id="ap_phone" placeholder="09..."></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Giới tính</label><select id="ap_gender"><option value="female">Nữ</option><option value="male">Nam</option></select></div>
        <div class="field"><label>Ngày sinh</label><input id="ap_birth" placeholder="dd/mm/yyyy" readonly></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Mã học viên (MSHV)</label><input id="ap_code" placeholder="TXTS-..."></div>
        <div class="field"><label>Lớp</label><input id="ap_class" placeholder="Esu..."></div>
      </div>
      <div class="field"><label>Cơ sở</label><select id="ap_fac">${facOpts}</select></div>
      <div class="field"><label>Nguyện vọng phòng</label><input id="ap_pref" placeholder="VD: tầng thấp, gần thang máy..."></div>
      <div class="grid2">
        <label class="check" style="align-self:center"><input type="checkbox" id="ap_wash"> Đăng ký máy giặt</label>
        <label class="check" style="align-self:center"><input type="checkbox" id="ap_park"> Gửi xe</label>
      </div>
      <div class="field"><label>Biển số xe (nếu gửi xe)</label><input id="ap_plate" placeholder="59-..."></div>
      <div class="field"><label>Ghi chú</label><textarea id="ap_note" rows="2"></textarea></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveApp">Tạo đơn</button></div>`);
  attachDate(el('ap_birth'), '', { max: today() });
}
async function saveApp() {
  const name = el('ap_name').value.trim(), phone = el('ap_phone').value.trim();
  if (!name) return toast('Nhập họ tên', 'err');
  if (!phone) return toast('Nhập số điện thoại', 'err');
  const body = {
    name, phone, gender: el('ap_gender').value, birth_date: el('ap_birth').dataset.iso || null,
    code: el('ap_code').value.trim(), class_name: el('ap_class').value.trim(),
    rental_type: 'ghep', // KTX không cho thuê nguyên phòng nữa — bỏ ô chọn, mọi đơn mới đều là thuê ghép
    facility_id: +el('ap_fac').value || null,
    pref: el('ap_pref').value.trim(), note: el('ap_note').value.trim(),
    wants_washing: el('ap_wash').checked, wants_parking: el('ap_park').checked, plate: el('ap_plate').value.trim(),
  };
  await guard(() => API.publicApply(body));
  await refreshCache(); closeModal(); toast('Đã tạo đơn đăng ký (chờ duyệt)'); adminGo('reg');
}
function accountForm(id, code) {
  openModal(`
    <div class="mh"><h3>Tài khoản đăng nhập học viên</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="field"><label>Tên đăng nhập <span class="opt">${code ? 'gợi ý sẵn — sửa được' : 'hồ sơ chưa có mã HV lẫn SĐT, phải tự đặt'}</span></label>
        <input id="a_user" value="${esc(code || '')}" placeholder="vd mã học viên hoặc số điện thoại"></div>
      <div class="field"><label>Mật khẩu mới</label><input id="a_pass" type="text" placeholder="tối thiểu 6 ký tự"></div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveAccount" data-args='[${id}]'>Lưu</button></div>`);
  setTimeout(() => el('a_pass').focus(), 50);
}
async function saveAccount(id) {
  const r = await guard(() => API.setAccount(id, { username: el('a_user').value.trim(), password: el('a_pass').value.trim() }));
  await refreshCache(); closeModal(); toast('Đã lưu tài khoản: ' + r.username);
}
/* Cọc */
function depositForm(id) {
  const s = studentById(id) || {};
  openModal(`
    <div class="mh"><h3>${IC.lock} Ghi nhận đóng cọc</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="grid2">
        <div class="field"><label>Số tiền cọc</label><input id="d_amt" type="number" min="0" value="${esc(s.deposit_amount || ST.settings.deposit_fee || 1200000)}"></div>
        <div class="field"><label>Ngày đóng</label><input id="d_date"></div>
      </div>
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Hủy</button><button class="btn pri" data-act="saveDeposit" data-args='[${id}]'>Lưu</button></div>`);
  attachDate(el('d_date'), s.deposit_date || today());
}
async function saveDeposit(id) {
  await guard(() => API.setDeposit(id, { amount: +el('d_amt').value || 0, date: el('d_date').dataset.iso }));
  await refreshCache(); closeModal(); toast('Đã ghi nhận cọc'); studentDetailRefresh(id);
}
async function settleDeposit(id, action) {
  if (!confirm(action === 'refund' ? 'Xác nhận HOÀN cọc cho học viên?' : 'Xác nhận KHÔNG hoàn cọc (giữ lại)?')) return;
  await guard(() => API.settleDeposit(id, { action }));
  await refreshCache(); toast(action === 'refund' ? 'Đã hoàn cọc' : 'Đã giữ cọc'); studentDetailRefresh(id);
}
function studentDetailRefresh(id) { if (el('overlay').classList.contains('show')) studentDetail(id); else viewStudents(); }

/* ---------- QUỸ CỌC ---------- */
function quyCoc() {
  const held = ST.students.filter(s => s.deposit_status === 'held');
  const pending = held.filter(s => liveStatus(s) === 'left');   // đã trả phòng, cọc chưa xử lý
  const staying = held.filter(s => liveStatus(s) !== 'left');
  const total = held.reduce((a, s) => a + (+s.deposit_amount || 0), 0);
  const pendAmt = pending.reduce((a, s) => a + (+s.deposit_amount || 0), 0);
  const rowFor = s => `<tr>
    <td><span class="hd-ref" data-act="studentDetail" data-args='[${s.id}]' role="button" tabindex="0" title="Xem chi tiết học viên"><strong>${esc(s.name)}</strong></span><div class="sub2">${s.room_id ? `<span class="hd-ref" data-act="roomDetail" data-args='[${s.room_id}]' role="button" tabindex="0" title="Xem chi tiết phòng">${esc(s.room_name || '')}</span>` : 'Chưa xếp'} · ${esc(s.code || '')}</div></td>
    <td class="num">${money(s.deposit_amount)}</td>
    <td>${fmtDate(s.deposit_date)}</td>
    <td>${statusBadge(s)}</td>
    <td class="num">${liveStatus(s) === 'left' ? `<button class="btn sm green" data-close data-act="refundForm" data-args='[${s.id}]'>Hoàn cọc</button>` : ''}</td>
  </tr>`;
  openModal(`
    <div class="mh"><h3>${IC.lock} Quỹ cọc</h3><button class="x" aria-label="Đóng" data-act="modalBack">×</button></div>
    <div class="mb">
      <div class="kpis" style="margin-bottom:16px">
        <div class="kpi"><span class="ic ic-brand">${IC.lock}</span><div><div class="v">${money(total)}</div><div class="l">Tổng quỹ cọc đang giữ</div></div></div>
        <div class="kpi"><span class="ic ic-gray">${IC.users}</span><div><div class="v">${held.length}</div><div class="l">Học viên đang giữ cọc</div></div></div>
        <div class="kpi"><span class="ic ic-red">${IC.handCoins}</span><div><div class="v">${pending.length}</div><div class="l">Cần hoàn cọc ${pendAmt ? '(' + money(pendAmt) + ')' : ''}</div></div></div>
      </div>
      ${pending.length ? `<div class="bang-tin" style="background:var(--red-bg);border-color:#fca5a5;color:#b91c1c">${IC.handCoins} <strong>${pending.length} học viên đã trả phòng</strong> đang chờ hoàn cọc — hãy xử lý sớm.</div>
        <div class="table-wrap" style="margin-bottom:18px"><table><thead><tr><th>Học viên</th><th class="num">Cọc</th><th>Ngày đóng</th><th>Trạng thái</th><th></th></tr></thead><tbody>${pending.map(rowFor).join('')}</tbody></table></div>` : `<div class="hint">${IC.checkCircle} Không có khoản cọc nào chờ hoàn.</div>`}
      <h4 style="margin:6px 0 8px">Đang giữ cọc (${staying.length})</h4>
      ${staying.length ? `<div class="table-wrap"><table><thead><tr><th>Học viên</th><th class="num">Cọc</th><th>Ngày đóng</th><th>Trạng thái</th><th></th></tr></thead><tbody>${staying.map(rowFor).join('')}</tbody></table></div>` : '<p class="muted">Chưa có.</p>'}
    </div>
    <div class="mf"><button class="btn" data-act="closeModal">Đóng</button></div>`, true);
}

/* ---------- XE ---------- */
let vehSearch = '';
/* ---------- DỊCH VỤ (Máy giặt · Gửi xe — mọi dịch vụ tùy chọn ở 1 nơi) ---------- */
let svcTab = 'washing';
