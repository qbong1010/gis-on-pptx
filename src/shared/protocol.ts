import type { BBox, FeatureCollection } from "geojson";

/* ------------------------------------------------------------------ */
/* 상태 타입                                                            */
/* ------------------------------------------------------------------ */

export type LayerState = {
  id: string;
  name: string;
  data: FeatureCollection; // WGS84
  bbox: BBox;
  featureCount: number;
  visible: boolean;
  color: string;
};

export type LayerSummary = Omit<LayerState, "data">;

export type LayerInput = Pick<LayerState, "id" | "name" | "data" | "bbox" | "featureCount">;

export type MapView = { center: [number, number]; zoom: number };

export type MapSettings = {
  basemapId: string;
  /** 타일 1장을 화면에 그리는 크기 배율 (1 = 256px). 작을수록 지도 글자가 작아진다. */
  tileScale: number;
  /** 소프트웨어 십자 커서 표시 (Office 웹뷰에서 커서가 안 보이는 문제 대응) */
  cursorAid: boolean;
};

export const DEFAULT_SETTINGS: MapSettings = {
  basemapId: "vw-base",
  tileScale: 1,
  cursorAid: true,
};

export type MapSnapshot = {
  mapId: string;
  label: string;
  inOffice: boolean;
  settings: MapSettings;
  view: MapView;
  layers: LayerSummary[];
  ts: number;
};

/* ------------------------------------------------------------------ */
/* 메시지                                                              */
/* ------------------------------------------------------------------ */

export type MapCommand =
  | { kind: "addLayers"; layers: LayerInput[] }
  | { kind: "setVisible"; layerId: string; visible: boolean }
  | { kind: "removeLayer"; layerId: string }
  | { kind: "zoomToLayer"; layerId: string }
  | { kind: "zoomToAll" }
  | { kind: "setSettings"; patch: Partial<MapSettings> }
  | { kind: "identify" }
  | { kind: "bake"; options: BakeOptions };

export type BakeOptions = {
  /** 레이어 도형을 SVG(편집 가능한 도형)로 */
  vectors: boolean;
  /** 배경지도를 PNG 이미지로 (도형 아래에 깔림) */
  basemap: boolean;
};

export type BakePayload = {
  /** 지도 박스 화면 크기 (CSS px) — 가로세로 비율 계산용 */
  widthPx: number;
  heightPx: number;
  svg: string | null;
  /** base64 PNG (data: 접두어 없음) */
  png: string | null;
  featureCount: number;
  notes: string[];
};

export type Msg =
  // 지도(콘텐츠 애드인) → 패널
  | { type: "map:state"; snapshot: MapSnapshot }
  | { type: "map:bye"; mapId: string }
  | { type: "map:focus"; mapId: string }
  | { type: "map:result"; mapId: string; reqId: string; ok: boolean; message: string }
  | { type: "map:bakeData"; mapId: string; reqId: string; ok: boolean; message: string; payload: BakePayload | null }
  // 패널 → 지도
  | { type: "pane:hello" }
  | { type: "pane:config"; vworldKey: string }
  | { type: "pane:cmd"; mapId: string; reqId: string; cmd: MapCommand };

export const LAYER_COLORS = ["#ea580c", "#2563eb", "#16a34a", "#9333ea", "#db2777", "#0891b2"];
