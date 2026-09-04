// Nội quy ký túc xá (PDF) — tải lên / xem / xoá.
// Đây là đường NHẬN FILE từ người dùng: chỗ dễ bị lợi dụng nhất trong app.
module.exports = {
  name: 'Nội quy ký túc xá (PDF)',
  needsServer: true,
  cleanup: t => t.db.query(`DELETE FROM media WHERE key='noi-quy'`),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    const had = (await t.db.query(`SELECT path FROM media WHERE key='noi-quy'`)).rows[0];
    await t.api('DELETE', '/api/media/noi-quy', T);

    const b64 = s => Buffer.from(s, 'latin1').toString('base64');
    const pdf = 'data:application/pdf;base64,' + b64('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

    try {
      // ===== Chưa tải gì -> 404, KHÔNG được 500
      const none = await fetch(require('../lib/harness').BASE + '/api/public/doc/noi-quy');
      t.eq('Chưa tải nội quy · trả 404 (không phải lỗi máy chủ)', none.status, 404, `HTTP ${none.status}`);

      // ===== Chặn file rác
      for (const [nhan, data, vi] of [
        ['ảnh JPG đổi tên', 'data:application/pdf;base64,' + b64('\xFF\xD8\xFF\xE0JFIF rác'), 'sai chữ ký file'],
        ['file .exe', 'data:application/pdf;base64,' + b64('MZ\x90\x00 chương trình chạy được'), 'MZ = file thực thi Windows'],
        ['HTML kèm script', 'data:application/pdf;base64,' + b64('<html><script>alert(1)</script>'), 'nguy cơ XSS khi proxy'],
        ['ảnh PNG (nhãn image)', 'data:image/png;base64,' + b64('\x89PNG rác'), 'không phải PDF'],
        ['chuỗi rỗng', '', 'không có gì'],
        ['chữ thường', 'xin chào', 'không phải data URL'],
      ]) {
        const r = await t.api('POST', '/api/media/doc/noi-quy', T, { data });
        t.ok(`Tải lên ${nhan} → phải CHẶN (${vi})`, r.status === 400, `HTTP ${r.status} — ${r.json && r.json.error}`);
      }

      const bad = await t.api('POST', '/api/media/doc/lung-tung', T, { data: pdf });
      t.ok('Khoá tài liệu lạ → phải CHẶN (không cho ghi file tuỳ ý lên kho)', bad.status === 400, `HTTP ${bad.status} — ${bad.json && bad.json.error}`);

      const still404 = await fetch(require('../lib/harness').BASE + '/api/public/doc/noi-quy');
      t.eq('Sau khi chặn hết file rác · vẫn KHÔNG có nội quy nào lọt vào', still404.status, 404, `HTTP ${still404.status}`);

      // ===== PDF thật -> OK
      const ok = await t.api('POST', '/api/media/doc/noi-quy', T, { data: pdf });
      t.eq('Tải PDF thật → OK', ok.status, 200, `HTTP ${ok.status} — ${ok.json && ok.json.error || ''}`);

      const get = await fetch(require('../lib/harness').BASE + '/api/public/doc/noi-quy');
      t.eq('Xem nội quy · trả 200', get.status, 200, `HTTP ${get.status}`);
      t.eq('Đúng kiểu file PDF', (get.headers.get('content-type') || '').split(';')[0], 'application/pdf');
      t.ok('Mở thẳng trong trình duyệt, không bắt tải về (inline)',
        /^inline/.test(get.headers.get('content-disposition') || ''), get.headers.get('content-disposition'));
      t.eq('Chặn trình duyệt tự đoán kiểu file (nosniff)', get.headers.get('x-content-type-options'), 'nosniff');
      const body = Buffer.from(await get.arrayBuffer());
      t.eq('Nội dung tải về đúng là file đã tải lên', body.slice(0, 5).toString(), '%PDF-');

      // ===== Học viên KHÔNG được tải nội quy lên
      const stu = (await t.db.query(`SELECT username FROM users WHERE role='student' LIMIT 1`)).rows[0];
      if (stu) {
        const r = await t.api('POST', '/api/media/doc/noi-quy', null, { data: pdf });
        t.ok('Không đăng nhập mà tải nội quy lên → phải CHẶN', r.status === 401, `HTTP ${r.status}`);
      }

      // ===== Xoá
      const del = await t.api('DELETE', '/api/media/noi-quy', T);
      t.eq('Xoá nội quy → OK', del.status, 200, `HTTP ${del.status}`);
      const gone = await fetch(require('../lib/harness').BASE + '/api/public/doc/noi-quy');
      t.eq('Xoá rồi · trả về 404, không còn xem được', gone.status, 404, `HTTP ${gone.status}`);
    } finally {
      await t.api('DELETE', '/api/media/noi-quy', T).catch(() => {});
      if (had) await t.db.query(`INSERT INTO media (key, path, updated_at) VALUES ('noi-quy',$1,now()) ON CONFLICT (key) DO UPDATE SET path=EXCLUDED.path`, [had.path]);
    }
  },
};
