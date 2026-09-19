package auth

import (
	"crypto/rand"
	"math/big"
)

// Bảng chữ cho mật khẩu khởi tạo: bỏ các ký tự dễ đọc nhầm khi nhân viên chép tay hoặc đọc qua điện
// thoại (0 O o 1 l I) và bỏ ký tự đặc biệt (gõ trên bàn phím điện thoại hay sai).
const matKhauBangChu = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

// MatKhauKhoiTaoDai: đủ dài để không đoán được, đủ ngắn để đọc cho nhau chép.
const MatKhauKhoiTaoDai = 12

// MatKhauNgauNhien: mật khẩu khởi tạo do máy sinh, dùng crypto/rand.
func MatKhauNgauNhien() (string, error) {
	n := big.NewInt(int64(len(matKhauBangChu)))
	b := make([]byte, MatKhauKhoiTaoDai)
	for i := range b {
		k, err := rand.Int(rand.Reader, n)
		if err != nil {
			return "", err
		}
		b[i] = matKhauBangChu[k.Int64()]
	}
	return string(b), nil
}
