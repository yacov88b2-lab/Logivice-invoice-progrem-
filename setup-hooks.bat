@echo off
setlocal

REM Always run from this script's directory
cd /d "%~dp0"

echo ======================================
echo  Setup Git Hooks (.githooks)
echo ======================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: git was not found on PATH.
  echo Install Git for Windows and try again.
  echo.
  pause
  exit /b 1
)

if not exist ".githooks\pre-push" (
  echo ERROR: .githooks\pre-push not found.
  echo.
  pause
  exit /b 1
)

echo Configuring this repo to use .githooks...
git config core.hooksPath .githooks
if errorlevel 1 (
  echo.
  echo ERROR: failed to set core.hooksPath.
  echo.
  pause
  exit /b 1
)

echo.
echo DONE: Git hooks enabled for this repository.
echo.
echo From now on, pushes will run .githooks\pre-push checks automatically.
echo.
pause
