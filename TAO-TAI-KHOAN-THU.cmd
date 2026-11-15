@echo off
chcp 65001 >nul
cd /d "%~dp0BE"
"..\.venv\Scripts\python.exe" setup_demo_accounts.py
if errorlevel 1 goto end
echo Xem email va mat khau trong BE\.local\TAI-KHOAN-ADMIN-KHACH.txt
:end
pause
