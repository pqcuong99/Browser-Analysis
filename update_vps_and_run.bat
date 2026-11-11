@echo off
REM ======================================================================
REM  SentinelFP - cap nhat va chay ground listener (WRTC_09) tren VPS
REM  Keo code moi nhat tu git, roi chay lai vps\stun-listener.cjs.
REM  Lan dau (chua cai): hoi GROUND_KEY va cai dat day du.
REM  Chuot phai file nay > Run as administrator.
REM ======================================================================
setlocal
cd /d "%~dp0"
title SentinelFP - update VPS listener
set "TASK=SentinelFP Ground Listener"
set "PS=powershell -NoProfile -ExecutionPolicy Bypass -File vps\install.ps1"

net session >nul 2>&1
if errorlevel 1 (
  echo [!] Can quyen Administrator: chuot phai file nay ^> Run as administrator
  goto :fail
)
where git >nul 2>&1
if errorlevel 1 (
  echo [!] Chua cai Git for Windows: https://git-scm.com/download/win
  goto :fail
)
where node >nul 2>&1
if errorlevel 1 (
  echo [!] Khong tim thay Node.js trong PATH
  goto :fail
)

echo.
echo [1/2] Keo code moi nhat tu git...
git pull --ff-only
if errorlevel 1 (
  echo [!] git pull that bai. Thuong do co file bi sua truc tiep tren VPS.
  echo     Xem "git status"; bo thay doi bang "git checkout -- ." roi chay lai.
  goto :fail
)
for /f "delims=" %%L in ('git log -1 --format^="%%h %%s (%%cr)"') do echo       Commit hien tai: %%L

echo.
echo [2/2] Chay listener...
schtasks /query /tn "%TASK%" >nul 2>&1
if errorlevel 1 goto :install

%PS% -Update
if errorlevel 1 goto :fail
goto :done

:install
echo       Listener chua duoc cai tren may nay, cai moi.
echo       GROUND_KEY phai giong trong file .env o may chay SentinelFP.
set "GKEY="
set /p "GKEY=      Nhap GROUND_KEY: "
if not defined GKEY (
  echo [!] Chua nhap GROUND_KEY
  goto :fail
)
set "ALLOW="
set /p "ALLOW=      IP nha ban duoc goi API (Enter de bo qua): "
if defined ALLOW (
  %PS% -Key "%GKEY%" -ApiAllowFrom %ALLOW%
) else (
  %PS% -Key "%GKEY%"
)
if errorlevel 1 goto :fail

:done
echo.
echo ===== XONG. 10 dong log cuoi =====
if exist "C:\sentinelfp-ground\listener.log" powershell -NoProfile -Command "Get-Content 'C:\sentinelfp-ground\listener.log' -Tail 10"
echo.
pause
exit /b 0

:fail
echo.
echo ===== THAT BAI =====
pause
exit /b 1
