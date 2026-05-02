@echo off
setlocal enabledelayedexpansion

REM Always run from this script's directory
cd /d "%~dp0"

echo ============================================
echo Logivice Invoice Processor - Start Here
echo ============================================

echo.
echo Staging environment + local work
echo - Frontend: https://logivice-staging.netlify.app/
echo - Backend:  https://logivice-api-production.up.railway.app
echo.

echo Opening staging...
start "" "https://logivice-staging.netlify.app/"
echo.

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

call npm run dev

echo.
echo Server process exited.
pause

exit /b 0
