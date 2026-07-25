// === app-actions.js — EVENT DELEGATION (CHANG 5 refactor) ===
// Muc tieu: bo MOI inline on* handler (onclick/onchange/oninput/onerror) khoi HTML de CSP
// script-src KHONG con can 'unsafe-inline'. Thay bang MOT bo listener uy quyen tren `document`.
//
// Vi app ve lai innerHTML lien tuc nen KHONG addEventListener tung nut — chi gan 1 lan o day,
// bat su kien noi bot len document roi tra hanh dong qua thuoc tinh data-*.
//
// QUY UOC DOM (thay onclick/onchange/oninput/onerror):
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
function onCccdPreview() { previewCccd(this); }
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
