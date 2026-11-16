# Slide Map 설치 (PC 당 1번, Node.js 불필요) — D-032
#  - 배포 주소의 manifest.xml 을 %LOCALAPPDATA%\SlideMap 에 내려받아 PowerPoint 개발자 애드인으로 등록한다.
#  - 관리자 권한 불필요 (HKCU 레지스트리만 사용).
param(
  [string]$ManifestUrl = "",
  [string]$ManifestPath = ""
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dir = Join-Path $env:LOCALAPPDATA "SlideMap"
New-Item -ItemType Directory -Force $dir | Out-Null
$dest = Join-Path $dir "manifest.xml"

if ($ManifestPath -ne "") {
  Copy-Item $ManifestPath $dest -Force
} elseif ($ManifestUrl -ne "") {
  Invoke-WebRequest -UseBasicParsing $ManifestUrl -OutFile $dest
} else {
  Write-Host "사용법: install-addin.cmd https://배포주소/manifest.xml" ; exit 1
}

[xml]$m = Get-Content $dest -Encoding UTF8
$id = $m.OfficeApp.Id
if (-not $id) { throw "매니페스트에서 Id 를 찾지 못했습니다." }

$key = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name $id -Value $dest -PropertyType String -Force | Out-Null

# 오래된 애드인 캐시 비우기 (PowerPoint 가 꺼져 있을 때만)
if (-not (Get-Process POWERPNT -ErrorAction SilentlyContinue)) {
  $wef = Join-Path $env:LOCALAPPDATA "Microsoft\Office\16.0\Wef"
  if (Test-Path $wef) { Remove-Item $wef -Recurse -Force -ErrorAction SilentlyContinue }
}
Write-Host "설치 완료: $dest (Id $id)"
Write-Host "PowerPoint 를 다시 열면 [홈] 탭 오른쪽에 [Slide Map] 버튼이 생깁니다."
