@echo off
echo ==========================================
echo EVENING PUSH - Push your work to Test-Main
echo Time: %date% %time%
echo ==========================================
echo.

cd /d "c:\Dev - New\Windsurff invoice\invoice-processor"

REM Get current branch
for /f "tokens=*" %%a in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%a
echo Current branch: %BRANCH%
echo.

if "%BRANCH%"=="Test-Main" (
    echo ERROR: You should NOT be on Test-Main directly!
    echo Switch to your feature branch first:
    echo   Jacob: git checkout feature/jacob-sensos-qty
    echo   Tomer: git checkout feature/tomer
    echo.
    pause
    exit /b 1
)

if "%BRANCH%"=="main" (
    echo ERROR: You should NOT be on main!
    echo Switch to your feature branch first.
    echo.
    pause
    exit /b 1
)

REM Step 1: Check for uncommitted changes
for /f %%i in ('git status --porcelain ^| find /c /v ""') do set CHANGES=%%i

if %CHANGES%==0 (
    echo No changes to commit. Nothing to push.
    echo.
    pause
    exit /b 0
)

echo Found %CHANGES% changed files.
echo.

REM Step 2: Commit changes on your feature branch
echo [1/6] Committing changes on %BRANCH%...
git add .
git commit -m "Daily push: %date% - %BRANCH%"

REM Step 3: Push your feature branch
echo [2/6] Pushing %BRANCH% to remote...
git push origin %BRANCH%

REM Step 4: Switch to Test-Main and pull latest
echo [3/6] Switching to Test-Main...
git checkout Test-Main
git pull origin Test-Main

REM Step 5: Merge your branch into Test-Main
echo [4/6] Merging %BRANCH% into Test-Main...
git merge %BRANCH% --no-edit
if errorlevel 1 (
    echo.
    echo *** MERGE CONFLICT! ***
    echo Fix the conflicts in the files, then run:
    echo   git add .
    echo   git commit -m "Resolved merge conflicts"
    echo   git push origin Test-Main
    echo   git checkout %BRANCH%
    echo.
    pause
    exit /b 1
)

REM Step 6: Push Test-Main and go back to your branch
echo [5/6] Pushing Test-Main...
git push origin Test-Main

echo [6/6] Switching back to %BRANCH%...
git checkout %BRANCH%

echo.
echo ==========================================
echo EVENING PUSH COMPLETE!
echo Your code is now on Test-Main.
echo Railway + Netlify will auto-deploy.
echo You are back on: %BRANCH%
echo ==========================================
echo.
pause
