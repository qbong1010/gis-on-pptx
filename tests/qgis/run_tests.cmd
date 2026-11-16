@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
call "C:\Program Files\QGIS 3.34.10\bin\python-qgis-ltr.bat" "%~dp0test_bridge.py"
