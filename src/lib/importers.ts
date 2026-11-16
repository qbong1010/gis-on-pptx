/**
 * 파일 가져오기 단일 진입점 — 패널과 지도 박스 드롭이 같이 사용
 *  GeoJSON / SHP(zip·낱개) → 좌표계 판별 → WGS84 재투영 → LayerInput
 *
 * 좌표계 판별 우선순위 (D-019)
 *  1) 패널에서 수동 지정(override)
 *  2) SHP .prj 매칭 / GeoJSON crs 멤버
 *  3) 좌표가 경위도 범위면 EPSG:4326
 *  4) 실패 → 좌표계를 지정하라는 에러
 */
import { bbox as turfBbox } from "@turf/turf";
import type { BBox, FeatureCollection } from "geojson";

import { crsFromName, getCrs, matchPrj } from "@/lib/crs";
import { normalizeToFeatureCollection } from "@/lib/geojson";
import { looksLikeLonLat, toWgs84 } from "@/lib/reproject";
import { isShapefilePart, readShapefileParts, readShapefileZip, type RawShpLayer } from "@/lib/shapefile";
import type { LayerInput } from "@/shared/protocol";
import { uid } from "@/shared/util";

export const ACCEPT_ATTR = ".geojson,.json,.zip,.shp,.dbf,.prj,.cpg,.shx,application/geo+json,application/json,application/zip";

export type ImportedLayer = LayerInput & { crsLabel: string; warning?: string; encoding?: string };
export type ImportResult = { layers: ImportedLayer[]; errors: string[]; warnings: string[] };

const BIG_FEATURES = 20000;
const BIG_BYTES = 5 * 1024 * 1024;

type Candidate = { name: string; fc: FeatureCollection; source: string; crsHint: string | null; prj: string | null; encoding?: string };

function resolveCrs(c: Candidate, override: string | null): { proj4: string | null; label: string; warning?: string } {
  if (override) {
    const d = getCrs(override);
    if (!d) throw new Error(`알 수 없는 좌표계: ${override}`);
    return { proj4: d.code === "EPSG:4326" ? null : d.proj4, label: `${d.code} (수동 지정)` };
  }
  if (c.prj) {
    const m = matchPrj(c.prj);
    if (m.kind === "registry") return { proj4: m.crs.code === "EPSG:4326" ? null : m.crs.proj4, label: `${m.crs.code} (.prj)` };
    if (m.kind === "raw") return { proj4: m.proj4, label: ".prj 원문", warning: `${c.name}: ${m.note}` };
  }
  const fromName = crsFromName(c.crsHint);
  if (fromName) return { proj4: fromName.code === "EPSG:4326" ? null : fromName.proj4, label: `${fromName.code} (crs 정보)` };

  if (looksLikeLonLat(c.fc)) return { proj4: null, label: "EPSG:4326 (추정)" };

  throw new Error(
    `${c.name}: 좌표계를 알 수 없습니다${c.source === "shp" ? " (.prj 없음)" : ""}.\n` +
      `패널의 [입력 좌표계]에서 직접 고른 뒤 다시 올려주세요. (공공데이터는 보통 EPSG:5186 또는 5174)`,
  );
}

function finalize(c: Candidate, override: string | null): ImportedLayer {
  const crs = resolveCrs(c, override);
  const fc = toWgs84(c.fc, crs.proj4);
  if (!fc.features.length) throw new Error(`${c.name}: geometry 가 있는 피처가 없습니다.`);

  const box = turfBbox(fc);
  const [minX, minY, maxX, maxY] = box;
  if (!(minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90)) {
    throw new Error(`${c.name}: 변환 결과가 경위도 범위를 벗어납니다. 입력 좌표계(${crs.label})가 맞는지 확인하세요.`);
  }

  const warnings: string[] = [];
  if (crs.warning) warnings.push(crs.warning);
  if (fc.features.length > BIG_FEATURES) warnings.push(`${c.name}: 피처 ${fc.features.length.toLocaleString()}개 — 지도가 느려질 수 있습니다.`);
  const approxBytes = JSON.stringify(fc).length;
  if (approxBytes > BIG_BYTES)
    warnings.push(`${c.name}: 약 ${(approxBytes / 1024 / 1024).toFixed(1)}MB — 문서(pptx) 용량이 커지고 저장이 실패할 수 있습니다.`);

  return {
    id: uid(),
    name: c.name,
    data: fc,
    bbox: [minX, minY, maxX, maxY] as BBox,
    featureCount: fc.features.length,
    crsLabel: crs.label,
    encoding: c.encoding,
    warning: warnings.length ? warnings.join("\n") : undefined,
  };
}

async function readGeoJSON(file: File): Promise<Candidate> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name}: JSON 파싱에 실패했습니다.`);
  }
  const fc = normalizeToFeatureCollection(raw);
  fc.features = fc.features.filter((f) => f && f.geometry);
  const crsHint = (raw as { crs?: { properties?: { name?: string } } })?.crs?.properties?.name ?? null;
  return { name: file.name.replace(/\.(geo)?json$/i, ""), fc, source: "geojson", crsHint, prj: null };
}

const fromShp = (l: RawShpLayer): Candidate => ({ name: l.name, fc: l.fc, source: "shp", crsHint: null, prj: l.prj, encoding: l.encoding });

/** 여러 파일 한꺼번에 처리 (zip, 낱개 shp 묶음, geojson 섞여 있어도 됨) */
export async function importFiles(input: FileList | File[], crsOverride: string | null = null): Promise<ImportResult> {
  const files = Array.from(input);
  const result: ImportResult = { layers: [], errors: [], warnings: [] };
  const candidates: Candidate[] = [];

  const shpParts = files.filter((f) => isShapefilePart(f.name));
  const zips = files.filter((f) => /\.zip$/i.test(f.name));
  const jsons = files.filter((f) => /\.(geo)?json$/i.test(f.name));
  const others = files.filter((f) => !shpParts.includes(f) && !zips.includes(f) && !jsons.includes(f));

  for (const f of others) result.errors.push(`${f.name}: 지원하지 않는 형식입니다. (GeoJSON, SHP, SHP zip)`);

  for (const f of jsons) {
    try {
      candidates.push(await readGeoJSON(f));
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  for (const z of zips) {
    try {
      (await readShapefileZip(z)).forEach((l) => candidates.push(fromShp(l)));
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (shpParts.length) {
    try {
      (await readShapefileParts(shpParts)).forEach((l) => candidates.push(fromShp(l)));
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  for (const c of candidates) {
    try {
      const layer = finalize(c, crsOverride);
      result.layers.push(layer);
      if (layer.warning) result.warnings.push(layer.warning);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}
