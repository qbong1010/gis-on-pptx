/** 벡터 배경지도 스타일 프리셋 */
import type { LabelStyle, RoadClass, RoadStyle, VectorLabelKind, VectorStyle, VectorStyleId } from "./types";

const lab = (size: number, color: string, halo: string, haloWidth = 2, extra: Partial<LabelStyle> = {}): LabelStyle => ({
  size,
  color,
  halo,
  haloWidth,
  ...extra,
});

const road = (width: number, color: string, casing: string | undefined, casingExtra: number, minZoom: number, dash?: string): RoadStyle => ({
  width,
  color,
  casing,
  casingExtra,
  minZoom,
  dash,
});

/** 도시계획 하부 바탕용 - 밝은 회색 도로 + 흰 케이싱. 위에 올릴 컬러 레이어가 돋보이도록 채도를 거의 뺀다 */
const planGray: VectorStyle = {
  id: "plan-gray",
  name: "도시계획 (회색)",
  background: "#f1f1ef",
  water: { fill: "#cfe2ee" },
  waterway: { stroke: "#cfe2ee", width: 1.5 },
  park: { fill: "#e0e9d6", wood: "#d8e4cc", pitch: "#e3ebda" },
  landuse: { school: "#e9e9e6", college: "#e9e9e6", university: "#e9e9e6", hospital: "#ebe9e6", industrial: "#e6e6e3", commercial: null, retail: null, residential: null, railway: "#e6e6e3", cemetery: "#e0e9d6", library: "#e9e9e6" },
  building: { fill: "#e1e1dd", stroke: "#d1d1cc", strokeWidth: 0.5, minZoom: 15.3 },
  roads: {
    motorway: road(9, "#c4c4c1", "#ffffff", 1.2, 0),
    trunk: road(8, "#c8c8c5", "#ffffff", 1.2, 0),
    primary: road(7.5, "#cdcdca", "#ffffff", 1.1, 0),
    secondary: road(6.5, "#d3d3d0", "#ffffff", 1, 0),
    tertiary: road(5.5, "#d9d9d6", "#ffffff", 1, 12.5),
    minor: road(4.4, "#dfdfdc", "#ffffff", 0.9, 13.5),
    service: road(2.4, "#e3e3e0", "#ffffff", 0.7, 15),
    path: road(1.1, "#d6d6d2", undefined, 0, 15.5, "3 2"),
    rail: road(1.4, "#b8b8b4", undefined, 0, 12, undefined),
    transit: road(1, "#cfcfcb", undefined, 0, 99, "4 3"),
  },
  boundary: { color: "#a5a5a1", width: 1, dash: "6 3 1.5 3", maxLevel: 8 },
  labels: {
    place: lab(15, "#3d3d3a", "#ffffff", 2.5, { bold: true }),
    road: lab(10.5, "#5c5c58", "#ffffff", 2),
    poi: lab(10.5, "#4a4a46", "#ffffff", 2),
    water: lab(10.5, "#5f8aa8", "#ffffff", 2, { italic: true }),
    peak: lab(10.5, "#6b6b66", "#ffffff", 2),
  },
};

/** 흑백 선화 - 검정/회색 선만 사용 */
const monoLine: VectorStyle = {
  id: "mono-line",
  name: "흑백 선화",
  background: "#ffffff",
  water: { fill: "#ececec", stroke: "#8c8c8c", strokeWidth: 0.6 },
  waterway: { stroke: "#8c8c8c", width: 0.8 },
  park: { fill: null, stroke: "#b5b5b5" },
  landuse: {},
  building: { fill: null, stroke: "#6e6e6e", strokeWidth: 0.5, minZoom: 15.3 },
  roads: {
    motorway: road(2.6, "#111111", undefined, 0, 0),
    trunk: road(2.3, "#1a1a1a", undefined, 0, 0),
    primary: road(2, "#222222", undefined, 0, 0),
    secondary: road(1.6, "#333333", undefined, 0, 0),
    tertiary: road(1.2, "#444444", undefined, 0, 12.5),
    minor: road(0.9, "#666666", undefined, 0, 13.5),
    service: road(0.6, "#888888", undefined, 0, 15),
    path: road(0.5, "#999999", undefined, 0, 15.5, "2 2"),
    rail: road(1, "#333333", undefined, 0, 12, "7 3"),
    transit: road(0.8, "#666666", undefined, 0, 99, "4 3"),
  },
  boundary: { color: "#555555", width: 0.9, dash: "7 3 1.5 3", maxLevel: 8 },
  labels: {
    place: lab(15, "#000000", "#ffffff", 2.5, { bold: true }),
    road: lab(10.5, "#222222", "#ffffff", 2),
    poi: lab(10.5, "#111111", "#ffffff", 2),
    water: lab(10.5, "#444444", "#ffffff", 2, { italic: true }),
    peak: lab(10.5, "#333333", "#ffffff", 2),
  },
};

/** OSM 계열 부드러운 컬러 */
const color: VectorStyle = {
  id: "color",
  name: "컬러",
  background: "#f3f0e9",
  water: { fill: "#aad3df" },
  waterway: { stroke: "#aad3df", width: 1.6 },
  park: { fill: "#cde8b9", wood: "#b9dca4", pitch: "#aee0c2" },
  landuse: { school: "#f0e9d4", college: "#f0e9d4", university: "#f0e9d4", hospital: "#f1e0dc", industrial: "#ebdbe8", commercial: "#f2dad9", retail: "#fbd9c3", residential: null, railway: "#e9e2ec", cemetery: "#c4dfb5", library: "#f0e9d4" },
  building: { fill: "#dcd3cb", stroke: "#c9bdb2", strokeWidth: 0.5, minZoom: 15.3 },
  roads: {
    motorway: road(9, "#e990a0", "#c9667c", 1.1, 0),
    trunk: road(8, "#f9b29c", "#cf8368", 1.1, 0),
    primary: road(7.5, "#fcd6a4", "#c9a56f", 1.1, 0),
    secondary: road(6.5, "#f7fabf", "#b9ba7a", 1, 0),
    tertiary: road(5.5, "#ffffff", "#b9b9b9", 1, 12.5),
    minor: road(4.4, "#ffffff", "#c2c2c2", 0.9, 13.5),
    service: road(2.4, "#ffffff", "#cfcfcf", 0.7, 15),
    path: road(1.1, "#f4837d", undefined, 0, 15.5, "3 2"),
    rail: road(1.4, "#8f8f8f", undefined, 0, 12, undefined),
    transit: road(1, "#a0a0a0", undefined, 0, 99, "4 3"),
  },
  boundary: { color: "#9e7cae", width: 1, dash: "6 3 1.5 3", maxLevel: 8 },
  labels: {
    place: lab(15, "#333333", "#ffffff", 2.5, { bold: true }),
    road: lab(10.5, "#444444", "#ffffff", 2),
    poi: lab(10.5, "#555a66", "#ffffff", 2),
    water: lab(10.5, "#3a7ea0", "#ffffff", 2, { italic: true }),
    peak: lab(10.5, "#6b5a4a", "#ffffff", 2),
  },
};

export const VECTOR_STYLES: Record<VectorStyleId, VectorStyle> = {
  "plan-gray": planGray,
  "mono-line": monoLine,
  color,
};

export function getVectorStyle(id: VectorStyleId | string): VectorStyle {
  return VECTOR_STYLES[id as VectorStyleId] ?? planGray;
}

/** 그리는 순서 (낮은 등급 -> 높은 등급) */
export const ROAD_DRAW_ORDER: RoadClass[] = ["path", "service", "minor", "tertiary", "secondary", "primary", "trunk", "motorway"];

export const ROAD_CLASS_LABEL: Record<RoadClass, string> = {
  motorway: "고속도로",
  trunk: "주간선",
  primary: "간선",
  secondary: "보조간선",
  tertiary: "집산",
  minor: "국지",
  service: "이면",
  path: "보행",
  rail: "철도",
  transit: "지하철",
};

export const LABEL_KIND_NAME: Record<VectorLabelKind, string> = {
  place: "지명",
  road: "도로명",
  poi: "시설",
  water: "수역명",
  peak: "산",
};
