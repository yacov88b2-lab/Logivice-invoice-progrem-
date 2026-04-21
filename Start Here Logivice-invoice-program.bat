@echo off
setlocal enabledelayedexpansion

REM Always run from this script's directory
cd /d "%~dp0"

echo ============================================
echo Logivice Invoice Processor - Start Here
echo ============================================

set STAGING_URL=https://logivice-staging.netlify.app
set PRODUCTION_URL=https://logivice-prod.netlify.app

echo.
echo Choose what to open:
echo   [1] Local (dev) - http://localhost:5173
echo   [2] Staging     - %STAGING_URL%
echo   [3] Production  - %PRODUCTION_URL%
echo.
set /p TARGET_CHOICE=Enter 1, 2, or 3 then press ENTER: 

if "%TARGET_CHOICE%"=="2" (
  start "" "%STAGING_URL%"
  exit /b 0
)

if "%TARGET_CHOICE%"=="3" (
  start "" "%PRODUCTION_URL%"
  exit /b 0
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
