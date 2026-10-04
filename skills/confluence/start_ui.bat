@echo off
cd /d "%~dp0"
echo Starting Local Confluence UI...
start /b node --env-file=.env scripts/serve_ui.cjs
timeout /t 1 > nul
start http://localhost:8080
echo UI started at http://localhost:8080
echo Close this window to stop the server.
pause > nul
