@echo off
cd /d "%~dp0"
where node >nul 2>nul && (node serve.mjs 8080 & goto :eof)
where python >nul 2>nul && (start "" http://localhost:8080/ & python -m http.server 8080 & goto :eof)
echo Install Node.js or Python to run the local server.
pause
