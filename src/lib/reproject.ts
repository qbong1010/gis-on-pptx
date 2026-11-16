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

/** 첫 몇 개 좌표로 경위도 범위인지 대략 판단 */
export function looksLikeLonLat(fc: FeatureCollection): boolean {
  let checked = 0;
  let ok = true;
  const visit = (c: Position) => {
    if (checked > 50) return;
    checked++;
    if (!(Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)) ok = false;
  };
  const walk = (g: Geometry | null) => {
    if (!g || checked > 50) return;
    mapGeometry(g, (c) => {
      visit(c);
      return c;
    });
  };
  for (const f of fc.features) {
    walk(f.geometry);
    if (checked > 50) break;
  }
  return ok;
}
