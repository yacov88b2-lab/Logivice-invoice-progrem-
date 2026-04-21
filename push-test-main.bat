@echo off
setlocal

REM Always run from this script's directory
cd /d "%~dp0"

echo ======================================
echo  Push Test-Main (pull then push)
echo ======================================
echo.

git checkout Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: failed to checkout Test-Main.
  echo.
  pause
  exit /b 1
)

echo Pulling latest from origin/Test-Main...
git pull origin Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git pull failed. Resolve conflicts then run again.
  echo.
  pause
  exit /b 1
)

echo.
echo Pushing to origin/Test-Main...
git push origin Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git push failed.
  echo.
  pause
  exit /b 1
)

echo.
echo DONE: Test-Main pushed successfully.
pause
