/**
 * OpenFreeMap 벡터 타일(OpenMapTiles 스키마) 가져오기 + 디코딩 + 스타일 그룹 분류
 *  - TileJSON 1회 조회 후 캐시, 디코딩된 타일은 LRU 캐시
 *  - 타일 경계에서 잘린 도로명/시설 라벨은 이름+위치로 중복 제거
 */
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { Pt, RoadClass, VectorBasemapData, VectorFeature, VectorFeatureProps, VectorGeometry, VectorLabel } from "./types";

export const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
export const ATTRIBUTION = "© OpenMapTiles © OpenStreetMap contributors";
export const MAX_TILE_ZOOM = 14;
const MAX_TILES = 24;
/** 디코딩된 타일 캐시 한도: 타일 수 또는 정점 수(메모리 예산) 중 먼저 닿는 쪽 */
const LRU_TILES = 60;
const LRU_VERTICES = 2_500_000;
const TILEJSON_TIMEOUT_MS = 10_000;
const TILE_TIMEOUT_MS = 20_000;

type DecodedTile = { groups: Record<string, VectorFeature[]>; labels: VectorLabel[]; vertices: number };

let templatePromise: Promise<string> | null = null;

/**
 * fetch + 타임아웃 (AbortSignal.timeout 대신 AbortController+setTimeout).
 * 타임아웃은 AbortError 가 아닌 일반 Error 로 던진다 (호출 쪽이 "취소"와 "실패"를 구분하도록).
 */
async function fetchWithTimeout(url: string, ms: number, signal?: AbortSignal, init?: RequestInit): Promise<Response> {
  const c = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => {
    timedOut = true;
    c.abort();
  }, ms);
  const onAbort = () => c.abort();
  if (signal) {
    if (signal.aborted) c.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: c.signal });
  } catch (e) {
    if (timedOut) throw new Error(`요청 시간 초과 (${ms}ms): ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** TileJSON 에서 타일 URL 템플릿을 받아 캐시 (실패하면 캐시 비움) */
export function getTileTemplate(): Promise<string> {
  if (!templatePromise) {
    templatePromise = (async () => {
      const res = await fetchWithTimeout(TILEJSON_URL, TILEJSON_TIMEOUT_MS, undefined, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`TileJSON ${res.status}`);
      const tj = (await res.json()) as { tiles?: string[] };
      const t = tj.tiles?.[0];
      if (!t) throw new Error("TileJSON 에 tiles 가 없음");
      return t;
    })();
    templatePromise.catch(() => {
      templatePromise = null;
    });
  }
  return templatePromise;
}

// ---------- 타일 좌표 ----------
function lon2x(lon: number, n: number) {
  return ((lon + 180) / 360) * n;
}
function lat2y(lat: number, n: number) {
  const c = Math.max(-85.0511, Math.min(85.0511, lat)) * (Math.PI / 180);
  return ((1 - Math.log(Math.tan(c) + 1 / Math.cos(c)) / Math.PI) / 2) * n;
}

export type TileRange = { z: number; x0: number; x1: number; y0: number; y1: number; count: number };

/**
 * 줌에 맞는 정수 타일 줌 + 범위. 타일이 너무 많으면 줌을 낮춘다.
 * 줌 선택은 "타일 경계에 맞춘 실제 개수"가 아니라 최악의 경우(경계에 걸침) 개수 (ceil(w)+1)*(ceil(h)+1) 로 해서,
 * 같은 줌에서 패닝해도 타일 줌이 13<->14 로 흔들리지 않게 한다 (뷰 크기만의 함수).
 * 경도가 ±180 을 넘으면 타일 x 는 래핑해서 받고(fetch 쪽), 여기서 돌려주는 x0..x1 은 래핑 전(연속) 인덱스다.
 */
export function tileRangeFor(b: { west: number; south: number; east: number; north: number }, zoom: number): TileRange {
  let z = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.floor(zoom)));
  for (;;) {
    const n = 2 ** z;
    const fx0 = lon2x(b.west, n), fx1 = lon2x(b.east, n);
    const fy0 = lat2y(b.north, n), fy1 = lat2y(b.south, n);
    const worst = (Math.ceil(Math.max(0, fx1 - fx0)) + 1) * (Math.ceil(Math.max(0, fy1 - fy0)) + 1);
    if (worst <= MAX_TILES || z === 0) {
      // 가로: 연속 인덱스. 한 바퀴(n 장) 넘으면 n 장으로 제한
      const x0 = Math.floor(fx0);
      const x1 = Math.min(Math.floor(fx1), x0 + n - 1);
      const y0 = Math.max(0, Math.floor(fy0));
      const y1 = Math.min(n - 1, Math.floor(fy1));
      const count = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
      return { z, x0, x1, y0, y1, count };
    }
    z--;
  }
}

// ---------- LRU ----------
const cache = new Map<string, DecodedTile>();
let cacheVertices = 0;
type Inflight = { p: Promise<DecodedTile>; ctrl: AbortController; refs: number };
const inflight = new Map<string, Inflight>();
function cacheGet(k: string) {
  const v = cache.get(k);
  if (v) {
    cache.delete(k);
    cache.set(k, v);
  }
  return v;
}
function cacheSet(k: string, v: DecodedTile) {
  const old = cache.get(k);
  if (old) cacheVertices -= old.vertices;
  cache.set(k, v);
  cacheVertices += v.vertices;
  while ((cache.size > LRU_TILES || cacheVertices > LRU_VERTICES) && cache.size > 1) {
    const k0 = cache.keys().next().value as string;
    cacheVertices -= cache.get(k0)!.vertices;
    cache.delete(k0);
  }
}
export function clearVectorTileCache() {
  cache.clear();
  cacheVertices = 0;
}

// ---------- 분류 ----------
const ROAD_MAP: Record<string, RoadClass | undefined> = {
  motorway: "motorway",
  trunk: "trunk",
  primary: "primary",
  secondary: "secondary",
  tertiary: "tertiary",
  minor: "minor",
  service: "service",
  track: "path",
  path: "path",
  busway: "service",
  bus_guideway: "service",
  rail: "rail",
  transit: "transit",
};

const PARK_LANDUSE = new Set(["cemetery", "pitch", "playground", "garden", "park", "grass", "village_green", "recreation_ground", "golf_course", "zoo"]);
const POI_CLASSES = new Set([
  "railway", "school", "college", "hospital", "town_hall", "library", "police", "fire_station", "park", "attraction", "museum", "stadium", "zoo", "theatre", "place_of_worship", "castle", "harbor", "airport", "ferry_terminal", "monument",
]);
const PLACE_CLASSES = new Set(["city", "town", "village", "suburb", "borough", "quarter", "neighbourhood", "island", "hamlet"]);

function pickName(p: Record<string, unknown>): string | undefined {
  const n = (p["name:ko"] ?? p["name"] ?? p["name:nonlatin"] ?? p["name_int"]) as string | undefined;
  return typeof n === "string" && n.trim() ? n.trim() : undefined;
}

function toPoint(g: { type: string; coordinates: unknown }): Pt | null {
  if (g.type === "Point") return g.coordinates as Pt;
  if (g.type === "MultiPoint") return (g.coordinates as Pt[])[0] ?? null;
  return null;
}

function countCoords(c: unknown): number {
  if (!Array.isArray(c)) return 0;
  if (typeof c[0] === "number") return 1;
  let n = 0;
  for (const x of c) n += countCoords(x);
  return n;
}

/**
 * 폴리곤 윤곽선 - 타일 클립 경계(타일 extent 밖/경계 위)에 놓인 변을 뺀 선분 목록.
 * 타일은 도형을 타일 경계(+buffer)에서 잘라 닫힌 링으로 돌려주므로, 그 인공적인 변까지 선으로 그리면 타일 격자가 보인다.
 * 경계 변이 하나도 없는 링은 링 자체(같은 배열 참조)를 그대로 쓴다. 경계 변이 있는 폴리곤이 하나도 없으면 undefined.
 */
function outlineOf(g: { type: string; coordinates: unknown }, extent: number, tx: number, ty: number, z: number): Pt[][][] | undefined {
  const size = extent * 2 ** z;
  const TOL = 0.5; // 타일 좌표 단위 (extent 4096 기준 ~0.01%)
  const toLocal = (p: Pt) => {
    const lx = ((p[0] + 180) / 360) * size - tx * extent;
    const y2 = (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (p[1] * Math.PI) / 360));
    const ly = ((180 - y2) * size) / 360 - ty * extent;
    return [lx, ly] as const;
  };
  let any = false;
  const ringOutline = (ring: Pt[]): Pt[][] => {
    const n = ring.length - 1; // 변 개수 (닫힌 링: 마지막 = 첫 점)
    if (n < 2) return [];
    const loc = ring.map(toLocal);
    const bnd = new Array<boolean>(n);
    let nb = 0;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = loc[i], [bx, by] = loc[i + 1];
      const on = (ax <= TOL && bx <= TOL) || (ax >= extent - TOL && bx >= extent - TOL) || (ay <= TOL && by <= TOL) || (ay >= extent - TOL && by >= extent - TOL);
      bnd[i] = on;
      if (on) nb++;
    }
    if (nb === 0) return [ring];
    any = true;
    if (nb === n) return [];
    const runs: Pt[][] = [];
    let start = 0;
    while (!bnd[start]) start++; // 경계 변 하나를 찾아 그 다음부터 순환하며 연속 구간을 모은다
    let cur: Pt[] | null = null;
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (bnd[i]) {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = [ring[i]];
        runs.push(cur);
      }
      cur.push(ring[i + 1]);
    }
    return runs;
  };
  const polyOutline = (rings: Pt[][]) => rings.flatMap(ringOutline);
  const out = g.type === "Polygon" ? [polyOutline(g.coordinates as Pt[][])] : (g.coordinates as Pt[][][]).map(polyOutline);
  return any ? out : undefined;
}

function brunnelOf(p: Record<string, unknown>): VectorFeatureProps["brunnel"] {
  const b = p["brunnel"];
  return b === "bridge" || b === "tunnel" || b === "ford" ? b : undefined;
}

function decodeTile(buf: ArrayBuffer, z: number, x: number, y: number): DecodedTile {
  const tile = new VectorTile(new PbfReader(buf));
  const groups: Record<string, VectorFeature[]> = {};
  const labels: VectorLabel[] = [];
  let vertices = 0;
  let curF: VectorTileFeature | null = null;

  const each = (layerName: string, fn: (f: VectorTileFeature, p: Record<string, unknown>) => void) => {
    const layer = tile.layers[layerName];
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      curF = f;
      fn(f, f.properties as Record<string, unknown>);
    }
  };
  const pushTo = (gs: Record<string, VectorFeature[]>, name: string, geometry: VectorGeometry, properties: VectorFeatureProps) => {
    const feat: VectorFeature = { type: "Feature", geometry, properties };
    vertices += countCoords(geometry.coordinates);
    if ((geometry.type === "Polygon" || geometry.type === "MultiPolygon") && curF) {
      const o = outlineOf(geometry, (curF as VectorTileFeature).extent, x, y, z);
      if (o) feat.outline = o;
    }
    (gs[name] ??= []).push(feat);
  };
  const geom = (f: VectorTileFeature) => f.toGeoJSON(x, y, z).geometry as unknown as { type: string; coordinates: unknown };
  const isPoly = (g: { type: string }) => g.type === "Polygon" || g.type === "MultiPolygon";
  const isLine = (g: { type: string }) => g.type === "LineString" || g.type === "MultiLineString";

  each("water", (f, p) => {
    const g = geom(f);
    if (isPoly(g)) pushTo(groups, "water", g as VectorGeometry, { cls: String(p.class ?? "") });
  });
  each("waterway", (f, p) => {
    const g = geom(f);
    if (isLine(g) && p.class !== "ditch" && p.class !== "drain") pushTo(groups, "waterway", g as VectorGeometry, { cls: String(p.class ?? "") });
  });
  each("landcover", (f, p) => {
    const g = geom(f);
    if (!isPoly(g)) return;
    const c = String(p.class ?? "");
    if (c === "grass" || c === "wood") pushTo(groups, "park", g as VectorGeometry, { cls: c, sub: String(p.subclass ?? "") });
    else if (c === "farmland" || c === "sand" || c === "wetland" || c === "rock") pushTo(groups, "landuse", g as VectorGeometry, { cls: c });
  });
  each("park", (f, p) => {
    const g = geom(f);
    if (!isPoly(g)) return;
    const c = String(p.class ?? "");
    if (c === "park" || c === "nature_reserve") pushTo(groups, "park", g as VectorGeometry, { cls: "park" });
  });
  each("landuse", (f, p) => {
    const g = geom(f);
    if (!isPoly(g)) return;
    const c = String(p.class ?? "");
    if (c === "residential") return;
    pushTo(groups, PARK_LANDUSE.has(c) ? "park" : "landuse", g as VectorGeometry, { cls: c });
  });
  each("building", (f) => {
    const g = geom(f);
    if (isPoly(g)) pushTo(groups, "building", g as VectorGeometry, {});
  });
  each("aeroway", (f, p) => {
    const g = geom(f);
    const c = String(p.class ?? "");
    if (c === "helipad") return;
    if (isLine(g) || isPoly(g)) pushTo(groups, "aeroway", g as VectorGeometry, { cls: c });
  });
  each("boundary", (f, p) => {
    const g = geom(f);
    if (!isLine(g) || p.maritime === 1) return;
    const lv = Number(p.admin_level);
    if (lv) pushTo(groups, "boundary", g as VectorGeometry, { admin: lv });
  });
  each("transportation", (f, p) => {
    const g = geom(f);
    if (!isLine(g)) return;
    const cls = ROAD_MAP[String(p.class ?? "")];
    if (!cls) return;
    if (cls === "rail" && (p.service || p.subclass === "tram")) return;
    pushTo(groups, "road", g as VectorGeometry, { cls, sub: p.subclass ? String(p.subclass) : undefined, brunnel: brunnelOf(p) });
  });

  // ----- 라벨 -----
  each("place", (f, p) => {
    const c = String(p.class ?? "");
    const name = pickName(p);
    const pt = toPoint(geom(f));
    if (!name || !pt || !PLACE_CLASSES.has(c)) return;
    labels.push({ text: name, lon: pt[0], lat: pt[1], kind: "place", rank: Number(p.rank ?? 99), cls: c });
  });
  each("transportation_name", (f, p) => {
    const name = pickName(p);
    const g = geom(f);
    const cls = ROAD_MAP[String(p.class ?? "")];
    if (!name || !isLine(g) || !cls || cls === "rail" || cls === "transit") return;
    const lines = g.type === "LineString" ? [g.coordinates as Pt[]] : (g.coordinates as Pt[][]);
    for (const line of lines) {
      if (line.length < 2) continue;
      const mid = line[Math.floor(line.length / 2)];
      vertices += line.length;
      labels.push({ text: name, lon: mid[0], lat: mid[1], kind: "road", rank: 99, cls, line });
    }
  });
  each("poi", (f, p) => {
    const c = String(p.class ?? "");
    const sub = String(p.subclass ?? "");
    let name = pickName(p);
    const pt = toPoint(geom(f));
    if (!name || !pt || !POI_CLASSES.has(c)) return;
    const rank = Number(p.rank ?? 99);
    if (c === "railway") {
      if (sub !== "station" && sub !== "subway" && sub !== "halt") return;
      if (!/(역|Station)$/i.test(name)) name += "역";
    } else {
      if (rank > 4) return;
      if (sub === "kindergarten" || sub === "clinic" || sub === "community_centre") return;
    }
    labels.push({ text: name, lon: pt[0], lat: pt[1], kind: "poi", rank, cls: c === "railway" ? "railway" : c });
  });
  each("water_name", (f, p) => {
    const name = pickName(p);
    const pt = toPoint(geom(f));
    if (name && pt) labels.push({ text: name, lon: pt[0], lat: pt[1], kind: "water", rank: Number(p.rank ?? 99), cls: String(p.class ?? "") });
  });
  each("mountain_peak", (f, p) => {
    const name = pickName(p);
    const pt = toPoint(geom(f));
    if (name && pt) labels.push({ text: name, lon: pt[0], lat: pt[1], kind: "peak", rank: Number(p.rank ?? 99), cls: "peak" });
  });

  return { groups, labels, vertices: vertices + labels.length };
}

const EMPTY_TILE = (): DecodedTile => ({ groups: {}, labels: [], vertices: 0 });
const abortErr = () => new DOMException("aborted", "AbortError");

/**
 * 타일 1장. xu = 래핑 전(연속) 타일 x (지오메트리의 경도가 요청 범위와 이어지도록 디코딩에 사용), URL 은 xu mod 2^z.
 * 같은 타일을 여러 호출자가 기다릴 수 있으므로 호출자 signal 은 "내 대기"만 취소하고,
 * 기다리는 호출자가 모두 취소했을 때만 실제 fetch 를 중단한다.
 */
function loadTile(template: string, z: number, xu: number, y: number, signal?: AbortSignal): Promise<DecodedTile> {
  const n = 2 ** z;
  const xw = ((xu % n) + n) % n;
  const key = `${template}|${z}/${xu}/${y}`;
  const hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  if (signal?.aborted) return Promise.reject(abortErr());
  let it = inflight.get(key);
  if (!it) {
    const ctrl = new AbortController();
    const url = template.replace("{z}", String(z)).replace("{x}", String(xw)).replace("{y}", String(y));
    const p = (async () => {
      const res = await fetchWithTimeout(url, TILE_TIMEOUT_MS, ctrl.signal);
      if (res.status === 404 || res.status === 204) {
        const empty = EMPTY_TILE();
        cacheSet(key, empty); // 빈 타일도 캐시 (바다/오지 타일을 계속 다시 묻지 않게)
        return empty;
      }
      if (!res.ok) throw new Error(`tile ${z}/${xw}/${y} ${res.status}`);
      const out = decodeTile(await res.arrayBuffer(), z, xu, y);
      cacheSet(key, out);
      return out;
    })().finally(() => inflight.delete(key));
    it = { p, ctrl, refs: 0 };
    inflight.set(key, it);
  }
  const cur = it;
  cur.refs++;
  return new Promise<DecodedTile>((resolve, reject) => {
    let done = false;
    const release = () => {
      if (done) return false;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      cur.refs--;
      return true;
    };
    const onAbort = () => {
      if (release() && cur.refs <= 0) cur.ctrl.abort();
      reject(abortErr());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    cur.p.then(
      (v) => {
        if (release()) resolve(v);
      },
      (e) => {
        if (release()) reject(e);
      },
    );
  });
}

// ---------- 라벨 중복 제거 ----------
function dedupeLabels(labels: VectorLabel[]): VectorLabel[] {
  const out: VectorLabel[] = [];
  const byText = new Map<string, VectorLabel[]>();
  for (const src of labels) {
    const l = { ...src }; // 타일 캐시 안의 라벨 객체를 변형하지 않도록 복사본으로 병합한다
    const key = l.kind === "road" ? `r|${l.text}` : `${l.kind}|${l.text}`;
    const list = byText.get(key) ?? [];
    // 도로명: 같은 이름이 타일 버퍼로 겹친 조각이면 같은 것으로 본다 (대략 40m). 시설: 역은 station/subway 중복 때문에 넓게(~400m)
    const tol = l.kind === "road" ? 0.0004 : l.cls === "railway" ? 0.004 : 0.0003;
    const dup = list.find((o) => {
      if (Math.abs(o.lon - l.lon) < tol && Math.abs(o.lat - l.lat) < tol) return true;
      if (l.kind === "road" && o.line && l.line) {
        // 선형 끝점이 서로 40m 안이면 같은 도로 조각(겹침)으로 간주
        const a = o.line, b = l.line;
        const near = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < 0.0004 && Math.abs(p[1] - q[1]) < 0.0004;
        return near(a[0], b[0]) && near(a[a.length - 1], b[b.length - 1]);
      }
      return false;
    });
    if (dup) {
      // 더 긴 조각/더 중요한 rank 를 남긴다
      if (l.kind === "road" && (l.line?.length ?? 0) > (dup.line?.length ?? 0)) Object.assign(dup, l);
      else if (l.rank < dup.rank) dup.rank = l.rank;
      continue;
    }
    list.push(l);
    byText.set(key, list);
    out.push(l);
  }
  return out;
}

/**
 * 화면 범위의 벡터 배경지도 데이터를 가져온다.
 * @param zoom 화면 줌(소수 가능). 타일 줌 = clamp(floor(zoom), 0, 14), 14 초과는 오버줌
 */
export async function fetchVectorBasemap(
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
  opts?: { signal?: AbortSignal },
): Promise<VectorBasemapData> {
  const signal = opts?.signal;
  const abortCheck = () => {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  };
  abortCheck();
  const template = await getTileTemplate();
  abortCheck();
  const r = tileRangeFor(bounds, zoom);
  const jobs: Promise<DecodedTile>[] = [];
  for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) jobs.push(loadTile(template, r.z, x, y, signal));
  const settled = await Promise.allSettled(jobs);
  abortCheck();
  const ok = settled.filter((s): s is PromiseFulfilledResult<DecodedTile> => s.status === "fulfilled").map((s) => s.value);
  const failed = settled.length - ok.length;
  if (!ok.length && failed && settled.every((q) => q.status === "rejected" && (q.reason as { name?: string })?.name === "AbortError")) throw abortErr();
  if (!ok.length && failed) throw new Error("벡터 타일을 받지 못했습니다");

  const groups: Record<string, VectorFeature[]> = {};
  let labels: VectorLabel[] = [];
  for (const t of ok) {
    for (const [g, fs] of Object.entries(t.groups)) (groups[g] ??= []).push(...fs);
    labels.push(...t.labels);
  }
  labels = dedupeLabels(labels);
  return { groups, labels, tileZoom: r.z, attribution: ATTRIBUTION, bounds: { ...bounds }, tileCount: ok.length, failedTiles: failed };
}
