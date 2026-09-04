// Lịch trực nhật — xoay vòng theo TUẦN. Thuần, không cần máy chủ.
// Chỗ dễ sai âm thầm: lịch nhảy lung tung mỗi lần mở trang, hoặc tuần nào đó không ai trực.
const c = require('../../server/chores');

module.exports = {
  name: 'Lịch trực nhật — xoay vòng theo tuần',
  needsServer: false,

  async run(t) {
    const M = [
      { id: 3, name: 'C', check_in_date: '2026-03-01', check_out_date: null },
      { id: 1, name: 'A', check_in_date: '2026-01-01', check_out_date: null },
      { id: 2, name: 'B', check_in_date: '2026-02-01', check_out_date: null },
    ];
    const s = (opts = {}) => c.schedule({ members: M, today: '2026-07-15', weeks: 4, ...opts });

    // ===== Tuần bắt đầu THỨ HAI
    t.eq('Tuần chứa T4 15/07/2026 bắt đầu từ thứ Hai 13/07', c.mondayOf('2026-07-15'), '2026-07-13');
    t.eq('Chính ngày thứ Hai · vẫn là chính nó', c.mondayOf('2026-07-13'), '2026-07-13');
    t.eq('Chủ nhật 19/07 · vẫn thuộc tuần bắt đầu 13/07 (không nhảy sang tuần sau)', c.mondayOf('2026-07-19'), '2026-07-13');
    t.eq('Thứ Hai 20/07 · sang tuần mới', c.mondayOf('2026-07-20'), '2026-07-20');

    const r = s();
    t.eq('Xem trước đúng 4 tuần', r.length, 4);
    t.eq('Mỗi tuần đúng 7 ngày, T2 → CN', r.map(w => [w.from, w.to]),
      [['2026-07-13', '2026-07-19'], ['2026-07-20', '2026-07-26'], ['2026-07-27', '2026-08-02'], ['2026-08-03', '2026-08-09']]);

    // ===== Xoay vòng: 3 người -> 3 tuần khác nhau, tuần 4 quay lại người tuần 1
    t.eq('3 người · 3 tuần liên tiếp KHÔNG trùng ai', new Set(r.slice(0, 3).map(w => w.name)).size, 3,
      'thứ tự: ' + r.map(w => w.name).join(' → '));
    t.eq('Tuần thứ 4 · quay lại đúng người của tuần 1', r[3].name, r[0].name, r.map(w => w.name).join(' → '));

    // ===== Thứ tự theo NGÀY VÀO Ở, không phải thứ tự trong mảng
    t.eq('Xoay vòng theo thứ tự VÀO Ở (A vào 01/01 → B → C), dù mảng truyền vào là C,A,B',
      [...new Set(r.map(w => w.name))].sort().join(''), 'ABC', 'lịch: ' + r.map(w => w.name).join(' → '));

    // ===== KHÔNG ĐƯỢC nhảy lung tung: mở trang ngày khác trong CÙNG tuần phải ra CÙNG người
    for (const d of ['2026-07-13', '2026-07-15', '2026-07-19']) {
      t.eq(`Mở trang ngày ${d} · tuần này vẫn là cùng một người`, c.schedule({ members: M, today: d, weeks: 1 })[0].name, r[0].name);
    }
    // Tuần sau của hôm nay = tuần này của 7 ngày sau -> phải khớp
    t.eq('Tuần sau (xem trước) = tuần này khi tới đó — lịch không đổi ý',
      r[1].name, c.schedule({ members: M, today: '2026-07-20', weeks: 1 })[0].name);

    // ===== Người TRẢ PHÒNG không được xếp lịch (tới tuần đó phòng không ai trực)
    const leaving = c.schedule({
      members: [
        { id: 1, name: 'A', check_in_date: '2026-01-01', check_out_date: null },
        { id: 2, name: 'B', check_in_date: '2026-02-01', check_out_date: '2026-07-20' },
      ], today: '2026-07-15', weeks: 4,
    });
    t.ok('B trả phòng 20/07 · KHÔNG bị xếp trực các tuần sau đó',
      leaving.slice(2).every(w => w.name === 'A'), 'lịch: ' + leaving.map(w => `${w.from} ${w.name}`).join(' · '));
    t.ok('Tuần nào cũng có người trực, không tuần nào bỏ trống', leaving.length === 4 && leaving.every(w => w.name));

    // ===== Biên
    t.eq('Phòng không có ai · lịch rỗng, không văng lỗi', c.schedule({ members: [], today: '2026-07-15' }), []);
    const solo = c.schedule({ members: [{ id: 1, name: 'A', check_in_date: '2026-01-01', check_out_date: null }], today: '2026-07-15', weeks: 3 });
    t.ok('Ở một mình · tuần nào cũng là mình', solo.length === 3 && solo.every(w => w.name === 'A'));

    // ===== Mốc tính phải là thứ Hai, nếu không thì cả lịch lệch 1 ngày
    t.eq('Mốc tính (EPOCH) đúng là một thứ Hai', new Date(c.EPOCH_MONDAY).getUTCDay(), 1);
    t.eq('Số tuần từ mốc tới 13/07/2026 là số nguyên không âm',
      Number.isInteger(c.weeksSinceEpoch('2026-07-13')) && c.weeksSinceEpoch('2026-07-13') > 0, true,
      'tuần thứ ' + c.weeksSinceEpoch('2026-07-13'));

    // ===== Qua năm mới không được gãy
    const ny = c.schedule({ members: M, today: '2026-12-28', weeks: 3 });
    t.eq('Tuần vắt qua năm mới · vẫn đúng 7 ngày', ny.map(w => [w.from, w.to]),
      [['2026-12-28', '2027-01-03'], ['2027-01-04', '2027-01-10'], ['2027-01-11', '2027-01-17']]);
    t.eq('Vắt qua năm mới · vẫn xoay đủ 3 người không trùng', new Set(ny.map(w => w.name)).size, 3);
  },
};
