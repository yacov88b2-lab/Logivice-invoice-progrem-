@echo off
setlocal

REM Always run from this script's directory
cd /d "%~dp0"

echo ======================================
echo  Push Test-Main (pull then push)
echo ======================================
echo.

for /f "delims=" %%h in ('git config --get core.hooksPath 2^>nul') do set "HOOKS_PATH=%%h"
if /I not "%HOOKS_PATH%"==".githooks" (
  echo WARNING: pre-push hooks are not enabled for this repo.
  echo Run setup-hooks.bat once to enable checks.
  echo.
)

git checkout Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: failed to checkout Test-Main.
  echo.
  pause
  exit /b 1
)

git status --porcelain > .git-status-temp.txt
set /p GIT_STATUS=<.git-status-temp.txt
del .git-status-temp.txt >nul 2>nul

if not "%GIT_STATUS%"=="" (
  echo.
  echo ERROR: you have uncommitted changes. Commit or stash before pushing.
  echo.
  git status --short
  echo.
  pause
  exit /b 1
)

echo Branch status (ahead/behind):
git status -sb
echo.

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
