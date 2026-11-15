@echo off
REM Starts the college server. Keep this window open while people use the portal.
cd /d "%~dp0backend"
echo Portal is starting on port 3000...
echo Open http://localhost:3000 on this PC, or http://THIS-PC-IP:3000 from other devices.
node dist/server.js
pause
