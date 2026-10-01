// Lỗi đăng nhập Microsoft về tới màn đăng nhập là tiếng Anh kèm mã AADSTS… — phải đổi sang câu tiếng Việt có
// cách xử lý, vẫn giữ mã gốc để Ban Quản lý tra cứu; mã lạ không được rơi ra nguyên văn tiếng Anh.
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'Lỗi đăng nhập Microsoft — hiện tiếng Việt, giữ mã gốc',

  run(t) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'app-public-auth.js'), 'utf8');
    const bang = (src.match(/^const LOI_MS = \{[\s\S]*?^\};/m) || [])[0];
    const ham = (src.match(/^function loiMicrosoft\([\s\S]*?^\}/m) || [])[0];
    t.ok('Tìm thấy bảng LOI_MS và hàm loiMicrosoft', !!bang && !!ham);
    if (!bang || !ham) return;
    const loiMicrosoft = new Function(`${bang}\n${ham}\nreturn loiMicrosoft;`)();

    const ngoai = loiMicrosoft('invalid_request', 'AADSTS50020: User account from identity provider does not exist in tenant.');
    t.ok('AADSTS50020 → câu tiếng Việt chỉ cách xử lý', /không thuộc tổ chức/.test(ngoai), ngoai);
    t.ok('… giữ mã gốc trong ngoặc', ngoai.includes('(mã lỗi: AADSTS50020)'), ngoai);
    t.ok('… không còn câu tiếng Anh của Microsoft', !/User account|tenant/.test(ngoai), ngoai);
    t.eq('Người dùng bấm Huỷ (access_denied)', loiMicrosoft('access_denied', 'The user has denied access'), 'Bạn đã huỷ đăng nhập Microsoft.');
    const la = loiMicrosoft('server_error', 'AADSTS999999: Something unexpected happened.');
    t.ok('Mã lạ → câu chung tiếng Việt + mã gốc', /Microsoft từ chối đăng nhập/.test(la) && la.includes('AADSTS999999') && !/unexpected/.test(la), la);
    const rong = loiMicrosoft(undefined, undefined);
    t.ok('Không có mã nào → câu chung, không "(mã lỗi: undefined)"', /Microsoft từ chối/.test(rong) && !/undefined/.test(rong), rong);
  },
};
