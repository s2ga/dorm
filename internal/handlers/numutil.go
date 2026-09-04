package handlers

import (
	"encoding/json"
	"strconv"
	"strings"
)

// jsNum: mô phỏng Number(v) của JS cho json.RawMessage.
// Trả (số, hợp lệ). null/absent -> (0,false); "" -> (0,true) (Number('')=0); chuỗi phi số -> (0,false) (NaN).
func jsNum(raw json.RawMessage) (float64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		return f, true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		s = strings.TrimSpace(s)
		if s == "" {
			return 0, true
		}
		if v, err := strconv.ParseFloat(s, 64); err == nil {
			return v, true
		}
	}
	return 0, false
}

// numDisp: định dạng số như Number toString của JS (5 -> "5", 5.5 -> "5.5", -5 -> "-5").
func numDisp(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// toFloat: ép giá trị (int/float do pgx) về float64.
func toFloat(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}

// intFromDB: ép giá trị id (int4/int8/float do pgx trả) về int.
func intFromDB(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}
