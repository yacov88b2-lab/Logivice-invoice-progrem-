@echo off
echo ==========================================
echo Safe Push to Test-Main (Tomer's Version)
echo ==========================================
echo.

cd "C:\Users\TomerLev\Documents\GitHub\Logivice-invoice-progrem-"

REM Get current branch name
for /f "tokens=*" %%a in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%a

echo Current branch: %CURRENT_BRANCH%
echo.

REM Step 1: Stash any uncommitted changes
echo [1/5] Stashing uncommitted changes...
git stash

REM Step 2: Pull latest Test-Main
echo [2/5] Pulling latest Test-Main...
git checkout Test-Main
git pull origin Test-Main

REM Step 3: Merge your branch
echo [3/5] Merging your branch: %CURRENT_BRANCH%...
git merge %CURRENT_BRANCH% --no-edit
if errorlevel 1 (
    echo.
    echo ❌ MERGE CONFLICT! Resolve manually:
    echo    1. Fix conflicts in files
    echo    2. git add .
    echo    3. git commit -m "Resolved conflicts"
    echo    4. Run this script again
    pause
    exit /b 1
)

REM Step 4: Push to Test-Main
echo [4/5] Pushing to Test-Main (auto-deploys to staging)...
git push origin Test-Main

REM Step 5: Pop stash
echo [5/5] Restoring uncommitted changes...
git stash pop

echo.
echo ==========================================
echo ✅ SUCCESS! Deployed to staging.
echo Test here: https://logivice-staging.netlify.app
echo ==========================================
pause
