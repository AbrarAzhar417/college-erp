@echo off
REM One-time setup on the college server PC (needs Node.js 22 LTS installed from nodejs.org)
echo === Installing backend ===
cd /d "%~dp0backend"
call npm install || goto :fail
echo === Installing and building frontend ===
cd /d "%~dp0frontend"
call npm install || goto :fail
call npm run build || goto :fail
echo === Building backend ===
cd /d "%~dp0backend"
call npm run build || goto :fail
echo.
echo Setup finished. Now double-click start.bat
pause
exit /b 0
:fail
echo.
echo Setup failed. Take a screenshot of the error and send it to your developer.
pause
exit /b 1
