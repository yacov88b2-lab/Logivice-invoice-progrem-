@echo off
setlocal enabledelayedexpansion

REM Always run from this script's directory
cd /d "%~dp0"

echo ============================================
echo Logivice Invoice Processor - Start Here
echo ============================================

echo.
echo Staging environment only
echo - Frontend: https://logivice-staging.netlify.app/
echo - Backend:  https://logivice-api.onrender.com
echo.

echo Opening staging...
start "" "https://logivice-staging.netlify.app/"
echo.
pause
exit /b 0
