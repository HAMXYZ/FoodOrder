@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto install
where py >nul 2>nul
if errorlevel 1 goto usepython
py -3.12 -m venv .venv
if errorlevel 1 goto failed
goto install
:usepython
python -m venv .venv
if errorlevel 1 goto failed
:install
".venv\Scripts\python.exe" -m pip install -r BE\requirements-lock.txt
if errorlevel 1 goto failed
call npm ci --prefix FE
if errorlevel 1 goto failed
call npm run build --prefix FE
if errorlevel 1 goto failed
echo Cài đặt hoàn tất. Chạy TAO-ADMIN.cmd, sau đó CHAY-DU-AN.cmd.
pause
exit /b 0
:failed
echo Chưa cài đặt xong. Kiểm tra Python 3.12, Node.js, kết nối mạng và lỗi bên trên.
pause
exit /b 1
