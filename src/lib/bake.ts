/**
 * 반영(Bake) 재료 만들기 — 패널의 지도 편집기 화면 그대로 (D-029, D-034)
 *  - 벡터: 화면 범위로 잘라낸(bboxClip) 피처를 반올림 없는 투영(D-028)으로 px → 레이어별 SVG
 *  - 라벨: 배치 후 네이티브 텍스트 상자 또는 SVG <text>
 *  - 배경지도: 로드된 타일 <img> 를 화면 위치대로 캔버스에 합성 → PNG (CORS 허용 타일, D-025/D-027)
 */
import L from "leaflet";
import { bboxClip } from "@turf/turf";
import type { Feature, Geometry, Polygon, MultiPolygon, LineString, MultiLineString, Position } from "geojson";

import { TILE_CROSS_ORIGIN, type Basemap } from "@/lib/basemaps";
import { tilePx } from "@/shared/crs";
import { placeLabels, type LabelCandidate, type PlacedLabel } from "@/lib/labels";
import { haloText } from "@/lib/decorations";
import { stripInvalidXml, xmlId } from "@/lib/xml";
import {
  buildCategories,
  featureKind,
  markerSvg,
  resolveStyle,
  resolvedKey,
  type Categories,
  type GeomKind,
  type LayerStyle,
  type Resolved,
} from "@/lib/style";

/** SVG 좌표 소수 2자리 (0.01px) — 정밀도 손실로 인한 흔들림 방지 */
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 경위도 → 지도 박스 화면 px (반올림 없음) (D-028)
 * Leaflet 의 latLngToContainerPoint 는 내부에서 latLngToLayerPoint → project(...)._round() 로
 * **정수 px 로 반올림**한다. 화면에선 1px 이하라 안 보이지만, 정점이 촘촘한 직선 변이 ±0.5px 씩
 * 지그재그가 되고 슬라이드 크기로 확대되면 "지글지글"하게 보인다. → project() 결과를 그대로 쓴다.
 */
export function makeProjector(map: L.Map): (lng: number, lat: number) => { x: number; y: number } {
  const zoom = map.getZoom();
  const origin = map.getPixelOrigin();
  const pane = map.containerPointToLayerPoint([0, 0]); // = -(map pane offset)
  return (lng, lat) => {
    const p = map.project(L.latLng(lat, lng), zoom);
    return { x: p.x - origin.x - pane.x, y: p.y - origin.y - pane.y };
  };
}

/* ------------------------------------------------------------------ */
/* 벡터 → SVG                                                           */
/* ------------------------------------------------------------------ */

function clipFeature(f: Feature, bbox: [number, number, number, number]): Geometry | null {
  const g = f.geometry;
  if (!g) return null;
  switch (g.type) {
    case "Polygon":
    case "MultiPolygon":
    case "LineString":
    case "MultiLineString": {
      const clipped = bboxClip(f as Feature<Polygon | MultiPolygon | LineString | MultiLineString>, bbox);
      const cg = clipped.geometry;
      const empty =
        !cg ||
        (cg.type === "Polygon" && cg.coordinates.length === 0) ||
        (cg.type === "MultiPolygon" && cg.coordinates.every((p) => p.length === 0)) ||
        (cg.type === "LineString" && cg.coordinates.length < 2) ||
        (cg.type === "MultiLineString" && cg.coordinates.every((l) => l.length < 2));
      return empty ? null : cg;
    }
    case "Point": {
      const [x, y] = g.coordinates;
      return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3] ? g : null;
    }
    case "MultiPoint": {
      const pts = g.coordinates.filter(([x, y]) => x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3]);
      return pts.length ? { type: "MultiPoint", coordinates: pts } : null;
    }
    default:
      return null; // GeometryCollection 은 MVP 에서 제외
  }
}

/* ================================================================== */
/* v2 — 레이어별 SVG / 라벨 / 배경지도 (패널 편집기용)                     */
/* ================================================================== */

export type BakeLayer = {
  id: string;
  name: string;
  style: LayerStyle;
  data: import("geojson").FeatureCollection;
  kind?: GeomKind | "mixed";
};

/** 지도 중심 기준 1px 당 미터 (축척 계산용). CSS 배율과 무관 (Leaflet 내부 좌표 사용) */
export function metersPerPx(map: L.Map): number {
  const s = map.getSize();
  const cy = s.y / 2;
  const a = map.containerPointToLatLng([s.x / 2 - 50, cy]);
  const b = map.containerPointToLatLng([s.x / 2 + 50, cy]);
  return map.distance(a, b) / 100;
}

function viewBbox(map: L.Map): [number, number, number, number] {
  const b = map.getBounds();
  const padX = (b.getEast() - b.getWest()) * 0.03;
  const padY = (b.getNorth() - b.getSouth()) * 0.03;
  return [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY];
}

/** 레이어 하나의 SVG 본문(<g>…</g>) — 스타일은 resolveStyle 로 미리보기와 동일 */
export function layerSvgBody(map: L.Map, layer: BakeLayer): { body: string; count: number; skipped: number } {
  const bbox = viewBbox(map);
  const proj = makeProjector(map);
  const pt = (c: Position) => {
    const p = proj(c[0], c[1]);
    return `${r2(p.x)} ${r2(p.y)}`;
  };
  const ring = (cs: Position[], close: boolean) => (cs.length ? `M${cs.map(pt).join("L")}${close ? "Z" : ""}` : "");
  const cats: Categories | null = buildCategories(layer.data, layer.style);
  const data = flattenCollections(layer.data);

  // 같은 스타일끼리 한 path 로 묶는다
  const paths = new Map<string, { r: Resolved; kind: GeomKind; d: string[] }>();
  const marks: string[] = [];
  let count = 0;
  let skipped = 0;
  for (const f of data.features) {
    const kind = featureKind(f.geometry);
    if (!kind) {
      skipped++;
      continue;
    }
    if (isEmptyGeometry(f.geometry)) {
      skipped++;
      continue;
    }
    const g = clipFeature(f, bbox);
    if (!g) continue;
    count++;
    const r = resolveStyle(layer.style, kind, f.properties as Record<string, unknown> | null, cats);
    if (kind === "point") {
      const pts = g.type === "Point" ? [g.coordinates] : g.type === "MultiPoint" ? g.coordinates : [];
      for (const p of pts) {
        const q = proj(p[0], p[1]);
        marks.push(markerSvg(r, q.x, q.y));
      }
      continue;
    }
    let d = "";
    if (g.type === "Polygon") d = g.coordinates.map((x) => ring(x, true)).join("");
    else if (g.type === "MultiPolygon") d = g.coordinates.map((p) => p.map((x) => ring(x, true)).join("")).join("");
    else if (g.type === "LineString") d = ring(g.coordinates, false);
    else if (g.type === "MultiLineString") d = g.coordinates.map((l) => ring(l, false)).join("");
    if (!d) continue;
    const key = kind + resolvedKey(r);
    const e = paths.get(key) ?? { r, kind, d: [] };
    e.d.push(d);
    paths.set(key, e);
  }
  const parts: string[] = [];
  for (const { r, kind, d } of paths.values()) {
    const stroke =
      r.strokeWidth > 0
        ? ` stroke="${r.stroke}" stroke-opacity="${r.strokeOpacity}" stroke-width="${r.strokeWidth}" stroke-linejoin="round" stroke-linecap="${r.cap}"${r.dashArray ? ` stroke-dasharray="${r.dashArray}"` : ""}`
        : "";
    const fill = kind === "polygon" && r.fill ? ` fill="${r.fill}" fill-opacity="${r.fillOpacity}" fill-rule="evenodd"` : ' fill="none"';
    parts.push(`<path d="${d.join("")}"${fill}${stroke}/>`);
  }
  parts.push(...marks);
  return { body: parts.length ? `<g id="layer-${xmlId(layer.name)}">${parts.join("")}</g>` : "", count, skipped };
}

/** clipId: SVG 마다 고유해야 한다 (같은 슬라이드에 여러 SVG 가 있을 때 id 충돌 방지, L7) */
export function svgDoc(W: number, H: number, body: string, clipId = "frame"): string {
  const id = xmlId(clipId);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><clipPath id="${id}"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>` +
    `<g clip-path="url(#${id})">${body}</g></svg>`
  );
}

/* ---------- 지오메트리 정리 (L5) ---------- */

export function isEmptyGeometry(g: Geometry | null | undefined): boolean {
  if (!g) return true;
  switch (g.type) {
    case "Point":
      return !Array.isArray(g.coordinates) || g.coordinates.length < 2 || !Number.isFinite(g.coordinates[0]) || !Number.isFinite(g.coordinates[1]);
    case "MultiPoint":
    case "LineString":
      return !g.coordinates?.length;
    case "MultiLineString":
    case "Polygon":
      return !g.coordinates?.length || g.coordinates.every((r) => !r.length);
    case "MultiPolygon":
      return !g.coordinates?.length || g.coordinates.every((p) => !p.length || p.every((r) => !r.length));
    case "GeometryCollection":
      return !g.geometries?.length || g.geometries.every(isEmptyGeometry);
  }
  return true;
}

const flatCache = new WeakMap<import("geojson").FeatureCollection, import("geojson").FeatureCollection>();
/** GeometryCollection 을 멤버별 피처로 펼친 사본 (없으면 원본 그대로). 원본 객체 기준으로 캐시 */
export function flattenCollections(fc: import("geojson").FeatureCollection): import("geojson").FeatureCollection {
  const hit = flatCache.get(fc);
  if (hit) return hit;
  let any = false;
  const out: Feature[] = [];
  const walk = (f: Feature, g: Geometry | null) => {
    if (g && g.type === "GeometryCollection") {
      for (const m of g.geometries) walk(f, m);
      return;
    }
    out.push(g === f.geometry ? f : { ...f, geometry: g as Geometry });
  };
  for (const f of fc.features) {
    if (f.geometry?.type === "GeometryCollection") {
      any = true;
      walk(f, f.geometry);
    } else out.push(f);
  }
  const res = any ? { ...fc, features: out } : fc;
  flatCache.set(fc, res);
  return res;
}

/* ---------- 라벨 ---------- */

type Proj = (lng: number, lat: number) => { x: number; y: number };

function anchorOf(g: Geometry, proj: Proj): { x: number; y: number; weight: number } | null {
  const avg = (cs: Position[]) => {
    let x = 0;
    let y = 0;
    for (const c of cs) {
      const p = proj(c[0], c[1]);
      x += p.x;
      y += p.y;
    }
    return { x: x / cs.length, y: y / cs.length };
  };
  const bboxArea = (cs: Position[]) => {
    let a = Infinity;
    let b = Infinity;
    let c = -Infinity;
    let d = -Infinity;
    for (const q of cs) {
      const p = proj(q[0], q[1]);
      a = Math.min(a, p.x);
      b = Math.min(b, p.y);
      c = Math.max(c, p.x);
      d = Math.max(d, p.y);
    }
    return (c - a) * (d - b);
  };
  switch (g.type) {
    case "Point": {
      const p = proj(g.coordinates[0], g.coordinates[1]);
      return { ...p, weight: 1 };
    }
    case "Polygon":
      return { ...avg(g.coordinates[0]), weight: bboxArea(g.coordinates[0]) };
    case "MultiPolygon": {
      const big = [...g.coordinates].sort((a, b) => b[0].length - a[0].length)[0];
      return { ...avg(big[0]), weight: bboxArea(big[0]) };
    }
    case "LineString": {
      const c = g.coordinates[Math.floor(g.coordinates.length / 2)];
      return { ...proj(c[0], c[1]), weight: g.coordinates.length };
    }
    case "MultiLineString": {
      const big = [...g.coordinates].sort((a, b) => b.length - a.length)[0];
      const c = big[Math.floor(big.length / 2)];
      return { ...proj(c[0], c[1]), weight: big.length };
    }
    case "MultiPoint": {
      const c = g.coordinates[0];
      if (!c) return null;
      return { ...proj(c[0], c[1]), weight: 1 };
    }
    default:
      return null;
  }
}

/** 보이는 레이어들의 라벨을 충돌 제거하며 배치. 결과의 kind = "data:<layerId>" (layers 는 아래→위 순서) */
export function placeDataLabels(map: L.Map, layers: BakeLayer[], W: number, H: number): PlacedLabel[] {
  const proj = makeProjector(map);
  const cands: LabelCandidate[] = [];
  layers.forEach((layer, li) => {
    const lb = layer.style.label;
    if (!lb.field) return;
    for (const f of flattenCollections(layer.data).features) {
      const raw = f.properties?.[lb.field];
      if (raw === null || raw === undefined || raw === "") continue;
      const g = f.geometry;
      if (!g || isEmptyGeometry(g)) continue;
      const a = anchorOf(g, proj);
      if (!a || !Number.isFinite(a.x)) continue;
      if (a.x < -50 || a.y < -50 || a.x > W + 50 || a.y > H + 50) continue;
      cands.push({
        text: stripInvalidXml(String(raw)),
        x: a.x,
        y: a.y,
        fontSize: lb.size,
        color: lb.color,
        bold: lb.bold,
        halo: lb.halo,
        anchor: g.type === "Point" || g.type === "MultiPoint" ? "right" : "center",
        priority: li * 1e7 + Math.min(a.weight, 9e6),
        kind: `data:${layer.id}`,
      });
    }
  });
  return placeLabels(cands, { width: W, height: H, maxLabels: 120, padding: 3 });
}

/** SVG <text> 라벨 (native 가 아닌 것) */
export function labelsSvgBody(placed: PlacedLabel[]): string {
  return placed
    .map((l) => {
      const cx = l.anchor === "right" ? l.box.left : l.box.left + l.box.width / 2;
      const y = l.box.top + l.box.height / 2 + l.fontSize * 0.35;
      return haloText(l.text, cx, y, {
        size: l.fontSize,
        color: l.color ?? "#111827",
        anchor: l.anchor === "right" ? "start" : "middle",
        bold: l.bold,
        halo: l.halo !== false,
      });
    })
    .join("");
}

/* ---------- 배경지도 ---------- */

export type BasemapCapture = { png: string; tiles: number; /** 프레임과 겹치지만 로드되지 않은(실패·미완료) 타일 수 */ bad: number };

const tileOk = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

function frameTiles(map: L.Map, roots?: HTMLElement[]): { img: HTMLImageElement; x: number; y: number; w: number; h: number }[] {
  const container = map.getContainer();
  const W = container.offsetWidth;
  const H = container.offsetHeight;
  const cRect = container.getBoundingClientRect();
  const vs = cRect.width / W || 1;
  const out: { img: HTMLImageElement; x: number; y: number; w: number; h: number }[] = [];
  for (const img of Array.from(container.querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img.leaflet-tile"))) {
    if (roots ? !roots.some((r) => r.contains(img)) : img.closest(".sm-hires")) continue; // 고해상도 임시 레이어는 일반 캡처에서 제외
    const r = img.getBoundingClientRect();
    const x = (r.left - cRect.left) / vs;
    const y = (r.top - cRect.top) / vs;
    const w = r.width / vs;
    const h = r.height / vs;
    if (x + w < 0 || x > W || y + h < 0 || y > H) continue;
    out.push({ img, x, y, w, h });
  }
  return out;
}

/** 로드 실패/미완료 타일을 한 번 다시 요청하고 완료를 기다린다. 남은 불량 타일 수를 돌려준다 (M3) */
export async function retryBadTiles(map: L.Map, timeoutMs = 6000): Promise<number> {
  const bad = frameTiles(map).filter((t) => !tileOk(t.img));
  if (!bad.length) return 0;
  for (const { img } of bad) {
    const src = img.src;
    if (!src) continue;
    img.src = src + (src.includes("?") ? "&" : "?") + "retry=1";
  }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
    if (bad.every((t) => tileOk(t.img))) break;
  }
  return frameTiles(map).filter((t) => !tileOk(t.img)).length;
}

/**
 * 미리보기 지도의 타일 <img> 들을 캔버스(가상 크기 × scale)에 합성.
 * 미리보기는 CSS transform 으로 축소되어 있으므로 getBoundingClientRect 차이를 시각 배율로 나눈다.
 */
export async function captureBasemapV2(map: L.Map, scale = 2, roots?: HTMLElement[]): Promise<BasemapCapture> {
  const container = map.getContainer();
  const W = container.offsetWidth;
  const H = container.offsetHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";
  let drawn = 0;
  let bad = 0;
  for (const { img, x, y, w, h } of frameTiles(map, roots)) {
    if (!tileOk(img)) {
      bad++;
      continue;
    }
    const layerEl = img.closest(".leaflet-layer") as HTMLElement | null;
    const op = layerEl ? Number(getComputedStyle(layerEl).opacity || "1") : 1;
    ctx.globalAlpha = Number.isFinite(op) ? op : 1;
    // 타일 사이 틈 방지를 위해 살짝 겹쳐 그린다
    ctx.drawImage(img, x - 0.25, y - 0.25, w + 0.5, h + 0.5);
    drawn++;
  }
  ctx.globalAlpha = 1;
  try {
    return { png: canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""), tiles: drawn, bad };
  } catch {
    throw new Error("배경지도 캡처가 브라우저 보안(CORS)으로 막혔습니다. dev 서버 타일 프록시/crossOrigin 설정을 확인하세요.");
  }
}

/**
 * 2× 고해상도 배경지도 (L3): 같은 지도에 "한 줌 레벨 더 높은" 타일 레이어(zoomOffset +1, 타일 크기 절반)를 임시로 얹어
 * 실제로 4배 많은 타일을 받아 캡처한다 (단순 확대가 아님). 원본이 그 줌을 지원하지 않거나 타일이 하나라도 실패하면 null → 호출자가 1× 로 대체.
 * 글자가 없는 배경지도(hiResOk)에만 쓴다. 임시 레이어는 기본 레이어 아래(z-index 0)에 두어 화면에는 보이지 않는다.
 */
export async function captureHiRes(map: L.Map, bm: Basemap, tileScale: number, timeoutMs = 15000): Promise<BasemapCapture | null> {
  if (bm.kind !== "raster" || !bm.hiResOk) return null; // 글자가 구워진 타일은 z+1 로 받으면 글자가 절반 크기가 되어 WYSIWYG 가 깨진다
  const tz = Math.round(map.getZoom());
  if (tz + 1 > bm.maxNativeZoom) return null;
  const layers: L.TileLayer[] = [];
  try {
    for (const url of [bm.url, ...(bm.overlayUrl ? [bm.overlayUrl] : [])]) {
      const t = L.tileLayer(url, {
        tileSize: tilePx(tileScale) / 2,
        zoomOffset: 1,
        maxNativeZoom: bm.maxNativeZoom - 1,
        maxZoom: 21,
        subdomains: bm.subdomains ?? "abc",
        crossOrigin: TILE_CROSS_ORIGIN,
        keepBuffer: 0,
        className: "sm-hires",
      });
      t.addTo(map);
      t.setZIndex(0);
      layers.push(t);
    }
    await Promise.all(
      layers.map(
        (t) =>
          new Promise<void>((resolve) => {
            let done = false;
            const fin = () => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            t.once("load", fin);
            setTimeout(fin, timeoutMs);
          }),
      ),
    );
    const roots = layers.map((t) => t.getContainer()).filter(Boolean) as HTMLElement[];
    const cap = await captureBasemapV2(map, 2, roots);
    return cap.bad > 0 || cap.tiles === 0 ? null : cap;
  } catch {
    return null;
  } finally {
    layers.forEach((t) => map.removeLayer(t));
  }
}
