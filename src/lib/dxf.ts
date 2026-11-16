/**
 * DXF 읽기 (dxf-parser) → GeoJSON FeatureCollection (원 좌표 그대로)
 *  - 지원 엔티티: LINE, LWPOLYLINE/POLYLINE(bulge 호 포함), CIRCLE, ARC, ELLIPSE, POINT, SPLINE(근사),
 *                 TEXT/MTEXT(→ Point), SOLID/3DFACE(→ Polygon), INSERT(블록 재귀 전개, 깊이 4),
 *                 HATCH 경계(→ Polygon/MultiPolygon, 자체 파서를 dxf-parser 에 등록)
 *  - 미지원(건너뜀): DIMENSION, LEADER, IMAGE 등 dxf-parser 가 해석하지 않는 엔티티
 *  - Z 는 버린다. 좌표계 정보가 DXF 에는 없으므로 importers 가 결정한다.
 *  - 인코딩: $DWGCODEPAGE 가 949 계열이면 CP949, 아니면 UTF-8 → 깨지면 CP949
 */
import DxfParser from "dxf-parser";
import type { IDxf, IEntity, IPoint } from "dxf-parser";
import { checkCommonEntityProperties } from "dxf-parser/dist/ParseHelpers";
import type DxfArrayScanner from "dxf-parser/dist/DxfArrayScanner";
import type { IGroup } from "dxf-parser/dist/DxfArrayScanner";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

export type DxfOptions = {
  /** 닫힌 폴리라인/원/타원을 Polygon 으로 (기본 true). false 면 닫힌 LineString */
  closedAsPolygon?: boolean;
};

export type RawDxfLayer = {
  name: string;
  fc: FeatureCollection;
  warnings: string[];
  encoding: string;
};

const SEGS_PER_CIRCLE = 64;
const MAX_INSERT_DEPTH = 4;
const MAX_FEATURES = 1_000_000;

/* ------------------------------------------------------------------ */
/* 바이트 → 문자열                                                       */
/* ------------------------------------------------------------------ */

/** 파일 앞부분(ASCII)에서 헤더 변수 값을 찾는다 */
function findHeaderVar(bytes: Uint8Array, name: string, code: number): string | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const m = new RegExp(String.raw`\$${name}\s*\r?\n\s*${code}\s*\r?\n\s*([^\r\n]+)`).exec(head);
  return m ? m[1].trim() : null;
}

/** DXF 바이트 → 문자열.
 *  - $ACADVER ≥ AC1021(2007+) 은 DXF 가 UTF-8 이다. 이때 $DWGCODEPAGE 가 ANSI_949 로 남아 있어도 UTF-8 이 맞다.
 *  - 그 밖에는 코드페이지(949 계열이면 EUC-KR) 우선, 깨지면(U+FFFD) 엄격 UTF-8 로 재시도
 */
export function decodeDxf(bytes: Uint8Array): { text: string; encoding: string } {
  // UTF-8 BOM 제거
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  const cp = findHeaderVar(bytes, "DWGCODEPAGE", 3);
  const ver = /^AC(\d{4})/.exec(findHeaderVar(bytes, "ACADVER", 1) ?? "");
  const verNum = ver ? parseInt(ver[1], 10) : null;
  const korean = !!cp && /949|euc-?kr|korean/i.test(cp);
  const strictUtf8 = (): string | null => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  };
  const euc = () => ({ text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" });

  if (verNum !== null && verNum >= 1021) {
    const u = strictUtf8();
    return u !== null ? { text: u, encoding: "utf-8" } : euc();
  }
  if (korean) {
    const e = euc();
    if (!e.text.includes("�")) return e;
    const u = strictUtf8();
    return u !== null ? { text: u, encoding: "utf-8" } : e;
  }
  const u = strictUtf8();
  return u !== null ? { text: u, encoding: "utf-8" } : euc();
}

/* ------------------------------------------------------------------ */
/* 텍스트/색 정리                                                         */
/* ------------------------------------------------------------------ */

/** MTEXT/TEXT 서식 코드 제거 */
export function cleanDxfText(s: string): string {
  return s
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) // \U+D55C 유니코드 이스케이프
    .replace(/\\\\/g, "\u0001")
    .replace(/\\\{/g, "\u0002")
    .replace(/\\\}/g, "\u0003")
    .replace(/\\P/g, "\n")
    .replace(/\\~/g, " ")
    .replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g, "$1/$2")
    .replace(/\\[fFHCWQTApc][^;]*;/g, "")
    .replace(/\\x[^;]*;/gi, "")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/[{}]/g, "")
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[uUoO]/g, "")
    .replace(/\u0001/g, "\\")
    .replace(/\u0002/g, "{")
    .replace(/\u0003/g, "}")
    .trim();
}

const hex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;

function colorOf(e: IEntity, dxf: IDxf, blockLayer?: string): string | null {
  const ci = e.colorIndex;
  const layerName = e.layer && e.layer !== "0" ? e.layer : (blockLayer ?? e.layer);
  const byLayer = () => {
    const l = dxf.tables?.layer?.layers?.[layerName ?? ""] ?? dxf.tables?.layer?.layers?.[e.layer ?? ""];
    if (!l) return null;
    return l.colorIndex === 7 ? "#000000" : typeof l.color === "number" ? hex(l.color) : null;
  };
  if (ci === undefined || ci === 256 || ci === 0) {
    // 진짜 색(420) 이 있으면 그것
    if (ci === undefined && typeof e.color === "number") return hex(e.color);
    return byLayer();
  }
  if (Math.abs(ci) === 7) return "#000000"; // ACI 7 = 흰색/검정(배경 따라) → 검정
  return typeof e.color === "number" ? hex(e.color) : byLayer();
}

/* ------------------------------------------------------------------ */
/* 기하 보조                                                             */
/* ------------------------------------------------------------------ */

type Pt = [number, number];
type Xf = { f: (p: Pt) => Pt; rotDeg: number };
const IDENT: Xf = { f: (p) => p, rotDeg: 0 };

const segsFor = (sweep: number) => Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * SEGS_PER_CIRCLE));

function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, sweep: number, rotMajor = 0): Pt[] {
  const n = segsFor(sweep);
  const out: Pt[] = [];
  const c = Math.cos(rotMajor);
  const s = Math.sin(rotMajor);
  for (let i = 0; i <= n; i++) {
    const t = a0 + (sweep * i) / n;
    const px = rx * Math.cos(t);
    const py = ry * Math.sin(t);
    out.push([cx + px * c - py * s, cy + px * s + py * c]);
  }
  return out;
}

/** 폴리라인 정점(+bulge) → 호 densify 한 점열 */
function densifyBulge(vs: { x: number; y: number; bulge?: number }[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = vs.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % n];
    out.push([a.x, a.y]);
    const bulge = a.bulge ?? 0;
    if (!bulge || (a.x === b.x && a.y === b.y)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const off = (d * (1 - bulge * bulge)) / (4 * bulge); // 중점에서 현의 왼쪽으로 중심까지 거리
    const cx = (a.x + b.x) / 2 + (-dy / d) * off;
    const cy = (a.y + b.y) / 2 + (dx / d) * off;
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    const sweep = 4 * Math.atan(bulge);
    const m = segsFor(sweep);
    const r = Math.hypot(a.x - cx, a.y - cy);
    for (let k = 1; k < m; k++) {
      const t = a0 + (sweep * k) / m;
      out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  if (!closed) out.push([vs[n - 1].x, vs[n - 1].y]);
  return out;
}

/** 엔티티의 압출(법선) 벡터. 없거나 (0,0,1) 이면 null */
function normalOf(e: unknown): [number, number, number] | null {
  const x = e as {
    extrusion?: IPoint;
    extrusionDirection?: IPoint;
    extrusionDirectionX?: number;
    extrusionDirectionY?: number;
    extrusionDirectionZ?: number;
  };
  const d = x.extrusion ?? x.extrusionDirection;
  const nx = d?.x ?? x.extrusionDirectionX ?? 0;
  const ny = d?.y ?? x.extrusionDirectionY ?? 0;
  const nz = d?.z ?? x.extrusionDirectionZ ?? 1;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-9)) return null;
  const n: [number, number, number] = [nx / len, ny / len, nz / len];
  if (Math.abs(n[0]) < 1e-12 && Math.abs(n[1]) < 1e-12 && n[2] > 0) return null;
  return n;
}

const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: number[]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** OCS(객체 좌표계) → WCS 의 XY 변환 (arbitrary axis algorithm). Z(고도)는 버린다. */
function ocsToWcs(n: [number, number, number]): (p: Pt) => Pt {
  const ax = unit(Math.abs(n[0]) < 1 / 64 && Math.abs(n[1]) < 1 / 64 ? cross([0, 1, 0], n) : cross([0, 0, 1], n));
  const ay = unit(cross(n, ax));
  return (p) => [p[0] * ax[0] + p[1] * ay[0], p[0] * ax[1] + p[1] * ay[1]];
}

/** 링 부호 있는 면적 (shoelace) */
function ringArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return a / 2;
}

function pointInRing(p: Pt, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** inner 링이 outer 링 안에 있는지: 꼭짓점 몇 개를 표본으로 과반이 내부면 포함 (경계 접촉 오판 방지) */
function ringInside(inner: Pt[], outer: Pt[]): boolean {
  const n = inner.length - 1;
  const samples = Math.min(n, 7);
  let hit = 0;
  for (let k = 0; k < samples; k++) if (pointInRing(inner[Math.floor((k * n) / samples)], outer)) hit++;
  return hit * 2 > samples;
}

/** HATCH 경계 루프 → Polygon 들. 외곽(external) 마다 폴리곤을 만들고, 나머지 루프는 포함하는 가장 작은 외곽의 구멍으로 붙인다. */
function assembleHatchPolygons(rings: { ring: Pt[]; external: boolean; area: number }[]): Position[][][] {
  if (!rings.length) return [];
  let outers = rings.filter((r) => r.external);
  if (!outers.length) outers = [rings.reduce((a, b) => (b.area > a.area ? b : a))]; // 외곽 표시가 없으면 가장 큰 루프
  const polys = outers.map((o) => ({ o, coords: [o.ring as Position[]] }));
  for (const r of rings) {
    if (outers.includes(r)) continue;
    let best: (typeof polys)[number] | null = null;
    for (const p of polys) {
      if (p.o.area > r.area && ringInside(r.ring, p.o.ring) && (!best || p.o.area < best.o.area)) best = p;
    }
    if (best) best.coords.push(r.ring as Position[]);
    else polys.push({ o: r, coords: [r.ring as Position[]] }); // 어느 외곽에도 안 들어가면 독립 폴리곤
  }
  return polys.map((p) => p.coords);
}

/* ------------------------------------------------------------------ */
/* HATCH 파서 (dxf-parser 는 HATCH 를 지원하지 않아 핸들러를 직접 등록)                */
/* ------------------------------------------------------------------ */

type HatchLoop = { external: boolean; pts: Pt[] };
const DEG = Math.PI / 180;

type HatchEdge = { t: number; x1?: number; y1?: number; x2?: number; y2?: number; r?: number; a0?: number; a1?: number; ccw?: number; mx?: number; my?: number; ratio?: number; pts?: Pt[]; fit?: Pt[] };

function edgePoints(e: HatchEdge): Pt[] {
  // 반시계(73=1): 시작각 a0 에서 a1 까지 +방향.
  // 시계(73=0): 각도가 시계 방향으로 잰 값이라 시작각 = -a0, 끝각 = -a1, 스윕은 음수 (ezdxf 도 같은 규칙)
  const ccw = !!e.ccw;
  const startRad = (ccw ? (e.a0 ?? 0) : -(e.a0 ?? 0)) * DEG;
  const sweepOf = () => {
    let sweep = ccw ? ((e.a1 ?? 360) - (e.a0 ?? 0)) * DEG : ((e.a0 ?? 0) - (e.a1 ?? 360)) * DEG;
    if (ccw) {
      if (sweep <= 1e-12) sweep += 2 * Math.PI;
    } else if (sweep >= -1e-12) sweep -= 2 * Math.PI;
    return sweep;
  };
  switch (e.t) {
    case 1:
      return [[e.x1 ?? 0, e.y1 ?? 0], [e.x2 ?? 0, e.y2 ?? 0]];
    case 2:
      return arcPts(e.x1 ?? 0, e.y1 ?? 0, e.r ?? 0, e.r ?? 0, startRad, sweepOf());
    case 3: {
      const rx = Math.hypot(e.mx ?? 0, e.my ?? 0);
      return arcPts(e.x1 ?? 0, e.y1 ?? 0, rx, rx * (e.ratio ?? 1), startRad, sweepOf(), Math.atan2(e.my ?? 0, e.mx ?? 1));
    }
    case 4:
      // 스플라인 경계: 맞춤점(fit)이 있으면 그것, 없으면 제어점 폴리라인으로 근사
      return (e.fit?.length ?? 0) >= 2 ? e.fit! : (e.pts ?? []);
    default:
      return [];
  }
}

class HatchHandler {
  ForEntityName = "HATCH" as const;
  parseEntity(scanner: DxfArrayScanner, curr: IGroup) {
    const loops: HatchLoop[] = [];
    const entity = { type: "HATCH", loops } as unknown as AnyEntity;
    let inPaths = false;
    let pathFlags = 0;
    let isPoly = false;
    let closed = true;
    let verts: { x: number; y: number; bulge: number }[] = [];
    let edges: HatchEdge[] = [];
    let edge: HatchEdge | null = null;
    let open = false; // 경계 경로 수집 중

    const flush = () => {
      if (!open) return;
      open = false;
      let pts: Pt[] = [];
      if (isPoly) {
        if (verts.length >= 2) pts = densifyBulge(verts, closed);
      } else {
        for (const e of edges) {
          let seg = edgePoints(e);
          const last = pts[pts.length - 1];
          if (last && seg.length && Math.hypot(last[0] - seg[0][0], last[1] - seg[0][1]) < 1e-9) seg = seg.slice(1);
          pts.push(...seg);
        }
      }
      if (pts.length >= 3) loops.push({ external: (pathFlags & 1) === 1, pts });
      verts = [];
      edges = [];
      edge = null;
    };

    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0) break;
      const v = curr.value as number;
      if (!inPaths) {
        if (curr.code === 91) inPaths = true;
        else if (curr.code === 210) (entity.extrusion ??= { x: 0, y: 0, z: 1 }).x = v;
        else if (curr.code === 220) (entity.extrusion ??= { x: 0, y: 0, z: 1 }).y = v;
        else if (curr.code === 230) (entity.extrusion ??= { x: 0, y: 0, z: 1 }).z = v;
        else if (curr.code !== 10 && curr.code !== 20 && curr.code !== 30) checkCommonEntityProperties(entity as never, curr, scanner);
      } else {
        switch (curr.code) {
          case 92:
            flush();
            open = true;
            pathFlags = v;
            isPoly = (v & 2) === 2;
            closed = true;
            break;
          case 72:
            if (!isPoly) {
              edge = { t: v };
              edges.push(edge);
            }
            break;
          case 73:
            if (isPoly) closed = v !== 0;
            else if (edge) edge.ccw = v;
            break;
          case 10:
            if (isPoly) verts.push({ x: v, y: 0, bulge: 0 });
            else if (edge) {
              if (edge.t === 4) (edge.pts ??= []).push([v, 0]);
              else edge.x1 = v;
            }
            break;
          case 20:
            if (isPoly) {
              if (verts.length) verts[verts.length - 1].y = v;
            } else if (edge) {
              if (edge.t === 4) {
                if (edge.pts?.length) edge.pts[edge.pts.length - 1][1] = v;
              } else edge.y1 = v;
            }
            break;
          case 42:
            if (isPoly && verts.length) verts[verts.length - 1].bulge = v;
            break;
          case 11:
            if (edge) {
              if (edge.t === 1) edge.x2 = v;
              else if (edge.t === 4) (edge.fit ??= []).push([v, 0]); // 스플라인 맞춤점
              else edge.mx = v;
            }
            break;
          case 21:
            if (edge) {
              if (edge.t === 1) edge.y2 = v;
              else if (edge.t === 4) {
                if (edge.fit?.length) edge.fit[edge.fit.length - 1][1] = v;
              } else edge.my = v;
            }
            break;
          case 40:
            if (edge) {
              if (edge.t === 2) edge.r = v;
              else if (edge.t === 3) edge.ratio = v;
            }
            break;
          case 50:
            if (edge) edge.a0 = v;
            break;
          case 51:
            if (edge) edge.a1 = v;
            break;
          case 97:
            // 스플라인 엣지 안의 97 = 맞춤점 개수, 경로 끝의 97 = 경계 객체 참조 수.
            // 어느 쪽도 경로의 끝이 아니다 (다음 92 또는 75 에서 flush) — 소비만 한다.
            break;
          case 75: // 해칭 스타일부터는 패턴/시드 정보 — 경계 수집 끝
            flush();
            inPaths = false;
            break;
          default:
            break;
        }
      }
      curr = scanner.next();
    }
    flush();
    return entity;
  }
}

/* ------------------------------------------------------------------ */
/* 엔티티 변환                                                          */
/* ------------------------------------------------------------------ */

type Ctx = {
  dxf: IDxf;
  closedAsPolygon: boolean;
  features: Feature[];
  unsupported: Map<string, number>;
  capped: boolean;
  badBlocks: Set<string>;
  inheritLayer?: string;
  /** 꺼짐/동결 레이어 이름 */
  hiddenLayers: Set<string>;
  hiddenCount: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEntity = IEntity & Record<string, any>;

function emit(ctx: Ctx, e: AnyEntity, geometry: Geometry, extra: Record<string, unknown>, blockName?: string) {
  if (ctx.features.length >= MAX_FEATURES) {
    ctx.capped = true;
    return;
  }
  // 블록 안의 "0" 레이어 도형은 INSERT 의 레이어를 물려받는다 (CAD 규칙)
  const layer = !e.layer || e.layer === "0" ? (ctx.inheritLayer ?? "0") : e.layer;
  const props: Record<string, unknown> = { layer, color: colorOf(e, ctx.dxf, layer), type: e.type, ...extra };
  if (blockName) props.block = blockName;
  ctx.features.push({ type: "Feature", properties: props, geometry });
}

const finite = (pts: Pt[]) => pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));

function lineOrPolygon(ctx: Ctx, e: AnyEntity, pts: Pt[], closed: boolean, xf: Xf, blockName?: string, forceLine = false) {
  const mapped = pts.map(xf.f);
  if (!finite(mapped) || mapped.length < 2) return;
  if (closed) {
    const first = mapped[0];
    const lastP = mapped[mapped.length - 1];
    if (first[0] !== lastP[0] || first[1] !== lastP[1]) mapped.push([first[0], first[1]]);
    if (ctx.closedAsPolygon && !forceLine && mapped.length >= 4) {
      emit(ctx, e, { type: "Polygon", coordinates: [mapped as Position[]] }, {}, blockName);
      return;
    }
  }
  emit(ctx, e, { type: "LineString", coordinates: mapped as Position[] }, {}, blockName);
}

const OCS_TYPES = new Set(["ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE", "TEXT", "INSERT", "HATCH", "SOLID"]);

function processEntity(ctx: Ctx, e: AnyEntity, xfIn: Xf, depth: number, blockName?: string) {
  if (e.visible === false) return;
  // 꺼짐/동결 레이어는 건너뛴다 (블록 안 "0" 레이어는 INSERT 의 레이어를 따른다)
  const effLayer = !e.layer || e.layer === "0" ? (ctx.inheritLayer ?? "0") : e.layer;
  if (ctx.hiddenLayers.has(effLayer)) {
    ctx.hiddenCount++;
    return;
  }
  let xf = xfIn;
  // OCS 엔티티는 법선(210/220/230)에 따라 좌표계가 달라진다 (-Z 이면 x 가 뒤집힘 등).
  // ELLIPSE/LINE/POINT/MTEXT 는 WCS 좌표라 해당 없음.
  if (OCS_TYPES.has(e.type) && !(e.type === "POLYLINE" && e.is3dPolyline)) {
    const n = normalOf(e);
    if (n) {
      const o = ocsToWcs(n);
      xf = { f: (p) => xfIn.f(o(p)), rotDeg: xfIn.rotDeg };
    }
  }

  switch (e.type) {
    case "LINE": {
      const v = e.vertices as IPoint[] | undefined;
      if (v && v.length >= 2) lineOrPolygon(ctx, e, v.map((p) => [p.x, p.y] as Pt), false, xf, blockName);
      break;
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      if (e.type === "POLYLINE" && (e.is3dPolygonMesh || e.isPolyfaceMesh)) {
        ctx.unsupported.set("POLYLINE(메시)", (ctx.unsupported.get("POLYLINE(메시)") ?? 0) + 1);
        break;
      }
      const vs = (e.vertices as { x: number; y: number; bulge?: number }[] | undefined) ?? [];
      if (vs.length < 2) break;
      const closed = !!e.shape;
      const pts = densifyBulge(vs, closed);
      // 닫힌 LWPOLYLINE 은 3점 이상일 때만 Polygon (2점은 LineString)
      lineOrPolygon(ctx, e, pts, closed, xf, blockName, closed && vs.length < 3);
      break;
    }
    case "CIRCLE": {
      const c = e.center as IPoint;
      if (!c || !(e.radius > 0)) break;
      const pts = arcPts(c.x, c.y, e.radius, e.radius, 0, 2 * Math.PI);
      pts.pop(); // 시작점 중복 제거 (lineOrPolygon 이 닫는다)
      lineOrPolygon(ctx, e, pts, true, xf, blockName);
      break;
    }
    case "ARC": {
      const c = e.center as IPoint;
      if (!c || !(e.radius > 0)) break;
      let sweep = e.endAngle - e.startAngle;
      if (sweep <= 0) sweep += 2 * Math.PI;
      lineOrPolygon(ctx, e, arcPts(c.x, c.y, e.radius, e.radius, e.startAngle, sweep), false, xf, blockName);
      break;
    }
    case "ELLIPSE": {
      const c = e.center as IPoint;
      const m = e.majorAxisEndPoint as IPoint;
      if (!c || !m) break;
      const rx = Math.hypot(m.x, m.y);
      let ry = rx * (e.axisRatio ?? 1);
      // ELLIPSE 는 WCS 좌표. 매개변수는 법선 기준 반시계 → 법선이 -Z 면 위에서 볼 때 시계 방향이라 단축 방향이 뒤집힌다
      const nrm = normalOf(e);
      if (nrm && nrm[2] < 0) ry = -ry;
      const rot = Math.atan2(m.y, m.x);
      const a0 = e.startAngle ?? 0;
      let a1 = e.endAngle ?? 2 * Math.PI;
      if (a1 <= a0) a1 += 2 * Math.PI;
      const sweep = a1 - a0;
      const full = Math.abs(sweep - 2 * Math.PI) < 1e-6;
      const pts = arcPts(c.x, c.y, rx, ry, a0, sweep, rot);
      if (full) pts.pop();
      lineOrPolygon(ctx, e, pts, full, xf, blockName);
      break;
    }
    case "SPLINE": {
      const src = (e.fitPoints?.length ?? 0) >= 2 ? e.fitPoints : e.controlPoints;
      const pts = ((src ?? []) as IPoint[]).map((p) => [p.x, p.y] as Pt);
      if (pts.length >= 2) lineOrPolygon(ctx, e, pts, !!e.closed && pts.length >= 3, xf, blockName);
      break;
    }
    case "POINT": {
      const p = e.position as IPoint | undefined;
      if (!p) break;
      const q = xf.f([p.x, p.y]);
      if (finite([q])) emit(ctx, e, { type: "Point", coordinates: q }, {}, blockName);
      break;
    }
    case "TEXT":
    case "MTEXT": {
      const p = (e.type === "TEXT" ? e.startPoint : e.position) as IPoint | undefined;
      if (!p) break;
      const q = xf.f([p.x, p.y]);
      const text = cleanDxfText(String(e.text ?? ""));
      if (!text || !finite([q])) break;
      // 회전각: MTEXT 는 방향 벡터(11/21)가 있으면 그것이 우선. 나머지는 코드 50 (도).
      const dv = e.type === "MTEXT" ? (e.directionVector as IPoint | undefined) : undefined;
      const rotOcs = dv && Math.hypot(dv.x, dv.y) > 1e-12 ? Math.atan2(dv.y, dv.x) : ((e.rotation ?? 0) * Math.PI) / 180;
      // 점 + 방향 단위벡터를 같은 변환(OCS 법선·INSERT 회전/반사)에 통과시켜 최종 각도를 구한다
      const q2 = xf.f([p.x + Math.cos(rotOcs), p.y + Math.sin(rotOcs)]);
      let rotation = (Math.atan2(q2[1] - q[1], q2[0] - q[0]) * 180) / Math.PI;
      if (!Number.isFinite(rotation)) rotation = (e.rotation ?? 0) + xf.rotDeg;
      rotation = Math.round((((rotation % 360) + 360) % 360) * 1e6) / 1e6;
      if (rotation === 360) rotation = 0;
      emit(
        ctx,
        e,
        { type: "Point", coordinates: q },
        { text, height: (e.type === "TEXT" ? e.textHeight : e.height) ?? null, rotation },
        blockName,
      );
      break;
    }
    case "SOLID":
    case "3DFACE": {
      const v = (e.points ?? e.vertices) as IPoint[] | undefined;
      if (!v || v.length < 3) break;
      // SOLID 는 점 순서가 0,1,3,2 (나비넥타이) → 3DFACE 는 0,1,2,3
      const order = e.type === "SOLID" && v.length >= 4 ? [0, 1, 3, 2] : v.map((_, i) => i);
      lineOrPolygon(ctx, e, order.map((i) => [v[i].x, v[i].y] as Pt), true, xf, blockName);
      break;
    }
    case "HATCH": {
      const loops = (e.loops as HatchLoop[]) ?? [];
      const rings: { ring: Pt[]; external: boolean; area: number }[] = [];
      for (const l of loops) {
        const ring = l.pts.map(xf.f);
        if (!finite(ring)) continue;
        const f0 = ring[0];
        const l0 = ring[ring.length - 1];
        if (f0[0] !== l0[0] || f0[1] !== l0[1]) ring.push([f0[0], f0[1]]);
        if (ring.length < 4) continue;
        rings.push({ ring, external: l.external, area: Math.abs(ringArea(ring)) });
      }
      const polys = assembleHatchPolygons(rings);
      if (polys.length === 1) emit(ctx, e, { type: "Polygon", coordinates: polys[0] }, {}, blockName);
      else if (polys.length > 1) emit(ctx, e, { type: "MultiPolygon", coordinates: polys }, {}, blockName);
      break;
    }
    case "INSERT": {
      if (depth >= MAX_INSERT_DEPTH) {
        ctx.unsupported.set("INSERT(중첩 깊이 초과)", (ctx.unsupported.get("INSERT(중첩 깊이 초과)") ?? 0) + 1);
        break;
      }
      const name = String(e.name ?? "");
      const block = ctx.dxf.blocks?.[name];
      if (!block || !block.entities?.length) break;
      const pos = (e.position as IPoint) ?? { x: 0, y: 0, z: 0 };
      const base = block.position ?? { x: 0, y: 0, z: 0 };
      const sx = e.xScale ?? 1;
      const sy = e.yScale ?? 1;
      const rad = ((e.rotation ?? 0) * Math.PI) / 180;
      const cs = Math.cos(rad);
      const sn = Math.sin(rad);
      const cols = Math.max(1, e.columnCount ?? 1);
      const rows = Math.max(1, e.rowCount ?? 1);
      const prevInherit = ctx.inheritLayer;
      ctx.inheritLayer = !e.layer || e.layer === "0" ? prevInherit : e.layer;
      try {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const ox = c * (e.columnSpacing ?? 0);
            const oy = r * (e.rowSpacing ?? 0);
            const inner: Xf = {
              f: (p) => {
                const lx = (p[0] - base.x) * sx + ox;
                const ly = (p[1] - base.y) * sy + oy;
                return xf.f([pos.x + lx * cs - ly * sn, pos.y + lx * sn + ly * cs]);
              },
              rotDeg: xf.rotDeg + (e.rotation ?? 0),
            };
            for (const sub of block.entities) {
              // 블록 안 엔티티 하나가 터져도 나머지는 계속
              try {
                processEntity(ctx, sub as AnyEntity, inner, depth + 1, name);
              } catch {
                const k = `${(sub as AnyEntity).type}(오류)`;
                ctx.unsupported.set(k, (ctx.unsupported.get(k) ?? 0) + 1);
              }
            }
          }
        }
      } finally {
        ctx.inheritLayer = prevInherit; // 예외가 나도 레이어 상속 상태 복원
      }
      break;
    }
    default:
      ctx.unsupported.set(e.type, (ctx.unsupported.get(e.type) ?? 0) + 1);
  }
}

/**
 * dxf-parser 1.1.2 는 CIRCLE/TEXT/ELLIPSE 의 압출 방향(210/220/230)을 버린다.
 * 기본 핸들러를 감싸서, 파싱 후 해당 엔티티의 원시 그룹을 다시 훑어 entity.extrusion 을 채운다.
 * (스캐너 내부 _pointer/_data 사용 — 버전 고정(^1.1.2) 가정. 없으면 조용히 건너뛴다)
 */
function patchExtrusionHandlers(parser: DxfParser) {
  type Sc = { _pointer?: number; _data?: string[] };
  const handlers = (parser as unknown as { _entityHandlers?: Record<string, { parseEntity: (s: DxfArrayScanner, c: IGroup) => AnyEntity }> })._entityHandlers;
  if (!handlers) return;
  for (const nm of ["CIRCLE", "TEXT", "ELLIPSE"]) {
    const orig = handlers[nm];
    if (!orig) continue;
    handlers[nm] = {
      ...orig,
      parseEntity(scanner, curr) {
        const sc = scanner as unknown as Sc;
        const start = sc._pointer;
        const ent = orig.parseEntity(scanner, curr);
        const end = sc._pointer;
        const data = sc._data;
        if (typeof start === "number" && typeof end === "number" && data) {
          const ex = { x: 0, y: 0, z: 1 };
          let found = false;
          // end 직전 2줄은 다음 엔티티의 코드 0 그룹이라 제외
          for (let i = start; i + 1 < end - 2 + 1 && i + 1 < data.length; i += 2) {
            const c = parseInt(data[i], 10);
            if (c === 210 || c === 220 || c === 230) {
              const v = parseFloat(data[i + 1]);
              if (Number.isFinite(v)) {
                ex[c === 210 ? "x" : c === 220 ? "y" : "z"] = v;
                found = true;
              }
            }
          }
          if (found) ent.extrusion = ex;
        }
        return ent;
      },
    };
  }
}

/** 레이어 이름의 \U+XXXX 이스케이프 해제 */
const decodeLayerName = (s: string) => s.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** 엔티티/블록/레이어 테이블의 레이어 이름을 일괄 정규화 */
function normalizeLayerNames(dxf: IDxf) {
  const fix = (list: unknown) => {
    for (const e of (list as { layer?: string }[] | undefined) ?? []) if (e.layer && e.layer.includes("\\U+")) e.layer = decodeLayerName(e.layer);
  };
  fix(dxf.entities);
  for (const b of Object.values(dxf.blocks ?? {})) fix((b as { entities?: unknown }).entities);
  const layers = dxf.tables?.layer?.layers as Record<string, { name?: string }> | undefined;
  if (layers) {
    for (const k of Object.keys(layers)) {
      if (!k.includes("\\U+")) continue;
      const nk = decodeLayerName(k);
      layers[nk] = layers[k];
      if (layers[nk].name) layers[nk].name = nk;
      delete layers[k];
    }
  }
}

/** DXF 바이트 → 레이어 1개 (파일명으로 이름 지정은 호출 측) */
export function readDxf(bytes: Uint8Array, name: string, opts: DxfOptions = {}): RawDxfLayer {
  // 바이너리 DXF 는 지원하지 않는다
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 22)).startsWith("AutoCAD Binary DXF")) {
    throw new Error(`${name}: 바이너리 DXF 는 지원하지 않습니다. ASCII DXF 로 다시 저장해 주세요.`);
  }
  const { text, encoding } = decodeDxf(bytes);
  let dxf: IDxf | null;
  try {
    const parser = new DxfParser();
    parser.registerEntityHandler(HatchHandler as never);
    patchExtrusionHandlers(parser);
    dxf = parser.parseSync(text);
  } catch (e) {
    throw new Error(`${name}: DXF 를 해석하지 못했습니다. (${e instanceof Error ? e.message : e})`);
  }
  if (!dxf) throw new Error(`${name}: DXF 를 해석하지 못했습니다.`);
  normalizeLayerNames(dxf);
  const hiddenLayers = new Set<string>();
  for (const [ln, l] of Object.entries((dxf.tables?.layer?.layers ?? {}) as Record<string, { visible?: boolean; frozen?: boolean }>)) {
    if (l.visible === false || l.frozen) hiddenLayers.add(ln);
  }

  const ctx: Ctx = {
    dxf,
    closedAsPolygon: opts.closedAsPolygon ?? true,
    features: [],
    unsupported: new Map(),
    capped: false,
    badBlocks: new Set(),
    hiddenLayers,
    hiddenCount: 0,
  };
  for (const e of dxf.entities ?? []) {
    if ((e as AnyEntity).inPaperSpace) continue; // 도면 배치(페이퍼스페이스) 제외, 모델 공간만
    try {
      processEntity(ctx, e as AnyEntity, IDENT, 0);
    } catch {
      ctx.unsupported.set(`${e.type}(오류)`, (ctx.unsupported.get(`${e.type}(오류)`) ?? 0) + 1);
    }
  }

  const warnings: string[] = [];
  if (ctx.unsupported.size) {
    const list = [...ctx.unsupported].map(([k, v]) => `${k} ${v}개`).join(", ");
    warnings.push(`${name}: 지원하지 않는 엔티티를 건너뛰었습니다 (${list}).`);
  }
  if (ctx.hiddenCount) warnings.push(`${name}: 꺼짐/동결 레이어의 도형 ${ctx.hiddenCount.toLocaleString()}개를 제외했습니다.`);
  if (ctx.capped) warnings.push(`${name}: 도형이 ${MAX_FEATURES.toLocaleString()}개를 넘어 나머지는 생략했습니다.`);
  return { name, fc: { type: "FeatureCollection", features: ctx.features }, warnings, encoding };
}
