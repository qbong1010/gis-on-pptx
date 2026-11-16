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
echo 원본: %SRC%
echo 대상: %DEST%
if not exist "%DEST%" mkdir "%DEST%"
robocopy "%SRC%" "%DEST%" /MIR /XD __pycache__ /XF *.pyc /NFL /NDL /NJH /NJS /NP
rem robocopy 종료 코드 7 이하는 성공
if %ERRORLEVEL% GEQ 8 (
  echo [오류] 복사 실패 - 코드 %ERRORLEVEL%
  exit /b 1
)
echo.
echo 설치 완료. QGIS에서 다음을 하세요:
echo   1. QGIS 실행 (이미 켜져 있으면 재시작)
echo   2. 메뉴 플러그인 ^> 플러그인 관리 및 설치 ^> 설치됨
echo   3. "Slide Map Bridge" 체크
echo   4. 메뉴 플러그인 ^> Slide Map ^> 슬라이드 → 조판…
exit /b 0
