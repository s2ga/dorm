// QA-007: ô ảnh CCCD chỉ nhận ẢNH TẢI LÊN. Gửi khoá S3 của hồ sơ/đơn khác phải bị chặn TRƯỚC khi
// ghi, và xoá/thay ảnh không được xoá tệp không thuộc hồ sơ đang sửa.
const P = '__test_khoacheo';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,' +
  Buffer.concat([Buffer.from(PNG.split(',')[1], 'base64'), Buffer.from('anh-khac')]).toString('base64');

async function clean(db) {
  await db.query(`DELETE FROM applications WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
}

module.exports = {
  name: 'Ảnh CCCD: chặn gán khoá của hồ sơ khác',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    const T = await t.login('admin', process.env.ADMIN_P);
    await clean(t.db);
    const tao = async ten => (await t.db.query(
      `INSERT INTO students (name, code, gender) VALUES ($1,$2,'male') RETURNING id`, [P + ' ' + ten, P + '_' + ten])).rows[0].id;
    const X = await tao('X');
    const Y = await tao('Y');
    try {
      await kiem(t, T, X, Y);
    } finally {
      // Mỗi hồ sơ tự xoá ảnh (chỉ tệp của chính nó bị dọn), rồi mới xoá hồ sơ — không để lại hồ sơ
      // trỏ vào tệp đã mất (màn Hồ sơ lưu trữ sẽ hiện link hỏng).
      for (const id of [X, Y]) await t.api('PUT', `/api/students/${id}`, T, { cccd_front: '', cccd_back: '' });
      await clean(t.db);
    }
  },
};

async function kiem(t, T, X, Y) {
  const cot = async (id, f = 'cccd_front') => (await t.db.query(`SELECT ${f} FROM students WHERE id=$1`, [id])).rows[0][f];

  // Y có ảnh thật (nếu máy có S3); không có S3 thì dùng khoá giả đúng dạng để vẫn kiểm được phần chặn.
  const lenY = await t.api('PUT', `/api/students/${Y}`, T, { cccd_front: PNG });
  t.eq('Y tải ảnh CCCD → 200', lenY.status, 200, `HTTP ${lenY.status} ${lenY.json && lenY.json.error || ''}`);
  let khoaY = await cot(Y);
  const coS3 = !!khoaY;
  if (!coS3) {
    khoaY = `students/${Y}/cccd_front.png`;
    await t.db.query('UPDATE students SET cccd_front=$1 WHERE id=$2', [khoaY, Y]);
  }
  t.ok('Khoá của Y nằm trong thư mục của Y', String(khoaY).startsWith(`students/${Y}/`), String(khoaY));

  // ── Chặn gán khoá của người khác ───────────────────────────────────────────────────────
  const gan = await t.api('PUT', `/api/students/${X}`, T, { cccd_front: khoaY, name: P + ' X doi ten' });
  t.eq('PUT hồ sơ X với khoá ảnh của Y → 400', gan.status, 400, `HTTP ${gan.status} ${gan.json && gan.json.error || ''}`);
  t.eq('Bị chặn thì ảnh của X vẫn trống', await cot(X), null);
  const tenX = (await t.db.query('SELECT name FROM students WHERE id=$1', [X])).rows[0].name;
  t.eq('Bị chặn TRƯỚC khi ghi: các ô khác gửi kèm cũng không được lưu', tenX, P + ' X');
  const xemX = await t.api('GET', `/api/students/${X}/cccd/front`, T);
  t.eq('Không mở được ảnh của Y qua hồ sơ X', xemX.status, 404, `HTTP ${xemX.status}`);

  const ganSau = await t.api('PUT', `/api/students/${X}`, T, { cccd_back: khoaY });
  t.eq('Gán khoá của Y vào mặt sau của X → 400', ganSau.status, 400, `HTTP ${ganSau.status}`);

  const ganDon = await t.api('PUT', `/api/students/${X}`, T, { cccd_front: 'applications/999999/cccd_front.png' });
  t.eq('Gán khoá của một đơn đăng ký không phải của X → 400', ganDon.status, 400, `HTTP ${ganDon.status}`);

  const moi = { name: P + ' Moi', gender: 'female', check_in_date: '2026-07-01', rental_type: 'ghep' };
  const taoKhoa = await t.api('POST', '/api/students', T, { ...moi, cccd_front: khoaY });
  t.eq('Tạo hồ sơ mới kèm khoá ảnh của Y → 400', taoKhoa.status, 400, `HTTP ${taoKhoa.status} ${taoKhoa.json && taoKhoa.json.error || ''}`);
  t.ok('Lỗi nói đúng về ảnh CCCD', /CCCD/.test(taoKhoa.json && taoKhoa.json.error || ''), taoKhoa.json && taoKhoa.json.error);
  const conHoSo = (await t.db.query(`SELECT COUNT(*)::int AS n FROM students WHERE name=$1`, [moi.name])).rows[0].n;
  t.eq('Không có hồ sơ nào được tạo', conHoSo, 0);
  const taoDung = await t.api('POST', '/api/students', T, moi);
  t.eq('Cùng thân đó bỏ khoá ảnh thì tạo được (chặn đúng vì khoá, không vì thiếu trường)', taoDung.status, 201,
    `HTTP ${taoDung.status} ${taoDung.json && taoDung.json.error || ''}`);

  // ── Gửi lại đúng khoá hiện tại hoặc URL xem ảnh: không đổi gì ──────────────────────────
  const giu = await t.api('PUT', `/api/students/${Y}`, T, { cccd_front: khoaY });
  t.eq('Y gửi lại đúng khoá của chính mình → 200', giu.status, 200, `HTTP ${giu.status}`);
  t.eq('Khoá của Y giữ nguyên', await cot(Y), khoaY);
  const giuUrl = await t.api('PUT', `/api/students/${Y}`, T, { cccd_front: `/api/students/${Y}/cccd/front?v=1` });
  t.eq('Y gửi lại URL xem ảnh (lấy từ GET) → 200', giuUrl.status, 200, `HTTP ${giuUrl.status}`);
  t.eq('URL xem ảnh không ghi đè khoá', await cot(Y), khoaY);

  // ── Mục Kiểm dữ liệu bắt được hồ sơ đã lỡ mang khoá của người khác ──────────────────────
  await t.db.query('UPDATE students SET cccd_front=$1 WHERE id=$2', [khoaY, X]);
  const dh = await t.api('GET', '/api/admin/data-health', T);
  const muc = ((dh.json && dh.json.checks) || []).find(c => c.ma === 'cccd_cua_nguoi_khac') || {};
  const dong = JSON.stringify(muc.rows || []);
  t.ok('Kiểm dữ liệu có mục "Hồ sơ mang ảnh CCCD của người khác"', !!muc.ma, JSON.stringify(Object.keys(muc)));
  t.ok('Mục đó liệt kê hồ sơ X', dong.includes(`(#${X})`), dong.slice(0, 300));
  t.ok('Không liệt kê oan hồ sơ Y (khoá của chính mình)', !dong.includes(`(#${Y})`), dong.slice(0, 300));

  const don = (await t.db.query(
    `INSERT INTO applications (name, status, student_id) VALUES ($1,'approved',$2) RETURNING id`, [P + ' Don', Y])).rows[0].id;
  await t.db.query('UPDATE students SET cccd_back=$1 WHERE id=$2', [`applications/${don}/cccd_back.png`, Y]);
  const dh2 = await t.api('GET', '/api/admin/data-health', T);
  const dong2 = JSON.stringify((((dh2.json && dh2.json.checks) || []).find(c => c.ma === 'cccd_cua_nguoi_khac') || {}).rows || []);
  t.ok('Khoá của đơn đăng ký đã duyệt thành chính hồ sơ Y không bị liệt kê', !dong2.includes(`(#${Y})`), dong2.slice(0, 300));
  await t.db.query('UPDATE students SET cccd_back=NULL WHERE id=$1', [Y]);

  if (!coS3) { t.ok('S3 chưa cấu hình — bỏ qua phần xoá/thay tệp', true, 'không có kho ảnh'); return; }

  // ── Hồ sơ đã lỡ mang khoá của Y: xoá/thay ảnh của X không được làm mất tệp của Y ────────
  const xoa = await t.api('PUT', `/api/students/${X}`, T, { cccd_front: '' });
  t.eq('Xoá ảnh của X → 200', xoa.status, 200, `HTTP ${xoa.status}`);
  t.eq('Ô ảnh của X về trống', await cot(X), null);
  const conY = await t.api('GET', `/api/students/${Y}/cccd/front`, T);
  t.eq('Tệp ảnh của Y vẫn còn', conY.status, 200, `HTTP ${conY.status}`);

  await t.db.query('UPDATE students SET cccd_back=$1 WHERE id=$2', [khoaY, X]);
  const thay = await t.api('PUT', `/api/students/${X}`, T, { cccd_back: PNG2 });
  t.eq('Thay ảnh mặt sau của X → 200', thay.status, 200, `HTTP ${thay.status}`);
  t.ok('Ảnh mới của X nằm trong thư mục của X', String(await cot(X, 'cccd_back')).startsWith(`students/${X}/`), await cot(X, 'cccd_back'));
  const conY2 = await t.api('GET', `/api/students/${Y}/cccd/front`, T);
  t.eq('Thay ảnh của X xong, tệp ảnh của Y vẫn còn', conY2.status, 200, `HTTP ${conY2.status}`);

  // ── Đường thường của chính chủ vẫn dọn tệp cũ ───────────────────────────────────────────
  const xoaY = await t.api('PUT', `/api/students/${Y}`, T, { cccd_front: '' });
  t.eq('Y xoá ảnh của chính mình → 200', xoaY.status, 200, `HTTP ${xoaY.status}`);
  await t.db.query('UPDATE students SET cccd_front=$1 WHERE id=$2', [khoaY, Y]);
  const hetY = await t.api('GET', `/api/students/${Y}/cccd/front`, T);
  t.eq('Tệp của chính Y đã được dọn khỏi kho', hetY.status, 404, `HTTP ${hetY.status}`);
}
