# Slide Map — PowerPoint 콘텐츠 애드인 MVP

> 작업 이력: `docs/DEVLOG.md` · 의사결정: `docs/DECISIONS.md` · 작업 규칙: `CLAUDE.md`
>
> 지원 형식: GeoJSON, SHP(.zip 또는 .shp+.dbf+.prj 함께) — 한국 좌표계(5186/5174/5179 등) 자동 변환

슬라이드 본문 위에 지도 박스를 띄워 패닝/줌 → GeoJSON 올리기 → PPT 도형으로 정착(Bake)하는 콘텐츠 애드인.

## 0. 준비
- Node.js 20+ (22 권장)
- Windows PowerPoint (Microsoft 365) 또는 PowerPoint on the web

## 1. 설치 & 실행 (Step 1)

```bash
npm install
npm run certs        # 최초 1회: localhost HTTPS 인증서 생성 + 신뢰 등록 (Windows는 보안 경고 '예')
npm run dev          # https://localhost:3000 에서 서빙
```

브라우저에서 https://localhost:3000 을 열면 "브라우저(Office 아님)" 상태로 점검 화면이 보인다. → 서버 OK.

## 2. PowerPoint에 사이드로드

### A. Windows 데스크톱 (권장)
```bash
npm run sideload       # dev 서버 실행 + manifest 등록 + PowerPoint 실행
```
PowerPoint가 열리면: **삽입 → 추가 기능 가져오기(또는 내 추가 기능) → 개발자 추가 기능 → Slide Map**
→ 슬라이드 위에 800×450 박스로 삽입된다.

종료/등록 해제: `npm run sideload:stop`

### B. PowerPoint on the web
`npm run dev` 실행 상태에서 → **삽입 → 추가 기능 → 내 추가 기능 관리 → 내 추가 기능 업로드 → manifest.xml**

### C. Mac
`manifest.xml` 을 `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/` 에 복사 후 PowerPoint 재시작
→ 삽입 → 추가 기능 → 내 추가 기능 → Slide Map

## 3. Step 1 완료 기준
점검 화면에서
- `PowerPoint ContentApp 로드` = 지원
- `ImageCoercion 1.2 (SVG 삽입)` = 지원
- [테스트 SVG 슬라이드에 삽입] 클릭 → 슬라이드에 주황 폴리곤 SVG가 생기면 Bake 파이프라인 끝단까지 연결된 것.

## 트러블슈팅
- 박스가 하얗게만 뜸 → `npm run dev` 가 떠 있는지, https://localhost:3000 이 브라우저에서 인증서 경고 없이 열리는지 확인
- 매니페스트 수정 후 반영 안 됨 → `npm run sideload:stop` 후 Office 캐시 삭제
  (`%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\` 폴더 삭제) → 다시 `npm run sideload`
- 포트 변경 시 `vite.config.ts` 와 `manifest.xml` 의 3000 을 함께 바꿀 것
