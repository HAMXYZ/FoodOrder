@echo off
chcp 65001 >nul
cd /d "%~dp0FE"
call npm run start -- --hostname 127.0.0.1 --port 3001
pause
