@echo off
echo ==========================================
echo Auto-Push: Pushing to Test-Main
echo Time: %date% %time%
echo ==========================================
echo.

cd "C:\Users\TomerLev\Documents\GitHub\Logivice-invoice-progrem-"

REM Check if there are uncommitted changes
for /f %%i in ('git status --porcelain ^| find /c /v ""') do set CHANGES=%%i

if %CHANGES%==0 (
    echo No changes to commit. Skipping auto-push.
    echo.
    echo ==========================================
    echo Auto-Push: Nothing to push (no changes)
    echo ==========================================
    msg * "Logivice: No changes to push today."
    exit /b 0
)

echo Found %CHANGES% changed files.
echo.

REM Get current branch name
for /f "tokens=*" %%a in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%a

REM Check if on Test-Main directly (shouldn't push directly)
if "%CURRENT_BRANCH%"=="Test-Main" (
    echo.
    echo ⚠️  WARNING: You are on Test-Main branch directly!
    echo Please work on a feature branch (feature/tomer-*)
    echo Auto-push cancelled for safety.
    echo.
    msg * "Logivice: Auto-push CANCELLED - you are on Test-Main. Create a feature branch!"
    exit /b 1
)

echo Current branch: %CURRENT_BRANCH%
echo.

REM Step 1: Commit changes with auto-message
echo [1/5] Committing changes...
git add .
git commit -m "Auto-push: %date% %time% - Afimilk updates"

REM Step 2: Pull latest Test-Main
echo [2/5] Pulling latest Test-Main...
git checkout Test-Main
git pull origin Test-Main

REM Step 3: Merge your branch
echo [3/5] Merging your branch: %CURRENT_BRANCH%...
git merge %CURRENT_BRANCH% --no-edit
if errorlevel 1 (
    echo.
    echo ❌ MERGE CONFLICT DETECTED!
    echo Auto-push stopped. Please resolve manually:
    echo    1. Fix the conflicts in the files
    echo    2. Run: git add .
    echo    3. Run: git commit -m "Resolved conflicts"
    echo    4. Run: git push origin Test-Main
    echo.
    msg * "Logivice: Auto-push FAILED - merge conflict! Fix manually."
    exit /b 1
)

REM Step 4: Push to Test-Main
echo [4/5] Pushing to Test-Main...
git push origin Test-Main
if errorlevel 1 (
    echo.
    echo ❌ PUSH FAILED!
    echo Check your internet connection or GitHub status.
    echo.
    msg * "Logivice: Auto-push FAILED - check connection!"
    exit /b 1
)

REM Step 5: Go back to your feature branch
echo [5/5] Returning to your branch: %CURRENT_BRANCH%...
git checkout %CURRENT_BRANCH%

echo.
echo ==========================================
echo ✅ AUTO-PUSH SUCCESSFUL!
echo Deployed to: https://logivice-staging.netlify.app
echo Wait 1 minute, then test Afimilk there.
echo ==========================================

msg * "Logivice: Auto-push complete! Test on staging in 1 minute."
