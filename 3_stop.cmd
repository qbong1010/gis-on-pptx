@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run unregister
call npm run unregister:legacy >nul 2>nul
pause
