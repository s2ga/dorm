// Giấy tạm trú đính kèm hồ sơ: nhận ẢNH hoặc PDF, lưu KHOÁ S3 thư mục tamtru/, xem qua proxy có kiểm quyền.
// Chỉ admin/nhân viên cùng cơ sở được nộp/gỡ; thư ký xem được; học viên chỉ xem giấy của chính mình.
const bcrypt = require('../../node_modules/bcryptjs');
const { reqRaw } = require('../lib/harness');
const P = '__test_tamtru';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n').toString('base64');
const GIA_MAO = 'data:application/pdf;base64,' + Buffer.from('day khong phai PDF').toString('base64');
const CHU_KY_PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47]);

const clean = async db => {
  await db.query(`DELETE FROM users WHERE username LIKE '${P}%'`);
  await db.query(`DELETE FROM students WHERE name LIKE '${P}%'`);
  await db.query(`DELETE FROM facilities WHERE name LIKE '${P}%'`);
};

module.exports = {
  name: 'Giấy tạm trú đính kèm hồ sơ',
  needsServer: true,
  cleanup: t => clean(t.db),

  async run(t) {
    await clean(t.db);
    const pw = 'test1234';
    const hash = bcrypt.hashSync(pw, 10);
    const q = (sql, p) => t.db.query(sql, p);
    const fA = (await q(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_A'])).rows[0].id;
    const fB = (await q(`INSERT INTO facilities (name) VALUES ($1) RETURNING id`, [P + '_B'])).rows[0].id;
    const sA = (await q(`INSERT INTO students (name, gender, facility_id, residency_status) VALUES ($1,'male',$2,'processing') RETURNING id`, [P + '_hvA', fA])).rows[0].id;
    const sB = (await q(`INSERT INTO students (name, gender, facility_id) VALUES ($1,'male',$2) RETURNING id`, [P + '_hvB', fB])).rows[0].id;
    const user = (u, role, fac, sid) => q(
      `INSERT INTO users (username, password_hash, role, full_name, facility_id, student_id) VALUES ($1,$2,$3,$1,$4,$5)`,
      [P + u, hash, role, fac, sid]);
    await user('_nvA', 'staff', fA, null);
    await user('_tkA', 'secretary', fA, null);
    await user('_btA', 'maintenance', fA, null);
    await user('_hvA', 'student', null, sA);
    const cot = async (id, c = 'residency_doc') => (await q(`SELECT ${c} FROM students WHERE id=$1`, [id])).rows[0][c];
    const tai = async (d, tok) => {
      const r = await reqRaw(d, tok);
      return { status: r.status, cd: r.headers.get('content-disposition') || '', than: r.body };
    };

    const admin = await t.login('admin', process.env.ADMIN_P);
    try {
      // ── Chặn tệp không đúng chữ ký ──────────────────────────────────────────────────
      const gia = await t.api('POST', `/api/students/${sA}/residency-doc`, admin, { data: GIA_MAO });
      t.ok('Tệp khai là PDF nhưng không đúng chữ ký → chặn', gia.status === 400 || gia.status === 501,
        `HTTP ${gia.status} ${gia.json && gia.json.error || ''}`);
      if (gia.status === 501) { t.ok('S3 chưa cấu hình — bỏ qua phần còn lại', true, '501'); return; }
      t.eq('Chặn rồi thì cột vẫn trống', await cot(sA), null);

      // ── Ảnh ──────────────────────────────────────────────────────────────────────────
      const anh = await t.api('POST', `/api/students/${sA}/residency-doc`, admin, { data: PNG });
      t.eq('Đính kèm ảnh → 200', anh.status, 200, `HTTP ${anh.status} ${anh.json && anh.json.error || ''}`);
      const k1 = await cot(sA);
      t.ok('CSDL lưu KHOÁ S3 trong thư mục tamtru/, không phải data URL', String(k1).startsWith('tamtru/'), String(k1));
      const hs = await t.api('GET', `/api/students/${sA}`, admin);
      t.ok('Hồ sơ trả đường proxy (kèm ?v= phiên bản hồ sơ)',
        String(hs.json.residency_doc).split('?')[0] === `/api/students/${sA}/residency-doc`, hs.json.residency_doc);
      t.eq('Kèm đuôi tệp', hs.json.residency_doc_ext, 'png');
      t.eq('Không tự đổi tình trạng tạm trú', await cot(sA, 'residency_status'), 'processing');
      t.eq('Không đụng bản scan HĐ', await cot(sA, 'contract_scan'), null);

      // ── Đổi sang PDF ─────────────────────────────────────────────────────────────────
      const pdf = await t.api('POST', `/api/students/${sA}/residency-doc`, admin, { data: PDF });
      t.eq('Đính kèm PDF → 200', pdf.status, 200, `HTTP ${pdf.status} ${pdf.json && pdf.json.error || ''}`);
      t.ok('Khoá đổi sang .pdf', String(await cot(sA)).endsWith('.pdf'), String(await cot(sA)));
      t.eq('Đuôi tệp cập nhật theo', (await t.api('GET', `/api/students/${sA}`, admin)).json.residency_doc_ext, 'pdf');
      const xem = await tai(`/api/students/${sA}/residency-doc`, admin);
      t.eq('Admin xem được giấy tạm trú', xem.status, 200, `HTTP ${xem.status}`);
      t.ok('Nội dung đúng tệp PDF vừa nộp', xem.than.slice(0, 5).toString() === '%PDF-', xem.than.slice(0, 8).toString());
      t.ok('Mở thẳng trong trình duyệt (inline), không ép tải về', xem.cd.startsWith('inline'), xem.cd);

      // ── Sửa hồ sơ không ghi được cột này: chặn trỏ sang tệp của người khác ─────────────
      const kTruoc = await cot(sA);
      const sua = await t.api('PUT', `/api/students/${sA}`, admin, { residency_doc: `tamtru/${sB}.png` });
      t.eq('PUT hồ sơ kèm residency_doc vẫn lưu được phần khác', sua.status, 200, `HTTP ${sua.status}`);
      t.eq('… nhưng cột residency_doc không đổi', await cot(sA), kTruoc);

      // ── Theo vai, cùng cơ sở ─────────────────────────────────────────────────────────
      const nvA = await t.login(P + '_nvA', pw);
      const tkA = await t.login(P + '_tkA', pw);
      const btA = await t.login(P + '_btA', pw);
      const hvA = await t.login(P + '_hvA', pw);
      t.eq('Nhân viên cùng cơ sở xem → 200', (await tai(`/api/students/${sA}/residency-doc`, nvA)).status, 200);
      const nvNop = await t.api('POST', `/api/students/${sA}/residency-doc`, nvA, { data: PDF });
      t.eq('Nhân viên cùng cơ sở nộp → 200', nvNop.status, 200, `HTTP ${nvNop.status}`);
      t.eq('Thư ký cùng cơ sở xem → 200', (await tai(`/api/students/${sA}/residency-doc`, tkA)).status, 200);
      t.eq('Thư ký nộp → 403', (await t.api('POST', `/api/students/${sA}/residency-doc`, tkA, { data: PNG })).status, 403);
      t.eq('Thư ký gỡ → 403', (await t.api('DELETE', `/api/students/${sA}/residency-doc`, tkA)).status, 403);
      t.eq('Vai bảo trì xem → 403', (await tai(`/api/students/${sA}/residency-doc`, btA)).status, 403);
      t.eq('Vai bảo trì nộp → 403', (await t.api('POST', `/api/students/${sA}/residency-doc`, btA, { data: PNG })).status, 403);
      t.eq('Học viên xem giấy của chính mình → 200', (await tai(`/api/students/${sA}/residency-doc`, hvA)).status, 200);
      t.eq('Học viên tự nộp → 403', (await t.api('POST', `/api/students/${sA}/residency-doc`, hvA, { data: PNG })).status, 403);
      t.eq('Học viên tự gỡ → 403', (await t.api('DELETE', `/api/students/${sA}/residency-doc`, hvA)).status, 403);
      t.ok('Sau các lần bị chặn, tệp vẫn là PDF', String(await cot(sA)).endsWith('.pdf'), String(await cot(sA)));

      // ── Khác cơ sở ───────────────────────────────────────────────────────────────────
      const nopB = await t.api('POST', `/api/students/${sB}/residency-doc`, admin, { data: PNG });
      t.eq('Admin nộp giấy cho HV cơ sở B → 200', nopB.status, 200, `HTTP ${nopB.status}`);
      const kB = await cot(sB);
      for (const [ten, tok] of [['Nhân viên', nvA], ['Thư ký', tkA], ['Học viên khác', hvA]]) {
        const r = await tai(`/api/students/${sB}/residency-doc`, tok);
        t.eq(`${ten} cơ sở A xem giấy HV cơ sở B → 403`, r.status, 403, `HTTP ${r.status}`);
        t.ok(`${ten} cơ sở A xem giấy HV cơ sở B → không lọt byte nào của tệp`, !r.than.includes(CHU_KY_PNG), `${r.than.length} byte`);
      }
      for (const bien of [`${sB}`, `%2B${sB}`, `+${sB}`, `%20${sB}`]) {
        const nop = await t.api('POST', `/api/students/${bien}/residency-doc`, nvA, { data: PDF });
        t.ok(`Nhân viên cơ sở A nộp giấy cho HV cơ sở B qua id "${bien}" → 403/404`, nop.status === 403 || nop.status === 404, `HTTP ${nop.status}`);
        const go = await t.api('DELETE', `/api/students/${bien}/residency-doc`, nvA);
        t.ok(`Nhân viên cơ sở A gỡ giấy HV cơ sở B qua id "${bien}" → 403/404`, go.status === 403 || go.status === 404, `HTTP ${go.status}`);
        const r = await tai(`/api/students/${bien}/residency-doc`, nvA);
        t.ok(`Nhân viên cơ sở A xem giấy HV cơ sở B qua id "${bien}" → không lọt byte nào`, r.status !== 200 && !r.than.includes(CHU_KY_PNG), `HTTP ${r.status}`);
      }
      t.eq('Giấy của HV cơ sở B còn nguyên', await cot(sB), kB);

      // ── Hồ sơ đã khoá ────────────────────────────────────────────────────────────────
      await q('UPDATE students SET deleted_at = now() WHERE id=$1', [sA]);
      const khoa = await t.api('POST', `/api/students/${sA}/residency-doc`, admin, { data: PNG });
      t.ok('Hồ sơ đã khoá → không nộp được', khoa.status !== 200, `HTTP ${khoa.status}`);
      t.ok('… tệp vẫn là PDF cũ', String(await cot(sA)).endsWith('.pdf'), String(await cot(sA)));
      await q('UPDATE students SET deleted_at = NULL WHERE id=$1', [sA]);

      // ── Gỡ: chỉ gỡ giấy tạm trú, bản scan HĐ còn nguyên ──────────────────────────────
      const scan = await t.api('POST', `/api/students/${sA}/contract-scan`, admin, { data: PNG });
      t.eq('Nộp kèm bản scan HĐ → 200', scan.status, 200, `HTTP ${scan.status}`);
      const go = await t.api('DELETE', `/api/students/${sA}/residency-doc`, admin);
      t.eq('Gỡ giấy tạm trú → 200', go.status, 200, `HTTP ${go.status}`);
      t.eq('Cột về trống', await cot(sA), null);
      t.ok('Bản scan HĐ vẫn còn', !!(await cot(sA, 'contract_scan')), String(await cot(sA, 'contract_scan')));
      t.eq('Gỡ rồi thì xem ra 404', (await tai(`/api/students/${sA}/residency-doc`, admin)).status, 404);
      t.eq('Hồ sơ trả residency_doc = null', (await t.api('GET', `/api/students/${sA}`, admin)).json.residency_doc, null);
    } finally {
      for (const id of [sA, sB]) {
        await q('UPDATE students SET deleted_at = NULL WHERE id=$1', [id]);
        await t.api('DELETE', `/api/students/${id}/residency-doc`, admin);
        await t.api('DELETE', `/api/students/${id}/contract-scan`, admin);
      }
      await clean(t.db);
    }
  },
};
