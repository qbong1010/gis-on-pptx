# 실제 QGIS GUI(임시 프로필)에서 플러그인 스모크 테스트 실행. 결과: out/gui_smoke.json + 스크린샷
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:SMB_ROOT = (Resolve-Path (Join-Path $here '..\..')).Path
$pp = Join-Path $env:TEMP 'smb_profile'
New-Item -ItemType Directory -Force $pp | Out-Null
$json = Join-Path $here 'out\gui_smoke.json'
Remove-Item $json -ErrorAction SilentlyContinue
Start-Process -FilePath cmd.exe -ArgumentList '/c', '"C:\Program Files\QGIS 3.34.10\bin\qgis-ltr.bat"', '--nologo', '--noplugins', '--profiles-path', $pp, '--code', (Join-Path $here 'gui_smoke.py') | Out-Null
for ($i = 0; $i -lt 60 -and -not (Test-Path $json); $i++) { Start-Sleep 3 }
Get-Content $json -Encoding UTF8
