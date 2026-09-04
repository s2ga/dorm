#!/usr/bin/env bash
# BL-42: chạy test DOM (Playwright) qua Docker — KHÔNG cần Node/Playwright cài trên máy.
# Cần: app đang chạy; đặt TEST_ADMIN_PASS (mật khẩu admin). TEST_BASE mặc định host.docker.internal:3000.
# Windows (Git Bash): chạy kèm  MSYS_NO_PATHCONV=1  và dùng  $(pwd -W)  cho mount (xem README).
set -euo pipefail

IMG="mcr.microsoft.com/playwright:v1.46.1-jammy"   # pin: khớp browser trong image với playwright@$PWV
PWV="1.46.1"

: "${TEST_ADMIN_PASS:?Đặt TEST_ADMIN_PASS (mật khẩu admin) qua biến môi trường}"
BASE="${TEST_BASE:-http://host.docker.internal:3000}"
MOUNT="${DOM_MOUNT:-$(pwd)}"   # trên Windows Git Bash: DOM_MOUNT="$(pwd -W)"

docker run --rm --add-host=host.docker.internal:host-gateway \
  -v "$MOUNT:/work" -w /work \
  -e TEST_BASE="$BASE" \
  -e TEST_ADMIN_USER="${TEST_ADMIN_USER:-admin}" \
  -e TEST_ADMIN_PASS="$TEST_ADMIN_PASS" \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  "$IMG" \
  bash -c "cd /tmp && npm init -y >/dev/null 2>&1 && npm install playwright@$PWV >/dev/null 2>&1 && cd /work && NODE_PATH=/tmp/node_modules node tests/dom/smoke.cjs"
