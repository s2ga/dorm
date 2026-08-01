package checkout

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// Querier giả: chỉ cần trả về lượt ở đang mở, đủ để kiểm luật chặn ngày mà không cần Postgres.
type qGia struct{ tuNgay string } // "" = không có lượt nào đang mở

type rowGia struct{ tuNgay string }

func (r rowGia) Scan(dest ...any) error {
	if r.tuNgay == "" {
		return pgx.ErrNoRows
	}
	t, _ := time.Parse("2006-01-02", r.tuNgay)
	*(dest[0].(*int)) = 1
	*(dest[1].(**int)) = nil
	*(dest[2].(*pgtype.Date)) = pgtype.Date{Time: t, Valid: true}
	*(dest[3].(*pgtype.Date)) = pgtype.Date{}
	return nil
}

func (q qGia) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	return rowGia{tuNgay: q.tuNgay}
}
func (q qGia) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	return nil, nil
}
func (q qGia) Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

// BLK-3: trả phòng lùi ngày trước mốc bắt đầu lượt ở đang mở (học viên đã chuyển phòng hôm đó) là
// xoá dấu vết lượt ở — phải chặn, và câu báo phải chỉ ra mốc nào đang chặn.
func TestBadCheckoutDate(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		ten, ngay, nhanPhong, luotMo string
		chan_                        bool
		chua                         string
	}{
		{"ngày trả sau ngày nhận, không lượt mở", "2026-07-20", "2026-07-01", "", false, ""},
		{"ngày trả TRÙNG ngày nhận (ở một ngày rồi đi)", "2026-07-01", "2026-07-01", "", false, ""},
		{"ngày trả TRƯỚC ngày nhận phòng", "2026-06-30", "2026-07-01", "", true, "trước ngày nhận phòng"},
		{"đã chuyển phòng 15/7, trả lùi về 10/7", "2026-07-10", "2026-07-01", "2026-07-15", true, "lượt ở hiện tại"},
		{"đã chuyển phòng 15/7, trả đúng 15/7", "2026-07-15", "2026-07-01", "2026-07-15", false, ""},
		{"đã chuyển phòng 15/7, trả 20/7", "2026-07-20", "2026-07-01", "2026-07-15", false, ""},
		{"chưa có ngày nhận phòng thì không lấy gì mà chặn", "2026-07-20", "", "", false, ""},
		// check_in_date kèm giờ (một số nơi trả timestamp): phải cắt còn 10 ký tự rồi mới so.
		{"ngày nhận phòng kèm giờ", "2026-07-01", "2026-07-01T00:00:00Z", "", false, ""},
	}
	for _, c := range cases {
		msg, err := BadCheckoutDate(ctx, qGia{tuNgay: c.luotMo}, 1, c.ngay, c.nhanPhong)
		if err != nil {
			t.Fatalf("%s: lỗi bất ngờ %v", c.ten, err)
		}
		if c.chan_ && msg == "" {
			t.Errorf("%s: phải BỊ CHẶN nhưng lọt", c.ten)
		}
		if !c.chan_ && msg != "" {
			t.Errorf("%s: phải cho qua, bị chặn với %q", c.ten, msg)
		}
		if c.chua != "" && !strings.Contains(msg, c.chua) {
			t.Errorf("%s: câu báo phải nêu %q, được %q", c.ten, c.chua, msg)
		}
	}
}

func TestSlice10(t *testing.T) {
	cases := map[string]string{
		"2026-07-20T00:00:00Z": "2026-07-20",
		"2026-07-20":           "2026-07-20",
		"2026-07":              "2026-07", // ngắn hơn 10 thì giữ nguyên, không được cắt hụt
		"":                     "",
	}
	for vao, ra := range cases {
		if got := slice10(vao); got != ra {
			t.Errorf("slice10(%q) = %q, phải %q", vao, got, ra)
		}
	}
}
