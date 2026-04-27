@echo off
echo ==========================================
echo Auto-Pull: Getting latest code from Test-Main
echo Time: %date% %time%
echo ==========================================
echo.

cd "C:\Users\TomerLev\Documents\GitHub\Logivice-invoice-progrem-"

REM Stash any uncommitted changes
git stash

REM Switch to Test-Main and pull latest
git checkout Test-Main
git pull origin Test-Main

REM Pop stash to restore uncommitted changes
git stash pop

echo.
echo ==========================================
echo Auto-Pull Complete! You have latest code.
echo ==========================================

REM Optional: Show notification
msg * "Logivice: Auto-pull complete! Latest code downloaded."
