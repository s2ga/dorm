package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"ktx/internal/auth"
	"ktx/internal/billing"
	"ktx/internal/db"
	"ktx/internal/invoicecalc"
	"ktx/internal/scope"
	"ktx/internal/timeutil"
)

// Học viên tự đăng ký / hủy máy giặt và gửi xe ở cổng của mình. Không ghi thẳng vào hồ sơ: gửi ĐỀ NGHỊ,
// Ban Quản lý duyệt mới áp, và áp từ KỲ SAU tính theo NGÀY GỬI (owner chốt 05/10/2026). Máy giặt cùng
// luật với gửi xe. Đường an ninh (washing_requests, báo xe lạ) giữ nguyên, áp ngay khi duyệt.

const (
	dvGiat   = "washing"
	dvXe     = "parking"
	dvDangKy = "register"
	dvHuy    = "cancel"
	dvTran   = 200
)

var nhanDichVu = map[string]string{dvGiat: "máy giặt", dvXe: "gửi xe"}

// dvNgayApDung: đăng ký tính từ ngày 1 tháng SAU ngày gửi; hủy thì vẫn tính hết THÁNG gửi.
func dvNgayApDung(action, homNay string) string {
	ky := homNay[:7]
	if action == dvDangKy {
		return billing.FirstDay(invoicecalc.NextMonthOf(ky))
	}
	return billing.LastDay(ky)
}

// MeServices: GET /api/me/services — tình trạng máy giặt, xe đang gửi và các đề nghị gần đây của chính mình.
func (h *Handlers) MeServices(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	homNay := timeutil.Today()
	var (
		giat         bool
		tuNgay, toiN *string
		status       string
		checkOut     pgtype.Date
	)
	err := h.pool().QueryRow(ctx, `
		SELECT COALESCE(uses_washing,false), washing_from::text, washing_to::text,
		       CASE WHEN check_in_date IS NULL THEN 'pending' ELSE status END, check_out_date
		  FROM students WHERE id=$1 AND deleted_at IS NULL`, sid).Scan(&giat, &tuNgay, &toiN, &status, &checkOut)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy hồ sơ học viên")
			return
		}
		serverErr(c, err)
		return
	}
	xeRows, err := h.pool().Query(ctx, `
		SELECT id, plate, vehicle_type, from_date, to_date, bill_from FROM vehicles
		 WHERE student_id=$1 AND deleted_at IS NULL AND (to_date IS NULL OR to_date >= $2::date)
		 ORDER BY from_date NULLS LAST, id`, sid, homNay)
	if err != nil {
		serverErr(c, err)
		return
	}
	xe, err := db.RowsToMaps(xeRows)
	if err != nil {
		serverErr(c, err)
		return
	}
	dnRows, err := h.pool().Query(ctx, `
		SELECT id, service, action, plate, vehicle_type, vehicle_id, note, effective_date, status,
		       requested_at, decided_at, decision_note
		  FROM service_requests WHERE student_id=$1 AND requested_at > now() - interval '120 days'
		 ORDER BY requested_at DESC LIMIT 30`, sid)
	if err != nil {
		serverErr(c, err)
		return
	}
	dn, err := db.RowsToMaps(dnRows)
	if err != nil {
		serverErr(c, err)
		return
	}
	s, err := h.DB.GetSettings(ctx)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"washing":     gin.H{"uses": giat, "from": tuNgay, "to": toiN},
		"vehicles":    xe,
		"requests":    dn,
		"washing_fee": s["washing_fee"], "parking_fee": s["parking_fee"],
		"dang_o":          meOccupying(true, status, checkOut, homNay),
		"ap_dung_dang_ky": dvNgayApDung(dvDangKy, homNay),
		"ap_dung_huy":     dvNgayApDung(dvHuy, homNay),
	})
}

type dvBody struct {
	Service     string `json:"service"`
	Action      string `json:"action"`
	Plate       string `json:"plate"`
	VehicleType string `json:"vehicle_type"`
	VehicleID   int    `json:"vehicle_id"`
	Note        string `json:"note"`
}

// MeServiceRequest: POST /api/me/service-requests — học viên gửi đề nghị đăng ký / hủy.
func (h *Handlers) MeServiceRequest(c *gin.Context) {
	sid, ok := meStudentID(c)
	if !ok {
		return
	}
	var b dvBody
	_ = c.ShouldBindJSON(&b)
	if (b.Service != dvGiat && b.Service != dvXe) || (b.Action != dvDangKy && b.Action != dvHuy) {
		badRequest(c, "Đề nghị không hợp lệ — tải lại trang rồi gửi lại.")
		return
	}
	note := strings.TrimSpace(b.Note)
	if len([]rune(note)) > 500 {
		badRequest(c, "Ghi chú dài quá 500 ký tự.")
		return
	}
	ctx := c.Request.Context()
	homNay := timeutil.Today()
	var (
		giat     bool
		tuNgay   *string
		status   string
		checkOut pgtype.Date
		facID    *int
	)
	err := h.pool().QueryRow(ctx, `
		SELECT COALESCE(uses_washing,false), washing_from::text,
		       CASE WHEN check_in_date IS NULL THEN 'pending' ELSE status END, check_out_date, facility_id
		  FROM students WHERE id=$1 AND deleted_at IS NULL`, sid).Scan(&giat, &tuNgay, &status, &checkOut, &facID)
	if err != nil || !meOccupying(true, status, checkOut, homNay) {
		badRequest(c, "Bạn không còn ở ký túc xá nên không thể thay đổi dịch vụ.")
		return
	}
	var cho int
	if h.pool().QueryRow(ctx, `SELECT 1 FROM service_requests WHERE student_id=$1 AND service=$2 AND status='pending'
		   AND ($2='washing' OR (action=$3 AND (vehicle_id=$4 OR ($3='register' AND regexp_replace(upper(plate),'[^0-9A-Z]','','g') = $5))))`,
		sid, b.Service, b.Action, b.VehicleID, vehicleChuanBien(b.Plate)).Scan(&cho) == nil {
		conflict(c, gin.H{"error": "Bạn đã có đề nghị " + nhanDichVu[b.Service] + " đang chờ Ban Quản lý duyệt."})
		return
	}

	plate, loai, vid := "", strings.TrimSpace(b.VehicleType), 0
	switch b.Service + ":" + b.Action {
	case dvGiat + ":" + dvDangKy:
		if giat && (tuNgay == nil || *tuNgay <= homNay) {
			badRequest(c, "Bạn đang dùng máy giặt rồi.")
			return
		}
		if giat {
			badRequest(c, "Bạn đã được duyệt dùng máy giặt, tính phí từ "+timeutil.NgayVN(*tuNgay)+".")
			return
		}
		if h.pool().QueryRow(ctx, "SELECT 1 FROM washing_requests WHERE student_id=$1 AND status='pending'", sid).Scan(&cho) == nil {
			conflict(c, gin.H{"error": "Đã có đề nghị máy giặt cho bạn đang chờ Ban Quản lý duyệt."})
			return
		}
	case dvGiat + ":" + dvHuy:
		if !giat {
			badRequest(c, "Bạn đang không dùng máy giặt.")
			return
		}
	case dvXe + ":" + dvDangKy:
		plate = bienChuanHienThi(b.Plate)
		if plate == "" {
			badRequest(c, "Nhập biển số xe.")
			return
		}
		if len([]rune(plate)) > 20 || vehicleChuanBien(plate) == "" {
			badRequest(c, `Biển số không hợp lệ: "`+plate+`"`)
			return
		}
		if len([]rune(loai)) > 50 {
			badRequest(c, "Loại xe dài quá 50 ký tự.")
			return
		}
		if ten, trung := h.dvBienDaCo(ctx, sid, vehicleChuanBien(plate), homNay); trung {
			badRequest(c, "Biển số này đã đăng ký cho "+ten+" — kiểm lại biển, hoặc báo Ban Quản lý.")
			return
		}
	case dvXe + ":" + dvHuy:
		if b.VehicleID <= 0 {
			badRequest(c, "Chọn xe cần hủy gửi.")
			return
		}
		if h.pool().QueryRow(ctx, `SELECT 1 FROM vehicles WHERE id=$1 AND student_id=$2 AND deleted_at IS NULL
			   AND (to_date IS NULL OR to_date >= $3::date)`, b.VehicleID, sid, homNay).Scan(&cho) != nil {
			notFound(c, "Không tìm thấy xe đang gửi của bạn")
			return
		}
		vid = b.VehicleID
	}

	apDung := dvNgayApDung(b.Action, homNay)
	var vidArg interface{}
	if vid > 0 {
		vidArg = vid
	}
	var id int
	if err := h.pool().QueryRow(ctx, `
		INSERT INTO service_requests (student_id, facility_id, service, action, plate, vehicle_type, vehicle_id, note, effective_date)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		sid, facID, b.Service, b.Action, plate, loai, vidArg, note, apDung).Scan(&id); err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": "pending", "effective_date": apDung})
}

// dvBienDaCo: biển đã thuộc một xe CHƯA XOÁ (chỉ mục duy nhất của CSDL tính cả xe đã ngưng). Xe cũ đã
// ngưng của chính học viên thì không chặn — lúc duyệt sẽ cất dòng cũ đi rồi mới thêm dòng mới.
func (h *Handlers) dvBienDaCo(ctx context.Context, sid int, norm, homNay string) (string, bool) {
	var ten string
	err := h.pool().QueryRow(ctx, `
		SELECT CASE WHEN v.student_id=$2 THEN 'chính bạn (xe đang gửi)' ELSE s.name END
		  FROM vehicles v JOIN students s ON s.id = v.student_id
		 WHERE v.deleted_at IS NULL AND `+parkingSQLNorm+` = $1
		   AND NOT (v.student_id=$2 AND v.to_date IS NOT NULL AND v.to_date < $3::date)
		 LIMIT 1`, norm, sid, homNay).Scan(&ten)
	return ten, err == nil
}

// ListServiceRequests: GET /api/service-requests?status=pending|all&service=washing|parking (admin, staff).
func (h *Handlers) ListServiceRequests(c *gin.Context) {
	u := auth.CurrentUser(c)
	cond := []string{"s.deleted_at IS NULL"}
	params := []interface{}{}
	switch st := strings.TrimSpace(c.Query("status")); st {
	case "", "pending":
		cond = append(cond, "q.status = 'pending'")
	case "all":
	default:
		badRequest(c, `Bộ lọc không hợp lệ: "`+st+`"`)
		return
	}
	if dv := strings.TrimSpace(c.Query("service")); dv != "" {
		if dv != dvGiat && dv != dvXe {
			badRequest(c, `Bộ lọc không hợp lệ: "`+dv+`"`)
			return
		}
		params = append(params, dv)
		cond = append(cond, "q.service = $"+itoa(len(params)))
	}
	scope.ApplyFacilityFilter(u, "q.facility_id", &cond, &params)
	rows, err := h.pool().Query(c.Request.Context(), `
		SELECT q.id, q.student_id, q.service, q.action, q.plate, q.vehicle_type, q.vehicle_id, q.note,
		       q.effective_date, q.status, q.requested_at, q.decided_by, q.decided_at, q.decision_note,
		       s.name AS student_name, s.code AS student_code, r.name AS room_name, v.plate AS vehicle_plate
		  FROM service_requests q
		  JOIN students s ON s.id = q.student_id
		  LEFT JOIN rooms r ON r.id = s.room_id
		  LEFT JOIN vehicles v ON v.id = q.vehicle_id
		 WHERE `+joinAnd(cond)+`
		 ORDER BY q.requested_at DESC LIMIT `+itoa(dvTran), params...)
	if err != nil {
		serverErr(c, err)
		return
	}
	list, err := db.RowsToMaps(rows)
	if err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"rows": list})
}

// ApproveServiceRequest: POST /api/service-requests/:id/approve — áp đúng ngày đã chốt lúc gửi.
func (h *Handlers) ApproveServiceRequest(c *gin.Context) { h.dvQuyetDinh(c, true) }

// RejectServiceRequest: POST /api/service-requests/:id/reject — bắt buộc có lý do, học viên đọc được.
func (h *Handlers) RejectServiceRequest(c *gin.Context) { h.dvQuyetDinh(c, false) }

func (h *Handlers) dvQuyetDinh(c *gin.Context, duyet bool) {
	u := auth.CurrentUser(c)
	id, ok := paramInt(c, "id")
	if !ok {
		notFound(c, "Không tìm thấy đề nghị")
		return
	}
	var b struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	note := strings.TrimSpace(b.Note)
	if !duyet && note == "" {
		badRequest(c, "Nhập lý do từ chối để học viên biết vì sao.")
		return
	}
	ctx := c.Request.Context()
	var (
		sid                                   int
		dv, act, st, plate, loai, apDung, ten string
		vid                                   *int
		facID                                 *int
	)
	err := h.pool().QueryRow(ctx, `
		SELECT q.student_id, q.service, q.action, q.status, q.plate, q.vehicle_type, q.vehicle_id,
		       q.effective_date::text, q.facility_id, s.name
		  FROM service_requests q JOIN students s ON s.id = q.student_id
		 WHERE q.id=$1 AND s.deleted_at IS NULL`, id).
		Scan(&sid, &dv, &act, &st, &plate, &loai, &vid, &apDung, &facID, &ten)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			notFound(c, "Không tìm thấy đề nghị")
			return
		}
		serverErr(c, err)
		return
	}
	if fe := scope.AssertFacility(u, facID); fe != nil {
		c.JSON(fe.Status, gin.H{"error": fe.Error})
		return
	}
	if st != "pending" {
		conflict(c, gin.H{"error": "Đề nghị này " + nhanTT(nhanTTDeNghi, st) + " — tải lại danh sách."})
		return
	}
	viec := map[string]string{dvDangKy: "đăng ký ", dvHuy: "hủy "}[act] + nhanDichVu[dv]
	if !duyet {
		if _, err := h.pool().Exec(ctx, `UPDATE service_requests SET status='rejected', decided_by=$1, decided_at=now(),
			decision_note=$2 WHERE id=$3 AND status='pending'`, u.Username, note, id); err != nil {
			serverErr(c, err)
			return
		}
		maintGhiVet(ctx, h, u, "TỪ-CHỐI-DỊCH-VỤ", c.Request.URL.Path,
			"Từ chối đề nghị "+viec+" của "+ten+" (HV #"+itoa(sid)+") · lý do: "+note)
		c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": "rejected"})
		return
	}

	homNay := timeutil.Today()
	err = h.DB.WithTx(ctx, func(tx pgx.Tx) error {
		switch dv + ":" + act {
		case dvGiat + ":" + dvDangKy:
			// Đang dùng không hẹn ngày thôi (vd quản trị đã bật tay) thì giữ nguyên, khỏi dời ngày tính phí.
			if _, e := tx.Exec(ctx, `UPDATE students SET uses_washing=true, washing_from=$2::date, washing_to=NULL
				 WHERE id=$1 AND NOT (COALESCE(uses_washing,false) AND washing_to IS NULL)`, sid, apDung); e != nil {
				return e
			}
		case dvGiat + ":" + dvHuy:
			if _, e := tx.Exec(ctx, `UPDATE students SET uses_washing=false, washing_to=$2::date
				 WHERE id=$1 AND COALESCE(uses_washing,false)`, sid, apDung); e != nil {
				return e
			}
		case dvXe + ":" + dvDangKy:
			if _, e := tx.Exec(ctx, `UPDATE vehicles v SET deleted_at=now() WHERE v.student_id=$1 AND v.deleted_at IS NULL
				 AND v.to_date IS NOT NULL AND v.to_date < $3::date AND `+parkingSQLNorm+` = $2`,
				sid, vehicleChuanBien(plate), homNay); e != nil {
				return e
			}
			var moi int
			if e := tx.QueryRow(ctx, `INSERT INTO vehicles (student_id, plate, vehicle_type, from_date, bill_from)
				 VALUES ($1,$2,$3,$4::date,$5::date) RETURNING id`, sid, plate, loai, homNay, apDung).Scan(&moi); e != nil {
				return e
			}
			if _, e := tx.Exec(ctx, "UPDATE service_requests SET vehicle_id=$1 WHERE id=$2", moi, id); e != nil {
				return e
			}
		case dvXe + ":" + dvHuy:
			// Duyệt trong tháng gửi: thôi gửi từ hôm nay (an ninh khỏi điểm danh) mà kỳ này vẫn tính đủ;
			// duyệt trễ sang tháng sau thì lùi về hết tháng gửi để kỳ sau không bị tính.
			if vid != nil {
				if _, e := tx.Exec(ctx, `UPDATE vehicles SET to_date = LEAST($3::date, $4::date)
					 WHERE id=$1 AND student_id=$2 AND deleted_at IS NULL AND (to_date IS NULL OR to_date > LEAST($3::date, $4::date))`,
					*vid, sid, homNay, apDung); e != nil {
					return e
				}
			}
		}
		_, e := tx.Exec(ctx, `UPDATE service_requests SET status='approved', decided_by=$1, decided_at=now(), decision_note=$2
			 WHERE id=$3`, u.Username, note, id)
		return e
	})
	if err != nil {
		if vehicleIsDup(err) {
			badRequest(c, "Biển số "+plate+" đang thuộc một xe khác — từ chối đề nghị và ghi lý do.")
			return
		}
		serverErr(c, err)
		return
	}
	// Phiếu CHƯA THU từ kỳ áp dụng trở đi tính lại theo dịch vụ mới; phiếu đã thu giữ nguyên.
	tuKy := apDung[:7]
	if act == dvHuy {
		tuKy = invoicecalc.NextMonthOf(tuKy)
	}
	h.dvTinhLaiPhieu(ctx, sid, tuKy)
	maintGhiVet(ctx, h, u, "DUYỆT-DỊCH-VỤ", c.Request.URL.Path,
		"Duyệt đề nghị "+viec+" của "+ten+" (HV #"+itoa(sid)+")"+map[bool]string{true: " · biển " + plate, false: ""}[plate != ""]+
			" · áp dụng "+map[string]string{dvDangKy: "từ ", dvHuy: "đến hết "}[act]+timeutil.NgayVN(apDung))
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "status": "approved", "effective_date": apDung})
}

// dvTinhLaiPhieu: tính lại phiếu chưa thu của học viên từ kỳ `tuKy` (RecalcInvoice tự bỏ qua phiếu đã thu).
func (h *Handlers) dvTinhLaiPhieu(ctx context.Context, sid int, tuKy string) {
	rows, err := h.pool().Query(ctx, `SELECT month FROM invoices WHERE student_id=$1 AND deleted_at IS NULL
		AND status <> 'paid' AND month >= $2 ORDER BY month`, sid, tuKy)
	if err != nil {
		return
	}
	var ky []string
	for rows.Next() {
		var m string
		if rows.Scan(&m) == nil {
			ky = append(ky, m)
		}
	}
	rows.Close()
	for _, m := range ky {
		_, _ = invoicecalc.RecalcInvoice(ctx, h.DB, sid, m)
	}
}
