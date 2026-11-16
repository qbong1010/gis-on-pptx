@echo off
chcp 65001 >nul
rem 사용법: install-addin.cmd https://배포주소/manifest.xml
rem   또는  install-addin.cmd C:\경로\manifest.xml
set ARG=%~1
if "%ARG%"=="" (
  echo 사용법: install-addin.cmd https://배포주소/manifest.xml
  pause
  exit /b 1
)
echo %ARG% | findstr /B /I "http" >nul
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-addin.ps1" -ManifestPath "%ARG%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-addin.ps1" -ManifestUrl "%ARG%"
)
pause
