@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Slide Map - 2/2 실행
echo ============================================
echo.
tasklist /FI "IMAGENAME eq POWERPNT.EXE" | find /I "POWERPNT.EXE" >nul
if not errorlevel 1 (
  echo.
  echo  [중단] PowerPoint 가 실행 중입니다. 저장하고 완전히 닫은 뒤 다시 실행하세요.
  echo         ^(실행 중에 캐시를 지우면 애드인 등록이 꼬일 수 있습니다^)
  pause
  exit /b 1
)
echo.
echo [1/3] Office 애드인 캐시 비우기
rem --- Wef 폴더 전체를 지우면 webview2 사용자 데이터(저장된 VWorld 키 등)까지 사라진다 → 캐시 하위 폴더만 삭제 ---
set "WEF=%LOCALAPPDATA%\Microsoft\Office\16.0\Wef"
if exist "%WEF%" (
  for %%D in (AddinInfo AggregatedCache AppCommands) do (
    if exist "%WEF%\%%D" rmdir /s /q "%WEF%\%%D"
  )
  for /d %%G in ("%WEF%\{*}") do rmdir /s /q "%%G"
  echo      캐시 삭제 완료 ^(webview2 사용자 데이터는 유지^)
) else (
  echo      캐시 없음
)
echo.
echo [2/3] 개발자 애드인으로 등록 (레지스트리)
rem --- 예전 v1 지도 박스 애드인이 등록돼 있으면 조용히 해제 (D-042) ---
reg delete "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v bd8deeef-efd4-492e-bdcf-49bafcec8d9f /f >nul 2>nul
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
