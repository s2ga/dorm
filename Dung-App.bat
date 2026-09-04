@echo off
chcp 65001 >nul
title Dung app Quan ly Ky tuc xa
taskkill /f /im node.exe >nul 2>&1
echo Da dung app Quan ly Ky tuc xa.
timeout /t 2 >nul
