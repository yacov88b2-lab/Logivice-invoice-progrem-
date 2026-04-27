@echo off
echo ==========================================
echo Push to Staging (Test-Main Branch)
echo ==========================================
echo.

cd "c:\Dev - New\Windsurff invoice\invoice-processor"

echo Step 1: Committing changes...
git add .
git commit -m "Update: %date% %time%"

echo.
echo Step 2: Pushing to Test-Main (Auto-Deploys to Staging)...
git push origin Test-Main

echo.
echo ==========================================
echo DONE! Wait 1-2 minutes, then test:
echo https://logivice-staging.netlify.app
echo ==========================================
pause
