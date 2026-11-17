# gis-on-pptx — PowerPoint 지도 애드인 "Slide Map" (v2)

> 작업 이력 `docs/DEVLOG.md` · 의사결정 `docs/DECISIONS.md` · 구조 `docs/ARCHITECTURE.md`
> 설치(회사/집 PC) `docs/INSTALL.md` · 서비스화 기획 `docs/SERVICE_PLAN.md` · QGIS 연동 `qgis-plugin/README.md`

PowerPoint 오른쪽 패널 하나로 지도를 만들고, 슬라이드에는 **편집 가능한 객체**로 넣는 애드인.

```
[패널]  지도 추가 → 파일 끌어넣기(GeoJSON·SHP·GPKG·DXF) → 스타일·배경지도·방위표/축척/범례 → [슬라이드에 반영]
[슬라이드]  배경지도(PNG 또는 편집형 벡터 SVG) · 레이어별 SVG · 네이티브 텍스트 라벨 · 범례 · 축척 · 방위표  (각각 분리된 객체)
```

- 슬라이드의 지도 객체를 클릭하면 패널이 그 지도를 자동으로 고른다. 배경지도 그림을 슬라이드에서 늘리거나 옮긴 뒤 다시 반영하면 그 영역으로 다시 그린다. 옮겨 둔 방위표·범례 위치는 유지된다.
- 지도 상태는 pptx 안에 저장된다 → 파일만 옮기면 다른 PC 에서도 이어서 편집.
- 한국 좌표계(5186/5174/5179/2097 등) 자동 인식·변환. 파일당 200MB 까지(30MB 이상 경고), 무거운 처리는 백그라운드(웹 워커).
- 배경지도: VWorld 4종, OSM, CARTO(라벨 있음/없음), 흰 배경, **편집형 벡터 3종**(도로·건물은 도형, 지명·도로명은 회전된 텍스트 상자).
- PowerPoint 에서 SVG 객체 우클릭 → **도형으로 변환** 하면 선·면을 하나하나 편집할 수 있다.

## 개발 실행 (Windows)
1. `1_setup.cmd` (최초 1회 / 패키지가 바뀌면 다시) — npm install + localhost 인증서
2. PowerPoint 를 닫고 `2_start.cmd` — 작업창 애드인 등록 + dev 서버(https://localhost:3000)
3. PowerPoint → **홈 탭 오른쪽 [Slide Map]** 버튼
- 끝낼 때 `3_stop.cmd` (등록 해제)
- `.env.local` 에 `VITE_VWORLD_KEY=...` (개발용 키) — 패널 설정에서도 입력 가능

## 배포판(설치형) 만들기 — 자세한 건 `docs/INSTALL.md`
```
npm run build
node scripts/make-manifest.mjs https://<호스팅 주소>
```
`dist/` 를 정적 호스팅에 올리고, 각 PC 에서 `install\install-addin.cmd https://<호스팅 주소>/manifest.xml` 1번.

## 테스트
| 대상 | 명령 |
|---|---|
| 패널 E2E (브라우저 모드, 모의 슬라이드) | `python tests/core/e2e_pane.py 380` |
| **실제 PowerPoint E2E** (원격 디버깅 하네스, D-031) | `python tests/core/e2e_real.py` |
| 가져오기 (GDAL 대비 오차) | `python tests/import/run_import_tests.py`, `run_regress_tests.py` |
| 벡터 배경지도 | `python tests/vector/test_vector_basemap.py` |
| QGIS 플러그인 | `tests\qgis\run_tests.cmd` |

## 라이선스
- PowerPoint 애드인(이 저장소 기본): **MIT** — `LICENSE`.
- QGIS 플러그인(`qgis-plugin/`): **GPL-2.0-or-later** — `qgis-plugin/slide_map_bridge/LICENSE`.
- 지도 데이터는 각 제공처 약관을 따른다: VWorld(국토교통부), © OpenStreetMap contributors (ODbL), © OpenMapTiles, © CARTO.
