@echo off
echo ========================================
echo   Auto Pull from Test-Main - 8:00 AM
echo ========================================
cd /d "c:\Dev - New\Windsurff invoice\invoice-processor"
echo Pulling latest from Test-Main...
git pull origin Test-Main
if %errorlevel% neq 0 (
    echo ERROR: Pull failed! Please resolve manually.
    pause
    exit /b 1
)
echo.
echo Done! You are up to date with Test-Main.
echo Starting dev server...
start cmd /k "npm run dev"
