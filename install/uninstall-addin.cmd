@echo off
chcp 65001 >nul
rem Slide Map 배포판 제거 (개발용 등록은 3_stop.cmd)
reg delete "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v 8f1c2d7e-5b3a-4c9e-9a61-2d4f7b0c5e13 /f
echo 제거 완료. PowerPoint 를 다시 여세요.
pause
