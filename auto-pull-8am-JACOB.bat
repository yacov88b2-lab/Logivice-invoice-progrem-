@echo off
echo ==========================================
echo Auto-Pull 8AM: Getting latest code from Test-Main
echo User: Jacob
echo Time: %date% %time%
echo ==========================================
echo.

cd "c:\Dev - New\Windsurff invoice\invoice-processor"

REM Stash any uncommitted changes
git stash

REM Switch to Test-Main and pull latest
git checkout Test-Main
git pull origin Test-Main

REM Switch back to your feature branch
git checkout feature/jacob-sensos-qty

REM Merge Test-Main changes into your branch
git merge Test-Main --no-edit

REM Pop stash to restore uncommitted changes
git stash pop

echo.
echo ==========================================
echo Auto-Pull Complete! Latest code merged into your branch.
echo ==========================================

REM Optional: Show notification
msg * "Logivice: Auto-pull complete! Latest code merged into feature/jacob-sensos-qty."
