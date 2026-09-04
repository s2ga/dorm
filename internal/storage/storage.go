// Package storage — object storage (S3) một client cho mọi môi trường (MinIO/Supabase/AWS).
// Port từ server/storage.js. Chỉ khác endpoint+credentials qua ENV.
package storage

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"regexp"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	appconfig "ktx/internal/config"
)

type Storage struct {
	client      *s3.Client
	presign     *s3.PresignClient
	CccdBucket  string
	IntroBucket string
}

// New dựng client S3. Trả lỗi nếu thiếu cấu hình (server/storage.js:8-13).
func New(ctx context.Context, cfg *appconfig.Config) (*Storage, error) {
	missing := []string{}
	for k, v := range map[string]string{
		"S3_ENDPOINT": cfg.S3Endpoint, "S3_REGION": cfg.S3Region, "S3_ACCESS_KEY": cfg.S3AccessKey,
		"S3_SECRET_KEY": cfg.S3SecretKey, "S3_CCCD_BUCKET": cfg.S3CccdBucket, "S3_INTRO_BUCKET": cfg.S3IntroBucket,
	} {
		if v == "" {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("thiếu cấu hình object storage (S3): %v", missing)
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.S3Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.S3AccessKey, cfg.S3SecretKey, "")),
	)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.S3Endpoint)
		o.UsePathStyle = true // MinIO & Supabase Storage dùng path-style
		// aws-sdk-go-v2 (s3 >= v1.60) bật checksum CRC32 MẶC ĐỊNH trên PutObject: gửi header
		// x-amz-checksum-* + trailing checksum (aws-chunked). Supabase Storage & nhiều S3-compat
		// TỪ CHỐI -> upload fail ("[HỆ THỐNG] chưa lưu được ảnh CCCD"). MinIO mới thì chấp nhận nên
		// local không lộ. Tắt về hành vi cũ: chỉ gửi/validate checksum khi thao tác BẮT BUỘC.
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	})
	return &Storage{client: client, presign: s3.NewPresignClient(client), CccdBucket: cfg.S3CccdBucket, IntroBucket: cfg.S3IntroBucket}, nil
}

// EXT + magic bytes: chỉ nhận ảnh raster an toàn (KHÔNG SVG). server/storage.js:26-41
var extByType = map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}

func khopMagic(ext string, b []byte) bool {
	if len(b) < 4 {
		return false
	}
	switch ext {
	case "jpg":
		return b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF
	case "png":
		return b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
	case "gif":
		return string(b[0:3]) == "GIF"
	case "webp":
		return len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP"
	}
	return false
}

var reImageDataURL = regexp.MustCompile(`(?s)^data:(image/[\w.+-]+);base64,(.+)$`)
var rePdfDataURL = regexp.MustCompile(`(?s)^data:application/pdf;base64,(.+)$`)

type Parsed struct {
	ContentType string
	Ext         string
	Buffer      []byte
}

// ParseDataUrl: data:image/...;base64 -> buffer, kiểm magic bytes. server/storage.js:43-51
func ParseDataUrl(dataURL string) *Parsed {
	m := reImageDataURL.FindStringSubmatch(dataURL)
	if m == nil {
		return nil
	}
	ext, ok := extByType[m[1]]
	if !ok {
		return nil
	}
	buf, err := base64.StdEncoding.DecodeString(m[2])
	if err != nil || !khopMagic(ext, buf) {
		return nil
	}
	return &Parsed{ContentType: m[1], Ext: ext, Buffer: buf}
}

// ParsePdfDataUrl: data:application/pdf;base64 -> buffer, kiểm %PDF-. server/storage.js:68-75
func ParsePdfDataUrl(dataURL string) *Parsed {
	m := rePdfDataURL.FindStringSubmatch(dataURL)
	if m == nil {
		return nil
	}
	buf, err := base64.StdEncoding.DecodeString(m[1])
	if err != nil || len(buf) < 5 || string(buf[0:5]) != "%PDF-" {
		return nil
	}
	return &Parsed{ContentType: "application/pdf", Ext: "pdf", Buffer: buf}
}

// HTTPError: lỗi có status cho handler.
type HTTPError struct {
	Status int
	Msg    string
}

func (e *HTTPError) Error() string { return e.Msg }

func (st *Storage) PutBuffer(ctx context.Context, bucket, key string, buffer []byte, contentType string) (string, error) {
	cc := "public, max-age=3600"
	_, err := st.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: &bucket, Key: &key, Body: bytes.NewReader(buffer), ContentType: &contentType, CacheControl: &cc,
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// PutDataUrl: server/storage.js:60-64
func (st *Storage) PutDataUrl(ctx context.Context, bucket, key, dataURL string) (string, error) {
	p := ParseDataUrl(dataURL)
	if p == nil {
		return "", &HTTPError{Status: 400, Msg: "Ảnh không hợp lệ (chỉ nhận JPG/PNG/WEBP/GIF)"}
	}
	return st.PutBuffer(ctx, bucket, key, p.Buffer, p.ContentType)
}

// PutPdfDataUrl: server/storage.js:76-80
func (st *Storage) PutPdfDataUrl(ctx context.Context, bucket, key, dataURL string) (string, error) {
	p := ParsePdfDataUrl(dataURL)
	if p == nil {
		return "", &HTTPError{Status: 400, Msg: "Tệp không hợp lệ — chỉ nhận file PDF"}
	}
	return st.PutBuffer(ctx, bucket, key, p.Buffer, p.ContentType)
}

type Object struct {
	Body          io.ReadCloser
	ContentType   string
	ContentLength int64
	ETag          string
}

// GetObject: lấy object để proxy stream. server/storage.js:83-86
func (st *Storage) GetObject(ctx context.Context, bucket, key string) (*Object, error) {
	r, err := st.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &bucket, Key: &key})
	if err != nil {
		return nil, err
	}
	o := &Object{Body: r.Body}
	if r.ContentType != nil {
		o.ContentType = *r.ContentType
	}
	if r.ContentLength != nil {
		o.ContentLength = *r.ContentLength
	}
	if r.ETag != nil {
		o.ETag = *r.ETag
	}
	return o, nil
}

func (st *Storage) DeleteObject(ctx context.Context, bucket, key string) error {
	if key == "" {
		return nil
	}
	_, err := st.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &bucket, Key: &key})
	return err
}

// SignedGetUrl: link ký hạn (tiện ích). server/storage.js:94-96
func (st *Storage) SignedGetUrl(ctx context.Context, bucket, key string, expires time.Duration) (string, error) {
	req, err := st.presign.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: &bucket, Key: &key}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}
