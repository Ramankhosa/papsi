@echo off
echo Waiting 40 seconds for server to fully start...
timeout /t 40 /nobreak >nul
echo Checking server status...
node check-server.js
if %errorlevel% equ 0 (
    echo Server is running, running test...
    node test-new-novelty-search-pipeline.js
) else (
    echo Server not running, exiting...
)















