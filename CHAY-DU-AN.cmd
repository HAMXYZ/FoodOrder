@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "FoodOrder Backend" cmd /c ""%~dp0CHAY-BACKEND.cmd""
start "FoodOrder Frontend" cmd /c ""%~dp0CHAY-FRONTEND.cmd""
echo Mở http://127.0.0.1:3001 sau khi hai cửa sổ báo đã sẵn sàng.
echo Nếu cổng đang được dùng bởi FoodOrder, không mở thêm lần nữa.
pause
