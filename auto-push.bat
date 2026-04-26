@echo off
echo ========================================
echo   Auto Push to Test-Main - 3:00 PM
echo ========================================
cd /d "c:\Dev - New\Windsurff invoice\invoice-processor"

git add -A
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo No changes to push. Already up to date.
    exit /b 0
)

set TIMESTAMP=%date:~6,4%-%date:~3,2%-%date:~0,2% %time:~0,5%
git commit -m "Daily auto-push: %TIMESTAMP%"
git push origin Test-Main
if %errorlevel% neq 0 (
    echo ERROR: Push failed! Please resolve manually.
    pause
    exit /b 1
)
echo.
echo Done! Changes pushed to Test-Main.
