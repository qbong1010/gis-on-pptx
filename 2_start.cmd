@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Slide Map - 2/2 실행
echo ============================================
echo.
echo [!] PowerPoint 를 모두 닫은 상태에서 진행하세요.
tasklist /FI "IMAGENAME eq POWERPNT.EXE" | find /I "POWERPNT.EXE" >nul
if not errorlevel 1 (
  echo     지금 PowerPoint 가 실행 중입니다. 저장 후 닫고 아무 키나 누르세요.
  pause
)
echo.
echo [1/3] Office 애드인 캐시 비우기
if exist "%LOCALAPPDATA%\Microsoft\Office\16.0\Wef" (
  rmdir /s /q "%LOCALAPPDATA%\Microsoft\Office\16.0\Wef"
  echo      삭제 완료
) else (
  echo      캐시 없음
)
echo.
echo [2/3] 개발자 애드인으로 등록 (레지스트리)
rem --- 레거시 지도 박스(manifest.xml)가 등록돼 있으면 조용히 해제 ---
call npm run unregister:legacy >nul 2>nul
call npm run register
call npm run registered
call npm run nodebug
echo.
echo [3/3] HTTPS dev 서버 시작 (https://localhost:3000)
rem --- 이전에 실행된 dev 서버(node)가 3000 포트를 잡고 있으면 종료 ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  tasklist /FI "PID eq %%p" | find /I "node.exe" >nul
  if not errorlevel 1 (
    echo      이전 dev 서버 종료 ^(PID %%p^)
    taskkill /PID %%p /F >nul 2>nul
  ) else (
    echo      [경고] 3000 포트를 node 가 아닌 프로그램^(PID %%p^)이 사용 중입니다. 직접 종료하세요.
  )
)
echo.
echo  ---------------------------------------------------------
echo   이제 PowerPoint 를 직접 열고 [새 프레젠테이션] 에서:
echo   1) 홈 탭 오른쪽 [Slide Map 패널] 버튼 -^> 우측 패널
echo   2) 패널의 [+ 지도 추가] -^> 슬라이드에 지도가 들어갑니다
echo   ※ 이 창은 dev 서버입니다. 작업하는 동안 닫지 마세요.
echo  ---------------------------------------------------------
echo.
call npm run dev
pause
