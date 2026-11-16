/**
 * FeatureCollection 좌표를 WGS84 경위도로 변환 + 소수 7자리 반올림 (D-019, D-021)
 */
import proj4 from "proj4";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const P = 1e7;
const round = (v: number) => Math.round(v * P) / P;

type Fn = (c: Position) => Position;

function mapGeometry(g: Geometry | null, fn: Fn): Geometry | null {
  if (!g) return null;
  switch (g.type) {
    case "Point":
      return { type: "Point", coordinates: fn(g.coordinates) };
    case "MultiPoint":
    case "LineString":
      return { type: g.type, coordinates: g.coordinates.map(fn) } as Geometry;
    case "MultiLineString":
    case "Polygon":
      return { type: g.type, coordinates: g.coordinates.map((r) => r.map(fn)) } as Geometry;
    case "MultiPolygon":
      return { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map((r) => r.map(fn))) };
    case "GeometryCollection":
      return { type: "GeometryCollection", geometries: g.geometries.map((x) => mapGeometry(x, fn)!).filter(Boolean) };
  }
}

/** fromProj4 가 null 이면 이미 WGS84 → 반올림만 */
export function toWgs84(fc: FeatureCollection, fromProj4: string | null): FeatureCollection {
  let fn: Fn;
  if (fromProj4) {
    const conv = proj4(fromProj4, WGS84);
    fn = (c) => {
      const [x, y] = conv.forward([c[0], c[1]]);
      return [round(x), round(y)];
    };
  } else {
    fn = (c) => [round(c[0]), round(c[1])];
  }
  const features: Feature[] = [];
  for (const f of fc.features) {
    const geometry = mapGeometry(f.geometry, fn);
    if (geometry) features.push({ type: "Feature", properties: f.properties ?? {}, geometry });
  }
  return { type: "FeatureCollection", features };
}

/** 모든 좌표의 범위 [minX, minY, maxX, maxY] (비어 있으면 null) */
export function coordBounds(fc: FeatureCollection): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c: Position) => {
    const x = c[0];
    const y = c[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const f of fc.features) {
    if (!f.geometry) continue;
    mapGeometry(f.geometry, (c) => {
      visit(c);
      return c;
    });
  }
  return minX === Infinity ? null : [minX, minY, maxX, maxY];
}

/**
 * 전체 좌표(bbox)가 경위도 범위인지 판단.
 *  - 기본: 모든 좌표가 [-180,180]/[-90,90] 안 (NaN/Infinity 는 불가)
 *  - koreaOnly: 한국 근방(경도 124–132, 위도 33–39.5)일 때만 true.
 *    좌표계 정보가 없는 DXF 는 원점 근처 로컬 좌표(예: 0~100)도 "경위도 범위"에 들어가 조용히 틀린 위치로 가므로 이 모드를 쓴다.
 */
export function looksLikeLonLat(fc: FeatureCollection, opts: { koreaOnly?: boolean } = {}): boolean {
  const b = coordBounds(fc);
  if (!b || !b.every(Number.isFinite)) return false;
  const [minX, minY, maxX, maxY] = b;
  if (opts.koreaOnly) return minX >= 124 && maxX <= 132 && minY >= 33 && maxY <= 39.5;
  return minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90;
}
