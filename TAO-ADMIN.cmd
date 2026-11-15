@echo off
chcp 65001 >nul
cd /d "%~dp0BE"
"..\.venv\Scripts\python.exe" create_admin.py
pause
