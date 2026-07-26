@echo off
REM Double-click entry point for the PurpleInk local development launcher.
REM Keeps this console open so preflight output stays readable after the run.
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" %*
echo.
pause
endlocal
