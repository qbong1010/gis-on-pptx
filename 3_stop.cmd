@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run unregister
reg delete "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v bd8deeef-efd4-492e-bdcf-49bafcec8d9f /f >nul 2>nul
pause
