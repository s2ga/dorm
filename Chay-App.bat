@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Quan ly Ky tuc xa - DANG CHAY (dung thi dong cua so nay)

echo ============================================
echo   QUAN LY KY TUC XA
echo   Khoi dong CSDL + object storage (Docker)...
echo ============================================

rem Cau hinh nam trong file .env (khong hardcode secret o day).
rem Backing services: Postgres + MinIO qua docker compose.
docker compose up -d
if errorlevel 1 (
  echo.
  echo [LOI] Khong khoi dong duoc Docker. Hay mo Docker Desktop roi chay lai file nay.
  pause
  exit /b 1
)

rem Mo trinh duyet sau 6 giay (khi server da san sang)
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000"

echo   -^> Trinh duyet se tu mo http://localhost:3000
echo   -^> GIU CUA SO NAY MO trong khi dung app. Dong = tat app.
echo.

rem Chay server (doc bien tu .env)
".runtime\node\node.exe" server\index.js

echo.
echo App da dung. Bam phim bat ky de dong.
pause >nul
