# gis-on-pptx (Slide Map) — 작업 규칙

PowerPoint 지도 애드인. v2: 우측 패널(TaskPane) 하나 + 슬라이드에는 태그 붙은 분리 객체 (`docs/ARCHITECTURE.md`). 공개 저장소: https://github.com/qbong1010/gis-on-pptx — 비밀값(.env.local, 키)은 절대 커밋하지 않는다.

## 기록 (필수)
- 작업할 때마다 `docs/DEVLOG.md` 맨 위에 항목 추가: 시각(KST) · 요청 · 한 일 · 검증 · 남은 문제.
- 설계/기술 결정은 `docs/DECISIONS.md` 에 D-번호로 추가.
- **기존 결정을 바꿀 때는 지우지 말고** 기존 항목 상태를 `대체됨 → D-xxx` 로 바꾸고, 대체 사유를 적은 뒤 새 항목을 추가. 요약 표도 함께 갱신.
- 실환경(실제 PowerPoint)에서 검증 안 된 가정은 `[확인 필요]` 로 표시하고, 검증되면 결과를 적는다.

## 구조
- `taskpane.html` → `src/taskpane.tsx` → `src/pane/PaneApp.tsx` : 우측 패널 = 애드인 전체 (manifest-taskpane.xml)
- `src/shared/` : 문서 저장소(docStore), 레이어 타입, CRS(해상도 배율)
- `src/lib/` : 파일 가져오기(GeoJSON/SHP), 좌표계 레지스트리·재투영, 배경지도

## 실행 (Windows)
- `1_setup.cmd` → `2_start.cmd` (PowerPoint 닫고 실행) → 홈 탭 [Slide Map 패널], 삽입 → 내 추가 기능 → 개발자 추가 기능 → Slide Map
- 패키지가 바뀌면 `1_setup.cmd` 다시 실행.

## 라이선스
- 애드인 MIT (`LICENSE`), QGIS 플러그인 GPL-2.0-or-later. 애드인 새 의존성은 허용적 라이선스(MIT·BSD·Apache-2.0·ISC 등)만 — GPL/AGPL 이나 비표준 "윤리" 라이선스(Hippocratic 등)는 MIT 배포와 맞지 않으니 피한다.
