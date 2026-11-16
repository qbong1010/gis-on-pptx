# 작업 이력 (Dev Log)

> 최신이 위. 각 항목: 시각(KST) · 요청 · 한 일 · 검증 · 남은 문제. 관련 결정은 `DECISIONS.md` 의 D-번호로 연결.

---

## 2026-11-17 04:40 — v2: 단일 패널 애드인 + 스타일·꾸미기 + 편집형 벡터 배경지도 + GPKG/DXF + 워커
- 요청: (1) 애드인 하나(작업창)로, 지도 추가는 패널 버튼 (2) 지도 선형·텍스트를 PPT 도형/텍스트 상자로 — 기술 검토 후 진행 (3) 레이어 스타일링 (4) 대용량 백그라운드 처리 + 용량 상한 타협 (5) GPKG·DXF (6) 방위표·축척 스타일 프리셋 (7) Bake 시 객체 분리 삽입.
- 진행 방식: 설계(`docs/ARCHITECTURE.md`) → Sonnet 에이전트 병렬 구현(파일 소유 분리: CORE/IMPORT/VECTOR/QGIS/DOCS) → 다른 모델(Fable) 새 세션 독립 리뷰 → Sonnet 수정 → 실제 PowerPoint 검증. Codex 는 계정 모델 사용 불가로 대체(D-037).
- 실제 PowerPoint 하네스 구축(D-031): 사용자 열린 문서는 `Documents\SlideMap-backup\` 에 백업 후 PowerPoint 를 원격 디버깅 모드로 재시작.
  - 실측: PowerPointApi 1.1~1.10, 삽입 후 선택 비어 있음(→ id 비교), 태그·이름·회전·addTextBox·addGroup·pageSetup·exportAsBase64 동작, `ungroup()` 은 void 이고 자식 id·태그 유지, 슬라이드에서 지도 객체 클릭 → 패널이 해당 지도 자동 선택(지도 1→2 전환 확인).
- 한 일
  - D-029 단일 애드인 구조: 패널 내 WYSIWYG 지도 편집기, 지도 목록/추가/이름/삭제, 탭(레이어·배경지도·꾸미기·반영), 하단 고정 [슬라이드에 반영], 문서 settings 저장(`docStore`), Office/Mock 슬라이드 어댑터, 진단 패널. `2_start.cmd` 는 작업창 매니페스트만 등록(레거시 지도 박스 해제).
  - D-030 편집형 벡터 배경지도(OpenFreeMap): 도로·건물·수계를 SVG(도형으로 변환 가능), 지명·도로명을 **네이티브 텍스트 상자(도로 각도 회전)**. OCR 방식 기각.
  - D-035 스타일·꾸미기: 선/면/점/분류색/라벨, 도시계획 프리셋 6종, 방위표 4종·축척 3종·범례 2종 + 크기·색·위치.
  - D-034 반영: 배경 PNG·레이어별 SVG·라벨·범례·축척·방위표를 분리 객체로, 태그 기반 교체, 슬라이드에서 바꾼 프레임/꾸미기 위치 보존.
  - D-033 가져오기: GPKG(sql.js)·DXF(dxf-parser+HATCH)·웹 워커·용량 정책.
  - D-032 배포·설치: `scripts/make-manifest.mjs`, `install/install-addin.cmd`. D-038 배포 번들에 개인 VWorld 키 미포함.
  - 서비스화 기획 `docs/SERVICE_PLAN.md`.
- 독립 리뷰 결과 → 수정
  - 가져오기 11건(UTF-8 DXF 한글 깨짐, `.cpg` 없는 UTF-8 DBF 오판, -Z 돌출 원/문자 좌우 반전, HATCH 시계방향 호·스플라인·구멍, prj 투영 종류 미비교, 단순화 무한 반복(30초→7ms), SHP 그룹 하나 실패 시 전체 실패, 로컬 좌표 DXF 를 4326 으로 추정 등) 모두 수정, 회귀 테스트 33개.
  - 벡터 9건(패닝 후 재그리기 어긋남, 화면 레이어 정수 반올림, 타일 줌 13↔14 흔들림, 캐시 라벨 변형, 타일 경계 격자선, whenDrawn 무한 대기 등) 모두 수정.
- 검증
  - `tsc` 0 에러, `vite build` 성공, 배포 번들에 개인 키 없음.
  - 브라우저 E2E(`tests/core/e2e_pane.py`) 340/380/450px 전체 통과(지도 추가, SHP zip+GeoJSON, 스타일, 반영, 프레임 채택, 방위표 위치 유지, 새로고침 복원).
  - **실제 PowerPoint E2E**(`tests/core/e2e_real.py`): 래스터·벡터 배경 모두 반영/재반영 성공, 벡터 배경 41개 객체(회전된 도로명 33개) — 슬라이드 내보내기 이미지로 확인.
  - 가져오기: GDAL 대비 오차 GRS80 0.00m / 5174 0.04m, 44MB 파일 워커 처리 중 UI 최대 정지 31ms.
- 남은 문제: 문서 settings 실제 용량 한도 `[확인 필요]`(8MB 경고만), HATCH 타원 엣지 각도 해석 `[확인 필요]`, UI/UX 다듬기(3단계), 배포 호스팅 미실행(사용자 계정 필요).

## 2026-11-17 02:50 — VWorld 배경지도 미표시 + Bake 도형 지글거림 수정
- 요청: 마지막 Bake 작업 이후 브이월드 지도가 안 나옴. Bake 된 폴리곤의 직선 변이 구불구불하게 나옴.
- 원인 1 (VWorld): headless Chromium 으로 재현 → 타일 12장 모두 `net::ERR_HTTP2_PROTOCOL_ERROR`.
  dev 서버는 HTTPS(HTTP/2)인데, VWorld 응답에 `connection: Upgrade, close` · `upgrade: h2,h2c` · `transfer-encoding` 같은
  HTTP/1.1 전용(hop-by-hop) 헤더가 붙어 오고, D-025 프록시가 이를 그대로 전달 → 브라우저가 규약 위반으로 응답 폐기.
  OSM 은 그런 헤더가 없어서 정상이었음. (VWorld 서버·키·Referer 는 정상: curl/Node 직접 요청 200)
- 원인 2 (지글거림): `latLngToContainerPoint` 가 내부에서 정수 px 로 반올림(`project()._round()`).
  공공데이터 폴리곤은 직선 변에도 정점이 촘촘해서 정점마다 ±0.5px 지그재그 → 슬라이드 크기로 확대되면 눈에 띔.
- 한 일
  - `vite.config.ts`: 프록시 응답에서 hop-by-hop 헤더 + set-cookie 제거 (D-027)
  - `src/lib/bake.ts`: `makeProjector()` — `map.project()` 실수 좌표를 그대로 쓰고 SVG 좌표 소수 2자리 (D-028)
- 검증 (headless Chromium, 실행 중인 HTTPS dev 서버)
  - 수정 전: VWorld 타일 0/12 로드, ERR_HTTP2_PROTOCOL_ERROR / 수정 후: 12/12 로드(200), 화면 캡처로 지도 표시 확인 ✅
  - 동일선상 정점 200개짜리 비스듬한 변(배율 0.7, 줌 16.25): 직선 이탈 최대 **이전 0.99px → 0.003px** ✅
- 발견: VWorld 응답에 `access-control-allow-origin: *` 가 있음 → 배포본에서는 프록시 없이 `crossOrigin="anonymous"` 로 캔버스 캡처 가능성 높음 (D-025 후속)
- 남은 문제: 실제 PowerPoint 에서 재확인 `[확인 필요]`

## 2026-11-17 02:19 — Step 4 Bake + 패널↔지도 통신 교체 + 배경지도 캡처
- 요청: Bake 구현. 패널이 지도 박스를 인식하지 못함(실제 PowerPoint). 타일 캡처용 CORS 가 문제면 화면 캡처 등 대안 검토.
- 원인 분석: 두 애드인(매니페스트 2개)의 웹뷰 저장소가 분리되어 BroadcastChannel/localStorage 가 통하지 않는 것으로 판단. MS 문서에 콘텐츠+작업창을 한 애드인으로 묶는 통합 매니페스트(`contentRuntimes`)가 있음 → 애드인 단위 분리 정황. `[확인 필요]`
- VWorld CORS: PC·클라우드 모두 외부망 차단으로 직접 확인 불가.
- 한 일
  - dev 서버 웹소켓 중계(Vite 플러그인 + `import.meta.hot`)를 메시지 버스 주 경로로 추가 (D-024, D-012 대체)
  - 타일을 dev 서버 동일 출처 프록시(`/tiles/vworld`, `/tiles/osm`)로 받도록 변경 → 캔버스 합성 가능 (D-025)
  - Bake (D-026): 지도 박스가 현재 화면 기준 SVG(범위로 잘라낸 도형) + 배경지도 PNG(로드된 타일 합성) 생성 → 패널이 지도 박스 위치를 PowerPointApi 1.5 로 찾아 PNG → SVG 순서로 삽입. 못 찾으면 왼쪽 위.
  - 패널: Bake 옵션(도형/배경지도), 마지막 정착 진단 + 미리보기
  - `SLIDEMAP_NO_HTTPS=1` 테스트용 HTTP 모드
- 검증 (headless Chrome, 서로 다른 브라우저 컨텍스트 = 저장소 분리 상황 재현)
  - 패널 "연결된 지도 1" — 웹소켓 중계로 인식 ✅
  - SHP zip 업로드 → 지도에 2개 레이어 ✅
  - Bake 재료: 800×450px, 도형 2개, SVG 0.6KB, 배경 PNG 53KB(2배 해상도), 미리보기에서 도형·배경 정렬 일치 ✅
  - 실제 PowerPoint 삽입/위치 감지: `[확인 필요]` — Claude 가 화면 제어로 직접 확인을 시도했으나 PowerPoint 창이 캡처되지 않음(검은 화면) → 사용자 확인으로 전환
- 남은 문제: 콘텐츠 애드인이 PowerPoint API 도형으로 노출되는지(위치 감지), setSelectedDataAsync 좌표 단위(pt) `[확인 필요]`, 배포 시 중계/프록시 서버 필요 여부

## 2026-11-17 02:14 — dev 서버 재시작 시 포트 3000 충돌
- 증상: `1_setup.cmd` 후 `2_start.cmd` 실행 시 `Error: Port 3000 is already in use`
- 원인: 이전 `2_start.cmd` 의 node(vite) 프로세스가 창을 닫은 뒤에도 남아 3000 포트 점유
- 조치: `2_start.cmd` 가 시작 전에 3000 포트를 LISTEN 중인 프로세스를 찾아 **node.exe 일 때만** 종료 (다른 프로그램이면 경고만)
- 결정: D-023 추가

## 2026-11-17 02:02 — SHP 업로드 + 좌표 자동 재투영 + 기록 문서
- 요청: 공공데이터 SHP 를 올릴 수 있게. 작업/의사결정 이력을 문서에 꾸준히 기록(결정 변경 포함).
- 한 일
  - `docs/DEVLOG.md`, `docs/DECISIONS.md`, `CLAUDE.md` 생성 (D-022)
  - proj4 재투영 + 한국 EPSG 레지스트리 + `.prj` 감지 (D-019, D-017 대체)
  - SHP 파서: zip / 다중 파일, DBF 인코딩 자동판별 (D-020)
  - 패널에 "입력 좌표계" 선택(자동/수동), 파일 선택창이 `.zip/.shp/.dbf/.prj/.cpg/.shx` 허용
  - 지도 박스 드롭도 같은 가져오기 로직 사용
  - 좌표 7자리 반올림 (D-021)
- 추가 패키지: `proj4`, `shpjs`, `but-unzip` → PC 에서 `1_setup.cmd` 재실행 필요
- 검증 (headless Chrome, `samples/shp-test/` — pyshp+pyproj 로 생성한 한국형 테스트 SHP, ESRI .prj)
  | 케이스 | 결과 | 기준(pyproj EPSG 변환) 대비 최대 오차 |
  |---|---|---|
  | 5186 낱개, DBF CP949, .cpg 없음 | 성공, 한글 속성 정상 (EUC-KR 자동판별) | 0.00 m |
  | zip (5174 + 5186), 5174 는 .cpg=949 | 2개 레이어 성공 | 5174: 0.05 m / 5186: 0.00 m |
  | 5179 UTF-8 (.cpg=UTF-8) | 성공 | 0.00 m |
  | .prj 없음 + 자동 | 의도대로 "좌표계를 알 수 없음" 안내 | – |
  | .prj 없음 + 수동 5186 | 성공 | 0.00 m |
- 수정: 지도 박스의 "N개 레이어 추가" 응답이 패널의 상세 결과(파일·좌표계·인코딩)를 덮어써서 응답 메시지를 비움
- 남은 문제: 대용량 SHP(연속지적도 시군 단위) 처리 속도/문서 용량, 실제 공공데이터로 위치 대조 `[확인 필요]`, 처리 중 패널 멈춤(메인 스레드) → 필요 시 Web Worker

## 2026-11-17 01:59 — 파일 형식 확장 검토
- 질문: shp/gpkg/dxf 지원 난이도.
- 결론: SHP(하~중) < GPKG(중) < DXF(상). 공통 선행 = proj4 재투영. GDAL WASM 은 대안으로 보류 (D-018).

## 2026-11-17 01:46 — 구조 변경: 우측 패널 + 지도 박스
- 요청: 관리는 우측 패널, 삽입된 지도는 단일 표현 객체. 커서 안 보이는 문제. 지도 글자 크기(해상도) 조절.
- 한 일: TaskPane 매니페스트/페이지 추가, 메시지 버스, 지도 박스 인스턴스 저장, 소프트웨어 커서, 해상도 배율 CRS (D-010 대체 → D-011~D-015)
- 검증: headless Chrome 에서 패널↔지도 연결, GeoJSON 추가, 가시성 토글, 배율 70%(타일 256→179px, 범위 유지) 확인. 실제 PowerPoint 에서의 웹뷰 간 통신은 `[확인 필요]`.

## 2026-11-17 01:38 — Step 2/3: 지도 UI + GeoJSON + VWorld
- 한 일: Leaflet 전체화면(강남역), 드래그 오버레이, GeoJSON 로드 + Turf bbox 자동 줌, VWorld 배경지도 4종 + OSM, `.env.local` 키 (D-009)
- 검증: 사용자 확인 — 지도 정상 로드·동작.

## 2026-11-17 01:37 — Step 1 검증 완료
- 결과: ContentApp 로드, ImageCoercion 1.1/1.2, PowerPointApi 1.4 모두 지원. 테스트 SVG 삽입 성공.
- 발견: 그룹 해제 시 텍스트 스타일/위치 변경 → Step 4 과제 (D-016)
- 발견: "로드 시 웹 보기 중지" 디버거 팝업 → `debugging --disable` 추가 (D-007)

## 2026-11-17 01:32 — 사이드로드 오류 수정
- 증상: "배포 중에 삽입된 추가 기능만 … 디버깅하는 중에 사용할 수 있습니다"
- 원인: `office-addin-debugging start` 가 여는 템플릿 문서의 박스가 개발자 레지스트리 등록과 어긋남
- 조치: 레지스트리 등록 + 수동 삽입 방식으로 변경 (D-006 → D-007)

## 2026-11-17 01:28 — PC 폴더 연결 (`C:\Users\Joey\mapitup`)
- 프로젝트 배치, Windows 실행 스크립트 작성 (D-008)

## 2026-11-17 01:16 — Step 1 스캐폴딩
- Vite+React+TS 프로젝트, ContentApp 매니페스트, HTTPS 개발 인증서, 연결 점검 화면 (D-001~D-005)
