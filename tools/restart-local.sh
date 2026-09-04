#!/bin/sh
# Khởi động lại server local. LUÔN chạy cái này sau khi sửa code server, TRƯỚC khi test —
# nếu không thì server vẫn chạy code cũ và kết quả test là kết quả của bản chưa sửa.
powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
sleep 2
cd /c/Users/thuyhien/quan-ly-ktx
nohup ./.runtime/node/node.exe --env-file=.env server/index.js > /tmp/srv.log 2>&1 &
sleep 5
if grep -qiE "^Error|EADDRINUSE" /tmp/srv.log; then echo "❌ SERVER KHÔNG LÊN:"; grep -iE "^Error|EADDRINUSE" /tmp/srv.log | head -3; exit 1; fi
curl -s -o /dev/null -w "✅ server v73 đã lên (HTTP %{http_code})\n" http://localhost:3000/api/public/stats
