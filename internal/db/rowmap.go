package db

import (
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RowsToMaps trả []map[string]any với tên cột snake_case + KIỂU JSON khớp bản Node
// (server/db.js:13-14 setTypeParser): DATE(1082)->'YYYY-MM-DD', NUMERIC(1700)->float64,
// TIMESTAMP(TZ)->ISO-UTC ms (như Date.toJSON của Node). Dùng cho các endpoint "dump nguyên hàng".
func RowsToMaps(rows pgx.Rows) ([]map[string]interface{}, error) {
	defer rows.Close()
	fds := rows.FieldDescriptions()
	out := []map[string]interface{}{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]interface{}, len(fds))
		for i, fd := range fds {
			m[fd.Name] = convertVal(fd.DataTypeOID, vals[i])
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// RowToMap: 1 hàng (dùng RETURNING *). Trả nil nếu không có hàng.
func RowToMap(rows pgx.Rows) (map[string]interface{}, error) {
	list, err := RowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

func convertVal(oid uint32, v interface{}) interface{} {
	if v == nil {
		return nil
	}
	switch oid {
	case pgtype.DateOID: // 1082 -> 'YYYY-MM-DD'
		if t, ok := v.(time.Time); ok {
			return t.Format("2006-01-02")
		}
	case pgtype.TimestamptzOID, pgtype.TimestampOID: // 1184/1114 -> ISO-UTC ms (Date.toJSON)
		if t, ok := v.(time.Time); ok {
			return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		}
	case pgtype.NumericOID: // 1700 -> float64 (parseFloat)
		switch n := v.(type) {
		case pgtype.Numeric:
			if f, err := n.Float64Value(); err == nil && f.Valid {
				return f.Float64
			}
			return nil
		case float64:
			return n
		}
	}
	return v
}
