// ---- Tiện ích giao diện dùng chung ----
const $ = s => document.querySelector(s);
const el = id => document.getElementById(id);

const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (Number(n) || 0).toLocaleString('vi-VN');  // số tiền — KHÔNG kèm đơn vị "đ" (bỏ đơn vị toàn app theo yêu cầu)
const moneyN = money;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const curMonth = () => today().slice(0, 7);
const prevKy = m => { const d = new Date(m + '-15T00:00:00'); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function fmtDate(d) { if (!d) return '—'; const p = String(d).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }
// BL-95: gói phần chữ của mỗi .hint vào một lớp phủ, chỉ chừa icon. Làm ở đây thay vì sửa 63 chỗ
// dựng HTML, và note viết sau này cũng tự có hành vi đó.
function gonNote(goc) {
  (goc || document).querySelectorAll('.hint:not([data-gon])').forEach(h => {
    h.dataset.gon = '1';
    h.tabIndex = 0;                                  // chạm/tab được -> điện thoại và bàn phím vẫn mở được
    const boc = document.createElement('span');
    boc.className = 'hint-noi-dung';
    [...h.childNodes].forEach(n => {
      if (n.nodeType === 1 && n.classList.contains('ic-svg')) return;   // giữ icon ở ngoài làm nút bấm
      boc.appendChild(n);
    });
    h.appendChild(boc);
  });
}
let _henGonNote = 0;
new MutationObserver(() => {
  if (_henGonNote) return;
  _henGonNote = requestAnimationFrame(() => { _henGonNote = 0; gonNote(); });
}).observe(document.documentElement, { childList: true, subtree: true });
function monthLabel(m) { const [y, mm] = m.split('-'); return `Tháng ${mm}/${y}`; }
function initials(name) { const p = (name || '?').trim().split(/\s+/); return ((p[0] || '')[0] || '') + ((p[p.length - 1] || '')[0] || ''); }

// Tài khoản CHỈ đăng nhập bằng Microsoft (auth_provider='sso') KHÔNG có mật khẩu trong hệ thống này
// -> ẩn nút "Đổi mật khẩu" (mật khẩu do Microsoft quản). Học viên và quản trị khởi tạo (bootstrap)
// dùng mật khẩu nên vẫn thấy; tài khoản 'both' (có cả hai) cũng thấy vì mật khẩu vẫn còn hiệu lực.
const dungMatKhau = () => !!Auth.user && Auth.user.auth_provider !== 'sso';

function toast(msg, type = 'ok') {
  const t = el('toast');
  t.className = 'toast show ' + type;
  t.innerHTML = (type === 'err' ? IC.alert+' ' : IC.checkCircle+' ') + esc(msg);
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.className = 'toast'), 2800);
}
// BL-30: sao chép văn bản vào clipboard (credential HV, SĐT, số HĐ...). navigator.clipboard chạy ở HTTPS/localhost;
// execCommand là dự phòng cho ngữ cảnh không an toàn.
function copyToClipboard(text) {
  const ok = () => toast('Đã sao chép');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => _copyFallback(text, ok));
  else _copyFallback(text, ok);
}
function _copyFallback(text, ok) {
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); ok(); } catch { toast('Không sao chép được — chọn và Ctrl+C thủ công', 'err'); }
  document.body.removeChild(ta);
}

/* ---- Bảo vệ công sức nhập liệu ----
   Form học viên có ~20 ô. Điền dở rồi lỡ bấm X / Esc / bấm ra nền / đổi menu là MẤT SẠCH,
   phải gõ lại từ đầu — trên điện thoại thì bỏ cuộc luôn.
   Cách làm: chụp lại nội dung form lúc MỞ, so lúc ĐÓNG. Có khác thì mới hỏi.
   Cờ window._dangLuu do chongBam2Lan (app.js) bật trong lúc hàm lưu chạy — nhờ vậy 126 chỗ gọi
   closeModal() sau khi lưu xong KHÔNG bị hỏi nhầm, mà không phải sửa 126 chỗ đó. */
function _chupForm() {
  return [...el('modal').querySelectorAll('input,select,textarea')]
    .map(f => (f.type === 'checkbox' || f.type === 'radio') ? (f.checked ? '1' : '0') : f.value).join('');
}
let _formLucMo = null;
function formDangDo() { return _formLucMo !== null && el('overlay').classList.contains('show') && _chupForm() !== _formLucMo; }

/* ---- MODAL: trên điện thoại là MÀN HÌNH, không phải hộp nổi ----------------------------------
   CSS ≤620px kéo modal ra toàn màn. Kèm theo đó là 2 việc của phần JS:

   ① NGĂN XẾP. App chỉ có MỘT #modal, mở modal khác là ghi đè innerHTML — nên trước đây "quay lại"
      không có gì để quay về (bấm Hủy ở Sửa phòng là đóng sạch, không trở lại Chi tiết phòng).
      Nay giữ lại chuỗi HTML của từng lớp: lùi = vẽ lại lớp trước. Rẻ vì modal vốn là chuỗi HTML.
   ② LỊCH SỬ. Modal toàn màn hình mà bấm Back (nút cứng Android / vuốt mép iOS) lại đổi màn phía
      SAU trong khi modal vẫn nằm nguyên trên mặt — đó là lỗi có sẵn. Nay mở modal đẩy MỘT mục lịch
      sử cho cả phiên; Back = lùi một lớp modal, hết lớp thì đóng.
   KHÔNG đẩy mỗi lớp một mục: syncFilterUrl() (12 chỗ, có cả ô tìm kiếm) gọi replaceState và sẽ
   xoá dấu mục modal — càng nhiều mục càng dễ lệch. Một mục cho cả phiên thì lùi mấy lớp cũng an toàn. */
let _lopModal = [];          // ngăn xếp HTML từng lớp: [{html, wide}]
let _modalCoLichSu = false;  // phiên modal này đã đẩy mục lịch sử chưa
let _boQuaPopKe = false;     // cú popstate kế tiếp là do CHÍNH TA gọi history.back() -> đừng xử lý lại
let _henTraLichSu = null;    // hẹn trả mục lịch sử (hoãn 1 tick, xem closeModalNgay)

function _veModal(lop) {
  // wide: true -> 720px · 'x' -> 1000px (bảng nhiều cột như chỉ số điện) · bỏ trống -> 560px
  el('modal').className = 'modal' + (lop.wide === 'x' ? ' xwide' : lop.wide ? ' wide' : '');
  el('modal').removeAttribute('style');   // dọn transform còn sót của cử chỉ vuốt lần trước
  el('modal').innerHTML = lop.html;
  el('modal').scrollTop = 0;
  const mb = el('modal').querySelector('.mb'); if (mb) mb.scrollTop = 0;
}
// Chốt lớp đang hiện trước khi bị lớp con che: đồng bộ giá trị ô nhập từ property sang attribute
// rồi chụp lại HTML, để lùi lớp về còn nguyên những gì đang nhập dở.
function _chotLopHienTai() {
  if (!_lopModal.length) return;
  const m = el('modal');
  m.querySelectorAll('input,select,textarea').forEach(e => {
    if (e.type === 'checkbox' || e.type === 'radio') e.toggleAttribute('checked', e.checked);
    else if (e.tagName === 'TEXTAREA') e.textContent = e.value;
    else if (e.tagName === 'SELECT') [...e.options].forEach(o => o.toggleAttribute('selected', o.selected));
    else e.setAttribute('value', e.value);
  });
  _lopModal[_lopModal.length - 1].html = m.innerHTML;
}
function openModal(html, wide) {
  const dangMo = el('overlay').classList.contains('show');
  if (!dangMo) {
    _lopModal = [];
    document.body.classList.add('modal-open');   // khoá cuộn trang nền (toàn màn hình thì bắt buộc)
    if (_henTraLichSu) {
      // Vừa đóng modal xong lại mở modal khác NGAY trong cùng một tick — mẫu này có ở ~11 chỗ
      // ("đóng rồi mở phiếu báo", data-close rồi mở form...). Đừng trả rồi mượn lại: giữ nguyên mục
      // lịch sử đang có. Nếu trả, cú history.back() bất đồng bộ sẽ đua với pushState của modal mới.
      clearTimeout(_henTraLichSu); _henTraLichSu = null; _modalCoLichSu = true;
    } else {
      // Đẩy mục lịch sử để Back của HỆ ĐIỀU HÀNH đóng modal thay vì thoát app / đổi màn sau lưng.
      // Giữ nguyên URL: modal không phải một địa chỉ, chỉ là một lớp phủ lên màn đang đứng.
      try {
        const st = Object.assign({}, history.state || {}, { modal: true });
        history.pushState(st, '', location.href);
        _modalCoLichSu = true;
      } catch (e) { _modalCoLichSu = false; }
    }
  }
  else _chotLopHienTai();   // mở lớp CON -> chốt những gì đang gõ ở lớp dưới trước khi bị che
  _lopModal.push({ html, wide: wide === 'x' ? 'x' : !!wide });
  _veModal(_lopModal[_lopModal.length - 1]);
  el('overlay').classList.add('show');
  _formLucMo = _chupForm();
  // BL-23: nhiều form gọi attachDate(...) NGAY SAU openModal (điền ngày vào ô đang rỗng). Ảnh chụp ở
  // trên (lúc ô ngày còn rỗng) khác ảnh sau khi điền → formDangDo() báo NHẦM "chưa lưu" ở MỌI lần Sửa
  // học viên (ai cũng có ngày sinh). Chụp LẠI sau tick hiện tại, khi các lời gọi đồng bộ hậu-openModal
  // (attachDate…) đã chạy xong — vẫn bắt được thay đổi thật vì người dùng chưa kịp gõ trong ~0ms này.
  setTimeout(() => { if (el('overlay').classList.contains('show')) _formLucMo = _chupForm(); }, 0);
}
// THAY nội dung lớp đang đứng (không thêm lớp mới). Dùng cho màn tự vẽ lại chính mình nhiều lần —
// vd đổi kỳ ở form nhập chỉ số điện: nếu ghi thẳng el('modal').innerHTML thì ngăn xếp vẫn giữ HTML
// cũ, vuốt quay lại sẽ trả về đúng cái spinner của lần vẽ đầu.
function modalThay(html) {
  // Đóng mất rồi thì THÔI, tuyệt đối không mở lại: renderElectricForm/renderGenerateForm vẽ spinner
  // rồi `await` gọi API; người dùng bấm × trong lúc chờ mà ta lại mở modal khi API về thì nó tự hiện
  // lại sau 1-2 giây như ma, còn mất cả cờ `wide` lẫn đúng một mục lịch sử.
  if (!_lopModal.length || !el('overlay').classList.contains('show')) return;
  _lopModal[_lopModal.length - 1].html = html;
  el('modal').innerHTML = html;
  // Chụp LẠI mốc form: vẽ lại lớp = nội dung mới hoàn toàn (mọi thứ người dùng gõ đã bị chính lần vẽ
  // này xoá), mốc cũ vô nghĩa. Không chụp lại thì mốc kẹt ở ảnh của spinner (chuỗi rỗng) trong khi
  // form thật đã có sẵn giá trị (kỳ tháng, chỉ số điện) -> đóng ra là bị hỏi "có dữ liệu chưa lưu"
  // dù chưa ai gõ gì.
  _formLucMo = _chupForm();
}
// LÙI MỘT LỚP: còn lớp dưới thì vẽ lại lớp đó (vd Sửa phòng -> về Chi tiết phòng), hết thì đóng hẳn.
// Dùng cho: vuốt mép trái, nút ‹ trên đầu modal, Back của hệ điều hành.
function modalBack() {
  if (!el('overlay').classList.contains('show')) return false;
  if (_lopModal.length > 1) {
    if (!window._dangLuu && formDangDo()
        && !confirm('Bạn có dữ liệu chưa lưu.\n\nQuay lại và bỏ những gì vừa nhập?')) return true;
    _lopModal.pop();
    _veModal(_lopModal[_lopModal.length - 1]);
    _formLucMo = _chupForm();
    return true;
  }
  closeModal();
  return true;
}
function closeModal() {
  if (!window._dangLuu && formDangDo()
      && !confirm('Bạn có dữ liệu chưa lưu.\n\nĐóng lại và bỏ những gì vừa nhập?')) return;
  closeModalNgay();
}
// Đóng thẳng, không hỏi — dùng khi người dùng ĐÃ đồng ý bỏ (vd đã xác nhận ở adminGo)
function closeModalNgay() {
  const dangMo = el('overlay').classList.contains('show');
  _formLucMo = null; _lopModal = [];
  el('overlay').classList.remove('show');
  el('modal').removeAttribute('style');
  document.body.classList.remove('modal-open');
  // Trả lại mục lịch sử đã mượn, CHỈ khi modal đang thật sự mở (closeModal gọi ở ~139 chỗ, nhiều chỗ
  // gọi lúc không có modal — lùi lịch sử ở đó là văng khỏi màn). Hoãn một tick vì nhiều chỗ đóng modal
  // rồi mở modal khác trong cùng cú bấm: hoãn thì openModal kịp huỷ hẹn và dùng lại mục đang có.
  if (dangMo && _modalCoLichSu) {
    _modalCoLichSu = false;
    clearTimeout(_henTraLichSu);
    _henTraLichSu = setTimeout(() => {
      _henTraLichSu = null;
      if (el('overlay').classList.contains('show')) return;   // đã có modal khác mở lên -> giữ mục đó
      // CHỈ trả khi ta còn đang ĐỨNG trên đúng mục đã mượn. Rất nhiều chỗ làm "đóng modal rồi đi màn
      // khác" ngay trong một cú bấm (stuGoAdmin, reloadView, lưu hoá đơn xong nhảy màn...) — lúc đó
      // adminGo đã đẩy mục MỚI, mục mượn nằm phía sau; back() sẽ kéo URL ngược về màn cũ trong khi
      // màn hình đang hiện màn mới (F5 là văng, copy link là sai màn). Mục mượn để lại cũng vô hại:
      // nó thành "màn trước" hợp lệ, Back kế tiếp rơi vào popstate thường và router vẽ đúng.
      if (!(history.state && history.state.modal)) return;
      _boQuaPopKe = true;               // cú popstate sinh ra từ đây là của ta, đừng diễn giải lại
      try { history.back(); } catch (e) { _boQuaPopKe = false; }
    }, 0);
  }
}
// Router (app-admin-core.js) và các cổng gọi hàm này TRƯỚC khi xử lý popstate của mình.
// Trả true = sự kiện đã được modal tiêu thụ, đừng đổi màn.
function modalXuLyPop() {
  if (_boQuaPopKe) {
    _boQuaPopKe = false;
    // Cú lùi này ta đã tính trước: hoặc do chính closeModalNgay gọi, hoặc do TRÌNH DUYỆT tự lùi cho
    // cùng một cú vuốt mép mà ta vừa xử lý (Chrome Android bắt vuốt mép trái làm cử chỉ back của
    // nó, song song với cử chỉ của app). Đừng lùi thêm lớp nữa.
    if (_henTraLichSu) { clearTimeout(_henTraLichSu); _henTraLichSu = null; }  // trình duyệt lùi hộ rồi
    _modalCoLichSu = false;                                    // mục lịch sử đã bị lấy đi
    if (el('overlay').classList.contains('show')) _muonMucLichSu();   // còn modal -> mượn lại mục khác
    return true;
  }
  if (!el('overlay').classList.contains('show')) return false;
  _modalCoLichSu = false;              // mục vừa bị trình duyệt lấy đi rồi
  modalBack();
  // Còn lớp nữa (hoặc người dùng bấm Huỷ ở hộp "chưa lưu") -> mượn lại một mục để lần Back sau
  // vẫn rơi vào modal chứ không nhảy ra khỏi màn.
  if (el('overlay').classList.contains('show')) _muonMucLichSu();
  return true;
}
function _muonMucLichSu() {
  try {
    history.pushState(Object.assign({}, history.state || {}, { modal: true }), '', location.href);
    _modalCoLichSu = true;
  } catch (e) { _modalCoLichSu = false; }   // không đẩy được thì thôi, lần Back sau sẽ đổi màn
}
// Cử chỉ vuốt mép trái gọi hàm này thay cho modalBack(): trên trình duyệt (không phải PWA standalone),
// vuốt mép trái CŨNG là cử chỉ back của Chrome/Safari -> ngay sau đó sẽ có một popstate cho CÙNG một
// thao tác của người dùng. Không chặn thì nó lùi tiếp lớp thứ hai, tức vuốt một cái mất hai màn.
function modalCuChiLui() {
  if (!el('overlay').classList.contains('show')) return;
  _boQuaPopKe = true;
  setTimeout(() => { _boQuaPopKe = false; }, 700);   // trình duyệt không lùi thì cờ tự tan, không kẹt
  modalBack();
}

// F5 / đóng tab / bấm Back của trình duyệt khi form đang dở -> nhờ trình duyệt hỏi hộ.
// closeModal chỉ cứu được đường TRONG app; F5 là đường của trình duyệt, phải chặn ở đây.
window.addEventListener('beforeunload', e => {
  if (window._dangLuu || !formDangDo()) return;
  e.preventDefault(); e.returnValue = '';   // trình duyệt tự hiện hộp "Rời khỏi trang?"
});

el('overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Bọc lời gọi API trong try/catch + toast lỗi
async function guard(fn) {
  try { return await fn(); }
  catch (e) { toast(e.message || 'Có lỗi xảy ra', 'err'); throw e; }
}

// Trì hoãn gọi hàm cho tới khi ngừng gõ
function debounce(fn, ms = 180) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

// ===== TÌM KIẾM + LỌC CỘT (dùng CHUNG một bộ hiển thị) =====================================
// Ô tìm kiếm lọc theo data-s (mọi cột). Phễu ▾ trên tiêu đề lọc theo TỪNG cột: cột ít giá trị
// (trạng thái, hợp đồng…) -> danh sách tick kiểu Excel; cột nhiều giá trị (họ tên…) -> ô gõ chữ
// "chứa". Cả hai đi qua applyRowFilters() nên HỢP với nhau, chỉ ẩn/hiện <tr> (mượt, không dựng lại
// bảng). State gắn trên table._flt (mất khi bảng render lại — chấp nhận). CSP: chỉ addEventListener.
// <= số giá trị phân biệt này -> danh sách tick; nhiều hơn -> ô gõ chữ.
// Phải phủ được cột Phòng: 29 phòng vượt ngưỡng cũ (12) nên phễu rơi về ô gõ tay, người dùng phải
// tự nhớ tên phòng. Danh sách có max-height 236px + cuộn nên dài hơn vẫn dùng được.
const COLFILT_MAX = 60;
const _FUNNEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>';
const _stripSel = '.sub2,.sub,.rowbtns,button,.col-filt,.sort-ar,.rz-handle';
function _cellText(cell) {
  if (!cell) return '';
  const c = cell.cloneNode(true);
  c.querySelectorAll(_stripSel).forEach(n => n.remove());
  return (c.textContent || '').replace(/\s+/g, ' ').trim();
}
function _tableState(t) { return t._flt || (t._flt = { q: '', cols: new Map(), countId: null, page: 0, pageSize: 0, pagerId: null }); }

// Nguồn sự thật hiển thị hàng: qua ô tìm kiếm (data-s) VÀ mọi bộ lọc cột đang bật.
function applyRowFilters(table) {
  const st = table._flt; if (!st) return;
  const head = table.tHead && table.tHead.rows[0]; const nCol = head ? head.cells.length : 0;
  const body = table.tBodies && table.tBodies[0]; if (!body) return;
  // BL-56: bảng bật numWord + query SỐ thuần -> khớp nguyên token (gõ "301" ra đúng phòng 301, không lẫn
  // mã/SĐT chứa "301"). Query có chữ (tên/mã) -> vẫn khớp chứa-chuỗi như cũ.
  let qre = null; if (st.q && st.numWord && /^\d+$/.test(st.q)) qre = new RegExp('(?:^|\\D)' + st.q + '(?:\\D|$)');
  const passing = [];
  for (const tr of body.rows) {
    if (tr.classList.contains('no-result')) continue;
    if (nCol && tr.cells.length !== nCol) continue; // hàng tổng/đặc biệt (colspan) -> để yên
    let show = true;
    if (st.q) { const ds = tr.getAttribute('data-s'); if (ds != null && (qre ? !qre.test(ds) : ds.indexOf(st.q) === -1)) show = false; }
    if (show) for (const [idx, f] of st.cols) {
      const v = _cellText(tr.cells[idx]);
      if (f.type === 'set') { if (f.set.size && !f.set.has(v)) { show = false; break; } }
      else if (f.text && v.toLowerCase().indexOf(f.text) === -1) { show = false; break; }
    }
    if (show) passing.push(tr); else tr.style.display = 'none';
  }
  const n = passing.length, size = st.pageSize || 0;
  // BL-12: phân trang tại LỚP DOM — mọi hàng vẫn nằm trong DOM (phễu cột/tìm kiếm đọc được), chỉ ẩn hàng
  // ngoài trang hiện tại trong SỐ HÀNG ĐÃ QUA LỌC. Bảng không bật pageSize -> hiện hết như cũ.
  if (size > 0 && n > size) {
    const pages = Math.ceil(n / size);
    let page = st.page || 0; if (page >= pages) page = pages - 1; if (page < 0) page = 0; st.page = page;
    passing.forEach((tr, i) => { tr.style.display = (i >= page * size && i < (page + 1) * size) ? '' : 'none'; });
    _renderPager(table, st, n, page, pages);
  } else { passing.forEach(tr => { tr.style.display = ''; }); st.page = 0; _renderPager(table, st, n, 0, 1); }
  if (st.countId) { const c = el(st.countId); if (c) c.textContent = n; }
  const er = table.querySelector('.no-result'); if (er) er.style.display = n === 0 ? '' : 'none';
  if (head) for (const th of head.cells) {
    const fn = th.querySelector('.col-filt'); if (!fn) continue;
    const f = st.cols.get(th.cellIndex);
    fn.classList.toggle('on', !!(f && (f.type === 'set' ? f.set.size : f.text)));
  }
}
// BL-12: khung phân trang (chỉ hiện khi >1 trang). Nút ‹ › đổi trang rồi áp lại bộ lọc.
function _renderPager(table, st, total, page, pages) {
  if (!st.pagerId) return;
  const box = el(st.pagerId); if (!box) return;
  if (!st.pageSize || pages <= 1) { box.innerHTML = ''; return; }
  const from = page * st.pageSize + 1, to = Math.min(total, (page + 1) * st.pageSize);
  box.innerHTML = `<button class="btn sm" ${page <= 0 ? 'disabled' : ''} data-pg="prev">‹ Trước</button>
    <span class="muted" style="font-size:13px">${from}–${to} / ${total} · trang ${page + 1}/${pages}</span>
    <button class="btn sm" ${page >= pages - 1 ? 'disabled' : ''} data-pg="next">Sau ›</button>`;
  box.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => {
    st.page = (b.dataset.pg === 'next') ? page + 1 : page - 1;
    applyRowFilters(table);
    const p = table.closest('.panel'); if (p) window.scrollTo({ top: p.offsetTop - 60, behavior: 'smooth' });
  });
}
// Bật phân trang cho bảng trong cùng panel với `input` (thường là ô tìm kiếm). Gọi SAU attachRowSearch.
function enablePaging(input, pagerId, pageSize) {
  const panel = input && input.closest ? (input.closest('.panel') || document) : document;
  const table = panel.querySelector('table'); if (!table) return;
  const st = _tableState(table); st.pageSize = pageSize; st.pagerId = pagerId; st.page = 0;
  applyRowFilters(table);
}

// Tìm kiếm tức thì (ô search) — nay đi qua applyRowFilters để HỢP với lọc cột.
function attachRowSearch(input, countId, opts) {
  if (!input) return;
  const panel = input.closest('.panel') || document;
  const table = panel.querySelector('table'); if (!table) return;
  const st = _tableState(table); st.countId = countId;
  if (opts && opts.numWord) st.numWord = true; else delete st.numWord;   // BL-56: query thuần số -> khớp nguyên token
  const run = () => { st.q = input.value.trim().toLowerCase(); st.page = 0; applyRowFilters(table); }; // BL-12: đổi tìm kiếm -> về trang 1
  input.addEventListener('input', run);
  if (input.value) run(); else applyRowFilters(table);
}

function _distinctCol(table, idx) {
  const body = table.tBodies[0], nCol = table.tHead.rows[0].cells.length, m = new Map();
  for (const tr of body.rows) {
    if (tr.classList.contains('no-result') || tr.cells.length !== nCol) continue;
    const v = _cellText(tr.cells[idx]); m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}
function _closeColPop() { const p = el('colPop'); if (p) p.remove(); document.removeEventListener('mousedown', _colPopOutside, true); }
function _colPopOutside(e) { const p = el('colPop'); if (p && !p.contains(e.target) && !e.target.closest('.col-filt')) _closeColPop(); }

function openColFilter(table, idx, anchor) {
  const prev = el('colPop'); _closeColPop();
  if (prev && prev._ci === idx && prev._t === table) return; // bấm lại phễu đang mở = đóng
  const st = _tableState(table);
  const dist = _distinctCol(table, idx);
  const cur = st.cols.get(idx);
  const th = table.tHead.rows[0].cells[idx];
  const label = _cellText(th) || 'Cột';
  // th có data-filt="list" -> luôn danh sách tick, dù bao nhiêu giá trị phân biệt
  const useList = dist.size > 0 && (th.dataset.filt === 'list' || dist.size <= COLFILT_MAX);
  const pop = document.createElement('div'); pop.id = 'colPop'; pop.className = 'col-pop'; pop._ci = idx; pop._t = table;
  let html = `<div class="cp-hd">Lọc: ${esc(label)}</div>`;
  if (useList) {
    const vals = [...dist.keys()].sort((a, b) => a.localeCompare(b, 'vi'));
    const sel = cur && cur.type === 'set' ? cur.set : null;
    html += `<label class="cp-all"><input type="checkbox" id="cpAll"> <b>Chọn tất cả</b></label><div class="cp-list">` +
      vals.map(v => `<label><input type="checkbox" class="cpv" value="${esc(v)}" ${(!sel || sel.has(v)) ? 'checked' : ''}><span>${esc(v || '(trống)')}</span><span class="cp-n">${dist.get(v)}</span></label>`).join('') +
      `</div><div class="cp-ft"><button class="btn sm ghost" id="cpClear">Xoá lọc</button><button class="btn sm pri" id="cpApply">Áp dụng</button></div>`;
  } else {
    html += `<div class="cp-tx"><input id="cpText" placeholder="Chứa chữ..." value="${cur && cur.type === 'text' ? esc(cur.text) : ''}"></div>` +
      `<div class="cp-ft"><button class="btn sm ghost" id="cpClear">Xoá lọc</button><button class="btn sm pri" id="cpApply">Lọc</button></div>`;
  }
  pop.innerHTML = html; document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = (r.bottom + window.scrollY + 5) + 'px';
  let left = r.left + window.scrollX;
  if (left + pop.offsetWidth > window.scrollX + window.innerWidth - 8) left = window.scrollX + window.innerWidth - pop.offsetWidth - 8;
  pop.style.left = Math.max(window.scrollX + 8, left) + 'px';
  el('cpClear').addEventListener('click', () => { st.cols.delete(idx); applyRowFilters(table); _closeColPop(); });
  if (useList) {
    const all = el('cpAll'), boxes = [...pop.querySelectorAll('.cpv')];
    const sync = () => { all.checked = boxes.every(b => b.checked); all.indeterminate = !all.checked && boxes.some(b => b.checked); };
    sync();
    all.addEventListener('change', () => boxes.forEach(b => (b.checked = all.checked)));
    boxes.forEach(b => b.addEventListener('change', sync));
    el('cpApply').addEventListener('click', () => {
      const chosen = boxes.filter(b => b.checked).map(b => b.value);
      if (chosen.length === 0 || chosen.length === boxes.length) st.cols.delete(idx); // rỗng / tất cả = không lọc
      else st.cols.set(idx, { type: 'set', set: new Set(chosen) });
      applyRowFilters(table); _closeColPop();
    });
  } else {
    const inp = el('cpText'); setTimeout(() => inp.focus(), 0);
    const apply = () => { const t = inp.value.trim().toLowerCase(); if (t) st.cols.set(idx, { type: 'text', text: t }); else st.cols.delete(idx); applyRowFilters(table); };
    el('cpApply').addEventListener('click', () => { apply(); _closeColPop(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { apply(); _closeColPop(); } });
  }
  setTimeout(() => document.addEventListener('mousedown', _colPopOutside, true), 0);
}

// Gắn phễu ▾ vào tiêu đề mọi bảng danh sách (.table-wrap table). Cột trống (thao tác) -> bỏ qua.
function enhanceColFilters(root) {
  (root || document).querySelectorAll('.table-wrap table').forEach(table => {
    if (table._fltEnhanced) return;
    const head = table.tHead && table.tHead.rows[0], body = table.tBodies && table.tBodies[0];
    if (!head || !body || !body.querySelector('tr')) return;
    table._fltEnhanced = true; _tableState(table);
    for (const th of head.cells) {
      if (!_cellText(th) || th.querySelector('.col-filt')) continue;
      const f = document.createElement('span');
      f.className = 'col-filt'; f.title = 'Lọc cột'; f.innerHTML = _FUNNEL;
      f.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); openColFilter(table, th.cellIndex, f); });
      th.appendChild(f);
    }
  });
}
const _enhColScan = debounce(() => enhanceColFilters(document), 60);
if (typeof MutationObserver !== 'undefined') new MutationObserver(_enhColScan).observe(document.body, { childList: true, subtree: true });
