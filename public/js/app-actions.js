// === app-actions.js — EVENT DELEGATION: mot bo listener uy quyen tren `document`, khong inline on* ===
// QUY UOC DOM:
//   data-act="tenHam"     -> click:  goi window.tenHam(...args, event), this = phan tu
//   data-args='[...json]'  -> tham so (JSON HOP LE, dung nhay don cho thuoc tinh); thieu = []
//   data-close             -> goi closeModal() TRUOC
//   data-closenotif        -> goi closeNotif() TRUOC
//   data-change="tenHam"   -> change (vd o <select>/<input>)
//   data-input="tenHam"    -> input
//   data-err="tenHam"      -> loi tai <img> (su kien error KHONG noi bot -> bat pha capture)
//   <a data-act> tu preventDefault (thay cho ';return false' cu).
// Cac ham deu khai bao bang `function` o cap cao nhat -> nam san tren window, tra qua window[ten].

function _actRun(name, elBind, ev, argsAttr) {
  const fn = window[name];
  if (typeof fn !== 'function') { console.warn('[act] khong thay ham:', name); return; }
  let args = [];
  if (argsAttr) {
    try { args = JSON.parse(argsAttr); }
    catch (e) { console.error('[act] data-args loi JSON:', name, argsAttr); return; }
  }
  // KHONG noi `event` vao args: nhieu ham co tham so DAU tuy chon (vd facilityForm(id) — id=undefined = "them moi").
  // Neu nhet event vao do -> id=event -> sai/crash. Ham can event (toggleNotif) tu doc, da guard `if(e)`.
  // `this` = phan tu (elBind) de wrapper doc this.dataset.* / this.value / this.checked.
  return fn.apply(elBind, args);
}
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-act]');
  if (!t) return;
  // Bôi đen chữ trong một HÀNG bấm được (copy tên phòng, ghi chú...) rồi nhả chuột vẫn phát click ->
  // mở modal ngoài ý muốn, mà vùng bôi đen thì mất luôn. Chỉ chặn ở cấp <tr>: nút bên trong hàng
  // KHÔNG bị ảnh hưởng vì closest() trả về nút chứ không phải hàng.
  if (t.tagName === 'TR' && window.getSelection) {
    const s = window.getSelection();
    if (s && !s.isCollapsed && String(s).trim().length > 1 && t.contains(s.anchorNode)) return;
  }
  if (t.tagName === 'A') e.preventDefault();              // thay ';return false' tren <a href="#">
  if (t.hasAttribute('data-close')) closeModal();
  if (t.hasAttribute('data-closenotif')) closeNotif();
  _actRun(t.dataset.act, t, e, t.dataset.args);
});
// BL-63/BL-31: Enter/Space kích hoạt phần tử role="button" gắn data-act (div/td/tr KHÔNG tự kích hoạt như <button>).
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const t = e.target;
  if (!t || !t.matches || !t.matches('[data-act][role="button"]')) return;
  if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return; // control gốc tự xử lý -> tránh chạy 2 lần
  e.preventDefault();   // Space không cuộn trang
  t.click();            // tổng hợp click -> chạy qua listener click ở trên
});
/* ===== VUỐT MÉP TRÁI = QUAY LẠI (điện thoại) =================================================
   Modal trên điện thoại chiếm trọn màn hình, nên nó phải cư xử như MỘT MÀN HÌNH: vuốt từ mép trái
   sang phải là lùi về màn trước (lớp modal dưới, hoặc đóng hẳn) — đúng quy ước iOS/Android.
   Vùng mép trái ≤24px chính là vùng mà bộ cử chỉ xoá-hàng bên dưới CỐ Ý chừa ra, nên hai cử chỉ
   không tranh nhau: chạm mép = quay lại, chạm giữa hàng = giữ/kéo để xoá.
   Chỉ chạy khi modal đang mở; ngoài modal thì để nguyên cử chỉ back của hệ điều hành. */
// Cử chỉ áp cho HAI thứ, tuỳ lúc đó đang có gì trên màn:
//   · modal đang mở  -> lùi một lớp modal (hoặc đóng)
//   · màn thường     -> QUAY LẠI MÀN TRƯỚC, kéo cả .main theo tay rồi trượt hẳn ra
// Không có chỗ để lùi (đang ở màn gốc) thì vẫn cho kéo một đoạn ngắn rồi bật về — im lặng không phản
// hồi gì thì người dùng tưởng máy đơ, còn kéo hụt một cái là hiểu ngay "hết đường lùi".
const _VUOT = { MEP: 26, NGUONG: 70, LECH_HUY: 40, CAN_GOC: 44 };
let _vuot = null;
const _vuotManHinh = () => el('main') || document.querySelector('.main');
document.addEventListener('touchstart', e => {
  _vuot = null;
  if (e.touches.length !== 1) return;
  if (!window.matchMedia || !matchMedia('(max-width:620px)').matches) return; // chỉ chế độ điện thoại
  const p = e.touches[0];
  if (p.clientX > _VUOT.MEP) return;
  const trongModal = el('overlay') && el('overlay').classList.contains('show');
  if (!trongModal && !_vuotManHinh()) return;                 // màn đăng nhập / cổng -> không có gì để kéo
  // Màn gốc (chưa đi đâu) thì chỉ cho kéo hụt: có phản hồi nhưng không lùi.
  const luiDuoc = trongModal || (typeof navDepth === 'function' && navDepth() > 0);
  _vuot = { x0: p.clientX, y0: p.clientY, keo: false, trongModal, luiDuoc };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!_vuot) return;
  const p = e.touches[0], dx = p.clientX - _vuot.x0, dy = p.clientY - _vuot.y0;
  if (!_vuot.keo) {
    if (Math.abs(dy) > _VUOT.LECH_HUY && Math.abs(dy) > Math.abs(dx)) return (_vuot = null);  // đang cuộn dọc
    if (dx <= 8) return;
    _vuot.keo = true;
    if (!_vuot.trongModal) { const s = _vuotManHinh(); if (s) s.classList.add('keo-man'); }
  }
  const dich = _vuot.trongModal ? el('modal') : _vuotManHinh();
  if (!dich) return;
  // Kéo hụt ở màn gốc: cho đi rất ngắn rồi ì lại (kiểu dây chun), đủ để thấy là "không lùi được nữa".
  const di = _vuot.luiDuoc ? Math.max(0, dx) : Math.min(_VUOT.CAN_GOC, Math.max(0, dx) * .35);
  if (_vuot.trongModal) dich.style.transition = 'none';
  dich.style.transform = `translateX(${di}px)`;
  dich.style.opacity = String(Math.max(.35, 1 - di / 420));
}, { passive: true });
document.addEventListener('touchend', () => {
  if (!_vuot) return;
  const trongModal = _vuot.trongModal, luiDuoc = _vuot.luiDuoc, keo = _vuot.keo;
  const dich = trongModal ? el('modal') : _vuotManHinh();
  const dx = dich ? parseFloat((dich.style.transform.match(/-?[\d.]+/) || [0])[0]) : 0;
  _vuot = null;
  const du = keo && luiDuoc && dx >= _VUOT.NGUONG;

  if (trongModal) {
    if (dich) { dich.style.transition = ''; dich.style.transform = ''; dich.style.opacity = ''; }
    // modalCuChiLui (không phải modalBack): nó nuốt thêm cú popstate mà trình duyệt tự sinh cho cùng
    // cú vuốt mép này, nếu không thì một cái vuốt lùi mất hai lớp.
    if (du && typeof modalCuChiLui === 'function') modalCuChiLui();
    return;
  }
  if (!dich) return;
  dich.classList.remove('keo-man');
  if (!du) {                                   // chưa tới ngưỡng (hoặc hết đường lùi) -> bật về chỗ
    dich.classList.add('keo-ve');
    dich.style.transform = ''; dich.style.opacity = '';
    setTimeout(() => dich.classList.remove('keo-ve'), 220);
    return;
  }
  // Đủ ngưỡng: trượt hẳn màn cũ ra rồi mới đổi màn — màn mới tự trượt vào từ trái (navHieuUng).
  dich.classList.add('keo-ra');
  dich.style.transform = ''; dich.style.opacity = '';
  setTimeout(() => {
    dich.classList.remove('keo-ra');
    dich.style.transform = ''; dich.style.opacity = '';
    if (typeof goBackCuChi === 'function') goBackCuChi();
  }, 180);
}, { passive: true });
document.addEventListener('touchcancel', () => {
  if (_vuot) {
    const dich = _vuot.trongModal ? el('modal') : _vuotManHinh();
    if (dich) { dich.classList.remove('keo-man'); dich.style.transition = ''; dich.style.transform = ''; dich.style.opacity = ''; }
  }
  _vuot = null;
}, { passive: true });

/* ===== CỬ CHỈ TRÊN HÀNG BẢNG (điện thoại): GIỮ hoặc KÉO NGANG = XOÁ ==========================
   Trên điện thoại nút thùng rác bị ẩn (.row-del) vì đứng sát vùng bấm của hàng, chỉ lệch vài pixel
   là bấm nhầm. Thay bằng cử chỉ có chủ đích: GIỮ ~0,6s hoặc KÉO NGANG hàng qua 90px.
   Quy ước DOM:  <tr data-del="tenHam" data-delid="12" data-delname="104">
   Uỷ quyền trên document (KHÔNG gắn từng hàng) vì app vẽ lại innerHTML liên tục — y như bộ listener
   data-act ở trên, gắn 1 lần là xong.
   Chỉ chạy khi hàng đang ở CHẾ ĐỘ THẺ (.card-tbl ≤620px): lúc đó <tr> mới là block box nên
   translateX có hiệu lực và bảng không còn cuộn ngang để giành cử chỉ (styles.css .card-tbl).
   Chuột thì bỏ qua hoàn toàn — máy tính vẫn dùng nút. */
// GIU_MS = 1000: 600ms là quá nhạy — đặt ngón lên thẻ để đọc rồi mới vuốt cuộn là thao tác thường
// ngày, và nó sẽ bật hộp thoại xoá dù người ta chưa định làm gì. 1 giây cũng đúng bằng câu gợi ý
// hiện trên màn hình ("giữ khoảng 1 giây"), không nói một đằng làm một nẻo.
const _CU_CHI = { GIU_MS: 1000, KEO_NGUONG: 90, LECH_HUY: 12 };
let _cc = null;              // phiên cử chỉ đang diễn ra
let _ccDaChay = false;       // đã phát hành động -> touchend preventDefault để không sinh click ma
let _ccVuaChay = 0;          // lưới thứ hai: mốc thời gian, phòng khi trình duyệt vẫn bồi click

const _ccHangHopLe = t => {
  const tr = t && t.closest && t.closest('tr[data-del]');
  if (!tr || !tr.dataset.del) return null;
  // chỉ ở chế độ thẻ; getComputedStyle đọc display thật, không đoán theo bề rộng cửa sổ
  if (getComputedStyle(tr).display !== 'block') return null;
  return tr;
};
function _ccDon(nhaHang) {
  if (!_cc) return;
  clearTimeout(_cc.timer);
  if (nhaHang && _cc.tr) { _cc.tr.classList.remove('row-swiping', 'row-armed', 'row-holding'); _cc.tr.style.transform = ''; }
  _cc = null;
}
function _ccChay(tr) {
  // Hàng còn nằm trong trang chứ? App vẽ lại innerHTML liên tục (refreshCache/viewRooms có thể chạy
  // vì việc khác ngay lúc ngón tay còn trên màn). Khi đó _cc.tr là node đã lìa DOM: cử chỉ vẫn "chạy"
  // trên dữ liệu của hàng CŨ, trong khi dưới ngón tay giờ là phòng khác — xoá nhầm mà không ai biết.
  if (!tr.isConnected) return _ccDon(true);
  const id = +tr.dataset.delid;
  _ccDon(true);
  _ccDaChay = true;                                          // -> touchend sẽ preventDefault, chặn click ma
  _actRun(tr.dataset.del, tr, null, JSON.stringify([id]));   // delRoom(id) — tự có confirm() bên trong
  // Lưới thứ hai, theo thời gian. Đặt mốc SAU khi hành động chạy xong chứ không phải trước: delRoom mở
  // confirm() — hộp thoại này CHẶN luồng theo thời gian THẬT, người ta đắn đo 2-3 giây là bình thường,
  // đặt mốc trước thì cửa sổ đã hết hạn lúc cú click mới tới. (Test tự động không lộ ra điều này: máy
  // bấm OK trong vài mili giây nên cửa sổ nào cũng kịp.)
  _ccVuaChay = Date.now();
}
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return _ccDon(true);            // 2 ngón = phóng to, không phải cử chỉ
  const t = e.target;
  if (t.closest && t.closest('button, a, input, select, textarea, label')) return; // chạm nút thì để nút làm việc
  const tr = _ccHangHopLe(t);
  if (!tr) return;
  const p = e.touches[0];
  if (p.clientX < 24) return;                                 // mép trái = cử chỉ BACK của iOS, đừng tranh
  _cc = { tr, x0: p.clientX, y0: p.clientY, keo: false, timer: null };
  tr.classList.add('row-holding');
  _cc.timer = setTimeout(() => { if (_cc && _cc.tr === tr && !_cc.keo) _ccChay(tr); }, _CU_CHI.GIU_MS);
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!_cc) return;
  const p = e.touches[0], dx = p.clientX - _cc.x0, dy = p.clientY - _cc.y0;
  if (!_cc.keo) {
    // Cuộn dọc thắng: nhấc tay khỏi cử chỉ ngay khi thấy ý định cuộn (dọc nhiều hơn ngang).
    if (Math.abs(dy) > _CU_CHI.LECH_HUY && Math.abs(dy) >= Math.abs(dx)) return _ccDon(true);
    if (Math.abs(dx) <= _CU_CHI.LECH_HUY) return;
    _cc.keo = true; clearTimeout(_cc.timer);
    _cc.tr.classList.remove('row-holding'); _cc.tr.classList.add('row-swiping');
  }
  // Hãm biên độ: .panel có overflow:hidden nên thẻ kéo quá xa sẽ bị CẮT (mất luôn nhãn "Xoá" và
  // nửa nội dung) — người dùng tưởng vỡ giao diện. Cho đi vừa quá ngưỡng là đủ để hiểu.
  const gh = _CU_CHI.KEO_NGUONG + 40;
  _cc.tr.style.transform = `translateX(${Math.max(-gh, Math.min(gh, dx))}px)`;
  _cc.tr.classList.toggle('row-armed', Math.abs(dx) >= _CU_CHI.KEO_NGUONG);
}, { passive: true });   // không preventDefault: CSS touch-action:pan-y đã nhường cuộn dọc cho trình duyệt
// KHÔNG passive: cần preventDefault() để CHẶN TẠI GỐC cú click mà trình duyệt bồi sau touchend.
// Đây mới là cách chắc chắn — so khớp "đúng phần tử hàng vừa ra cử chỉ" thì hỏng ngay ở đường thành
// công: xoá xong app vẽ lại bảng, hàng cũ không còn trong DOM nữa nên chẳng còn gì để so.
document.addEventListener('touchend', e => {
  if (_ccDaChay) { _ccDaChay = false; e.preventDefault(); }
  if (!_cc) return;
  const tr = _cc.tr, du = tr.classList.contains('row-armed');
  if (du && _cc.keo) { _ccChay(tr); _ccDaChay = false; e.preventDefault(); return; }
  _ccDon(true);
}, { passive: false });
document.addEventListener('touchcancel', () => { _ccDaChay = false; _ccDon(true); }, { passive: true });
// Sau khi cử chỉ phát hành động, trình duyệt vẫn bồi thêm một cú click -> nuốt ở pha capture,
// nếu không thì xoá xong lại mở luôn card chi tiết của phòng vừa xoá.
// Lưới thứ hai (preventDefault ở touchend là lưới chính): chỉ nuốt click rơi vào HÀNG BẢNG, trong
// 500ms. Hẹp cả về chỗ lẫn về thời gian, vì kéo ngang xa thì trình duyệt tự huỷ tap và KHÔNG bồi
// click nào — cửa sổ mở toang sẽ nuốt oan cú chạm thật kế tiếp của người dùng ở bất kỳ đâu.
document.addEventListener('click', e => {
  if (!_ccVuaChay) return;
  if (Date.now() - _ccVuaChay > 500) { _ccVuaChay = 0; return; }
  if (e.target.closest && e.target.closest('tr')) { e.stopPropagation(); e.preventDefault(); }
  _ccVuaChay = 0;                          // dù nuốt hay không, chỉ xét ĐÚNG một cú click kế tiếp
}, true);

document.addEventListener('change', e => {
  const t = e.target.closest && e.target.closest('[data-change]');
  if (t) _actRun(t.dataset.change, t, e, t.dataset.args);
});
document.addEventListener('input', e => {
  const t = e.target.closest && e.target.closest('[data-input]');
  if (t) _actRun(t.dataset.input, t, e, t.dataset.args);
}, true);                                                 // pha capture cho chac (input van noi bot, capture cho som)
document.addEventListener('error', e => {                 // loi tai anh: error KHONG noi bot -> pha capture
  const t = e.target;
  if (t && t.dataset && t.dataset.err) _actRun(t.dataset.err, t, e);
}, true);

// Bo thuoc tinh du lieu -> chuoi attribute cho template (dung cho action DONG: notif, KPI dashboard...).
// Vd actAttr('adminGo','rooms') => `data-act="adminGo" data-args='["rooms"]'`
function actAttr(fn, ...args) {
  return `data-act="${fn}"` + (args.length ? ` data-args='${JSON.stringify(args)}'` : '');
}

/* ---- Wrapper: gan bien LOC roi ve lai danh sach (thay cac onclick da-lenh) ---- */
function stuGo(f) { stuFilter = f; viewStudents(); }
function stuGoAdmin(f) { closeModal(); stuFilter = f; adminGo('students'); } // closeModal khi khong co modal = vo hai
function logGo(f) { logFilter = f; viewCheckin(); }
function roomDel(b) { roomShowDeleted = b; viewRooms(); }
function svcGo(t) { svcTab = t; viewServices(); }
function reloadView() { closeModal(); adminGo(ST.view); }

/* ---- Wrapper: ca doc DOM / dieu kien / method object ---- */
function quickPickGo(type) { const id = +el('q_stu').value; closeModal(); (type === 'in' ? checkInForm : checkOutForm)(id); }
function washAdd() { toggleWashing(+el('wash_stu').value, true); }
function delUserRow(id) { delUser(id, (this && this.dataset && this.dataset.uname) || ''); } // ten doc tu data-uname (delUser = KHOA tai khoan)
function unlockUserRow(id) { unlockUser(id, (this && this.dataset && this.dataset.uname) || ''); }
function logout() { Auth.logout(); }
function doPrint() { window.print(); }
function reloadPage() { location.reload(); } // BL-22: nút "Tải lại" trang công khai (CSP chặn inline onclick)
function handoverCheckinRow(id) { handoverCheckinForm(id, (this && this.dataset && this.dataset.hname) || ''); }     // ten doc tu data-hname (tranh nhet ten vao JSON)
function handoverCheckoutRow(id) { handoverCheckoutForm(id, (this && this.dataset && this.dataset.hname) || '', (this && this.dataset && this.dataset.plandate) || ''); }

/* ---- Wrapper cho change/input/error dung `this` (phan tu) ---- */
function onHandoverMonth() { loadHandovers(this.value); }
function onCccdFront() { previewCccd(this, 'front'); }
function onCccdBack() { previewCccd(this, 'back'); }
function onPubCccdFront() { pubCccd(this, 'front'); }
function onPubCccdBack() { pubCccd(this, 'back'); }
function onFacSel() { setFacilityFilter(this.value); }
function onElecMonth() { renderElectricForm(this.value); }
function onGenMonth() { renderGenerateForm(this.value); }
function onIntroMedia() { uploadIntroMedia(this.dataset.mkey, this); }
function onRulesDoc() { uploadRulesDoc(this); }
function onApLoginToggle() { el('apLogin').style.display = this.checked ? 'block' : 'none'; }
function onApDepToggle() { el('ap_depamt').disabled = !this.checked; }
function onFCapFromType() { el('f_cap').value = HANG_CAP[this.value] || el('f_cap').value; }
function onFRoomFromGender() { el('f_room').innerHTML = roomOptions('', this.value); }
function onLgHintGender() { el('lgHint').textContent = 'Pháp nhân: ' + (this.value === 'female' ? (ST.settings.legal_female || 'E2') : (ST.settings.legal_male || 'S2')); }
function onLoginBoxToggle() { el('loginBox').style.display = this.checked ? 'block' : 'none'; }
function onPlateBoxToggle() { el('plateBox').style.display = this.checked ? 'block' : 'none'; }
function onFloorDisp() { el('f_floor_disp').value = 'Tầng ' + roomFloorOf(this.value); }
function onImgRemove() { this.remove(); }
function onImgFallback() { this.style.display = 'none'; if (this.nextElementSibling) this.nextElementSibling.style.display = 'flex'; }
