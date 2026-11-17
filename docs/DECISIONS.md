# 의사결정 기록 (Decision Log)

> 규칙
> - 결정은 지우지 않는다. 바뀌면 기존 항목 상태를 **대체됨(Superseded by D-xxx)** 으로 바꾸고 새 항목을 추가한다.
> - 각 항목: 날짜 · 상태 · 맥락 · 결정 · 이유 · 영향/후속.
> - `[확인 필요]` = 실제 PowerPoint 등 실환경에서 아직 검증되지 않은 가정.
> - 상태: 채택 / 대체됨 / 보류 / 폐기

## 요약 표

| ID | 날짜 | 제목 | 상태 |
|---|---|---|---|
| D-001 | 2026-11-17 | 기술 스택 (Vite+React+TS, Tailwind/shadcn, Leaflet, Turf, Office.js) | 채택 |
| D-002 | 2026-11-17 | 콘텐츠 애드인은 `OfficeApp xsi:type="ContentApp"` 으로 정의 | 채택 |
| D-003 | 2026-11-17 | Office.js 는 CDN 로드 + `@types/office-js` | 채택 |
| D-004 | 2026-11-17 | 필수 요구사항은 ImageCoercion 1.1, SVG(1.2)는 런타임 체크 | 채택 |
| D-005 | 2026-11-17 | 개발 HTTPS: office-addin-dev-certs, 포트 3000 고정 | 채택 |
| D-006 | 2026-11-17 | 사이드로드: `office-addin-debugging start` (템플릿 문서) | 대체됨 → D-007 |
| D-007 | 2026-11-17 | 사이드로드: 레지스트리 등록 + 수동 삽입 + 캐시 삭제 + 디버깅 끔 | 채택 |
| D-008 | 2026-11-17 | Windows 실행 스크립트(.cmd)로 설치/실행 | 채택 |
| D-009 | 2026-11-17 | 배경지도 VWorld WMTS, 키는 `.env.local` | 일부 대체 → D-011 |
| D-010 | 2026-11-17 | 지도 박스 하나에 UI 전부 (플로팅 버튼/패널) | 대체됨 → D-011 |
| D-011 | 2026-11-17 | 우측 패널(TaskPane)=관리, 지도 박스(ContentApp)=표현 객체 | 대체됨 → D-029 |
| D-012 | 2026-11-17 | 패널↔지도 통신: BroadcastChannel + localStorage 폴백 | 대체됨 → D-024 |
| D-013 | 2026-11-17 | 지도 박스별 상태는 문서(인스턴스 settings)에 저장, mapId 부여 | 채택 `[확인 필요]` |
| D-014 | 2026-11-17 | 커서: 도형 비대화형 + 표준 커서 + 소프트웨어 십자 커서 | 채택 |
| D-015 | 2026-11-17 | 지도 해상도 배율 = 사용자 정의 CRS(타일 256×배율) | 채택 |
| D-016 | 2026-11-17 | Bake 방향: 도형은 SVG path, 라벨은 PPT 네이티브 텍스트 | 일부 채택 → D-026 (라벨은 스타일 단계) |
| D-017 | 2026-11-17 | WGS84 아닌 좌표는 거부 | 대체됨 → D-019 |
| D-018 | 2026-11-17 | 파일 형식 우선순위: SHP → GPKG → DXF, GDAL WASM 은 보류 | 채택 (GPKG·DXF 구현 → D-033) |
| D-019 | 2026-11-17 | proj4 로 업로드 시 WGS84 자동 재투영 (한국 EPSG 내장 + 수동 지정) | 채택 |
| D-020 | 2026-11-17 | SHP: shpjs, zip/다중파일 둘 다, DBF 인코딩 자동판별(UTF-8→CP949) | 채택 |
| D-021 | 2026-11-17 | 좌표 소수 7자리 반올림 (문서 저장 용량 절감) | 채택 |
| D-022 | 2026-11-17 | 작업/의사결정 기록은 저장소 `docs/` 에 누적 | 채택 |
| D-023 | 2026-11-17 | `2_start.cmd` 가 3000 포트의 이전 node 프로세스를 자동 종료 | 채택 |
| D-024 | 2026-11-17 | 패널↔지도 통신 주 경로 = dev 서버 웹소켓 중계 | 대체됨 → D-029 (레거시 지도 박스 전용) |
| D-025 | 2026-11-17 | 배경지도 타일은 dev 서버 동일 출처 프록시 경유 → 캔버스 캡처 | 채택 (배포 방식 미정) |
| D-026 | 2026-11-17 | Bake = 지도 박스가 SVG+PNG 생성, 패널이 위치 감지 후 삽입 | 대체됨 → D-029 |
| D-027 | 2026-11-17 | 타일 프록시는 hop-by-hop 헤더를 제거해서 전달 (HTTP/2 호환) | 채택 |
| D-028 | 2026-11-17 | Bake SVG 좌표는 반올림 없는 `map.project()` 실수 좌표 사용 | 채택 |
| D-029 | 2026-11-17 | 애드인 1개(작업창)로 통합, 지도 추가는 패널 버튼, 슬라이드 지도 = 태그 붙은 분리 객체 | 채택 |
| D-030 | 2026-11-17 | 선형·텍스트의 PPT 객체화 = 벡터 원천(OSM 벡터타일)→SVG 선 + 네이티브 텍스트, OCR 기각 | 채택 |
| D-031 | 2026-11-17 | 실제 PowerPoint 자동 검증 하네스 (WebView2 원격 디버깅 + 자동 열림 문서 + COM) | 채택 |
| D-032 | 2026-11-17 | 배포 = 정적 호스팅 + PC별 1회 설치 스크립트(HKCU 개발자 애드인 등록), 배포용 Id 분리 | 채택 (호스팅 미실행) |
| D-033 | 2026-11-17 | 가져오기: 웹 워커, 파일 200MB 거부/30MB 경고/정점 30만 경고, GPKG=sql.js, DXF=dxf-parser+자체 HATCH | 채택 |
| D-034 | 2026-11-17 | 반영(v2) 세부: 새 객체 먼저 삽입 후 기존 삭제, 프레임 확대 시 줌 유지, 꾸미기는 위치만 기억 | 채택 |
| D-035 | 2026-11-17 | 레이어 스타일 모델 + 도시계획 프리셋 6종, 꾸미기(방위표 4·축척 3·범례 2) 프리셋 | 채택 |
| D-036 | 2026-11-17 | QGIS 연동 = QGIS 플러그인 + PowerShell COM, 조판은 배경/지도/오버레이 3층, 결과는 PNG 로 슬라이드 프레임에 | 채택 |
| D-037 | 2026-11-17 | 독립 리뷰는 다른 모델(Claude Fable) 새 세션 — Codex 는 계정에서 모델 사용 불가 | 채택 |
| D-038 | 2026-11-17 | 배포 빌드에는 개인 VWorld 키를 넣지 않음 (`VITE_VWORLD_KEY_PUBLIC` 만) | 채택 |

---

## D-001 기술 스택
- 상태: 채택
- 결정: Vite 8 + React 19 + TypeScript 5.9, Tailwind 4 + shadcn/ui(필요 컴포넌트만 직접 작성), Leaflet 1.9 / react-leaflet 5, Turf 7, Office.js.
- 이유: 사용자 지정 스택. TS 는 7(Go 포트) 대신 5.9 로 고정 — 툴체인 호환성.

## D-002 콘텐츠 애드인 매니페스트 형식
- 상태: 채택
- 맥락: 최초 요청은 `<ExtensionPoint xsi:type="ContentApp">`.
- 결정: 루트를 `<OfficeApp xsi:type="ContentApp">` 으로 정의.
- 이유: ExtensionPoint 는 TaskPane 의 리본 명령 구조이며 콘텐츠 애드인 정의 방식이 아님.

## D-003 Office.js 로드 방식
- 상태: 채택
- 결정: `https://appsforoffice.microsoft.com/lib/1/hosted/office.js` CDN, 타입은 `@types/office-js`.
- 이유: 공식 권장. Office 밖(일반 브라우저)에서도 `Office.onReady` 가 resolve 되어 UI 개발 가능.

## D-004 요구사항 집합
- 상태: 채택
- 결정: 매니페스트에는 ImageCoercion 1.1 만 필수. XmlSvg(1.2)는 런타임 `isSetSupported` 후 PNG 폴백.
- 이유: 1.2 를 필수로 걸면 구버전 PowerPoint 에서 애드인 목록에 안 뜸.
- 검증: 사용자 PC(Windows M365)에서 1.1/1.2/PowerPointApi 1.4 모두 지원 확인.

## D-005 개발 HTTPS
- 상태: 채택
- 결정: `office-addin-dev-certs` 의 `getHttpsServerOptions()` 를 vite dev 에서만 사용, `strictPort: 3000`.

## D-006 사이드로드 방식 (최초)
- 상태: **대체됨 → D-007**
- 결정: `office-addin-debugging start manifest.xml desktop --app powerpoint`.
- 대체 사유: 이 명령은 애드인이 미리 박힌 템플릿 pptx 를 열어주는데, 사용자 PC에서 "배포 중에 삽입된 추가 기능만 Visual Studio에서 디버깅하는 중에 사용할 수 있습니다" 오류 발생 (박스가 정사각형 = 템플릿 박스).

## D-007 사이드로드 방식 (현재)
- 상태: 채택
- 결정: `office-addin-dev-settings register` 로 개발자 애드인 레지스트리 등록 → 사용자가 삽입 메뉴에서 직접 삽입. 실행 전 `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef` 캐시 삭제, `debugging --disable` 로 "로드 시 웹 보기 중지" 디버거 팝업 제거.
- 검증: 사용자 PC 에서 정상 로드 확인.

## D-008 Windows 실행 스크립트
- 상태: 채택
- 맥락: Claude 의 셸은 Linux VM 이라 Windows 네이티브 바이너리 설치/인증서 등록/PowerPoint 실행 불가. 터미널 앱은 화면 제어로 타이핑 불가.
- 결정: `1_setup.cmd`(npm install + 인증서), `2_start.cmd`(캐시 삭제·등록·디버깅 끔·dev 서버), `3_stop.cmd`(등록 해제).

## D-009 배경지도
- 상태: 일부 대체 → D-011 (키 관리 위치)
- 결정: VWorld WMTS `https://api.vworld.kr/req/wmts/1.0.0/{key}/{layer}/{z}/{y}/{x}.{ext}` (Base/white/midnight/Satellite+Hybrid) + OSM. 키는 `.env.local` 의 `VITE_VWORLD_KEY`.
- 변경: 키는 이제 패널에서도 저장/전파(localStorage + 메시지), `.env.local` 은 기본값.
- 메모: `crossOrigin` 속성은 VWorld CORS 미확인이라 제거. (이미지 캡처 방식 Bake 를 하게 되면 재검토)

## D-010 단일 콘텐츠 애드인 + 플로팅 UI
- 상태: **대체됨 → D-011**
- 결정: 지도 박스 안에 Bake 버튼·레이어 패널·배경지도 선택을 플로팅으로 배치.
- 대체 사유 (사용자 요청 01:46): 관리는 우측 패널에서, 삽입된 지도는 "표현되는 단일 객체"로 다루는 편이 사용성이 좋음.

## D-011 패널(관리) + 지도 박스(표현) 분리
- 상태: **대체됨 → D-029**
- 대체 사유 (2026-11-17 03:10, 사용자 요청): "작업창 애드인만 있으면 되고 지도 추가는 패널 버튼이 자연스럽다." 2개 애드인은 설치·삽입·통신(중계 서버) 부담이 크고 배포가 어려움.
- 결정: 매니페스트 2개.
  - `manifest.xml` (ContentApp, `index.html`) — 지도만 표시. UI 최소화(줌·축척바·드롭 오버레이).
  - `manifest-taskpane.xml` (TaskPaneApp, `taskpane.html`, 홈 탭 [Slide Map 패널] 버튼) — 지도 목록·레이어·배경지도·해상도 배율·커서·API 키·Bake.
- 영향: 지도 박스 삽입은 여전히 삽입 메뉴로 (Office.js 로 콘텐츠 애드인을 프로그램적으로 삽입하는 API 없음).

## D-012 패널↔지도 통신
- 상태: **대체됨 → D-024**
- 대체 사유 (02:19): 실제 PowerPoint 에서 패널이 지도 박스를 인식하지 못함. 매니페스트 2개 = 애드인 2개라 웹뷰 저장소가 분리된 것으로 판단 (BroadcastChannel/localStorage 모두 불통). 코드에는 브라우저 개발용 보조 경로로 남겨둠.
- 결정: 같은 오리진이므로 BroadcastChannel 과 localStorage `storage` 이벤트로 동시 송신, 메시지 id 로 중복 제거. 지도는 4초마다 상태 하트비트.
- 위험: 두 애드인 웹뷰가 저장소 파티션을 공유하지 않으면 동작 안 함. 패널 상단 "연결된 지도 N" 으로 확인. 실패 시 대안: PowerPoint 문서 태그(PowerPointApi 1.3) 폴링.

## D-013 지도 박스 상태 저장
- 상태: 채택 `[확인 필요]`
- 결정: `Office.context.document.settings` (콘텐츠 애드인은 인스턴스별) 에 mapId·레이어·뷰·설정 저장. 브라우저 개발 모드는 sessionStorage.
- 위험: 박스 복사 시 mapId 중복 가능. 문서 settings 용량 한도 미확인 → 큰 레이어 주의(D-021).

## D-014 커서 보이지 않는 문제
- 상태: 채택
- 결정: GeoJSON 레이어 `interactive: false`, 컨테이너 커서를 crosshair/move 로 고정, 소프트웨어 십자 커서(빨간 점) 기본 표시(패널에서 끄기 가능).

## D-015 지도 해상도 배율 (글자 크기)
- 상태: 채택
- 결정: `L.CRS.EPSG3857` 의 scale 을 `256×배율×2^z` 로 바꾼 사용자 CRS + `tileSize=256×배율`. 배율 변경 시 지상 해상도 유지되도록 줌 보정, `zoomSnap 0.25`.
- 이유: 줌과 무관하게 타일을 그리는 픽셀 크기를 바꿔야 글자 크기만 줄일 수 있음. 2의 거듭제곱 zoomOffset 방식은 단계가 너무 거침.

## D-016 Bake 방향
- 상태: 일부 채택 → D-026 (도형=SVG 적용, 라벨=네이티브 텍스트는 스타일/라벨 단계에서)
- 맥락: Step 1 테스트에서 XmlSvg 삽입 후 그룹 해제 시 텍스트 스타일/위치가 달라짐.
- 방향: 도형은 SVG path 로, 라벨/텍스트는 PowerPoint 네이티브 텍스트 상자로 분리 삽입. 완전 편집형이 필요하면 OOXML custGeom 경로 검토.

## D-017 비 WGS84 좌표 처리 (최초)
- 상태: **대체됨 → D-019**
- 결정: 좌표가 경위도 범위를 벗어나면 에러로 거부하고 QGIS 에서 4326 으로 다시 저장하라고 안내.
- 대체 사유: 공공데이터 SHP 대부분이 TM 좌표 → 업로드 자체가 막힘.

## D-018 파일 형식 확장 우선순위
- 상태: 채택
- 결정: SHP(공공데이터 다수, 사용자 요청) → GPKG → DXF. GDAL WASM(gdal3.js, 약 42MB)은 DXF 수요가 커지면 재검토.

## D-019 좌표 자동 재투영
- 상태: 채택
- 결정: proj4 로 업로드 시점에 WGS84 로 변환. 한국 주요 EPSG(5186/5185/5187/5188/5179/5181/5174 계열/2097/32652/3857/4326/4737) 정의 내장. 감지 순서: 패널에서 수동 지정 > `.prj` 매칭 > GeoJSON `crs` 멤버 > 경위도 범위면 4326 > 실패 시 사용자에게 지정 요청.
- 메모: Bessel(5174 계열/2097) 은 TOWGS84 7변수 포함 정의 사용 `[확인 필요: 실제 연속지적도와 위치 대조]`.

## D-020 SHP 업로드
- 상태: 채택
- 결정: `shpjs` 로 파싱. `.zip`(여러 레이어 가능) 과 `.shp+.dbf+.prj(+.cpg)` 다중 선택/드롭 모두 지원, 파일명(basename) 기준으로 묶음. `.cpg` 없으면 DBF 를 UTF-8 로 읽어 깨지면 CP949(EUC-KR)로 재해석.

## D-021 좌표 정밀도
- 상태: 채택
- 결정: 재투영 후 좌표를 소수 7자리(약 1cm)로 반올림. 문서 settings 저장 용량 절감.

## D-022 기록 방식
- 상태: 채택
- 결정: 저장소 `docs/DEVLOG.md`(작업 이력) 와 `docs/DECISIONS.md`(의사결정) 를 작업할 때마다 갱신. 결정 변경은 기존 항목을 대체됨으로 표시하고 새 항목 추가. `CLAUDE.md` 에 규칙 명시.

## D-023 dev 서버 포트 충돌 자동 정리
- 상태: 채택
- 맥락: 창을 닫아도 vite(node) 프로세스가 남아 재실행 시 `Port 3000 is already in use`. 포트는 manifest 에 고정(D-005)이라 바꿀 수 없음.
- 결정: `2_start.cmd` 시작 시 `netstat` 으로 3000 포트 LISTEN PID 를 찾아 node.exe 이면 `taskkill`, 아니면 경고만.

## D-024 패널↔지도 통신: dev 서버 웹소켓 중계
- 상태: **대체됨 → D-029** (단일 웹뷰라 통신 불필요. 레거시 지도 박스 코드에서만 사용)
- 맥락: D-012 실패. 두 애드인 모두 이미 https://localhost:3000 의 Vite HMR 웹소켓에 접속해 있음.
- 결정: Vite 플러그인이 `slide-map:bus` 커스텀 이벤트를 받아 모든 클라이언트에 재전송, 클라이언트는 `import.meta.hot.send/on`. 기존 BroadcastChannel/localStorage 는 보조로 유지, 메시지 id 로 중복 제거.
- 검토한 대안
  - PowerPoint 문서 태그(PowerPointApi 1.3) 폴링: 순수 클라이언트지만 레이어 데이터(수 MB) 전달에 부적합, 폴링 지연.
  - 통합 매니페스트(JSON, `contentRuntimes`)로 한 애드인으로 합치기: 저장소 공유 가능성 있으나 PowerPoint 지원 범위/사이드로드 방식 재검토 필요 → 배포 단계에서 재검토.
- 영향: 빌드 배포본에서는 `import.meta.hot` 이 없음 → 배포 시 작은 중계 서버(WebSocket) 또는 통합 매니페스트 필요.

## D-025 배경지도 타일 동일 출처 프록시
- 상태: 채택 (배포 방식 미정)
- 맥락: Bake 시 배경지도를 이미지로 넣으려면 캔버스 합성이 필요한데, 다른 출처 타일은 CORS 허용이 없으면 캔버스가 오염됨. VWorld CORS 여부는 네트워크 제한으로 확인 불가.
- 결정: dev 서버 프록시 `/tiles/vworld/*` → `https://api.vworld.kr/req/wmts/1.0.0/*` (Referer: https://localhost:3000/), `/tiles/osm/*` → `https://tile.openstreetmap.org/*`. 지도는 개발 모드에서 프록시 주소 사용.
- 검토한 대안: 화면 캡처(getDisplayMedia) — Office 웹뷰에서 권한/지원 불확실, 사용자 승인 필요 → 제외. html2canvas — 같은 CORS 문제.
- `[확인 필요]` VWorld 가 프록시 경유 요청(Referer 헤더)을 허용하는지 — 타일이 안 보이면 이 항목 재검토.

## D-026 Bake 구조
- 상태: **대체됨 → D-029**
- 대체 사유: 지도가 패널 안에 있으므로 위치 감지(콘텐츠 애드인 도형 추정)가 필요 없어짐. 프레임은 태그로 추적. (D-026 의 SVG/PNG 재료 생성 방식은 계승)
- 결정
  - 지도 박스: 현재 화면 범위로 피처를 bboxClip → Leaflet `latLngToContainerPoint`(해상도 배율 CRS 반영)로 px 좌표 → SVG (텍스트 없음). 배경지도는 로드된 타일 `<img>` 를 실제 화면 위치대로 캔버스에 합성(2배 해상도) → PNG.
  - 패널: 지도 박스 위치를 PowerPointApi 1.5 `getSelectedShapes` → 현재 슬라이드 도형 중 가로세로비 4% 이내 + 알 수 없는 유형 우선으로 추정. 못 찾으면 왼쪽 위(480pt 폭). `setSelectedDataAsync` 로 PNG(Image) → SVG(XmlSvg) 순서 삽입.
- 이유: setSelectedDataAsync 는 패널에서 현재 슬라이드에 삽입 가능, 좌표·크기 지정 가능. 텍스트 제외로 그룹 해제 시 변형 문제 회피.
- 미검증: 콘텐츠 애드인의 Shape 노출 여부/유형, 좌표 단위, SVG clipPath 의 그룹 해제 시 처리.

## D-027 타일 프록시 응답 헤더 정리
- 상태: 채택
- 맥락: D-025 이후 VWorld 배경지도가 안 보임. dev 서버(HTTPS)는 HTTP/2 로 응답하는데 VWorld 응답의 `connection`/`upgrade`/`transfer-encoding` 헤더가 프록시를 통해 그대로 전달 → `ERR_HTTP2_PROTOCOL_ERROR`.
- 결정: `/tiles/*` 프록시의 `proxyRes` 에서 hop-by-hop 헤더(connection, upgrade, keep-alive, proxy-connection, transfer-encoding, te, trailer)와 set-cookie 를 삭제.
- 검토한 대안: dev 서버를 HTTP/1.1 로 강제 — Vite 설정으로 깔끔하게 끄기 어렵고, 다른 업스트림에서도 같은 문제가 재발할 수 있어 헤더 정리가 근본 해결.
- 참고: VWorld 응답에 `access-control-allow-origin: *` 확인 → 배포본은 프록시 없이 직접 CORS 로딩 가능성 (배포 설계 시 반영).

## D-028 Bake SVG 좌표 정밀도
- 상태: 채택
- 맥락: Bake 된 폴리곤의 직선 변이 구불구불. `latLngToContainerPoint` 는 정수 px 로 반올림 → 촘촘한 정점들이 ±0.5px 지그재그.
- 결정: `map.project(latlng, zoom) - pixelOrigin + paneOffset` 으로 실수 px 를 계산(`makeProjector`), SVG 좌표는 소수 2자리.
- 검증: 동일선상 정점 200개 변에서 직선 이탈 0.99px → 0.003px.

## D-029 단일 작업창 애드인 + 태그 기반 슬라이드 지도 객체
- 상태: 채택 — 설계 문서 `docs/ARCHITECTURE.md`
- 맥락: 사용자 요청(지도 추가는 패널 버튼으로). 콘텐츠 애드인은 Office.js 로 프로그램 삽입 불가(유일한 우회는 `insertSlidesFromBase64` 로 **새 슬라이드**를 넣는 것), 두 애드인 통신은 중계 서버 필요(D-024), 배포·다중 PC 설치가 번거로움.
- 결정
  - 매니페스트는 `manifest-taskpane.xml` 하나만 등록. 지도 편집기는 패널 안(슬라이드 프레임과 같은 비율·크기의 가상 지도를 축소 표시 = WYSIWYG).
  - "지도 추가" = MapDoc 생성 + 현재 슬라이드에 배경지도 자리 표시 객체 삽입.
  - 슬라이드의 지도 = 분리된 객체들(배경 PNG, 레이어별 SVG, 네이티브 라벨, 방위표·축척·범례 SVG), 모두 태그 `SLIDEMAP_MAP/PART/VER`.
  - 반영 시 기존 객체를 태그로 찾아 교체, 사용자가 슬라이드에서 바꾼 프레임 크기/위치·꾸미기 위치는 보존.
  - 상태는 작업창 애드인의 문서 settings 에 저장 → pptx 와 함께 이동.
- 실환경 검증 (D-031 하네스, PowerPoint 16.0.20527): PowerPointApi 1.1~1.10 지원. 이미지/SVG 삽입 좌표 정확, 삽입 후 선택은 비어 있음 → **삽입 전후 도형 id 비교**로 새 객체 식별. 태그 쓰기/읽기·그룹 내부 태그 유지, `addTextBox`·글꼴·회전(rotation) 쓰기, `addGroup`, `pageSetup.slideWidth/Height`, `exportAsBase64` 모두 동작 확인.
- 잃는 것: 슬라이드 위에서 지도를 직접 드래그하는 경험. 레거시 지도 박스는 코드에 남김(등록 안 함).

## D-030 지도 선형·텍스트를 PowerPoint 도형/텍스트 상자로
- 상태: 채택
- 질문: 배경지도의 도로·경계선, 지명·도로명을 편집 가능한 PPT 객체로 올릴 수 있나?
- 검토한 접근
  | 접근 | 품질 | 개발 시간 | 판단 |
  |---|---|---|---|
  | A. 래스터 타일 OCR(Tesseract.js kor) → 텍스트 상자 | 낮음: 지도 글자는 9~11px·후광·아이콘 겹침·회전된 도로명 → 오인식/누락, 위치 근사. 모델 10MB+ | 중 | **기각** |
  | B. 래스터 선 벡터화(윤곽 추출) | 매우 낮음: 의미 없는 지글지글한 도형 | 상 | **기각** |
  | C. 벡터 원천 데이터(OpenFreeMap OSM 벡터타일, 키 불필요, CORS 허용, `name:ko` 포함) → 선은 SVG, 글자는 네이티브 텍스트(회전 포함) | 높음: 정확한 위치·실제 이름·스타일 제어 | 중 | **채택** |
  | D. VWorld 2D 데이터 API(WFS: 행정경계·도로·건물) | 높음(공식 데이터) | 중 | 보류 — 요청당 건수 제한·키 필요 `[확인 필요]`, 공식 경계가 필요할 때 추가 |
  | E. 네이티브 자유형 도형 직접 생성 | 최고(즉시 편집) | 상 | 보류 — Office.js 에 자유형 도형 API 없음. `exportAsBase64`→XML 수정→`insertSlidesFromBase64`→원본 삭제 우회는 가능하나 슬라이드 교체(애니메이션·메모·id) 위험 |
- 결정: C 를 "벡터 배경지도(편집형)" 로 제공. 선은 레이어별 SVG(PowerPoint 에서 우클릭 → **도형으로 변환** 1번이면 자유형 도형), 글자는 처음부터 **네이티브 텍스트 상자**(도로명은 도로 각도로 회전). 래스터 배경과 섞을 땐 라벨 없는 래스터(CARTO light_nolabels)를 권장해 글자가 이중으로 나오지 않게 함.
- 사용자 데이터 레이어도 동일: 도형=SVG, 라벨(속성 필드)=네이티브 텍스트 옵션.
- 후속: E 는 "실험 기능"으로 별도 검증 후 판단. D 는 공식 행정경계 수요 시.

## D-031 실제 PowerPoint 자동 검증 하네스
- 상태: 채택
- 맥락: 지금까지 PowerPoint 동작은 사용자 수동 확인에 의존(`[확인 필요]` 누적).
- 결정: ① 사용자 문서는 먼저 `SaveCopyAs` 로 백업 ② `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9229` 로 PowerPoint 실행 ③ 작업창 자동 열림 문서(office-addin-dev-settings 템플릿의 webextension 참조 id 를 우리 애드인 id 로 치환) 열기 ④ Playwright `connect_over_cdp` 로 작업창 웹뷰 조작 ⑤ COM(`Slide.Export`)으로 슬라이드 PNG 를 떠서 결과 확인.
- 주의: 파이썬 출력은 `PYTHONIOENCODING=utf-8` (아니면 한글이 깨져 보임 — 실제 데이터는 정상).

## D-032 배포·설치 방식 (회사/집 PC 왕복 사용)
- 상태: 채택 (실제 호스팅 업로드는 사용자 계정·VWorld 키 도메인 등록이 필요해 미실행)
- 맥락: 지금은 PC 마다 Node 설치 + `1_setup` + `2_start`(dev 서버 상시 실행) 필요 → 회사·집을 오가며 쓰기 불편. v2(D-029)로 중계 서버가 필요 없어져 **정적 파일만 호스팅**하면 됨.
- 결정
  - `npm run build` 결과(dist)를 정적 호스팅(권장: Cloudflare Pages, 무료)에 올림.
  - `node scripts/make-manifest.mjs https://<주소>` 로 배포용 매니페스트 생성 — Id 를 개발용과 다르게(동시 설치 가능), 표시 이름 "Slide Map".
  - 각 PC 에서 `install\install-addin.cmd https://<주소>/manifest.xml` 1번 실행 → `%LOCALAPPDATA%\SlideMap\manifest.xml` 저장 + `HKCU\...\WEF\Developer` 등록 (관리자 권한·Node 불필요). 코드 업데이트는 호스팅만 갱신하면 모든 PC 에 자동 반영.
  - 지도 상태는 pptx 안(문서 settings)에 있으므로 파일만 옮기면 다른 PC 에서도 이어서 편집.
- 검토한 대안: 공유 폴더 카탈로그(UNC 경로·신뢰 설정 필요, 회사망 의존), M365 관리 센터 중앙 배포(회사 관리자 권한 필요 — 팀 확산 단계에서 권장), AppSource 등록(심사·서비스화 단계).
- 주의: VWorld 키는 서비스 URL(도메인) 단위 → 배포 도메인으로 키 추가 발급 필요 `[확인 필요]`. 배포본은 타일을 직접 CORS 로 받음(VWorld·CARTO·OpenFreeMap 모두 `Access-Control-Allow-Origin: *` 확인).

## D-033 대용량·추가 형식 가져오기
- 상태: 채택
- 결정
  - 파싱·재투영·통계는 **웹 워커**(`src/workers/import.worker.ts`), 실패 시 메인 스레드 폴백. 44MB/160만 정점 GeoJSON: 메인 직접 실행 시 UI 완전 정지 → 워커는 20ms 하트비트 최대 간격 31ms.
  - 용량 타협점: 파일당 **200MB 초과 거부**(WebView 메모리: 파싱·변환에 원본의 5~10배), **30MB 초과 경고**, 정점 **30만 초과 경고**. 문서 저장 시 예산 초과 레이어는 `simplifyForBudget` 으로 단순화본 저장 가능.
  - GPKG: sql.js(wasm) + GeoPackage 바이너리 헤더/WKB 직접 파싱, 좌표계는 EPSG 코드 우선·WKT 폴백.
  - DXF: dxf-parser + 자체 HATCH 핸들러, INSERT 재귀 4단계, 한글 인코딩(코드페이지 949/UTF-8) 처리. 좌표계 정보가 없으므로 수동 지정 필수(경위도 추정은 한국 범위일 때만).
  - DWG 는 미지원(안내 메시지) — 공개 파서 품질·라이선스 문제. QGIS/ODA 변환기로 DXF 저장 권장.
- 검증: GDAL 3.9.2(QGIS 동봉) 변환 결과 대비 최대 오차 GRS80 계열 0.00m, 5174 0.04m.
- 서버 처리(클라우드 변환)는 서비스화 단계 과금 기능으로 분리(`docs/SERVICE_PLAN.md`).

## D-034 반영(Bake v2) 세부 규칙
- 상태: 채택 (실제 PowerPoint 검증 완료)
- 결정: ① 새 객체를 모두 삽입한 뒤 성공하면 기존 객체 삭제(중간 실패 시 새로 넣은 것만 되돌림 → 슬라이드가 반쯤 깨진 상태로 남지 않음) ② 슬라이드에서 배경지도 사각형을 바꾸면 새 프레임으로 채택, 줌은 유지(넓히면 더 넓은 범위) ③ 방위표·축척·범례는 사용자가 옮긴 left/top 만 기억하고 크기는 재계산 ④ 텍스트 상자는 한 번의 `PowerPoint.run` 으로 일괄 생성(벡터 배경 글자 최대 90개) ⑤ 부분 이름: `basemap`, `basemap-label`, `layer:<id>`/`layer:all`, `labels`, `label`, `legend`, `scale`, `north`, `group`, `qgis`.
- 실측: 강남 샘플 3레이어 + 벡터 배경지도 = 객체 41개(지도글자 33개 회전 포함) 정상 삽입, 배경지도를 슬라이드에서 키운 뒤 재반영 시 새 프레임 채택·옮긴 방위표 위치 유지 확인.
- `[확인 필요]`: 묶기(그룹) 상태 지도를 재반영할 때 `ungroup()` 후 자식 태그 보존, 슬라이드에서 지도 객체 클릭 시 패널 자동 선택(`DocumentSelectionChanged`), 문서 settings 실제 용량 한도.

## D-035 레이어 스타일·꾸미기
- 상태: 채택
- 결정: 스타일 단위는 "슬라이드 100% 기준 px"(1pt=4/3px) — 프레임 크기와 무관하게 슬라이드에서 보이는 굵기·글자 크기 고정. 선(색·굵기·투명도·실선/파선/점선/일점쇄선), 면(색·투명도), 점(크기·원/사각/삼각), 속성값별 분류 색, 라벨(필드·크기·색·굵게·후광·네이티브 여부). 도시계획 프리셋 6종(계획구역·대상지·도로·행정경계·녹지·철도). 꾸미기: 방위표 4종(화살표·나침반·N원형·단순) × S/M/L/직접 크기 × 색, 축척 3종(선·막대·1:n 문자, 1·2·5×10ⁿ 반올림), 범례 2종(박스·배경 없음), 위치 = 모서리 + 여백. 미리보기와 SVG 가 같은 `resolveStyle` 결과를 사용.
- SVG 글자 후광은 `paint-order` 대신 흰 외곽선 복사본을 아래에 겹치는 방식(PowerPoint SVG 렌더러 호환).

## D-036 QGIS 연동 워크플로
- 상태: 채택
- 맥락(사용자): QGIS 조판에서 슬라이드 안 지도의 가시성·선 두께·글자 상대 크기·카드 오버레이 여유를 판단하고 결과를 pptx 로 가져가고 싶음. 이상 = pptx 슬라이드를 조판에 그대로 재현, 차선 = 슬라이드를 이미지로 고정해 조판에 넣기.
- 결정: QGIS 플러그인 "Slide Map Bridge"(`qgis-plugin/`)
  1. **슬라이드 → 조판**: 열려 있는 PowerPoint(또는 pptx 파일)의 슬라이드를 골라 슬라이드 크기(mm)의 조판 생성. 아래→위 3층: `슬라이드 배경`(지도 객체를 숨긴 슬라이드 이미지) / `지도`(Slide Map 프레임 위치·크기 그대로) / `슬라이드 오버레이`(프레임보다 z 순서가 위인 카드·제목만, 투명 PNG). → 카드가 지도를 얼마나 가리는지 조판에서 바로 판단.
  2. **조판 → 슬라이드**: 지도 아이템만 300dpi PNG(옵션 SVG)로 내보내 같은 슬라이드의 프레임 위치에 삽입(태그 `SLIDEMAP_PART=qgis`, 같은 조판의 이전 결과 교체, z 는 배경지도 바로 위).
  3. **레이어 보내기**: EPSG:4326 GPKG/GeoJSON → Slide Map 패널로 끌어 넣기.
- 이유: 슬라이드 원본을 QGIS 가 직접 해석(pptx 렌더링)하는 것은 글꼴·도형 렌더 차이가 커서 비현실적 → PowerPoint 자체 렌더(COM Export)를 이미지로 쓰는 것이 "그대로 재현"에 가장 가까움. QGIS 파이썬에 pywin32 가 없으므로 PowerShell 스크립트로 COM 호출(JSON 파일 교환, UTF-8). 투명 오버레이는 PowerPoint PNG 내보내기가 배경을 채우므로 흑/백 배경 2회 내보내기로 알파 복원. 사용자 슬라이드는 작업 후 원상 복구.
- 결과물 형식: 기본 PNG(PowerPoint 렌더 일치), SVG 선택, PDF 미사용(삽입 품질 불안정).
- 검증: 테스트 덱 기준 프레임 오차 ≤0.6pt, 재전송 시 교체, 사용자 슬라이드 원상 복구, QGIS GUI 스모크 10/10.
- 한계: Windows 전용(COM). 조판과 슬라이드 글꼴이 같아야 동일하게 보임.

## D-037 독립 리뷰 방식
- 상태: 채택
- 맥락: 사용자 요청 — 코딩은 Sonnet 에이전트, 피드백은 다른 모델의 다른 세션으로 객관성 확보(필요 시 Codex).
- 결과: Codex CLI 는 이 ChatGPT 계정에서 사용 가능한 모델이 없음(`model_not_found`, 설정 모델 포함 10여 개 시도). → **다른 모델(Claude Fable)** 의 새 세션에 코드만 주고(구현자의 결론은 주지 않음) 리뷰, 재현 가능한 것은 재현하도록 요구. 발견 사항은 Sonnet 수정 에이전트가 고치고 재검증.

## D-038 배포 번들의 VWorld 키
- 상태: 채택
- 맥락: `.env.local` 의 개인 키가 `vite build` 결과 JS 에 그대로 포함됨(확인). 공개 정적 호스팅 시 누구나 열람 가능.
- 결정: 개발 모드만 `VITE_VWORLD_KEY` 사용. 배포 빌드는 `VITE_VWORLD_KEY_PUBLIC`(배포 도메인으로 발급받은 키)만 넣고, 없으면 사용자가 패널 설정에서 입력(브라우저 저장). VWorld 키는 도메인(Referer) 제한이 있어 노출 위험은 제한적이지만 개인 키는 분리.

## D-041 프로젝트명·공개 저장소
- 상태: 채택 (사용자 요청)
- 결정: 저장소·패키지 이름 `gis-on-pptx`, GitHub 공개(`qbong1010/gis-on-pptx`). 애드인 화면 이름은 "Slide Map" 유지.
- 공개 전 점검: 전체 git 이력에서 VWorld 키·토큰·`.env.local` 미포함 확인. 매니페스트 `ProviderName` 의 회사명을 `gis-on-pptx` 로 교체 — 개인 프로젝트가 회사 제품으로 보이지 않게.
- 후속: 라이선스 → D-042.
- 로컬 폴더 이름(mapitup)은 개발용 레지스트리 등록 경로·실행 중인 dev 서버 때문에 유지.

## D-042 라이선스 + v1 지도 박스 코드 삭제
- 상태: 채택 (사용자 결정: "애드인은 AGPL, QGIS 는 GPL")
- 결정
  - 애드인(저장소 기본): **AGPL-3.0-or-later** (`LICENSE`, `package.json` license). 이유(사용자 선택): 서비스화 계획상, 남이 코드를 가져가 수정한 뒤 네트워크 서비스로 운영할 때도 소스 공개 의무가 생기는 라이선스. 패널 설정 팝오버에 소스 코드 링크(AGPL §13).
  - QGIS 플러그인: **GPL-2.0-or-later** (`qgis-plugin/slide_map_bridge/LICENSE`, `__init__.py` SPDX 헤더, metadata 의 repository/tracker/homepage). QGIS 가 GPL-2.0-or-later 이고 플러그인이 QGIS API 를 직접 사용하므로 GPL 계열이 필요(QGIS 공식 저장소 요건).
  - 절차: 별도 발급·등록 없음. 저작권은 작성 시 자동 발생, 라이선스는 LICENSE 파일로 선언. 저작권 표기 "Copyright (C) 2026 qbong1010".
- 의존성 점검(런타임): MIT·BSD-2/3·Apache-2.0·ISC → AGPL-3.0 과 호환. 단 `react-leaflet`(Hippocratic-2.1, 추가 사용 제한이 있어 GPL 계열과 비호환)은 v1 지도 박스에서만 쓰였음.
- 따라서 **v1 지도 박스(콘텐츠 애드인) 코드 삭제** — D-029 의 "레거시로 남김"을 대체: `index.html`, `src/App.tsx`, `src/main.tsx`, `manifest.xml`, `src/shared/bus.ts`, `src/shared/instanceStore.ts`, `bake.ts` 의 v1 함수, dev 서버 메시지 중계 플러그인(D-024), `register:legacy` 스크립트, `react-leaflet` 의존성. `protocol.ts` 는 가져오기 레이어 타입(`LayerInput`)만 남김. 필요하면 git 이력(커밋 7bfa400 이전)에서 복원 가능.
- `2_start.cmd`/`3_stop.cmd` 는 npm 스크립트 대신 레지스트리에서 v1 등록값을 직접 지움.
