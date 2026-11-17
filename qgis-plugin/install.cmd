@echo off
chcp 65001 >nul
setlocal
rem Slide Map Bridge 플러그인을 QGIS 기본 프로필에 복사한다 (파일 복사만 수행).
set "SRC=%~dp0slide_map_bridge"
if "%~1"=="" (
  set "DEST=%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\slide_map_bridge"
) else (
  set "DEST=%~1\python\plugins\slide_map_bridge"
)
echo SRC : %SRC%
echo DEST: %DEST%
if not exist "%DEST%" mkdir "%DEST%"
robocopy "%SRC%" "%DEST%" /MIR /XD __pycache__ /XF *.pyc /NFL /NDL /NJH /NJS /NP
rem robocopy 종료 코드 7 이하는 성공
if %ERRORLEVEL% GEQ 8 (
  echo [오류] 복사 실패 - 코드 %ERRORLEVEL%
  exit /b 1
)
echo.
rem 안내문은 cmd 가 UTF-8 한글 줄을 잘못 읽는 문제를 피하려고 별도 파일로 출력한다
type "%~dp0install-message.txt"
exit /b 0
