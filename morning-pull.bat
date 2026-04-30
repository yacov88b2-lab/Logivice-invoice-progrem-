@echo off
echo ==========================================
echo MORNING PULL - Get latest from Test-Main
echo Time: %date% %time%
echo ==========================================
echo.

cd /d "%~dp0"

REM Get current branch
for /f "tokens=*" %%a in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%a
echo Current branch: %BRANCH%
echo.

if "%BRANCH%"=="Test-Main" (
    echo ERROR: You should NOT be on Test-Main directly!
    echo Switch to your feature branch first.
    echo   e.g.: git checkout feature/tomer-afimilk-fix
    echo.
    pause
    exit /b 1
)

REM Step 1: Stash any uncommitted changes
echo [1/4] Saving any uncommitted work...
git stash

REM Step 2: Fetch latest from remote
echo [2/4] Fetching latest changes...
git fetch origin

REM Step 3: Pull latest Test-Main into your branch
echo [3/4] Merging latest Test-Main into %BRANCH%...
git merge origin/Test-Main --no-edit
if errorlevel 1 (
    echo.
    echo *** MERGE CONFLICT! ***
    echo Fix the conflicts, then run:
    echo   git add .
    echo   git commit -m "Resolved merge conflicts"
    echo.
    pause
    exit /b 1
)

REM Step 4: Restore stashed changes
echo [4/4] Restoring your uncommitted work...
git stash pop 2>nul

echo.
echo ==========================================
echo MORNING PULL COMPLETE!
echo You are on branch: %BRANCH%
echo You have the latest code from Test-Main.
echo Start working!
echo ==========================================
echo.
pause
