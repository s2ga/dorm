// Package ktx nhúng vỏ SPA cho bản deploy không kèm public/ (Vercel preset go).
// Khai báo ở GỐC: go:embed không với lên thư mục cha, mà file .go đặt trong public/
// thì bị xuất bản lên CDN.
package ktx

import _ "embed"

//go:embed public/index.html
var IndexHTML []byte
