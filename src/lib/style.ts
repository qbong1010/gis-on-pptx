/**
 * 레이어 스타일 모델 (v2)
 *  - 화면 미리보기(Leaflet)와 Bake 된 SVG 가 같은 `resolveStyle()` 결과를 쓰므로 모양이 일치한다.
 *  - 선 굵기·점 반지름·글자 크기는 모두 "슬라이드 100% 기준 px" (프레임 1pt = 4/3px)
 */
import type { FeatureCollection, Geometry } from "geojson";

import "@/lib/xml";

export type Dash = "solid" | "dash" | "dot" | "dashdot";
export type PointShape = "circle" | "square" | "triangle";
export type GeomKind = "polygon" | "line" | "point";

export type LabelStyle = {
  /** 라벨로 쓸 속성 필드 (null = 라벨 없음) */
  field: string | null;
  /** px (슬라이드 100% 기준) */
  size: number;
  color: string;
  bold: boolean;
  halo: boolean;
  /** true = PowerPoint 네이티브 텍스트 상자로 Bake (편집 가능), false = SVG 텍스트 */
  native: boolean;
};

export type LayerStyle = {
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  dash: Dash;
  fillColor: string;
  fillOpacity: number;
  pointRadius: number;
  pointShape: PointShape;
  /** 속성값별 분류 색상 (null = 단일 색) */
  categoryField: string | null;
  palette: string;
  label: LabelStyle;
};

export const DEFAULT_LABEL: LabelStyle = { field: null, size: 12, color: "#111827", bold: false, halo: true, native: true };

export const PALETTES: Record<string, { label: string; colors: string[] }> = {
  standard: { label: "기본", colors: ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#db2777", "#0891b2", "#ca8a04", "#4b5563", "#dc2626", "#65a30d"] },
  pastel: { label: "파스텔", colors: ["#93c5fd", "#fdba74", "#86efac", "#d8b4fe", "#f9a8d4", "#67e8f9", "#fde047", "#d1d5db", "#fca5a5", "#bef264"] },
  landuse: { label: "용도지역", colors: ["#f87171", "#fb923c", "#facc15", "#a3e635", "#34d399", "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#9ca3af"] },
};

export const OTHER_COLOR = "#9ca3af";

export type StylePreset = { id: string; label: string; hint: string; kind: GeomKind | "any"; style: Partial<LayerStyle> };

/** 도시계획 도면에서 자주 쓰는 표현 프리셋 */
export const STYLE_PRESETS: StylePreset[] = [
  { id: "plan-zone", label: "계획구역", hint: "빨간 굵은 점선, 채움 없음", kind: "polygon", style: { strokeColor: "#dc2626", strokeWidth: 3, strokeOpacity: 1, dash: "dash", fillOpacity: 0, fillColor: "#dc2626" } },
  { id: "target", label: "대상지", hint: "주황 채움 30%", kind: "polygon", style: { strokeColor: "#ea580c", strokeWidth: 2, strokeOpacity: 1, dash: "solid", fillColor: "#f97316", fillOpacity: 0.3 } },
  { id: "road", label: "도로", hint: "회색 굵은 선", kind: "line", style: { strokeColor: "#6b7280", strokeWidth: 4, strokeOpacity: 1, dash: "solid", fillOpacity: 0 } },
  { id: "admin", label: "행정경계", hint: "검정 일점쇄선", kind: "any", style: { strokeColor: "#111827", strokeWidth: 1.5, strokeOpacity: 1, dash: "dashdot", fillOpacity: 0 } },
  { id: "green", label: "녹지", hint: "초록 채움", kind: "polygon", style: { strokeColor: "#16a34a", strokeWidth: 1, strokeOpacity: 1, dash: "solid", fillColor: "#4ade80", fillOpacity: 0.45 } },
  { id: "rail", label: "철도", hint: "검정 선", kind: "line", style: { strokeColor: "#111827", strokeWidth: 2.5, strokeOpacity: 1, dash: "solid", fillOpacity: 0 } },
];

const AUTO_COLORS = ["#ea580c", "#2563eb", "#16a34a", "#9333ea", "#db2777", "#0891b2"];

/** 지오메트리 종류에 맞는 초기 스타일 */
export function defaultStyle(kind: GeomKind | "mixed", index = 0): LayerStyle {
  const c = AUTO_COLORS[index % AUTO_COLORS.length];
  const base: LayerStyle = {
    strokeColor: c,
    strokeWidth: 2,
    strokeOpacity: 1,
    dash: "solid",
    fillColor: c,
    fillOpacity: 0.3,
    pointRadius: 5,
    pointShape: "circle",
    categoryField: null,
    palette: "standard",
    label: { ...DEFAULT_LABEL },
  };
  if (kind === "line") return { ...base, strokeWidth: 3, fillOpacity: 0 };
  if (kind === "point") return { ...base, strokeColor: "#ffffff", strokeWidth: 1.5, fillColor: c, fillOpacity: 1 };
  return base;
}

export function applyPreset(base: LayerStyle, preset: StylePreset): LayerStyle {
  return { ...base, ...preset.style, label: base.label };
}

/* ------------------------------------------------------------------ */

export function featureKind(g: Geometry | null | undefined): GeomKind | null {
  switch (g?.type) {
    case "Polygon":
    case "MultiPolygon":
      return "polygon";
    case "LineString":
    case "MultiLineString":
      return "line";
    case "Point":
    case "MultiPoint":
      return "point";
    default:
      return null;
  }
}

/** 레이어 전체 종류와 속성 필드 목록 (앞쪽 일부만 훑는다) */
export function describeFc(fc: FeatureCollection): { kind: GeomKind | "mixed"; fields: string[] } {
  const kinds = new Set<GeomKind>();
  const fields: string[] = [];
  const seen = new Set<string>();
  const limit = Math.min(fc.features.length, 300);
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i];
    const k = featureKind(f.geometry);
    if (k) kinds.add(k);
    if (i < limit && f.properties) {
      for (const key of Object.keys(f.properties)) {
        if (!seen.has(key)) {
          seen.add(key);
          fields.push(key);
        }
      }
    }
    if (i >= limit && kinds.size > 1) break;
  }
  const kind: GeomKind | "mixed" = kinds.size === 1 ? [...kinds][0] : kinds.size === 0 ? "polygon" : "mixed";
  return { kind, fields };
}

/* ------------------------------------------------------------------ */
/* 분류 색상                                                            */
/* ------------------------------------------------------------------ */

export type Categories = { map: Map<string, string>; items: { value: string; color: string }[]; hasOther: boolean };

const MAX_CATS = 10;

/** 필드의 고유값을 팔레트 순서대로 색에 배정 (많은 값은 '기타'로 묶음) */
export function buildCategories(fc: FeatureCollection, style: LayerStyle): Categories | null {
  const field = style.categoryField;
  if (!field) return null;
  const colors = (PALETTES[style.palette] ?? PALETTES.standard).colors;
  const counts = new Map<string, number>();
  for (const f of fc.features) {
    const v = f.properties?.[field];
    const key = v === null || v === undefined || v === "" ? "(값 없음)" : String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  const map = new Map<string, string>();
  const items: { value: string; color: string }[] = [];
  sorted.slice(0, MAX_CATS).forEach(([v], i) => {
    const color = colors[i % colors.length];
    map.set(v, color);
    items.push({ value: v, color });
  });
  return { map, items, hasOther: sorted.length > MAX_CATS };
}

export function categoryColor(cats: Categories, props: Record<string, unknown> | null | undefined, field: string): string {
  const v = props?.[field];
  const key = v === null || v === undefined || v === "" ? "(값 없음)" : String(v);
  return cats.map.get(key) ?? OTHER_COLOR;
}

/* ------------------------------------------------------------------ */
/* 해석된 스타일 — 미리보기/SVG 공용                                       */
/* ------------------------------------------------------------------ */

export type Resolved = {
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  dashArray: string | null;
  cap: "butt" | "round";
  fill: string | null;
  fillOpacity: number;
  radius: number;
  shape: PointShape;
};

export function dashArrayFor(dash: Dash, width: number): string | null {
  const b = Math.max(width, 1);
  const f = (n: number) => Math.round(n * 100) / 100;
  switch (dash) {
    case "dash":
      return `${f(b * 4)} ${f(b * 2.5)}`;
    case "dot":
      return `${f(b)} ${f(b * 2)}`;
    case "dashdot":
      return `${f(b * 5)} ${f(b * 1.8)} ${f(b)} ${f(b * 1.8)}`;
    default:
      return null;
  }
}

export function resolveStyle(
  style: LayerStyle,
  kind: GeomKind,
  props?: Record<string, unknown> | null,
  cats?: Categories | null,
): Resolved {
  const cat = cats && style.categoryField ? categoryColor(cats, props, style.categoryField) : null;
  const dashArray = kind === "point" ? null : dashArrayFor(style.dash, style.strokeWidth);
  const cap: "butt" | "round" = dashArray ? "butt" : "round";
  if (kind === "polygon") {
    return {
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
      strokeOpacity: style.strokeOpacity,
      dashArray,
      cap,
      fill: style.fillOpacity > 0 ? (cat ?? style.fillColor) : null,
      fillOpacity: style.fillOpacity,
      radius: style.pointRadius,
      shape: style.pointShape,
    };
  }
  if (kind === "line") {
    return {
      stroke: cat ?? style.strokeColor,
      strokeWidth: style.strokeWidth,
      strokeOpacity: style.strokeOpacity,
      dashArray,
      cap,
      fill: null,
      fillOpacity: 0,
      radius: style.pointRadius,
      shape: style.pointShape,
    };
  }
  return {
    stroke: style.strokeColor,
    strokeWidth: style.strokeWidth,
    strokeOpacity: style.strokeOpacity,
    dashArray: null,
    cap: "round",
    fill: cat ?? style.fillColor,
    fillOpacity: style.fillOpacity,
    radius: style.pointRadius,
    shape: style.pointShape,
  };
}

/** 같은 스타일끼리 묶기 위한 키 */
export function resolvedKey(r: Resolved): string {
  return [r.stroke, r.strokeWidth, r.strokeOpacity, r.dashArray, r.fill, r.fillOpacity, r.radius, r.shape].join("|");
}

/* ------------------------------------------------------------------ */
/* SVG 조각 (Bake 와 범례가 공용)                                          */
/* ------------------------------------------------------------------ */

const r2 = (v: number) => Math.round(v * 100) / 100;

export { escapeXml } from "@/lib/xml";

/** 점 기호 하나 (원/사각/삼각) */
export function markerSvg(r: Resolved, cx: number, cy: number): string {
  const fill = r.fill ? `fill="${r.fill}" fill-opacity="${r.fillOpacity}"` : `fill="none"`;
  const stroke = r.strokeWidth > 0 ? ` stroke="${r.stroke}" stroke-opacity="${r.strokeOpacity}" stroke-width="${r.strokeWidth}"` : "";
  const R = r.radius;
  if (r.shape === "square") return `<rect x="${r2(cx - R)}" y="${r2(cy - R)}" width="${r2(R * 2)}" height="${r2(R * 2)}" ${fill}${stroke}/>`;
  if (r.shape === "triangle") {
    const h = R * 1.15;
    return `<path d="M${r2(cx)} ${r2(cy - h)}L${r2(cx + h)} ${r2(cy + h * 0.8)}L${r2(cx - h)} ${r2(cy + h * 0.8)}Z" ${fill}${stroke} stroke-linejoin="round"/>`;
  }
  return `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${R}" ${fill}${stroke}/>`;
}

/** 미리보기용 점 아이콘 (Leaflet divIcon 내부 SVG) */
export function markerIconHtml(r: Resolved): { html: string; size: number } {
  const pad = Math.ceil(r.strokeWidth) + 2;
  const size = Math.ceil(r.radius * 2.4 + pad * 2);
  const c = size / 2;
  return { html: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${markerSvg(r, c, c)}</svg>`, size };
}
