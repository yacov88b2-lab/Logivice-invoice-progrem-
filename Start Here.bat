@echo off
call "%~dp0Start Here Logivice-invoice-program.bat"
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

npm install
