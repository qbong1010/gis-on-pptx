import type { Feature, FeatureCollection, Geometry } from "geojson";

const GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

/** Feature / Geometry / FeatureCollection 무엇이 들어와도 FeatureCollection 으로 통일 */
export function normalizeToFeatureCollection(raw: unknown): FeatureCollection {
  if (!raw || typeof raw !== "object" || !("type" in raw)) {
    throw new Error("GeoJSON 객체가 아닙니다. (type 속성 없음)");
  }
  const obj = raw as { type: string };

  if (obj.type === "FeatureCollection") {
    const fc = obj as FeatureCollection;
    if (!Array.isArray(fc.features)) throw new Error("FeatureCollection 에 features 배열이 없습니다.");
    return { type: "FeatureCollection", features: fc.features };
  }
  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [obj as Feature] };
  }
  if (GEOMETRY_TYPES.has(obj.type)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: obj as Geometry }],
    };
  }
  throw new Error(`인식할 수 없는 GeoJSON type: ${obj.type}`);
}
