@echo off
setlocal enabledelayedexpansion

REM Always run from this script's directory
cd /d "%~dp0"

echo ============================================
echo Logivice Invoice Processor - Start Here
echo ============================================

echo.
echo Choose mode:
echo   [1] Local: runs dev server + opens localhost
echo   [2] Staging: opens staging URL
echo   [3] Production: opens production URL
echo.
set /p MODE=Enter 1, 2, or 3 then press Enter: 

if "%MODE%"=="2" (
  echo.
  echo Opening staging: https://logivice-staging.netlify.app/
  start "" "https://logivice-staging.netlify.app/"
  echo.
  pause
  exit /b 0
)

if "%MODE%"=="3" (
  echo.
  echo Opening production: https://logivice.netlify.app/
  start "" "https://logivice.netlify.app/"
  echo.
  pause
  exit /b 0
)

if not "%MODE%"=="1" (
  echo.
  echo Invalid choice. Please run again and choose 1, 2, or 3.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: npm was not found on PATH.
  echo Install Node.js 18+ from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo node_modules not found - running npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Starting development servers (Vite + Express)...
echo - Frontend: http://localhost:5173
echo - API:      http://localhost:3001
echo.

start "" "http://localhost:5173"

call npm run dev

echo.
echo Server process exited.
pause
