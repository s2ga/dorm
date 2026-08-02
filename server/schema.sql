-- ===== Lược đồ CSDL quản lý ký túc xá (v2 - theo nghiệp vụ thực tế) =====

-- Cơ sở ký túc xá (hiện có 1, thiết kế sẵn cho nhiều cơ sở)
CREATE TABLE IF NOT EXISTS facilities (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id           SERIAL PRIMARY KEY,
  facility_id  INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  floor        INTEGER DEFAULT 1,
  gender       TEXT NOT NULL DEFAULT 'male',   -- 'male' | 'female'
  capacity     INTEGER NOT NULL DEFAULT 0,
  monthly_fee  NUMERIC(12,0) NOT NULL DEFAULT 1200000,
  note         TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS facility_id INTEGER;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor INTEGER DEFAULT 1;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'male';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hang TEXT DEFAULT 'B';   -- hạng phòng A/B/C/D
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;  -- xóa mềm (khôi phục được)
-- Loại phòng: 'shared' (cho thuê ghép) | 'whole' (thuê nguyên phòng) | 'security' (an ninh, ko cho thuê) | 'staff' (nhân viên công tác, ko HĐ)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_type TEXT DEFAULT 'shared';

CREATE TABLE IF NOT EXISTS students (
  id                  SERIAL PRIMARY KEY,
  code                TEXT DEFAULT '',
  name                TEXT NOT NULL,
  gender              TEXT NOT NULL DEFAULT 'male',  -- 'male' | 'female'
  phone               TEXT DEFAULT '',
  id_card             TEXT DEFAULT '',
  room_id             INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  check_in_date       DATE,
  check_out_date      DATE,
  status              TEXT NOT NULL DEFAULT 'in',    -- 'in' | 'out'
  note                TEXT DEFAULT '',
  uses_washing        BOOLEAN NOT NULL DEFAULT false, -- đăng ký máy giặt
  uses_parking        BOOLEAN NOT NULL DEFAULT false, -- đăng ký gửi xe
  deposit_amount      NUMERIC(12,0) NOT NULL DEFAULT 0,
  deposit_status      TEXT NOT NULL DEFAULT 'none',   -- 'none'|'held'|'refunded'|'forfeited'
  deposit_date        DATE,
  deposit_refund_date DATE,
  checkout_notice_date DATE,
  checkout_reason      TEXT,                          -- 'normal'|'urgent_visa'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE students ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'male';
ALTER TABLE students ADD COLUMN IF NOT EXISTS uses_washing BOOLEAN DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS uses_parking BOOLEAN DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,0) DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS deposit_status TEXT DEFAULT 'none';
ALTER TABLE students ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS deposit_refund_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS checkout_notice_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS checkout_reason TEXT;
-- Bổ sung theo nghiệp vụ thực tế
ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS class_name TEXT DEFAULT '';        -- Lớp
-- Email công ty của học viên. Khớp email này với tài khoản Microsoft ở lần đăng nhập ĐẦU TIÊN thì
-- vào thẳng cổng học viên, không phải nằm hàng chờ admin duyệt. Trống = vẫn phải duyệt tay.
ALTER TABLE students ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
-- Một email chỉ được thuộc MỘT hồ sơ: nếu không, khớp email lúc đăng nhập sẽ không biết chọn ai.
CREATE UNIQUE INDEX IF NOT EXISTS ux_students_email ON students (lower(email)) WHERE email IS NOT NULL AND email <> '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS rental_type TEXT DEFAULT 'ghep';    -- 'ghep' | 'phong'
ALTER TABLE students ADD COLUMN IF NOT EXISTS residency_status TEXT DEFAULT 'unregistered'; -- tạm trú: 'registered'|'unregistered'
ALTER TABLE students ADD COLUMN IF NOT EXISTS contract_no TEXT DEFAULT '';        -- số HĐ
ALTER TABLE students ADD COLUMN IF NOT EXISTS contract_date DATE;                 -- ngày ký HĐ
ALTER TABLE students ADD COLUMN IF NOT EXISTS contract_status TEXT DEFAULT 'unsigned'; -- 'done'|'scanned'|'unsigned'|'none'
ALTER TABLE students ADD COLUMN IF NOT EXISTS cccd_image TEXT;                    -- (cũ) ảnh CCCD 1 mặt
ALTER TABLE students ADD COLUMN IF NOT EXISTS cccd_front TEXT;                    -- ảnh CCCD mặt trước
ALTER TABLE students ADD COLUMN IF NOT EXISTS cccd_back TEXT;                     -- ảnh CCCD mặt sau
ALTER TABLE students ADD COLUMN IF NOT EXISTS deposit_bank TEXT DEFAULT '';       -- ngân hàng hoàn cọc
ALTER TABLE students ADD COLUMN IF NOT EXISTS deposit_account TEXT DEFAULT '';    -- số TK hoàn cọc
ALTER TABLE students ADD COLUMN IF NOT EXISTS deposit_deduction NUMERIC(12,0) DEFAULT 0;  -- khấu trừ hư hao khi trả phòng
ALTER TABLE students ADD COLUMN IF NOT EXISTS deposit_deduction_note TEXT DEFAULT '';     -- chi tiết khấu trừ
-- Thông tin học viên bổ sung (điểm 8 — đồng bộ từ Bitrix/Kaizen sau)
ALTER TABLE students ADD COLUMN IF NOT EXISTS class_start_date DATE;              -- ngày khai giảng
ALTER TABLE students ADD COLUMN IF NOT EXISTS expected_departure DATE;            -- ngày dự kiến xuất cảnh
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone TEXT DEFAULT '';       -- SĐT phụ huynh
-- Bàn giao phòng thực tế (bảo trì xác nhận): nhận phòng + trả phòng (kiểm tài sản, thu chìa khóa)
ALTER TABLE students ADD COLUMN IF NOT EXISTS checkin_confirmed_at TIMESTAMPTZ;   -- đã xác nhận nhận phòng
ALTER TABLE students ADD COLUMN IF NOT EXISTS checkin_confirm_note TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS checkout_confirmed_at TIMESTAMPTZ;  -- đã xác nhận trả phòng
ALTER TABLE students ADD COLUMN IF NOT EXISTS checkout_actual_date DATE;          -- ngày trả phòng THỰC TẾ
ALTER TABLE students ADD COLUMN IF NOT EXISTS checkout_confirm_note TEXT DEFAULT '';
-- ĐA CƠ SỞ: cơ sở học viên thuộc về. Nguồn chuẩn để lọc/cách ly dữ liệu theo cơ sở người đăng nhập.
-- Gắn khi duyệt đơn/tạo HV và giữ đồng bộ theo phòng khi chuyển phòng. Backfill từ phòng cho HV cũ.
ALTER TABLE students ADD COLUMN IF NOT EXISTS facility_id INTEGER;
UPDATE students s SET facility_id = r.facility_id
  FROM rooms r WHERE s.room_id = r.id AND s.facility_id IS NULL AND r.facility_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_students_facility ON students (facility_id);

-- Xe của học viên
CREATE TABLE IF NOT EXISTS vehicles (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  plate        TEXT DEFAULT '',      -- biển số
  vehicle_type TEXT DEFAULT '',      -- loại xe
  sticker      TEXT DEFAULT '',      -- mã dán xe
  note         TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  -- KHÔNG đặt UNIQUE trần ở đây: xoá tài khoản là xoá mềm nên tên sẽ bị giữ chỗ vĩnh viễn.
  -- Ràng buộc duy nhất do uq_users_username_ci lo (lower(username) WHERE deleted_at IS NULL).
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'student', -- 'admin' | 'student'
  full_name     TEXT DEFAULT '',
  student_id    INTEGER REFERENCES students(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Bắt buộc đổi mật khẩu lần đăng nhập đầu (tài khoản admin khởi tạo từ ENV)
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
-- Số hiệu phiên đăng nhập. Token mang theo số này; tăng số = MỌI token cũ của tài khoản đó hết hiệu lực ngay.
-- Dùng để THU HỒI quyền: đăng xuất, đổi vai trò, xoá tài khoản, đặt lại mật khẩu.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_epoch INTEGER NOT NULL DEFAULT 0;
-- ĐA CƠ SỞ: cơ sở mà tài khoản quản lý/bảo trì phụ trách.
--   NULL  = ĐIỀU HÀNH — thấy & thao tác dữ liệu MỌI cơ sở (mặc định của admin khởi tạo).
--   có id = QUẢN LÝ CƠ SỞ — chỉ thấy & thao tác dữ liệu đúng cơ sở đó.
-- Vai (role) quyết định LÀM ĐƯỢC GÌ; facility_id quyết định THẤY DỮ LIỆU NÀO. Hai trục độc lập.
ALTER TABLE users ADD COLUMN IF NOT EXISTS facility_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_users_facility ON users (facility_id);

-- ===== ĐĂNG NHẬP MICROSOFT (SSO / OpenID Connect) =====
-- Nguyên tắc: SSO chỉ là CÁCH CHỨNG MINH danh tính. Sau khi chứng minh xong, phiên vẫn là cookie
-- httpOnly + token_epoch y như đăng nhập mật khẩu — không có đường quyền riêng cho SSO.
-- email: dùng để LIÊN KẾT tài khoản đã có với danh tính Microsoft (khớp lần đầu, sau đó khoá theo sso_subject).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
-- sso_subject: mã định danh BẤT BIẾN do Microsoft cấp (claim `oid` — KHÔNG dùng email vì email đổi được).
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_subject TEXT;
-- auth_provider: 'local' = đăng nhập bằng mật khẩu · 'sso' = chỉ Microsoft · 'both' = dùng được cả hai.
-- Quyết định tài khoản nào ĐƯỢC PHÉP dùng form mật khẩu (tài khoản 'sso' thuần thì không).
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local';
-- approved: tài khoản do SSO TỰ TẠO (người trong tenant chưa có hồ sơ) = false -> chưa dùng được gì,
-- chờ admin gán vai + duyệt. Tài khoản cũ/ do admin tạo = true (mặc định) nên không ai bị khoá oan.
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT true;
-- Tài khoản SSO thuần KHÔNG có mật khẩu. Nhét hash rác sẽ mở đường "đặt lại mật khẩu" chạy song song
-- SSO -> bỏ ràng buộc NOT NULL và chặn đăng nhập mật khẩu khi password_hash IS NULL.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
-- Một email / một danh tính Microsoft chỉ gắn được vào MỘT tài khoản còn sống.
-- deleted_at phải khai TRƯỚC chỉ mục bên dưới (chỉ mục lọc theo cột này).
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_sso_subject ON users (sso_subject) WHERE sso_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS logs (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                 -- 'in' | 'out'
  date        DATE NOT NULL,
  room_id     INTEGER,
  note        TEXT DEFAULT '',
  source      TEXT DEFAULT 'admin',          -- 'admin' | 'self'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chỉ số điện công-tơ từng phòng theo tháng (số đầu tự nối tháng trước)
CREATE TABLE IF NOT EXISTS electric_readings (
  id            SERIAL PRIMARY KEY,
  room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  month         TEXT NOT NULL,               -- 'YYYY-MM'
  reading_start NUMERIC(10,1) NOT NULL DEFAULT 0, -- số đầu (auto = số cuối tháng trước)
  reading_end   NUMERIC(10,1) NOT NULL DEFAULT 0, -- số cuối (nhập tay)
  kwh           NUMERIC(10,1) NOT NULL DEFAULT 0, -- tiêu thụ = cuối - đầu
  UNIQUE (room_id, month)
);
ALTER TABLE electric_readings ADD COLUMN IF NOT EXISTS reading_start NUMERIC(10,1) DEFAULT 0;
ALTER TABLE electric_readings ADD COLUMN IF NOT EXISTS reading_end NUMERIC(10,1) DEFAULT 0;

-- Hóa đơn (phiếu thu) hàng tháng, có phân tách từng khoản
CREATE TABLE IF NOT EXISTS invoices (
  id             SERIAL PRIMARY KEY,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  room_id        INTEGER,
  month          TEXT NOT NULL,              -- 'YYYY-MM'
  days_stayed    INTEGER NOT NULL DEFAULT 0,
  room_charge    NUMERIC(12,0) NOT NULL DEFAULT 0,
  electric_kwh   NUMERIC(10,1) NOT NULL DEFAULT 0,
  electric_charge NUMERIC(12,0) NOT NULL DEFAULT 0,
  water_charge   NUMERIC(12,0) NOT NULL DEFAULT 0,
  service_charge NUMERIC(12,0) NOT NULL DEFAULT 0,
  washing_charge NUMERIC(12,0) NOT NULL DEFAULT 0,
  parking_charge NUMERIC(12,0) NOT NULL DEFAULT 0,
  other_charge   NUMERIC(12,0) NOT NULL DEFAULT 0,
  other_note     TEXT DEFAULT '',
  total          NUMERIC(12,0) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'sent'|'paid'
  paid_date      DATE,
  note           TEXT DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, month)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Đơn đăng ký phòng (học viên tự gửi từ trang công khai)
CREATE TABLE IF NOT EXISTS applications (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT DEFAULT '',
  gender      TEXT DEFAULT 'female',
  birth_date  DATE,
  code        TEXT DEFAULT '',
  class_name  TEXT DEFAULT '',
  rental_type TEXT DEFAULT 'ghep',
  pref        TEXT DEFAULT '',       -- nguyện vọng (tầng/hạng...)
  note        TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'approved'|'rejected'
  student_id  INTEGER REFERENCES students(id) ON DELETE SET NULL,
  wants_parking BOOLEAN DEFAULT false,  -- đăng ký gửi xe
  plate       TEXT DEFAULT '',          -- biển số xe
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS wants_parking BOOLEAN DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS plate TEXT DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS wants_washing BOOLEAN DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS cccd_front TEXT;   -- ảnh CCCD mặt trước
ALTER TABLE applications ADD COLUMN IF NOT EXISTS cccd_back TEXT;    -- ảnh CCCD mặt sau
ALTER TABLE applications ADD COLUMN IF NOT EXISTS facility_id INTEGER;  -- cơ sở đăng ký
ALTER TABLE applications ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';  -- ghi chú của quản lý

-- Báo cáo hư hỏng (học viên gửi)
CREATE TABLE IF NOT EXISTS damage_reports (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER REFERENCES students(id) ON DELETE CASCADE,
  room_id     INTEGER,
  title       TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new', -- 'new'|'processing'|'done'
  admin_note  TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
-- Yêu cầu hỗ trợ học viên: phân loại (hư hỏng phòng / báo vi phạm / khác)
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'damage';
-- Chuyển bảo trì: mốc thời gian admin chuyển việc cho bộ phận bảo trì
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- Danh mục tài sản / trang thiết bị trong phòng (kèm phí bồi hoàn)
CREATE TABLE IF NOT EXISTS assets (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  unit       TEXT DEFAULT 'Cái',        -- đơn vị tính
  category   TEXT DEFAULT 'fixed',      -- 'person' (theo người) | 'fixed' (cố định)
  quantity   INTEGER DEFAULT 1,
  fee        NUMERIC(12,0) DEFAULT 0,   -- phí bồi hoàn nếu mất/hư/không vệ sinh
  note       TEXT DEFAULT '',
  sort       INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Đơn đăng ký trả phòng (học viên gửi)
CREATE TABLE IF NOT EXISTS checkout_requests (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER REFERENCES students(id) ON DELETE CASCADE,
  desired_date DATE,
  reason       TEXT DEFAULT 'normal', -- 'normal'|'urgent_visa'
  note         TEXT DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'done'|'rejected'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at   TIMESTAMPTZ
);
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';  -- ghi chú của quản lý
-- BL-62: workflow trả phòng 1 đơn — 5 trạng thái. Cột thêm (additive, idempotent).
-- Trạng thái (giữ TEXT, KHÔNG ràng buộc enum để dữ liệu cũ còn hợp lệ):
--   pending(chờ duyệt) → approved(chờ bàn giao) → handed_over(chờ lập phiếu)
--   → billed(chờ hoàn tất) → done(hoàn tất)  |  rejected(từ chối)
-- Đơn cũ 'pending'/'done'/'rejected' vẫn đúng nghĩa — KHÔNG viết lại.
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS bank_account   TEXT DEFAULT '';         -- HV nhập lúc gửi đơn
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS bank_name      TEXT DEFAULT '';
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS approved_by    TEXT;                    -- BQL duyệt
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMPTZ;
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS key_returned   BOOLEAN DEFAULT false;   -- an ninh bàn giao
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS damage_note    TEXT DEFAULT '';         -- hư hao (diễn giải từ danh mục)
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS damage_amount  NUMERIC(12,0) DEFAULT 0; -- tiền hư hao (server tính từ assets)
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS meter_reading  NUMERIC(10,1);           -- số điện chốt lúc bàn giao
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS handover_by    TEXT;
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS handover_at    TIMESTAMPTZ;
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS invoice_id     INTEGER REFERENCES invoices(id);  -- phiếu thu đã tạo
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS billed_at      TIMESTAMPTZ;
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS deposit_refunded_at TIMESTAMPTZ;         -- dấu mốc "đã hoàn cọc" (chỉ lịch sử)
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS refunded_by    TEXT;

-- Danh mục loại vi phạm / nhắc nhở (sửa trong Cài đặt)
CREATE TABLE IF NOT EXISTS violation_types (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'minor',   -- 'minor'|'major'|'severe'
  sort       INTEGER DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vi phạm / nhắc nhở theo từng học viên
CREATE TABLE IF NOT EXISTS violations (
  id              SERIAL PRIMARY KEY,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type_id         INTEGER REFERENCES violation_types(id) ON DELETE SET NULL,
  type_name       TEXT DEFAULT '',
  severity        TEXT DEFAULT 'minor',
  level           INTEGER NOT NULL DEFAULT 1,       -- lần vi phạm thứ mấy của học viên
  date            DATE NOT NULL,
  note            TEXT DEFAULT '',
  admin_note      TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'open',     -- 'open'|'resolved'
  notified_school BOOLEAN NOT NULL DEFAULT false,   -- đã gửi mail nhà trường
  notified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_violations_student ON violations(student_id);
-- Ai ghi vi phạm này (V2-11): hành động đụng danh dự HV + gửi mail ra ngoài trường, phải truy được.
ALTER TABLE violations ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Ảnh trang giới thiệu (upload trong Cài đặt, lưu base64 — bền vững qua deploy)
CREATE TABLE IF NOT EXISTS media (
  key        TEXT PRIMARY KEY,
  data       TEXT,             -- data URL: data:image/...;base64,...
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nhật ký thao tác (audit) — ai làm gì, khi nào
CREATE TABLE IF NOT EXISTS audit_log (
  id       SERIAL PRIMARY KEY,
  user_id  INTEGER,
  username TEXT DEFAULT '',
  role     TEXT DEFAULT '',
  method   TEXT DEFAULT '',
  path     TEXT DEFAULT '',
  detail   TEXT DEFAULT '',
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);

-- BL-79: chống dò mật khẩu theo TÊN ĐĂNG NHẬP. Khoá là lớp bảo vệ nên phải sống qua restart/deploy
-- và dùng chung giữa các instance — để trong RAM là mất sạch mỗi lần Render ngủ dậy.
-- Khoá theo tên chứ không theo user_id: kẻ dò gõ cả tên tài khoản không tồn tại.
CREATE TABLE IF NOT EXISTS login_guard (
  username        TEXT PRIMARY KEY,                   -- lower(trim(username))
  fails_ms        BIGINT[] NOT NULL DEFAULT '{}',     -- mốc các lần sai còn trong cửa sổ đếm
  locked_until_ms BIGINT NOT NULL DEFAULT 0,          -- > now = đang khoá
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_guard_updated ON login_guard(updated_at);

CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_invoices_month  ON invoices(month);
CREATE INDEX IF NOT EXISTS idx_logs_student    ON logs(student_id);

-- ===== Xóa mềm (soft-delete) toàn hệ thống: chỉ đánh dấu deleted_at, KHÔNG xóa thật =====
ALTER TABLE students     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE vehicles     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- Xe có KỲ hiệu lực (from_date .. to_date) như phòng trưởng: tính lại hoá đơn tháng CŨ phải lấy
-- số xe CỦA THÁNG ĐÓ, không lấy số xe hôm nay (V2-23, đúng lỗi TC-10 đã học ở chỗ khác).
ALTER TABLE vehicles     ADD COLUMN IF NOT EXISTS from_date DATE;
ALTER TABLE vehicles     ADD COLUMN IF NOT EXISTS to_date   DATE;
-- Backfill: xe cũ tính từ ngày tạo; xe đã xoá thì tới ngày xoá.
UPDATE vehicles SET from_date = created_at::date WHERE from_date IS NULL;
UPDATE vehicles SET to_date = deleted_at::date WHERE to_date IS NULL AND deleted_at IS NOT NULL;
ALTER TABLE assets       ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE facilities   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE invoices     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE violations   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Ảnh giới thiệu lưu trên Supabase Storage: cột path thay cho base64 trong 'data'
ALTER TABLE media ADD COLUMN IF NOT EXISTS path TEXT;

-- Chỉ mục lọc bản ghi còn hiệu lực + vá các FK còn thiếu (từ rà soát hiệu năng)
CREATE INDEX IF NOT EXISTS idx_students_deleted  ON students(deleted_at);
CREATE INDEX IF NOT EXISTS idx_students_room     ON students(room_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_student  ON vehicles(student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted  ON invoices(deleted_at);
CREATE INDEX IF NOT EXISTS idx_electric_month    ON electric_readings(month);

-- ===== Chốt chỉ số công-tơ GIỮA KỲ =====
-- Khi có người trả phòng / chuyển đi giữa tháng, ghi lại chỉ số điện của phòng NGAY HÔM ĐÓ.
-- Tháng được cắt thành các chặng giữa 2 lần chốt; mỗi chặng chia cho người có mặt theo số ngày ở.
-- Nếu không có lần chốt nào -> cả tháng là 1 chặng (y như trước).
CREATE TABLE IF NOT EXISTS meter_reads (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  read_date  DATE NOT NULL,
  reading    NUMERIC(10,1) NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'manual',   -- checkout | transfer | manual
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL, -- ai rời phòng mà phát sinh lần chốt này
  note       TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, read_date)                  -- 1 phòng 1 ngày chỉ 1 chỉ số
);
CREATE INDEX IF NOT EXISTS idx_meter_reads_room ON meter_reads(room_id, read_date);

-- ===== Lịch sử ở phòng =====
-- Trước đây chuyển phòng chỉ ĐÈ students.room_id -> mất dấu người đó từng ở phòng cũ,
-- nên tiền điện nửa tháng đầu của họ bị đổ sang đầu người ở lại. Bảng này giữ lại từng lượt ở.
CREATE TABLE IF NOT EXISTS room_stays (
  id         SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  from_date  DATE NOT NULL,
  to_date    DATE,                              -- NULL = còn đang ở phòng này
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_stays_room    ON room_stays(room_id, from_date);
CREATE INDEX IF NOT EXISTS idx_room_stays_student ON room_stays(student_id);

-- Nạp lần đầu từ dữ liệu hiện có (phòng hiện tại + ngày vào/ra). Chỉ chạy cho HV chưa có lượt nào,
-- nên chạy lại file này nhiều lần cũng không đẻ thêm dòng.
INSERT INTO room_stays (student_id, room_id, from_date, to_date)
SELECT s.id, s.room_id, s.check_in_date, s.check_out_date
  FROM students s
 WHERE s.room_id IS NOT NULL AND s.check_in_date IS NOT NULL AND s.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM room_stays rs WHERE rs.student_id = s.id);

-- ===== Ràng buộc ở CSDL =====
-- Bọc trong DO/EXCEPTION: file này chạy mỗi lần khởi động, ràng buộc không áp được (dữ liệu đang
-- vi phạm) mà ném lỗi thì máy chủ không lên nổi. Cái nào trượt thì ghi vào bảng schema_guard và
-- máy chủ in ra lúc boot; dọn dữ liệu rồi khởi động lại là nó tự áp.
CREATE TABLE IF NOT EXISTS schema_guard (
  ten        TEXT PRIMARY KEY,
  loi        TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Phòng trưởng + các cột giảm giá =====
-- PHẢI đứng TRƯỚC khối DO: ck_invoices_no_negative tham chiếu leader_discount/room_discount,
-- ck_room_leaders_dates cần bảng room_leaders — để sau thì CSDL mới boot lần đầu áp thiếu 2 chốt đó.
-- Phòng trưởng được miễn tiền nước + phí dịch vụ, có from_date/to_date để chia theo số ngày làm.
CREATE TABLE IF NOT EXISTS room_leaders (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_date  DATE NOT NULL,
  to_date    DATE,                              -- NULL = đang làm phòng trưởng
  note       TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_leaders_room    ON room_leaders(room_id, from_date);
CREATE INDEX IF NOT EXISTS idx_room_leaders_student ON room_leaders(student_id);
-- Một phòng CHỈ có 1 phòng trưởng tại một thời điểm. Ràng buộc ở CSDL, không chỉ ở code —
-- 2 người bấm cùng lúc thì code kiểm tra rồi mới ghi vẫn lọt, CSDL thì không.
CREATE UNIQUE INDEX IF NOT EXISTS uq_room_leader_current ON room_leaders(room_id) WHERE to_date IS NULL;

-- Khoản giảm cho phòng trưởng, ghi RIÊNG một dòng trên phiếu (không âm thầm hạ tiền nước xuống 0)
-- để học viên thấy được ưu đãi và cấp trên thống kê được chế độ này tốn bao nhiêu.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS leader_discount NUMERIC(12,0) NOT NULL DEFAULT 0;
-- Giảm tiền phòng theo % riêng của từng người (vd quản lý KTX ở phòng 104 được giảm 50%).
-- Để ở HỒ SƠ chứ không viết cứng số phòng vào code: đổi phòng/đổi người thì tự sửa được.
ALTER TABLE students ADD COLUMN IF NOT EXISTS room_fee_discount_pct SMALLINT NOT NULL DEFAULT 0
  CHECK (room_fee_discount_pct >= 0 AND room_fee_discount_pct <= 100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS room_discount NUMERIC(12,0) NOT NULL DEFAULT 0;

-- ===== Giảm giá theo % cho từng khoản (ngoài room_fee_discount_pct đã có) =====
ALTER TABLE students ADD COLUMN IF NOT EXISTS water_discount_pct    SMALLINT NOT NULL DEFAULT 0 CHECK (water_discount_pct    BETWEEN 0 AND 100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS electric_discount_pct SMALLINT NOT NULL DEFAULT 0 CHECK (electric_discount_pct BETWEEN 0 AND 100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS service_discount_pct  SMALLINT NOT NULL DEFAULT 0 CHECK (service_discount_pct  BETWEEN 0 AND 100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS washing_discount_pct  SMALLINT NOT NULL DEFAULT 0 CHECK (washing_discount_pct  BETWEEN 0 AND 100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS parking_discount_pct  SMALLINT NOT NULL DEFAULT 0 CHECK (parking_discount_pct  BETWEEN 0 AND 100);
-- Lý do khoá hồ sơ, hỏi lúc khoá. Bỏ trống thì máy chủ điền "Ngừng dịch vụ thuê phòng".
ALTER TABLE students ADD COLUMN IF NOT EXISTS lock_reason TEXT NOT NULL DEFAULT '';
-- Tổng phần giảm của các khoản ngoài tiền phòng, ghi riêng một dòng trên phiếu.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fee_discount NUMERIC(12,0) NOT NULL DEFAULT 0;

DO $ktx$
DECLARE
  r RECORD;
  -- BL-36: nhóm ràng buộc TÀI CHÍNH (chống trùng hồ sơ → thu/xuất phiếu 2 lần) là FAIL-CLOSED:
  -- áp không được (dữ liệu còn trùng) thì DỪNG boot (RAISE) — buộc dọn trùng TRƯỚC khi vận hành,
  -- thay vì ghi schema_guard rồi chạy tiếp mà thiếu chốt. Các ràng buộc còn lại vẫn fail-open như cũ.
  critical_names text[] := ARRAY['uq_students_id_card','uq_students_code','uq_vehicles_plate','uq_vehicles_plate_norm'];
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- Trùng CCCD = một người có 2 hồ sơ -> bị tính tiền 2 lần. Bỏ qua hồ sơ đã xoá & CCCD trống.
    ('uq_students_id_card',
     $q$CREATE UNIQUE INDEX IF NOT EXISTS uq_students_id_card ON students (id_card)
        WHERE deleted_at IS NULL AND COALESCE(id_card,'') <> ''$q$),
    -- Trùng MÃ HV = một người có 2 hồ sơ -> 2 phiếu -> bị thu tiền 2 lần.
    -- VŨ TRANG SẴN: hiện dữ liệu còn bản trùng nên ràng buộc này CHƯA áp được (xem cảnh báo lúc
    -- khởi động). Dọn xong dữ liệu rồi khởi động lại là nó TỰ KHOÁ, không phải sửa code.
    -- Nhân viên cũng KHÔNG được trùng mã (sếp chốt 16/07/2026) -> không loại trừ ai cả.
    ('uq_students_code',
     $q$CREATE UNIQUE INDEX IF NOT EXISTS uq_students_code ON students (lower(btrim(code)))
        WHERE deleted_at IS NULL AND COALESCE(btrim(code),'') <> ''$q$),
    -- Trùng biển số = 2 học viên cùng khai một xe -> thu phí gửi xe sai
    ('uq_vehicles_plate',
     $q$CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_plate ON vehicles (lower(btrim(plate)))
        WHERE deleted_at IS NULL AND COALESCE(plate,'') <> ''$q$),
    -- M-5: index CŨ chỉ lower(btrim) -> "63-B4 508.58" và "63B450858" coi là KHÁC. Hai người khai
    -- ĐỒNG THỜI cùng xe khác định dạng lọt cả 2 (chống trùng ở app chạy trước-INSERT, không khoá) ->
    -- NHÂN ĐÔI phí gửi xe. Thêm index chuẩn hoá GIỐNG app (bỏ mọi ký tự không phải chữ-số) làm chốt
    -- cuối ở DB. Fail-safe qua schema_guard nếu dữ liệu cũ có bản trùng dạng này (dọn rồi khởi động lại).
    ('uq_vehicles_plate_norm',
     $q$CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_plate_norm ON vehicles (regexp_replace(upper(plate),'[^0-9A-Z]','','g'))
        WHERE deleted_at IS NULL AND COALESCE(plate,'') <> ''$q$),
    -- Hai phòng cùng tên trong một cơ sở -> xếp người vào nhầm phòng
    ('uq_rooms_name_per_facility',
     $q$CREATE UNIQUE INDEX IF NOT EXISTS uq_rooms_name_per_facility ON rooms (facility_id, lower(btrim(name)))
        WHERE deleted_at IS NULL$q$),
    -- Tên đăng nhập trùng chỉ khác hoa/thường: app kiểm bằng lower() rồi mới ghi, nhưng 2 người
    -- bấm cùng lúc thì cả hai đều thấy "chưa có" -> lọt. CSDL thì không.
    ('uq_users_username_ci',
     $q$CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_ci ON users (lower(username))
        WHERE deleted_at IS NULL$q$),
    -- Một phòng chỉ 1 chỉ số công-tơ cho một ngày
    ('uq_meter_reads_room_date',
     $q$CREATE UNIQUE INDEX IF NOT EXISTS uq_meter_reads_room_date ON meter_reads (room_id, read_date)$q$),
    -- users.facility_id: đổi FK từ ON DELETE SET NULL -> ON DELETE RESTRICT. Xoá cơ sở khi còn tài khoản
    -- gắn nó KHÔNG được âm thầm biến quản lý thành "điều hành" (facility_id về NULL = thấy mọi cơ sở).
    -- App xoá cơ sở là XOÁ MỀM (không kích hoạt FK), nhưng đây là chốt chặn cứng cho lỡ có DELETE thật.
    -- Idempotent: gỡ FK cũ (tên mặc định) nếu còn, thêm FK RESTRICT nếu chưa có.
    ('fk_users_facility_restrict',
     $q$DO $fk$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='users_facility_id_fkey' AND table_name='users') THEN
         ALTER TABLE users DROP CONSTRAINT users_facility_id_fkey;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='users_facility_fk' AND table_name='users') THEN
         ALTER TABLE users ADD CONSTRAINT users_facility_fk FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE RESTRICT;
       END IF;
     END $fk$;$q$),
    -- BL-37: FK cho students.facility_id + applications.facility_id (trước chỉ ADD COLUMN, không tham chiếu).
    -- Bảo toàn tham chiếu + ON DELETE RESTRICT (không xoá cơ sở khi còn HV/đơn gắn nó). NULL vẫn cho phép.
    ('fk_students_facility',
     $q$DO $fk$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='fk_students_facility' AND table_name='students') THEN
         ALTER TABLE students ADD CONSTRAINT fk_students_facility FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE RESTRICT;
       END IF;
     END $fk$;$q$),
    ('fk_applications_facility',
     $q$DO $fk$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='fk_applications_facility' AND table_name='applications') THEN
         ALTER TABLE applications ADD CONSTRAINT fk_applications_facility FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE RESTRICT;
       END IF;
     END $fk$;$q$),

    -- ---- Tiền KHÔNG BAO GIỜ được âm. Ô nhập có min=0 nhưng đó chỉ là thuộc tính HTML.
    ('ck_invoices_no_negative',
     $q$ALTER TABLE invoices ADD CONSTRAINT ck_invoices_no_negative CHECK (
        room_charge >= 0 AND electric_charge >= 0 AND water_charge >= 0 AND service_charge >= 0
        AND washing_charge >= 0 AND parking_charge >= 0 AND other_charge >= 0
        AND leader_discount >= 0 AND room_discount >= 0 AND fee_discount >= 0
        AND electric_kwh >= 0 AND days_stayed >= 0 AND total >= 0)$q$),
    -- Kỳ phải đúng dạng YYYY-MM. Kỳ "xyz" lọt vào là mọi báo cáo doanh thu lệch.
    ('ck_invoices_month',
     $q$ALTER TABLE invoices ADD CONSTRAINT ck_invoices_month
        CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')$q$),
    ('ck_rooms_sane',
     $q$ALTER TABLE rooms ADD CONSTRAINT ck_rooms_sane
        CHECK (capacity >= 0 AND capacity <= 20 AND monthly_fee >= 0)$q$),
    ('ck_students_deposit',
     $q$ALTER TABLE students ADD CONSTRAINT ck_students_deposit CHECK (deposit_amount >= 0)$q$),
    -- Công-tơ chỉ quay tới: số cuối không nhỏ hơn số đầu
    ('ck_electric_sane',
     $q$ALTER TABLE electric_readings ADD CONSTRAINT ck_electric_sane
        CHECK (reading_start >= 0 AND reading_end >= 0 AND kwh >= 0 AND reading_end >= reading_start)$q$),
    -- Nhiệm kỳ phòng trưởng / lượt ở phòng: ngày kết thúc không thể trước ngày bắt đầu
    ('ck_room_leaders_dates',
     $q$ALTER TABLE room_leaders ADD CONSTRAINT ck_room_leaders_dates CHECK (to_date IS NULL OR to_date >= from_date)$q$),
    ('ck_room_stays_dates',
     $q$ALTER TABLE room_stays ADD CONSTRAINT ck_room_stays_dates CHECK (to_date IS NULL OR to_date >= from_date)$q$)
  ) AS t(ten, sql)
  LOOP
    BEGIN
      EXECUTE r.sql;
      DELETE FROM schema_guard WHERE ten = r.ten;   -- áp được rồi -> xoá cảnh báo cũ (nếu có)
    EXCEPTION
      WHEN duplicate_object OR duplicate_table THEN
        DELETE FROM schema_guard WHERE ten = r.ten; -- đã có sẵn từ trước, bình thường
      WHEN unique_violation THEN
        -- BL-36: TRÙNG DỮ LIỆU ở ràng buộc TÀI CHÍNH → FAIL-CLOSED (dừng boot, buộc dọn trùng).
        -- CHỈ bắt đúng ca trùng (unique_violation khi CREATE UNIQUE INDEX gặp bản trùng) — lỗi TẠM
        -- (timeout/khoá/quyền…) rơi xuống WHEN others (fail-open) để KHÔNG chặn boot nhầm.
        IF r.ten = ANY(critical_names) THEN
          RAISE EXCEPTION 'BL-36: ràng buộc tài chính % KHÔNG áp được vì dữ liệu còn bản trùng (%). Dọn trùng rồi khởi động lại — KHÔNG vận hành app khi thiếu chốt chống thu/xuất phiếu 2 lần.', r.ten, SQLERRM;
        END IF;
        INSERT INTO schema_guard (ten, loi) VALUES (r.ten, SQLERRM)
          ON CONFLICT (ten) DO UPDATE SET loi = EXCLUDED.loi, checked_at = now();
      WHEN others THEN
        -- Lỗi KHÁC (timeout/khoá/quyền…) → fail-open cho MỌI ràng buộc (kể cả tài chính): lỗi tạm
        -- không nên chặn boot; lần khởi động sau thử lại. Giữ nguyên hành vi gốc trước BL-36.
        INSERT INTO schema_guard (ten, loi) VALUES (r.ten, SQLERRM)
          ON CONFLICT (ten) DO UPDATE SET loi = EXCLUDED.loi, checked_at = now();
    END;
  END LOOP;
END
$ktx$;

-- ===== Phòng trưởng =====
-- (Định nghĩa bảng room_leaders + các cột leader_discount/room_discount/room_fee_discount_pct đã được
--  ĐƯA LÊN TRƯỚC khối DO $ktx$ ở trên — xem BLK-7 — để DB mới boot lần đầu áp đủ các ràng buộc
--  tham chiếu chúng. Giữ chú thích ở đây để ai đọc tới phần "Phòng trưởng" vẫn tìm được.)
