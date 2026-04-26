@echo off
setlocal

REM Always run from this script's directory
cd /d "%~dp0"

echo ======================================
echo  Commit Changes (Test-Main)
echo ======================================
echo.

set "CURRENT_BRANCH="
git rev-parse --abbrev-ref HEAD > .git-branch-temp.txt 2>nul
set /p CURRENT_BRANCH=<.git-branch-temp.txt
del .git-branch-temp.txt >nul 2>nul

if "%CURRENT_BRANCH%"=="" goto :not_git

echo Detected branch: "%CURRENT_BRANCH%"

if /I "%CURRENT_BRANCH%"=="Test-Main" goto :on_test_main

echo.
echo WARNING: You are on branch "%CURRENT_BRANCH%".
echo This script is intended for committing on Test-Main.
echo.
set "CONTINUE_ANYWAY="
set /p CONTINUE_ANYWAY=Continue anyway? (y/n): 
if /I "%CONTINUE_ANYWAY%"=="y" goto :on_test_main

echo.
echo Cancelled.
echo.
pause
exit /b 0

:not_git
echo ERROR: not a git repository (or git not installed).
echo.
pause
exit /b 1

:on_test_main

echo Current status:
git status --short

echo.
echo Summary of changes (for commit description):
echo --------------------------------------
git diff --name-only
echo.
git diff --stat
echo --------------------------------------

echo.
set "COMMIT_MSG="
set /p COMMIT_MSG=Enter one-line summary (title): 
if "%COMMIT_MSG%"=="" (
  echo.
  echo ERROR: summary cannot be empty.
  pause
  exit /b 1
)

echo.
echo Adding files...
git add -A
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git add failed.
  pause
  exit /b 1
)

git diff --cached --quiet
if %ERRORLEVEL%==0 (
  echo.
  echo ERROR: no staged changes to commit.
  echo.
  pause
  exit /b 1
)

echo.
echo Staged changes summary:
echo --------------------------------------
git diff --cached --name-only
echo.
git diff --cached --stat
echo --------------------------------------

echo.
echo Committing...
set "COMMIT_FILE=.git-commit-msg-temp.txt"
(
  echo %COMMIT_MSG%
  echo.
  echo Files changed:
  git diff --cached --name-only
  echo.
  echo Diffstat:
  git diff --cached --stat
) > "%COMMIT_FILE%"

git commit -F "%COMMIT_FILE%"
del "%COMMIT_FILE%" >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git commit failed.
  pause
  exit /b 1
)

echo.
echo DONE: Commit created.
pause
