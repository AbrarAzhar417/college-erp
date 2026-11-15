@echo off
REM Shows the running system to someone outside the college for a demo, over the internet, free.
REM Needs the free "cloudflared" program (https://developers.cloudflare.com/tunnel/downloads/). Start start.bat first.
REM The link it prints (https://something.trycloudflare.com) works while this window is open and changes each time.
REM Use demo data only: anyone with the link can reach the login page.
cloudflared tunnel --url http://localhost:3000
pause
