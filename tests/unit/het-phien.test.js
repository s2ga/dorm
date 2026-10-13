// Hết phiên (401) thì tab đang mở app phải tải lại về màn đăng nhập, kể cả khi dấu đăng nhập trong localStorage
// đã bị tab khác xoá; còn ở màn đăng nhập (chưa mở cổng nào) thì 401 là sai mật khẩu, không được tải lại trang.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'api.js'), 'utf8');
const doan = (tu, den) => { const a = src.indexOf(tu), b = src.indexOf(den, a); return a >= 0 && b > a ? src.slice(a, b) : ''; };

module.exports = {
  name: 'Hết phiên đăng nhập — tab đang mở app về màn đăng nhập',

  async run(t) {
    const khoi = doan('async function api(', 'async function withDuplicateGuide');
    t.ok('Rút được hàm api() trong api.js', !!khoi);
    if (!khoi) return;

    const thu = async ({ hint, cong, status = 401 }) => {
      let taiLai = 0, xoaHint = 0;
      const Auth = { get user() { return hint; }, set user(v) { hint = v; xoaHint++; } };
      const location = { reload: () => { taiLai++; } };
      const localStorage = { removeItem: () => {} };
      const fetch = async () => ({ status, ok: status < 400, json: async () => ({ error: 'Chưa đăng nhập' }) });
      const api = new Function('fetch', 'Auth', 'localStorage', 'location', '_congDangMo', `${khoi}\nreturn api;`)(
        fetch, Auth, localStorage, location, cong);
      let loi = null;
      try { await api('/applications'); } catch (e) { loi = e; }
      return { taiLai, xoaHint, status: loi && loi.status };
    };

    const haiTab = await thu({ hint: null, cong: 'admin' });
    t.eq('Tab khác đã xoá dấu đăng nhập, tab này đang mở cổng quản trị → tải lại về đăng nhập', haiTab.taiLai, 1);
    const motTab = await thu({ hint: { id: 1, role: 'admin' }, cong: 'admin' });
    t.eq('Một tab, dấu đăng nhập còn → tải lại về đăng nhập (như cũ)', motTab.taiLai, 1);
    const hocVien = await thu({ hint: null, cong: 'student' });
    t.eq('Cổng học viên cũng về đăng nhập', hocVien.taiLai, 1);
    const manDangNhap = await thu({ hint: null, cong: null });
    t.eq('Màn đăng nhập (chưa mở cổng nào): sai mật khẩu không tải lại trang', manDangNhap.taiLai, 0);
    t.eq('… và trả lỗi kèm mã 401 để form tự báo', manDangNhap.status, 401);
    const chuaKhai = await thu({ hint: null, cong: undefined });
    t.eq('Chưa nạp tệp khai báo cổng (biến chưa có) vẫn chạy, không tải lại', chuaKhai.taiLai, 0);
    const khongPhai401 = await thu({ hint: null, cong: 'admin', status: 403 });
    t.eq('Lỗi khác 401 (vd 403) không tải lại trang', khongPhai401.taiLai, 0);
  },
};
