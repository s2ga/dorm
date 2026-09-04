// Package scope — đa cơ sở: lọc & cách ly dữ liệu theo cơ sở. Port từ server/scope.js.
// role quyết định LÀM ĐƯỢC GÌ; facility_id quyết định THẤY DỮ LIỆU NÀO. Hai trục độc lập.
package scope

import (
	"fmt"

	"ktx/internal/auth"
)

// UserFacility: id cơ sở, hoặc nil = điều hành. ADMIN LUÔN là điều hành. server/scope.js:13-17
func UserFacility(u *auth.User) *int {
	if u == nil {
		return nil
	}
	if u.Role == "admin" {
		return nil
	}
	return u.FacilityID
}

// IsExecutive: không bị giới hạn cơ sở. server/scope.js:20-22
func IsExecutive(u *auth.User) bool { return UserFacility(u) == nil }

// ApplyFacilityFilter: thêm điều kiện `column = $n` vào cond/params đang dựng. server/scope.js:27-32
// Điều hành -> không thêm gì. Quản lý cơ sở -> thêm điều kiện.
func ApplyFacilityFilter(u *auth.User, column string, cond *[]string, params *[]interface{}) {
	fid := UserFacility(u)
	if fid == nil {
		return
	}
	*params = append(*params, *fid)
	*cond = append(*cond, fmt.Sprintf("%s = $%d", column, len(*params)))
}

// CanAccessFacility. server/scope.js:36-41
func CanAccessFacility(u *auth.User, facilityID *int) bool {
	fid := UserFacility(u)
	if fid == nil {
		return true
	}
	if facilityID == nil {
		return false
	}
	return *facilityID == *fid
}

// FacilityError: kết quả assertFacility (nil nếu hợp lệ).
type FacilityError struct {
	Status int
	Error  string
}

// AssertFacility: trả *FacilityError nếu không được phép. server/scope.js:45-50
func AssertFacility(u *auth.User, facilityID *int) *FacilityError {
	if !CanAccessFacility(u, facilityID) {
		return &FacilityError{Status: 403, Error: "Bạn không có quyền với dữ liệu của cơ sở này"}
	}
	return nil
}

// ResolveFacilityForCreate: cơ sở mà bản ghi mới nên nhận. server/scope.js:55-59
func ResolveFacilityForCreate(u *auth.User, requested *int) *int {
	fid := UserFacility(u)
	if fid != nil {
		return fid
	}
	return requested
}
