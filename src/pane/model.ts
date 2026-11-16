/**
 * v2 패널 데이터 모델 (docs/ARCHITECTURE.md §4)
 * 레거시 src/shared/protocol.ts 는 건드리지 않고 새 타입은 여기에 둔다.
 */
import type { BBox } from "geojson";

import type { DecoPos, LegendPreset, NorthPreset, ScalePreset } from "@/lib/decorations";
import { defaultStyle, type GeomKind, type LayerStyle } from "@/lib/style";

/** 슬라이드 위 위치 (pt). 16:9 기본 슬라이드는 960×540pt */
export type Frame = { left: number; top: number; width: number; height: number };

export const PX_PER_PT = 4 / 3;
export const DEFAULT_SLIDE = { width: 960, height: 540 };

export type LayerMeta = {
  id: string;
  name: string;
  visible: boolean;
  bbox: BBox;
  featureCount: number;
  kind: GeomKind | "mixed";
  fields: string[];
  style: LayerStyle;
};

export type DecoSettings = {
  north: { show: boolean; preset: NorthPreset; size: number; color: string; pos: DecoPos };
  scale: { show: boolean; preset: ScalePreset; color: string; pos: DecoPos };
  legend: { show: boolean; preset: LegendPreset; title: string; pos: DecoPos };
};

export type BakeOptions = {
  basemap: boolean;
  shapes: boolean;
  labels: boolean;
  /** 레이어별로 SVG 를 따로 (false = 하나로 합침) */
  split: boolean;
  /** 반영 후 하나로 묶기 (PowerPointApi 1.8) */
  group: boolean;
  /** 벡터 배경지도의 글자를 PowerPoint 텍스트 상자로 (false = SVG 안에 포함) */
  basemapLabelsNative: boolean;
};

export type MapDoc = {
  v: 2;
  id: string;
  name: string;
  slideId: string | null;
  frame: Frame;
  view: { center: [number, number]; zoom: number };
  settings: { basemapId: string; tileScale: number };
  layers: LayerMeta[]; // 아래 → 위 (그리는 순서)
  deco: DecoSettings;
  bake: BakeOptions;
  updatedAt: number;
  /** 마지막 반영 때 슬라이드에 넣은 지도 영역 (pt). 슬라이드에서 사용자가 바꿨는지 판별 (H3) */
  bakedFrame?: Frame | null;
  /** 마지막 반영 때 꾸미기 요소의 슬라이드 위치 (pt). 사용자가 옮겼는지 판별 (H4) */
  bakedPos?: Partial<Record<DecoName, { left: number; top: number }>>;
  /** 사용자가 슬라이드에서 옮겨 둔 꾸미기 위치 — 지도 영역 왼쪽 위 기준 오프셋(pt). 영역을 옮기면 같이 따라간다 */
  userRel?: Partial<Record<DecoName, { x: number; y: number }>>;
  /** 마지막 반영 시점의 반영 관련 필드 해시 (반영 안 된 변경 감지) */
  bakedHash?: string;
  /** 이 앱보다 새 버전이 저장한 문서 (읽기 전용으로 연다) */
  futureV?: number;
};

export type DecoName = "north" | "scale" | "legend";

export const DEFAULT_VIEW: MapDoc["view"] = { center: [37.4979, 127.0276], zoom: 15 };

export const DEFAULT_DECO: DecoSettings = {
  north: { show: true, preset: "arrow", size: 64, color: "#111827", pos: { corner: "tr", margin: 16 } },
  scale: { show: true, preset: "bar", color: "#111827", pos: { corner: "bl", margin: 16 } },
  legend: { show: true, preset: "box", title: "범 례", pos: { corner: "br", margin: 16 } },
};

export const DEFAULT_BAKE: BakeOptions = { basemap: true, shapes: true, labels: true, split: true, group: false, basemapLabelsNative: true };

/** 프레임 가상 크기(px) — 정수로 반올림 */
export function virtualSize(f: Frame): { W: number; H: number } {
  return { W: Math.max(64, Math.round(f.width * PX_PER_PT)), H: Math.max(64, Math.round(f.height * PX_PER_PT)) };
}

export function defaultFrame(slide = DEFAULT_SLIDE, width = 600): Frame {
  const height = Math.round((width * 9) / 16);
  return {
    left: Math.round((slide.width - width) / 2),
    top: Math.round((slide.height - height) / 2),
    width,
    height,
  };
}

export function newMapDoc(id: string, name: string, basemapId: string, slide = DEFAULT_SLIDE): MapDoc {
  return {
    v: 2,
    id,
    name,
    slideId: null,
    frame: defaultFrame(slide),
    view: { ...DEFAULT_VIEW },
    settings: { basemapId, tileScale: 1 },
    layers: [],
    deco: JSON.parse(JSON.stringify(DEFAULT_DECO)),
    bake: { ...DEFAULT_BAKE },
    updatedAt: Date.now(),
  };
}

/** 저장된 구버전/부분 문서를 안전하게 보정 (L2: 레이어 스타일·라벨 누락 필드는 기본값으로 채운다) */
export function normalizeMapDoc(raw: Partial<MapDoc> & { id: string }): MapDoc {
  const base = newMapDoc(raw.id, raw.name ?? "지도", raw.settings?.basemapId ?? "osm");
  const layers = (raw.layers ?? []).map((l, i) => {
    const kind = l.kind ?? "polygon";
    const def = defaultStyle(kind, i);
    return {
      ...l,
      kind,
      visible: l.visible !== false,
      fields: l.fields ?? [],
      style: { ...def, ...(l.style ?? {}), label: { ...def.label, ...(l.style?.label ?? {}) } },
    } as LayerMeta;
  });
  const future = typeof raw.v === "number" && raw.v > 2 ? raw.v : undefined;
  return {
    ...base,
    ...raw,
    v: 2,
    futureV: future,
    frame: { ...base.frame, ...(raw.frame ?? {}) },
    view: raw.view ?? base.view,
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    layers,
    deco: {
      north: { ...base.deco.north, ...(raw.deco?.north ?? {}) },
      scale: { ...base.deco.scale, ...(raw.deco?.scale ?? {}) },
      legend: { ...base.deco.legend, ...(raw.deco?.legend ?? {}) },
    },
    bake: { ...base.bake, ...(raw.bake ?? {}) },
  };
}

/** 반영 결과에 영향을 주는 필드의 해시 — 마지막 반영 이후 바뀌었는지(dirty) 판단용 */
export function hashDoc(d: MapDoc): string {
  const view = { c: [Math.round(d.view.center[0] * 1e6), Math.round(d.view.center[1] * 1e6)], z: Math.round(d.view.zoom * 1000) };
  const str = JSON.stringify([d.frame, view, d.settings, d.layers.map((l) => [l.id, l.visible, l.name, l.style]), d.deco, d.bake]);
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 33) + c) | 0;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${str.length}`;
}

/** 슬라이드 도형 → 부분 이름 (UI 표시용) */
export function partLabel(part: string): string {
  if (part === "basemap") return "배경지도";
  if (part.startsWith("layer:")) return "도형";
  const m: Record<string, string> = { frame: "지도 영역", labels: "라벨", label: "라벨", north: "방위표", scale: "축척", legend: "범례", group: "묶음", shapes: "도형" };
  return m[part] ?? part;
}
