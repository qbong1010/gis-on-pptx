# Slide Map v2 아키텍처 (단일 패널 애드인)

> 2026-11-17 03:10 결정 (D-029). 이전 구조(패널 + 콘텐츠 애드인 지도 박스, D-011)는 `legacy` 로 남기되 기본 등록하지 않는다.

## 1. 한 장 요약

```
PowerPoint
 ├─ 우측 패널 (TaskPane 애드인 1개, taskpane.html)
 │    ├─ 지도 목록 (이 문서의 지도들) + [+ 지도 추가]
 │    ├─ 지도 편집기: 슬라이드 프레임과 같은 비율·같은 크기(가상 px)로 그린 Leaflet 지도를 패널 폭에 맞게 축소 표시 (WYSIWYG)
 │    ├─ 탭: 레이어(스타일·라벨) | 배경지도 | 꾸미기(방위표·축척·범례) | 반영 옵션
 │    └─ [슬라이드에 반영] → 슬라이드에 "분리된 객체들"로 삽입/교체
 └─ 슬라이드
      └─ 지도 = 태그가 붙은 객체 묶음 (SLIDEMAP_MAP=<mapId>, SLIDEMAP_PART=<part>)
           basemap(PNG) · layer:<id>(SVG, 레이어별) · labels(네이티브 텍스트 상자) · north · scale · legend (각 SVG)
```

- 지도 상태(MapDoc)는 **이 애드인의 문서 settings** 에 저장 → pptx 와 함께 이동, 다른 PC 에서 열어도 편집 가능.
- 슬라이드의 지도 객체를 클릭하면 패널이 태그를 읽어 해당 지도를 자동 선택.
- 사용자가 슬라이드에서 배경지도 이미지를 **늘리거나 옮기면** 그 사각형이 새 프레임이 된다(다음 반영 때 그 위치·비율로 다시 그림).
- 방위표·축척·범례를 사용자가 옮겨 두면 다시 반영해도 **옮긴 위치를 유지**.

## 2. 왜 이렇게 바꾸나 (D-029 요약)
| | 이전 (패널 + 지도 박스) | v2 (패널만) |
|---|---|---|
| 애드인 수 | 2 (설치·삽입 2번) | 1 |
| 지도 추가 | 삽입 메뉴 4단계 | 패널 버튼 1번 |
| 패널↔지도 통신 | dev 서버 웹소켓 중계 필요 (배포 시 중계 서버 필요) | 불필요 (한 웹뷰) |
| 배포 | 중계 서버 + 정적 호스팅 | **정적 호스팅만** (회사/집 PC 설치 단순) |
| 슬라이드 위 지도 | 살아있는 지도 (편집 중 슬라이드에서 바로 보임) | 반영된 정적 객체 (패널에서 편집 → 반영) |
| 결과물 편집성 | 박스 → Bake 별도 단계 | 처음부터 분리된 PPT 객체 |

잃는 것: 슬라이드 위에서 지도를 직접 드래그하는 경험. 대신 패널 미리보기를 슬라이드 프레임과 같은 비율·같은 글자 크기로 그려 WYSIWYG 를 유지한다.

## 3. 모듈 / 파일 소유
| 영역 | 파일 | 설명 |
|---|---|---|
| 패널 앱 | `src/pane/**`, `src/taskpane.tsx` | UI, 상태, 슬라이드 연동 |
| 문서 저장소 | `src/shared/docStore.ts` | Office settings(문서) / localStorage(브라우저) |
| 슬라이드 조작 | `src/pane/slide.ts` | 삽입·태그·찾기·교체·선택 감지 (PowerPointApi) |
| 렌더(Bake 재료) | `src/lib/bake.ts` | 지도 → PNG/SVG, `makeProjector` |
| 꾸미기 | `src/lib/decorations.ts` | 방위표·축척·범례 SVG 프리셋 |
| 스타일 | `src/lib/style.ts` | 레이어 스타일 모델·프리셋 |
| 라벨 | `src/lib/labels.ts` | 라벨 배치(충돌 제거) 공용 |
| 가져오기 | `src/lib/importers.ts`, `src/lib/gpkg.ts`, `src/lib/dxf.ts`, `src/workers/import.worker.ts` | GeoJSON/SHP/GPKG/DXF, 워커 |
| 벡터 배경지도 | `src/lib/vectorBasemap.ts` | OpenFreeMap 벡터타일 → 편집형 선·라벨 |
| QGIS 연동 | `qgis-plugin/` | 슬라이드↔조판 브리지 |
| 레거시 | `index.html`, `src/App.tsx`, `src/main.tsx`, `manifest.xml` | 콘텐츠 애드인 지도 박스 (등록 안 함) |

## 4. 데이터 모델

```ts
// 슬라이드 위 위치 (pt). 16:9 기본 슬라이드는 960×540pt
type Frame = { left: number; top: number; width: number; height: number };

type MapDoc = {
  v: 2;
  id: string;            // 8자 이상 랜덤
  name: string;          // "지도 1"
  slideId: string | null;// 마지막으로 반영한 슬라이드 id
  frame: Frame;
  view: { center: [lat, lng]; zoom: number };
  settings: { basemapId: string; tileScale: number };
  layers: LayerMeta[];   // 데이터 본문은 별도 키 (layer:<id>)
  deco: DecoSettings;    // 방위표·축척·범례
  bake: BakeOptions;     // 무엇을 어떻게 넣을지
  updatedAt: number;
};
```
- settings 키: `slidemap.index` = `{ order: string[] }`, `slidemap.map.<id>` = MapDoc, `slidemap.layer.<layerId>` = FeatureCollection(WGS84, 7자리).
- 문서 settings 용량 한도는 미확인 `[확인 필요]` → 저장 직전 전체 JSON 크기를 계산해 **8MB 초과 시 경고**, 레이어는 정점 수 예산을 넘으면 단순화본을 저장(원본은 세션 메모리).

## 5. 슬라이드 객체 규약
- 태그: `SLIDEMAP_MAP` = mapId, `SLIDEMAP_PART` = `basemap | layer:<layerId> | vectors | labels | label | north | scale | legend | frame | qgis`, `SLIDEMAP_VER` = `2`
- 이름: `SlideMap · <지도 이름> · <부분>`
- z 순서(아래→위): basemap → layer SVG(레이어 목록 아래→위) → 라벨 → 범례 → 축척 → 방위표
- 반영(업데이트) 알고리즘
  1. 현재 슬라이드에서 `SLIDEMAP_MAP=id` 객체 수집
  2. basemap(또는 frame) 객체의 사각형이 MapDoc.frame 과 다르면 → 프레임 갱신(사용자가 슬라이드에서 크기/위치 조정)
  3. north/scale/legend 객체가 있으면 그 위치를 "사용자 위치"로 기억
  4. 기존 객체 삭제 → 새 재료를 프레임에 맞춰 삽입 → 태그/이름 부여 → 기억한 위치 적용
- 삽입은 `setSelectedDataAsync`(Image / XmlSvg, 좌표 지정) → 삽입 전후 슬라이드 도형 id 비교로 새 객체를 찾아 태그. 라벨은 `shapes.addTextBox` (PowerPointApi 1.4).

## 6. 크기·해상도 규칙
- 프레임 1pt = 지도 4/3 CSS px (96dpi). 즉 600×338pt 프레임은 800×450px 가상 지도.
- 패널 미리보기 = 가상 지도를 CSS `transform: scale(패널폭/가상폭)` 으로 축소 (Leaflet 1.9 는 transform 배율을 마우스 좌표에 반영).
- 배경지도 PNG 는 가상 크기의 2배 해상도로 합성.
- 선 굵기·글자 크기·기호 크기는 "슬라이드 100% 기준 px" 단위로 저장 → 프레임 크기와 무관하게 슬라이드에서 보이는 크기 고정.

## 7. 배포 형태
- dev: `https://localhost:3000` (Vite) + 타일 프록시(D-025/027)
- prod: 정적 호스팅(예: Cloudflare Pages). VWorld 응답에 `Access-Control-Allow-Origin: *` 확인 → 프록시 없이 `crossOrigin="anonymous"` 직접 로드. VWorld 키는 배포 도메인으로 발급 필요.
