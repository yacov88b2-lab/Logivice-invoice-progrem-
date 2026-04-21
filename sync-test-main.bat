@echo off
setlocal

REM Always run from this script's directory
cd /d "%~dp0"

echo ======================================
echo  Sync Test-Main (checkout + pull)
echo ======================================
echo.

git fetch origin
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git fetch failed.
  echo.
  pause
  exit /b 1
)

git checkout Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: failed to checkout Test-Main.
  echo.
  pause
  exit /b 1
)

git pull origin Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git pull failed. Resolve issues then run again.
  echo.
  pause
  exit /b 1
)

echo.
echo DONE: Your local Test-Main is up to date.
pause
