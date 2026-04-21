@echo off
REM One-command push to Test-Main
cd /d "%~dp0"

echo ======================================
echo  Push to Test-Main Automation
echo ======================================
echo.

REM Fetch latest
echo 📥 Fetching latest from origin...
git fetch origin

REM Checkout Test-Main
echo 🔄 Switching to Test-Main branch...
git checkout Test-Main
if %ERRORLEVEL% neq 0 (
    echo ❌ Failed to checkout Test-Main
    pause
    exit /b 1
)

REM Pull latest changes
echo 📥 Pulling latest Test-Main changes...
git pull origin Test-Main

REM Check for local changes
git status --short > .git-status-temp.txt
set /p GIT_STATUS=<.git-status-temp.txt
del .git-status-temp.txt

if "%GIT_STATUS%"=="" (
    echo.
    echo ✅ No local changes to commit
    echo ℹ️  You're up to date with origin/Test-Main
    pause
    exit /b 0
)

REM Show status
echo.
echo 📋 Changes detected:
git status --short
echo.

REM Add all changes
echo ➕ Adding all changes...
git add .

REM Commit with timestamp
echo 💾 Committing changes...
set COMMIT_MSG=Auto-commit: %date% %time%
git commit -m "%COMMIT_MSG%"
if %ERRORLEVEL% neq 0 (
    echo ❌ Commit failed
    pause
    exit /b 1
)

REM Push to origin
echo 🚀 Pushing to origin/Test-Main...
git push origin Test-Main
if %ERRORLEVEL% neq 0 (
    echo ❌ Push failed. Try resolving conflicts manually
    pause
    exit /b 1
)

echo.
echo ======================================
echo ✅ SUCCESS! Changes pushed to Test-Main
echo ======================================
pause
