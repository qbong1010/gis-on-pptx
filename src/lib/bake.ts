/**
 * Bake (지도 박스 쪽) — 현재 화면 그대로를 슬라이드에 넣을 재료로 만든다 (D-026)
 *  - 벡터: 화면 범위로 잘라낸(bboxClip) 피처를 Leaflet 좌표 변환(사용자 CRS 포함)으로 화면 px 로 → SVG
 *          텍스트는 넣지 않는다 (그룹 해제 시 스타일 변형 문제, D-016)
 *  - 배경지도: 화면에 로드된 타일 <img> 들을 실제 화면 위치 그대로 캔버스에 합성 → PNG
 *          (타일이 같은 오리진 프록시로 와야 캔버스가 오염되지 않음, D-025)
 */
import L from "leaflet";
import { bboxClip } from "@turf/turf";
import type { Feature, Geometry, Polygon, MultiPolygon, LineString, MultiLineString, Position } from "geojson";

import type { BakeOptions, BakePayload, LayerState } from "@/shared/protocol";

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

function escapeXml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
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

export function buildSvg(map: L.Map, layers: LayerState[]): { svg: string; featureCount: number; width: number; height: number } {
  const size = map.getSize();
  const W = size.x;
  const H = size.y;
  const b = map.getBounds();
  // 약간 여유를 두고 자른 뒤, SVG 자체 clipPath 로 최종 경계를 맞춘다
  const padX = (b.getEast() - b.getWest()) * 0.02;
  const padY = (b.getNorth() - b.getSouth()) * 0.02;
  const bbox: [number, number, number, number] = [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY];

  const proj = makeProjector(map);
  const pt = (c: Position) => {
    const p = proj(c[0], c[1]);
    return `${r2(p.x)} ${r2(p.y)}`;
  };
  const ring = (cs: Position[], close: boolean) => (cs.length ? `M${cs.map(pt).join("L")}${close ? "Z" : ""}` : "");

  let count = 0;
  const groups: string[] = [];

  for (const layer of layers) {
    if (!layer.visible) continue;
    const c = layer.color;
    const polys: string[] = [];
    const lines: string[] = [];
    const points: Position[] = [];

    for (const f of layer.data.features) {
      const g = clipFeature(f, bbox);
      if (!g) continue;
      count++;
      switch (g.type) {
        case "Polygon":
          polys.push(g.coordinates.map((r) => ring(r, true)).join(""));
          break;
        case "MultiPolygon":
          polys.push(g.coordinates.map((p) => p.map((r) => ring(r, true)).join("")).join(""));
          break;
        case "LineString":
          lines.push(ring(g.coordinates, false));
          break;
        case "MultiLineString":
          lines.push(g.coordinates.map((l) => ring(l, false)).join(""));
          break;
        case "Point":
          points.push(g.coordinates);
          break;
        case "MultiPoint":
          g.coordinates.forEach((p) => points.push(p));
          break;
        default:
          break;
      }
    }

    const parts: string[] = [];
    for (const d of polys) {
      parts.push(`<path d="${d}" fill="${c}" fill-opacity="0.3" fill-rule="evenodd" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`);
    }
    for (const d of lines) {
      parts.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    for (const p of points) {
      const q = proj(p[0], p[1]);
      parts.push(`<circle cx="${r2(q.x)}" cy="${r2(q.y)}" r="5" fill="${c}" stroke="#ffffff" stroke-width="1.5"/>`);
    }
    if (parts.length) groups.push(`<g id="${escapeXml(layer.name)}">${parts.join("")}</g>`);
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>` +
    `<g clip-path="url(#frame)">${groups.join("")}</g>` +
    `</svg>`;
  return { svg, featureCount: count, width: W, height: H };
}

/* ------------------------------------------------------------------ */
/* 배경지도 → PNG                                                        */
/* ------------------------------------------------------------------ */

export async function captureBasemap(map: L.Map, scale = Math.max(2, window.devicePixelRatio || 1)): Promise<string> {
  const container = map.getContainer();
  const cRect = container.getBoundingClientRect();
  const W = Math.round(cRect.width);
  const H = Math.round(cRect.height);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";

  // DOM 순서 = 레이어 순서 (기본 → 오버레이)
  const tiles = Array.from(container.querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img.leaflet-tile"));
  let drawn = 0;
  for (const img of tiles) {
    if (!img.complete || img.naturalWidth === 0) continue;
    const r = img.getBoundingClientRect();
    if (r.right < cRect.left || r.left > cRect.right || r.bottom < cRect.top || r.top > cRect.bottom) continue;
    const layerEl = img.closest(".leaflet-layer") as HTMLElement | null;
    const opacity = layerEl ? Number(getComputedStyle(layerEl).opacity || "1") : 1;
    ctx.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
    ctx.drawImage(img, r.left - cRect.left, r.top - cRect.top, r.width, r.height);
    drawn++;
  }
  ctx.globalAlpha = 1;
  if (drawn === 0) throw new Error("화면에 로드된 배경지도 타일이 없습니다.");

  try {
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  } catch {
    throw new Error("배경지도 캡처가 브라우저 보안(CORS)으로 막혔습니다. dev 서버 타일 프록시를 거치는지 확인하세요.");
  }
}

/* ------------------------------------------------------------------ */

export async function makeBakePayload(map: L.Map, layers: LayerState[], options: BakeOptions): Promise<BakePayload> {
  const size = map.getSize();
  const notes: string[] = [];
  let svg: string | null = null;
  let png: string | null = null;
  let featureCount = 0;

  if (options.vectors) {
    const r = buildSvg(map, layers);
    featureCount = r.featureCount;
    if (r.featureCount > 0) svg = r.svg;
    else notes.push("화면 범위 안에 보이는 레이어 도형이 없습니다.");
  }
  if (options.basemap) {
    try {
      png = await captureBasemap(map);
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { widthPx: size.x, heightPx: size.y, svg, png, featureCount, notes };
}
