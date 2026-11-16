/**
 * 벡터 배경지도 -> SVG / 라벨 후보 변환 (순수 함수, Office.js·Leaflet 의존 없음)
 *  - project(lng,lat) 는 반올림하지 않은 px 를 돌려줘야 한다 (정수 반올림은 선이 들쭉날쭉해진다)
 *  - SVG 는 <g id="..."> 로 그룹을 나눠, PowerPoint 에서 "도형으로 변환 / 그룹 해제" 후에도 정리된 상태가 되게 한다
 */
import { measureText, type LabelCandidate, type PlacedLabel } from "../labels";
import { getVectorStyle, LABEL_KIND_NAME, ROAD_CLASS_LABEL, ROAD_DRAW_ORDER } from "./styles";
import type { Pt, RoadClass, VectorBasemapData, VectorFeature, VectorLabel, VectorLabelKind, VectorStyle, VectorStyleId } from "./types";

export type ProjectFn = (lng: number, lat: number) => { x: number; y: number };
export type FrameSize = { width: number; height: number };
export type LabelRect = { x0: number; y0: number; x1: number; y1: number };

/** 라벨 후보: 공용 LabelCandidate + 회전각(도, 도로명) */
export type VectorLabelCandidate = LabelCandidate & { angle?: number; cls?: string };
export type VectorPlacedLabel = PlacedLabel & { angle?: number; cls?: string };

export type SvgOptions = {
  includeLabels?: boolean;
  /** 배경 사각형 포함 (기본 true). 위에 다른 이미지를 겹칠 땐 false 로 투명하게 */
  background?: boolean;
  /** 'group': 도로를 등급별로 하나의 path 로 합침(가볍다, 기본) / 'feature': 도로 선마다 별도 path (개별 편집 가능, 무겁다) */
  granularity?: "group" | "feature";
  maxLabels?: number;
  /** 라벨을 놓을 수 있는 영역 (프레임 px). 지정하면 그 안에만 배치/후보 생성 (여유분 패딩 영역의 라벨이 maxLabels 를 잡아먹지 않게). 기본: 프레임 전체 */
  labelRect?: LabelRect;
  /** 단순화 허용 오차 px (기본 0.3) */
  simplify?: number;
};

export type SvgResult = {
  svg: string;
  bytes: number;
  /** 그려진 도형 수 (그룹별) */
  counts: Record<string, number>;
  placedLabels: VectorPlacedLabel[];
  zoomEq: number;
};

// ---------- 수학 유틸 ----------
const f2 = (n: number) => String(Math.round(n * 100) / 100);

/** 화면 환산 줌 (256px 타일 기준). 스케일된 CRS 에서도 "보이는 지상 해상도"로 도로 폭/라벨 밀도를 정하기 위해 */
export function viewZoomEq(data: VectorBasemapData, project: ProjectFn): number {
  const cx = (data.bounds.west + data.bounds.east) / 2;
  const cy = (data.bounds.south + data.bounds.north) / 2;
  const d = Math.min(0.001, Math.max(1e-5, (data.bounds.east - data.bounds.west) / 50));
  const a = project(cx, cy);
  const b = project(cx + d, cy);
  const ppd = Math.abs(b.x - a.x) / d; // px / 경도 1도
  return Math.log2((ppd * 360) / 256);
}

/** 줌에 따른 폭 배율: 16 에서 1.0 */
function widthScale(zoomEq: number) {
  return Math.max(0.28, Math.min(3, 2 ** ((zoomEq - 16) * 0.75)));
}

/** Douglas-Peucker (평탄 배열 [x0,y0,x1,y1...]) */
function simplifyFlat(pts: number[], eps: number): number[] {
  const n = pts.length / 2;
  if (n <= 2 || eps <= 0) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const e2 = eps * eps;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    if (b <= a + 1) continue;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax, py = pts[i * 2 + 1] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const qx = px - t * dx, qy = py - t * dy;
        d2 = qx * qx + qy * qy;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > e2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

function projectLine(coords: Pt[], project: ProjectFn, eps: number): number[] {
  const flat: number[] = [];
  let lx = NaN, ly = NaN;
  for (const c of coords) {
    const p = project(c[0], c[1]);
    // 거의 같은 점 제거
    if (Math.abs(p.x - lx) < 0.05 && Math.abs(p.y - ly) < 0.05) continue;
    flat.push(p.x, p.y);
    lx = p.x;
    ly = p.y;
  }
  return simplifyFlat(flat, eps);
}

function bboxOf(flat: number[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i], y = flat[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
const hits = (b: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, m: number) =>
  b.x1 >= -m && b.y1 >= -m && b.x0 <= w + m && b.y0 <= h + m;

function pathOfLine(flat: number[]): string {
  if (flat.length < 4) return "";
  let s = `M${f2(flat[0])} ${f2(flat[1])}`;
  for (let i = 2; i < flat.length; i += 2) s += `L${f2(flat[i])} ${f2(flat[i + 1])}`;
  return s;
}
function pathOfRing(flat: number[]): string {
  if (flat.length < 6) return "";
  return pathOfLine(flat) + "Z";
}

function lineParts(g: VectorFeature["geometry"]): Pt[][] {
  if (g.type === "LineString") return [g.coordinates as Pt[]];
  if (g.type === "MultiLineString") return g.coordinates as Pt[][];
  return [];
}
function polyParts(g: VectorFeature["geometry"]): Pt[][][] {
  if (g.type === "Polygon") return [g.coordinates as Pt[][]];
  if (g.type === "MultiPolygon") return g.coordinates as Pt[][][];
  return [];
}

/** 폴리곤 1개(링 여러 개)를 path d 로. 너무 작으면 빈 문자열 */
function polygonPath(rings: Pt[][], project: ProjectFn, w: number, h: number, eps: number): string {
  let d = "";
  let first = true;
  for (const ring of rings) {
    const flat = projectLine(ring, project, eps);
    if (flat.length < 6) {
      if (first) return "";
      continue;
    }
    const bb = bboxOf(flat);
    if (first) {
      if (!hits(bb, w, h, 2)) return "";
      if (bb.x1 - bb.x0 < 0.6 && bb.y1 - bb.y0 < 0.6) return "";
    } else if (bb.x1 - bb.x0 < 0.5 && bb.y1 - bb.y0 < 0.5) continue; // 아주 작은 구멍 생략
    d += pathOfRing(flat);
    first = false;
  }
  return d;
}

/** 폴리곤 윤곽선(타일 경계 변 제외) path d. 첫==끝 선분은 닫힘(Z) */
function outlinePath(lines: Pt[][], project: ProjectFn, w: number, h: number, eps: number): string {
  let d = "";
  for (const line of lines) {
    if (line.length < 2) continue;
    const flat = projectLine(line, project, eps);
    if (flat.length < 4 || !hits(bboxOf(flat), w, h, 2)) continue;
    const closed = line.length > 3 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
    d += closed ? pathOfRing(flat) : pathOfLine(flat);
  }
  return d;
}

/**
 * 폴리곤 1개를 path 요소로. 윤곽선 데이터(outline)가 있고 테두리를 그려야 하면
 * 면(fill, 테두리 없음)과 테두리(fill 없음, 타일 클립 경계 변 제외)를 별도 path 로 낸다 -> 타일 격자선 방지.
 * @param fillAttr 예: 'fill="#fff" fill-rule="evenodd"'  @param strokeAttr 앞에 공백 포함, 없으면 ""
 */
function polyShape(f: VectorFeature, pi: number, rings: Pt[][], project: ProjectFn, w: number, h: number, eps: number, fillAttr: string, strokeAttr: string): string {
  const d = polygonPath(rings, project, w, h, eps);
  if (!d) return "";
  const ol = f.outline?.[pi];
  // 이 파트에 클립 경계 변이 없으면(윤곽선 = 링 그대로) 한 path 로 충분
  if (!ol || !strokeAttr || (ol.length === rings.length && ol.every((l, i) => l === rings[i]))) return `<path d="${d}" ${fillAttr}${strokeAttr}/>`;
  const sd = outlinePath(ol, project, w, h, eps);
  return `<path d="${d}" ${fillAttr} stroke="none"/>` + (sd ? `<path d="${sd}" fill="none"${strokeAttr}/>` : "");
}

/** XML 1.0 에서 금지된 제어문자와 짝 없는 서로게이트를 제거한 뒤 이스케이프 (이름 데이터에 섞여 SVG 가 깨지는 것 방지) */
const XML_BAD = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g; // 구형 WebView 호환을 위해 lookbehind 미사용
const esc = (s: string) => s.replace(XML_BAD, (m) => (m.length === 2 ? m : "")).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- 라벨 후보 ----------
const PLACE_SIZE_FACTOR: Record<string, number> = { city: 1.45, town: 1.25, borough: 1.1, suburb: 1.1, village: 1, quarter: 1, neighbourhood: 0.9, island: 1, hamlet: 0.9 };
const PLACE_PRIORITY: Record<string, number> = { city: 900, town: 800, borough: 700, suburb: 690, village: 640, quarter: 650, island: 600, neighbourhood: 600, hamlet: 560 };
const PLACE_MIN_ZOOM: Record<string, number> = { city: 0, town: 0, borough: 11, suburb: 11, village: 11, island: 11, quarter: 12.5, neighbourhood: 14.5, hamlet: 14 };
const ROAD_LABEL_PRIORITY: Record<string, number> = { motorway: 500, trunk: 500, primary: 490, secondary: 470, tertiary: 440, minor: 300, service: 150, path: 100 };
const ROAD_LABEL_SIZE: Record<string, number> = { motorway: 1.1, trunk: 1.1, primary: 1.05, secondary: 1, tertiary: 1, minor: 0.95, service: 0.9, path: 0.85 };
const ROAD_LABEL_MIN_ZOOM: Record<string, number> = { motorway: 11, trunk: 11, primary: 12.5, secondary: 13.5, tertiary: 14.5, minor: 15.2, service: 16.4, path: 17 };
const POI_PRIORITY: Record<string, number> = { railway: 560, hospital: 430, school: 420, college: 430, town_hall: 420, park: 400, attraction: 410, museum: 410, stadium: 410, library: 400, police: 390, fire_station: 390 };

/** 화면 px 폴리라인 -> 사각형 r 안쪽의 연속 구간들 (Liang-Barsky 로 선분 단위 클리핑) */
function clipRuns(flat: number[], r: LabelRect): number[][] {
  const runs: number[][] = [];
  let cur: number[] | null = null;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const x0 = flat[i], y0 = flat[i + 1], x1 = flat[i + 2], y1 = flat[i + 3];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - r.x0, r.x1 - x0, y0 - r.y0, r.y1 - y0];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) ok = false;
      } else {
        const rr = q[k] / p[k];
        if (p[k] < 0) t0 = Math.max(t0, rr);
        else t1 = Math.min(t1, rr);
      }
    }
    if (!ok || t0 >= t1) {
      cur = null;
      continue;
    }
    const sx = x0 + t0 * dx, sy = y0 + t0 * dy, ex = x0 + t1 * dx, ey = y0 + t1 * dy;
    if (cur && Math.abs(cur[cur.length - 2] - sx) < 1e-6 && Math.abs(cur[cur.length - 1] - sy) < 1e-6) cur.push(ex, ey);
    else {
      cur = [sx, sy, ex, ey];
      runs.push(cur);
    }
  }
  return runs;
}

function pointAt(flat: number[], s: number): { x: number; y: number } {
  let acc = 0;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const dx = flat[i + 2] - flat[i], dy = flat[i + 3] - flat[i + 1];
    const l = Math.hypot(dx, dy);
    if (acc + l >= s || i + 4 >= flat.length) {
      const t = l ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
      return { x: flat[i] + dx * t, y: flat[i + 1] + dy * t };
    }
    acc += l;
  }
  return { x: flat[0], y: flat[1] };
}
const runLength = (flat: number[]) => {
  let l = 0;
  for (let i = 0; i + 3 < flat.length; i += 2) l += Math.hypot(flat[i + 2] - flat[i], flat[i + 3] - flat[i + 1]);
  return l;
};
/** 글자를 눕히는 각도 (-90, 90] */
function readableAngle(dx: number, dy: number): number {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (a > 90) a -= 180;
  else if (a <= -90) a += 180;
  return a;
}

/**
 * 공용 라벨 배치기(placeLabels)용 후보 생성.
 * 우선순위: 지명 > 주요 도로 > 역/시설 > 이면 도로. 도로명은 화면에서 보이는 가장 긴 구간의 중점 + angle(도).
 * @param rect 라벨을 놓을 수 있는 영역 (기본: 프레임 전체)
 */
export function vectorLabelCandidates(data: VectorBasemapData, project: ProjectFn, styleId: VectorStyleId | string, size: FrameSize, rect?: LabelRect): VectorLabelCandidate[] {
  const style = getVectorStyle(styleId);
  const zoomEq = viewZoomEq(data, project);
  const out: VectorLabelCandidate[] = [];
  const rc: LabelRect = rect ?? { x0: 0, y0: 0, x1: size.width, y1: size.height };

  for (const l of data.labels) {
    const ls = style.labels[l.kind];
    if (l.kind === "road") {
      if (!l.line) continue;
      const cls = l.cls ?? "minor";
      if (zoomEq < (ROAD_LABEL_MIN_ZOOM[cls] ?? 15)) continue;
      const fontSize = ls.size * (ROAD_LABEL_SIZE[cls] ?? 1);
      const flat = projectLine(l.line, project, 0.5);
      if (flat.length < 4) continue;
      const bb = bboxOf(flat);
      if (bb.x1 < rc.x0 || bb.y1 < rc.y0 || bb.x0 > rc.x1 || bb.y0 > rc.y1) continue;
      const tw = measureText(l.text, fontSize) + 2;
      let best: number[] | null = null;
      let bestLen = 0;
      for (const run of clipRuns(flat, rc)) {
        const len = runLength(run);
        if (len > bestLen) {
          best = run;
          bestLen = len;
        }
      }
      if (!best || bestLen < tw + 10) continue;
      const mid = pointAt(best, bestLen / 2);
      const a = pointAt(best, bestLen / 2 - tw / 2);
      const b = pointAt(best, bestLen / 2 + tw / 2);
      // 라벨 구간이 많이 휘면 건너뜀
      const a1 = Math.atan2(mid.y - a.y, mid.x - a.x);
      const a2 = Math.atan2(b.y - mid.y, b.x - mid.x);
      let diff = Math.abs(a1 - a2);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > 0.6) continue;
      out.push({
        text: l.text,
        x: mid.x,
        y: mid.y,
        fontSize,
        priority: (ROAD_LABEL_PRIORITY[cls] ?? 200) + Math.min(60, bestLen / 20),
        color: ls.color,
        halo: true,
        kind: "road",
        cls,
        angle: Math.round(readableAngle(b.x - a.x, b.y - a.y) * 10) / 10,
      });
      continue;
    }

    const p = project(l.lon, l.lat);
    if (p.x < rc.x0 || p.y < rc.y0 || p.x > rc.x1 || p.y > rc.y1) continue;
    const cls = l.cls ?? "";

    if (l.kind === "place") {
      if (zoomEq < (PLACE_MIN_ZOOM[cls] ?? 12)) continue;
      out.push({
        text: l.text,
        x: p.x,
        y: p.y,
        fontSize: Math.round(ls.size * (PLACE_SIZE_FACTOR[cls] ?? 1) * 10) / 10,
        priority: (PLACE_PRIORITY[cls] ?? 600) - Math.min(l.rank, 99) * 0.1,
        color: ls.color,
        bold: ls.bold,
        halo: true,
        kind: "place",
        cls,
      });
    } else if (l.kind === "poi") {
      const station = cls === "railway";
      if (zoomEq < (station ? 12.5 : 14.5)) continue;
      if (!station && zoomEq < 15.5 && l.rank > 2) continue;
      out.push({
        text: l.text,
        x: p.x,
        y: p.y,
        fontSize: ls.size * (station ? 1.1 : 1),
        priority: (POI_PRIORITY[cls] ?? 380) - Math.min(l.rank, 20) * 2,
        color: ls.color,
        bold: station,
        halo: true,
        anchor: "right",
        kind: "poi",
        cls,
      });
    } else if (l.kind === "water") {
      if (zoomEq < 13.5) continue;
      out.push({ text: l.text, x: p.x, y: p.y, fontSize: ls.size, priority: 450 - Math.min(l.rank, 20), color: ls.color, halo: true, kind: "water", cls });
    } else if (l.kind === "peak") {
      if (zoomEq < 12) continue;
      out.push({ text: l.text, x: p.x, y: p.y, fontSize: ls.size, priority: 420 - Math.min(l.rank, 20), color: ls.color, halo: true, anchor: "right", kind: "peak", cls });
    }
  }
  return out;
}

// ---------- SVG ----------
const FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif";

/**
 * 라벨 배치 - 공용 placeLabels 와 같은 규칙(우선순위, 같은 이름 2회 제한, 여백)이지만
 * 회전한 도로명의 충돌 영역을 회전 사각형의 외접 박스로 계산한다 (placeLabels 는 회전을 모른다).
 * 반환 box 는 회전 전 텍스트 상자(중심 = 앵커) - PowerPoint 에서 rotation 을 주면 그대로 맞는다.
 * @param rect 라벨을 놓을 수 있는 영역 (기본: 프레임 전체). 이 밖의 후보는 maxLabels 에 세지 않는다
 */
export function placeVectorLabels(data: VectorBasemapData, project: ProjectFn, styleId: VectorStyleId | string, size: FrameSize, maxLabels = 90, rect?: LabelRect): VectorPlacedLabel[] {
  const rc: LabelRect = rect ?? { x0: 0, y0: 0, x1: size.width, y1: size.height };
  const cands = vectorLabelCandidates(data, project, styleId, size, rc).sort((a, b) => b.priority - a.priority);
  const pad = 3, margin = 3;
  const placed: (VectorPlacedLabel & { _bb: { l: number; t: number; r: number; b: number } })[] = [];
  const seen = new Map<string, number>();
  for (const c of cands) {
    if (placed.length >= maxLabels) break;
    const w = measureText(c.text, c.fontSize, c.bold) + 2;
    const h = c.fontSize * 1.25;
    const left = c.anchor === "right" ? c.x + c.fontSize * 0.5 : c.x - w / 2;
    const top = c.y - h / 2;
    let bb = { l: left, t: top, r: left + w, b: top + h };
    if (c.angle) {
      const a = (c.angle * Math.PI) / 180;
      const ex = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2;
      const ey = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) / 2;
      bb = { l: c.x - ex, t: c.y - ey, r: c.x + ex, b: c.y + ey };
    }
    if (bb.l < rc.x0 + margin || bb.t < rc.y0 + margin || bb.r > rc.x1 - margin || bb.b > rc.y1 - margin) continue;
    const key = `${c.kind ?? ""}|${c.text}`;
    const prev = seen.get(key) ?? 0;
    if (prev >= 2) continue;
    if (placed.some((p) => bb.l < p._bb.r + pad && bb.r + pad > p._bb.l && bb.t < p._bb.b + pad && bb.b + pad > p._bb.t)) continue;
    placed.push({ ...c, box: { left, top, width: w, height: h }, _bb: bb });
    seen.set(key, prev + 1);
  }
  return placed.map(({ _bb, ...rest }) => (void _bb, rest));
}

function labelsSvg(placed: VectorPlacedLabel[], style: VectorStyle): string {
  const kinds: VectorLabelKind[] = ["water", "peak", "road", "poi", "place"];
  const textOf = (l: VectorPlacedLabel, halo: boolean) => {
    const ls = style.labels[(l.kind as VectorLabelKind) ?? "poi"];
    const right = l.anchor === "right";
    const x = right ? l.box.left + 1 : l.x;
    const y = l.y + l.fontSize * 0.35;
    const rot = l.angle ? ` transform="rotate(${f2(l.angle)} ${f2(l.x)} ${f2(l.y)})"` : "";
    const attrs =
      `x="${f2(x)}" y="${f2(y)}" font-size="${f2(l.fontSize)}" text-anchor="${right ? "start" : "middle"}"` +
      (l.bold || ls.bold ? ' font-weight="bold"' : "") +
      (ls.italic ? ' font-style="italic"' : "") +
      rot;
    return halo
      ? `<text ${attrs} fill="${ls.halo}" stroke="${ls.halo}" stroke-width="${f2(ls.haloWidth * 2)}" stroke-linejoin="round">${esc(l.text)}</text>`
      : `<text ${attrs} fill="${l.color ?? ls.color}">${esc(l.text)}</text>`;
  };
  let s = "";
  s += `<g id="라벨_후광" font-family="${FONT}">${placed.map((l) => textOf(l, true)).join("")}</g>`;
  for (const k of kinds) {
    const ls = placed.filter((l) => l.kind === k);
    if (!ls.length) continue;
    let inner = "";
    for (const l of ls) {
      if ((k === "poi" || k === "peak") && l.anchor === "right") {
        const ms = style.labels[k];
        inner += `<circle cx="${f2(l.x)}" cy="${f2(l.y)}" r="2.2" fill="${ms.color}" stroke="${ms.halo}" stroke-width="1"/>`;
      }
      inner += textOf(l, false);
    }
    s += `<g id="라벨_${LABEL_KIND_NAME[k]}" font-family="${FONT}">${inner}</g>`;
  }
  return s;
}

export function renderVectorBasemapSvg(data: VectorBasemapData, project: ProjectFn, size: FrameSize, styleId: VectorStyleId | string, opts: SvgOptions = {}): SvgResult {
  const style = getVectorStyle(styleId);
  const { width: w, height: h } = size;
  const eps = opts.simplify ?? 0.3;
  const zoomEq = viewZoomEq(data, project);
  const ws = widthScale(zoomEq);
  const counts: Record<string, number> = {};
  const perFeature = opts.granularity === "feature";
  const parts: string[] = [];
  const g = (id: string, inner: string, attrs = "") => {
    if (inner) parts.push(`<g id="${id}"${attrs ? " " + attrs : ""}>${inner}</g>`);
  };
  const feats = (name: string) => data.groups[name] ?? [];

  // 1) 배경
  if (opts.background !== false) parts.push(`<rect id="배경" x="0" y="0" width="${w}" height="${h}" fill="${style.background}"/>`);

  // 2) 토지이용 / 공원녹지 (면)
  {
    let inner = "";
    let n = 0;
    for (const f of feats("landuse")) {
      const fill = style.landuse[f.properties.cls ?? ""] ?? null;
      if (!fill) continue;
      polyParts(f.geometry).forEach((rings, pi) => {
        const e = polyShape(f, pi, rings, project, w, h, eps, `fill="${fill}" fill-rule="evenodd"`, "");
        if (!e) return;
        inner += e;
        n++;
      });
    }
    counts["토지이용"] = n;
    g("토지이용", inner);
  }
  {
    let inner = "";
    let n = 0;
    for (const f of feats("park")) {
      const c = f.properties.cls;
      const fill = c === "wood" ? style.park.wood ?? style.park.fill : c === "pitch" ? style.park.pitch ?? style.park.fill : style.park.fill;
      if (!fill && !style.park.stroke) continue;
      polyParts(f.geometry).forEach((rings, pi) => {
        const stroke = style.park.stroke ? ` stroke="${style.park.stroke}" stroke-width="0.6"` : "";
        const e = polyShape(f, pi, rings, project, w, h, eps, `fill="${fill ?? "none"}" fill-rule="evenodd"`, stroke);
        if (!e) return;
        inner += e;
        n++;
      });
    }
    counts["공원녹지"] = n;
    g("공원녹지", inner);
  }

  // 3) 수계
  {
    let inner = "";
    let n = 0;
    const sw = style.water.stroke ? ` stroke="${style.water.stroke}" stroke-width="${style.water.strokeWidth ?? 0.6}" stroke-linejoin="round"` : "";
    for (const f of feats("water")) {
      polyParts(f.geometry).forEach((rings, pi) => {
        const e = polyShape(f, pi, rings, project, w, h, eps, `fill="${style.water.fill}" fill-rule="evenodd"`, sw);
        if (!e) return;
        inner += e;
        n++;
      });
    }
    counts["수계"] = n;
    g("수계", inner);
  }
  {
    let d = "";
    let n = 0;
    for (const f of feats("waterway")) {
      for (const line of lineParts(f.geometry)) {
        const flat = projectLine(line, project, eps);
        if (flat.length < 4 || !hits(bboxOf(flat), w, h, 4)) continue;
        d += pathOfLine(flat);
        n++;
      }
    }
    counts["하천"] = n;
    if (d) g("하천", `<path d="${d}" fill="none" stroke="${style.waterway.stroke}" stroke-width="${f2(Math.max(0.6, style.waterway.width * ws))}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // 4) 건물
  if (style.building.minZoom <= zoomEq && (style.building.fill || style.building.stroke)) {
    let inner = "";
    let n = 0;
    const st = style.building.stroke ? ` stroke="${style.building.stroke}" stroke-width="${style.building.strokeWidth}" stroke-linejoin="round"` : "";
    for (const f of feats("building")) {
      polyParts(f.geometry).forEach((rings, pi) => {
        const e = polyShape(f, pi, rings, project, w, h, Math.min(eps, 0.25), `fill="${style.building.fill ?? "none"}" fill-rule="evenodd"`, st);
        if (!e) return;
        inner += e;
        n++;
      });
    }
    counts["건물"] = n;
    g("건물", inner);
  }

  // 5) 공항 시설
  {
    let inner = "";
    let n = 0;
    const rs = style.roads.secondary;
    for (const f of feats("aeroway")) {
      if (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") {
        polyParts(f.geometry).forEach((rings, pi) => {
          const e = polyShape(f, pi, rings, project, w, h, eps, `fill="${style.landuse.industrial ?? style.background}" fill-rule="evenodd"`, "");
          if (e) {
            inner += e;
            n++;
          }
        });
      } else {
        let d = "";
        for (const line of lineParts(f.geometry)) {
          const flat = projectLine(line, project, eps);
          if (flat.length >= 4 && hits(bboxOf(flat), w, h, 8)) d += pathOfLine(flat);
        }
        if (d) {
          inner += `<path d="${d}" fill="none" stroke="${rs.color}" stroke-width="${f2(Math.max(1, (f.properties.cls === "runway" ? 8 : 3) * ws))}"/>`;
          n++;
        }
      }
    }
    counts["공항"] = n;
    g("공항", inner);
  }

  // 6) 철도/지하철
  const roadFeats = feats("road");
  const byClass = new Map<RoadClass, VectorFeature[]>();
  for (const f of roadFeats) {
    const c = f.properties.cls as RoadClass;
    const a = byClass.get(c);
    if (a) a.push(f);
    else byClass.set(c, [f]);
  }
  const roadLines = (fs: VectorFeature[]): string[] => {
    const ds: string[] = [];
    for (const f of fs) {
      let d = "";
      for (const line of lineParts(f.geometry)) {
        const flat = projectLine(line, project, eps);
        if (flat.length < 4 || !hits(bboxOf(flat), w, h, 12)) continue;
        d += pathOfLine(flat);
      }
      if (d) ds.push(d);
    }
    return ds;
  };
  const strokeEl = (ds: string[], color: string, width: number, dash?: string, cap = "round") => {
    const attrs = `fill="none" stroke="${color}" stroke-width="${f2(width)}" stroke-linecap="${dash ? "butt" : cap}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""}`;
    if (!ds.length) return "";
    return perFeature ? ds.map((d) => `<path d="${d}" ${attrs}/>`).join("") : `<path d="${ds.join("")}" ${attrs}/>`;
  };
  const minW = (x: number) => Math.max(0.5, x);

  for (const rc of ["transit", "rail"] as RoadClass[]) {
    const rs = style.roads[rc];
    if (zoomEq < rs.minZoom) continue;
    const ds = roadLines(byClass.get(rc) ?? []);
    if (!ds.length) continue;
    counts[ROAD_CLASS_LABEL[rc]] = ds.length;
    let inner = strokeEl(ds, rs.color, minW(rs.width * Math.max(ws, 0.6)), rs.dash);
    if (rc === "rail" && !rs.dash) {
      // 철도: 선 위에 배경색 점선을 얹어 침목 표현
      inner += strokeEl(ds, "#ffffff", minW(rs.width * Math.max(ws, 0.6)) * 0.55, `${f2(4 * Math.max(ws, 0.6))} ${f2(4 * Math.max(ws, 0.6))}`);
    }
    g(`도로_${ROAD_CLASS_LABEL[rc]}`, inner);
  }

  // 7) 도로 (등급 낮은 것부터: 케이싱 -> 본선)
  for (const rc of ROAD_DRAW_ORDER) {
    const rs = style.roads[rc];
    if (zoomEq < rs.minZoom) continue;
    const fs = byClass.get(rc);
    if (!fs?.length) continue;
    // 터널은 반투명 처리
    const normal = roadLines(fs.filter((f) => f.properties.brunnel !== "tunnel"));
    const tunnel = roadLines(fs.filter((f) => f.properties.brunnel === "tunnel"));
    if (!normal.length && !tunnel.length) continue;
    counts[ROAD_CLASS_LABEL[rc]] = normal.length + tunnel.length;
    const wLine = minW(rs.width * ws);
    let inner = "";
    if (rs.casing) {
      const cw = wLine + 2 * Math.max(0.4, (rs.casingExtra ?? 1) * Math.max(ws, 0.5));
      inner += `<g id="${ROAD_CLASS_LABEL[rc]}_케이싱">${strokeEl(normal, rs.casing, cw, undefined, "round")}</g>`;
    }
    inner += `<g id="${ROAD_CLASS_LABEL[rc]}_본선">${strokeEl(normal, rs.color, wLine, rs.dash)}</g>`;
    if (tunnel.length) inner += `<g id="${ROAD_CLASS_LABEL[rc]}_터널" opacity="0.5">${strokeEl(tunnel, rs.color, wLine, "4 3")}</g>`;
    g(`도로_${ROAD_CLASS_LABEL[rc]}`, inner);
  }

  // 8) 행정경계
  {
    const maxLv = zoomEq < 11 ? 6 : style.boundary.maxLevel;
    const ds: string[] = [];
    for (const f of feats("boundary")) {
      if ((f.properties.admin ?? 99) > maxLv) continue;
      for (const line of lineParts(f.geometry)) {
        const flat = projectLine(line, project, eps);
        if (flat.length >= 4 && hits(bboxOf(flat), w, h, 4)) ds.push(pathOfLine(flat));
      }
    }
    counts["경계"] = ds.length;
    if (ds.length) g("행정경계", `<path d="${ds.join("")}" fill="none" stroke="${style.boundary.color}" stroke-width="${f2(style.boundary.width)}" stroke-dasharray="${style.boundary.dash}" stroke-linejoin="round"/>`);
  }

  // 9) 라벨
  let placed: VectorPlacedLabel[] = [];
  let labelSvg = "";
  if (opts.includeLabels !== false) {
    placed = placeVectorLabels(data, project, styleId, size, opts.maxLabels ?? 90, opts.labelRect);
    labelSvg = labelsSvg(placed, style);
    counts["라벨"] = placed.length;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><clipPath id="프레임"><rect x="0" y="0" width="${w}" height="${h}"/></clipPath></defs>` +
    `<g id="벡터배경지도" clip-path="url(#프레임)">${parts.join("")}${labelSvg}</g>` +
    `</svg>`;
  return { svg, bytes: new TextEncoder().encode(svg).length, counts, placedLabels: placed, zoomEq };
}

/** SVG 문자열만 필요할 때 */
export function vectorBasemapToSvg(data: VectorBasemapData, project: ProjectFn, size: FrameSize, styleId: VectorStyleId | string, opts?: SvgOptions): string {
  return renderVectorBasemapSvg(data, project, size, styleId, opts).svg;
}

export type { VectorLabel };
