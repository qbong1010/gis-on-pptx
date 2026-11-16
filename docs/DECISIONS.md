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
| D-011 | 2026-11-17 | 우측 패널(TaskPane)=관리, 지도 박스(ContentApp)=표현 객체 | 채택 |
| D-012 | 2026-11-17 | 패널↔지도 통신: BroadcastChannel + localStorage 폴백 | 대체됨 → D-024 |
| D-013 | 2026-11-17 | 지도 박스별 상태는 문서(인스턴스 settings)에 저장, mapId 부여 | 채택 `[확인 필요]` |
| D-014 | 2026-11-17 | 커서: 도형 비대화형 + 표준 커서 + 소프트웨어 십자 커서 | 채택 |
| D-015 | 2026-11-17 | 지도 해상도 배율 = 사용자 정의 CRS(타일 256×배율) | 채택 |
| D-016 | 2026-11-17 | Bake 방향: 도형은 SVG path, 라벨은 PPT 네이티브 텍스트 | 일부 채택 → D-026 (라벨은 스타일 단계) |
| D-017 | 2026-11-17 | WGS84 아닌 좌표는 거부 | 대체됨 → D-019 |
| D-018 | 2026-11-17 | 파일 형식 우선순위: SHP → GPKG → DXF, GDAL WASM 은 보류 | 채택 |
| D-019 | 2026-11-17 | proj4 로 업로드 시 WGS84 자동 재투영 (한국 EPSG 내장 + 수동 지정) | 채택 |
| D-020 | 2026-11-17 | SHP: shpjs, zip/다중파일 둘 다, DBF 인코딩 자동판별(UTF-8→CP949) | 채택 |
| D-021 | 2026-11-17 | 좌표 소수 7자리 반올림 (문서 저장 용량 절감) | 채택 |
| D-022 | 2026-11-17 | 작업/의사결정 기록은 저장소 `docs/` 에 누적 | 채택 |
| D-023 | 2026-11-17 | `2_start.cmd` 가 3000 포트의 이전 node 프로세스를 자동 종료 | 채택 |
| D-024 | 2026-11-17 | 패널↔지도 통신 주 경로 = dev 서버 웹소켓 중계 | 채택 (배포 방식 미정) |
| D-025 | 2026-11-17 | 배경지도 타일은 dev 서버 동일 출처 프록시 경유 → 캔버스 캡처 | 채택 (배포 방식 미정) |
| D-026 | 2026-11-17 | Bake = 지도 박스가 SVG+PNG 생성, 패널이 위치 감지 후 삽입 | 채택 `[확인 필요]` |
| D-027 | 2026-11-17 | 타일 프록시는 hop-by-hop 헤더를 제거해서 전달 (HTTP/2 호환) | 채택 |
| D-028 | 2026-11-17 | Bake SVG 좌표는 반올림 없는 `map.project()` 실수 좌표 사용 | 채택 |

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
- 상태: 채택
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
- 상태: 채택 (배포 방식 미정)
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
- 상태: 채택 `[확인 필요]`
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
