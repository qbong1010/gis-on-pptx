@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Slide Map - 1/2 설치 (npm install + 인증서)
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js 가 없습니다. https://nodejs.org 에서 LTS 설치 후 다시 실행하세요.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo Node %%v
echo.
echo [1/2] 패키지 설치 중... (1~3분)
call npm install
if errorlevel 1 (
  echo [오류] npm install 실패. 위 메시지를 확인하세요.
  pause
  exit /b 1
)
echo.
echo [2/2] localhost HTTPS 인증서 설치 중...
echo      ※ "보안 경고 - 인증서를 설치하시겠습니까?" 창이 뜨면 [예] 를 눌러주세요.
call npm run certs
if errorlevel 1 (
  echo [오류] 인증서 설치 실패.
  pause
  exit /b 1
)
echo.
echo 설치 완료! 이제 2_start.cmd 를 실행하세요.
pause
