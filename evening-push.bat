@echo off
setlocal

REM Always run from this script's directory
cd /d "%~dp0"

echo ========================================
echo   Evening Push (merge feature/tomer -> Test-Main)
echo   Pushes Test-Main to origin (triggers staging deploy)
echo ========================================
echo.

git rev-parse --is-inside-work-tree >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo ERROR: not a git repository (or git not installed).
  echo.
  pause
  exit /b 1
)

git remote get-url origin >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo ERROR: git remote "origin" not found.
  echo.
  pause
  exit /b 1
)

git diff --quiet
if %ERRORLEVEL% neq 0 (
  echo ERROR: you have uncommitted changes.
  echo Please commit or stash before running evening push.
  echo.
  git status --short
  echo.
  pause
  exit /b 1
)

set "CURRENT_BRANCH="
git rev-parse --abbrev-ref HEAD > .git-branch-temp.txt 2>nul
set /p CURRENT_BRANCH=<.git-branch-temp.txt
del .git-branch-temp.txt >nul 2>nul

if /I not "%CURRENT_BRANCH%"=="feature/tomer" (
  echo ERROR: You must run this from branch "feature/tomer".
  echo Current branch: "%CURRENT_BRANCH%"
  echo.
  pause
  exit /b 1
)

echo Checking out Test-Main...
git checkout Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: failed to checkout Test-Main.
  echo.
  pause
  exit /b 1
)

echo.
echo Pulling latest origin/Test-Main...
git pull origin Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git pull failed.
  echo Resolve conflicts, then run evening-push.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo Merging feature/tomer into Test-Main...
git merge feature/tomer
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: merge failed (possible conflict).
  echo Resolve conflicts, then run evening-push.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo Pushing Test-Main to origin...
git push origin Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git push failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Switching back to feature/tomer...
git checkout feature/tomer
if %ERRORLEVEL% neq 0 (
  echo.
  echo WARNING: pushed successfully, but failed to checkout feature/tomer.
  echo Please switch back manually.
  echo.
  pause
  exit /b 1
)

echo.
echo DONE: Test-Main pushed. Staging deploy should start automatically.
pause
