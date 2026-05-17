@echo off
cd /d "%~dp0"
echo Starting LOGICOM build...
npm run build
if %ERRORLEVEL% equ 0 (
    echo Build successful! Your LOGICOM shortcut on the desktop is now up to date.
) else (
    echo Build failed. Make sure you ran this script as Administrator.
)
pause
