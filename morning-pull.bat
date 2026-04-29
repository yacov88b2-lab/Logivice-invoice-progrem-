@echo off
setlocal

REM Always run from this script's directory
cd /d "%~dp0"

echo ========================================
echo   Morning Pull (feature/tomer)
echo   Merges origin/Test-Main into feature/tomer
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
  echo Commit or stash before running morning pull.
  echo.
  git status --short
  echo.
  pause
  exit /b 1
)

echo Checking out feature/tomer...
git checkout feature/tomer
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: failed to checkout feature/tomer.
  echo.
  pause
  exit /b 1
)

echo.
echo Fetching origin...
git fetch origin
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git fetch failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Merging origin/Test-Main into feature/tomer...
git merge origin/Test-Main
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: merge failed (possible conflict).
  echo Resolve conflicts, then run morning-pull.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo DONE: feature/tomer is up to date with origin/Test-Main.
pause
