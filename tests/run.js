#!/usr/bin/env node
// Chạy bộ test đối kháng.   npm test            — chạy hết
//                          npm test -- dien     — chỉ chạy bộ có tên/đường dẫn chứa "dien"
//                          npm run test:unit    — chỉ bộ không cần máy chủ (chạy nhanh, không đụng CSDL)
const fs = require('fs');
const path = require('path');
const { pool, serverUp, makeCtx, BASE } = require('./lib/harness');

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name)) : (e.name.endsWith('.test.js') ? [path.join(d, e.name)] : []));

(async () => {
  const filter = process.argv.slice(2).find(a => !a.startsWith('-'));
  const unitOnly = process.argv.includes('--unit');
  let files = walk(__dirname).sort();
  if (filter) files = files.filter(f => f.toLowerCase().includes(filter.toLowerCase()));

  let suites = files.map(f => ({ file: f, mod: require(f) }));
  if (unitOnly) suites = suites.filter(s => !s.mod.needsServer);
  if (!suites.length) { console.error('Không có bộ test nào khớp: ' + (filter || '')); process.exit(1); }

  const up = await serverUp();
  const needSrv = suites.some(s => s.mod.needsServer);
  if (needSrv && !up) {
    console.error(`\n  Máy chủ ${BASE} chưa chạy — các bộ test e2e cần nó.\n` +
      `     Mở CSDL:   npm run services\n     Chạy máy chủ: npm start\n` +
      `     Hoặc chỉ chạy phần không cần máy chủ: npm run test:unit\n`);
    process.exit(2);
  }

  let nPass = 0, nFail = 0;
  const failed = [];
  for (const { file, mod } of suites) {
    console.log(`\n\x1b[1m▸ ${mod.name}\x1b[0m  \x1b[2m(${path.relative(__dirname, file).replace(/\\/g, '/')})\x1b[0m`);
    const t = makeCtx();
    try {
      await mod.run(t);
    } catch (e) {
      t.cases.push({ name: 'BỘ TEST VỠ GIỮA CHỪNG — ' + e.message, pass: false, detail: (e.stack || '').split('\n')[1] || '' });
      if (mod.cleanup) { try { await mod.cleanup(t); } catch {} }
    }
    for (const c of t.cases) {
      if (c.pass) nPass++; else { nFail++; failed.push(`${mod.name} › ${c.name}`); }
      console.log(`  ${c.pass ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m'} ${c.name}`);
      if (c.detail) console.log(`     \x1b[2m${c.detail}\x1b[0m`);
    }
  }

  await pool.end().catch(() => {});
  console.log(`\n${'─'.repeat(62)}`);
  if (nFail) {
    console.log(`\x1b[31m✘ ${nFail} hỏng\x1b[0m · ${nPass} đúng\n`);
    failed.forEach(f => console.log('   • ' + f));
    console.log('');
    process.exit(1);
  }
  console.log(`\x1b[32m✔ ${nPass} case — tất cả đều đúng\x1b[0m\n`);
})().catch(e => { console.error(e); process.exit(1); });
