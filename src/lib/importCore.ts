/**
 * 가져오기 핵심 로직 — 워커/메인 스레드 양쪽에서 실행 (D-0xx)
 *  GeoJSON / SHP(zip·낱개) / GeoPackage / DXF → 좌표계 판별 → WGS84 재투영 → LayerInput + 통계
 *
 * 좌표계 판별 우선순위 (D-019)
 *  1) 패널에서 수동 지정(override)
 *  2) SHP .prj / GPKG srs 매칭 / GeoJSON crs 멤버
 *  3) 좌표가 경위도 범위면 EPSG:4326
 *  4) 실패 → 좌표계를 지정하라는 에러
 */
import { bbox as turfBbox } from "@turf/turf";
import type { BBox, FeatureCollection } from "geojson";

import { crsFromName, getCrs, matchPrj } from "@/lib/crs";
import { readDxf, type DxfOptions } from "@/lib/dxf";
import { normalizeToFeatureCollection } from "@/lib/geojson";
import { readGpkg } from "@/lib/gpkg";
import {
  HARD_FILE_BYTES,
  SOFT_FILE_BYTES,
  WARN_VERTICES,
  type ImportedLayer,
  type ImportProgress,
  type ImportResult,
} from "@/lib/importTypes";
import { looksLikeLonLat, toWgs84 } from "@/lib/reproject";
import { isShapefilePart, readShapefileParts, readShapefileZip, type RawShpLayer, type ShpReadResult } from "@/lib/shapefile";
import { countVertices } from "@/lib/simplify";
import { uid } from "@/shared/util";

const BIG_FEATURES = 20000;
const BIG_BYTES = 5 * 1024 * 1024;

type Source = "geojson" | "shp" | "gpkg" | "dxf";
type Candidate = {
  name: string;
  fc: FeatureCollection;
  source: Source;
  crsHint: string | null;
  prj: string | null;
  encoding?: string;
  notes?: string[]; // 읽기 단계에서 생긴 경고
};

export type CoreOptions = {
  onProgress?: (p: ImportProgress) => void;
  /** 취소 여부 (메인 스레드 실행 시 AbortSignal.aborted 연결) */
  aborted?: () => boolean;
  dxf?: DxfOptions;
};

const abortError = () => new DOMException("가져오기가 취소되었습니다.", "AbortError");
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

function resolveCrs(c: Candidate, override: string | null): { proj4: string | null; label: string; warning?: string } {
  if (override) {
    const d = getCrs(override);
    if (!d) throw new Error(`알 수 없는 좌표계: ${override}`);
    return { proj4: d.code === "EPSG:4326" ? null : d.proj4, label: `${d.code} (수동 지정)` };
  }
  if (c.prj) {
    const m = matchPrj(c.prj);
    const tag = c.source === "gpkg" ? "gpkg 좌표계" : ".prj";
    if (m.kind === "registry") return { proj4: m.crs.code === "EPSG:4326" ? null : m.crs.proj4, label: `${m.crs.code} (${tag})` };
    if (m.kind === "raw") return { proj4: m.proj4, label: `${tag} 원문`, warning: `${c.name}: ${m.note}` };
  }
  const fromName = crsFromName(c.crsHint);
  if (fromName) return { proj4: fromName.code === "EPSG:4326" ? null : fromName.proj4, label: `${fromName.code} (crs 정보)` };

  // DXF 는 좌표계 정보가 없고 로컬 좌표가 흔하므로, 한국 경위도 범위일 때만 4326 으로 추정한다
  if (looksLikeLonLat(c.fc, { koreaOnly: c.source === "dxf" })) return { proj4: null, label: "EPSG:4326 (추정)" };

  const why = c.source === "shp" ? " (.prj 없음)" : c.source === "dxf" ? " (DXF 는 좌표계 정보가 없습니다)" : "";
  throw new Error(
    `${c.name}: 좌표계를 알 수 없습니다${why}.\n` +
      `패널의 [입력 좌표계]에서 직접 고른 뒤 다시 올려주세요. (공공데이터·도면은 보통 EPSG:5186 또는 5174)`,
  );
}

/** GeoJSON 직렬화 크기 추정 — 전체를 stringify 하지 않고 꼭짓점 수 + 속성 표본으로 계산 (수십만 피처에서 문자열 수백 MB 방지) */
function estimateBytes(fc: FeatureCollection, vertexCount: number): number {
  try {
    const n = fc.features.length;
    const sample = Math.min(n, 50);
    let propBytes = 0;
    for (let i = 0; i < sample; i++) propBytes += JSON.stringify(fc.features[i].properties ?? {}).length;
    const perFeature = sample ? propBytes / sample : 0;
    // 꼭짓점 하나 ≈ "[127.1234567,37.1234567]," 약 24자, 피처 껍데기 ≈ 60자
    return Math.round(vertexCount * 24 + n * (60 + perFeature));
  } catch {
    return vertexCount * 24;
  }
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

  const vertexCount = countVertices(fc);
  const bytes = estimateBytes(fc, vertexCount);

  const warnings: string[] = [...(c.notes ?? [])];
  if (crs.warning) warnings.push(crs.warning);
  if (fc.features.length > BIG_FEATURES) warnings.push(`${c.name}: 피처 ${fc.features.length.toLocaleString()}개 — 지도가 느려질 수 있습니다.`);
  if (vertexCount > WARN_VERTICES)
    warnings.push(`${c.name}: 꼭짓점 ${vertexCount.toLocaleString()}개 — 매우 무겁습니다. 문서에 넣을 때 단순화를 권장합니다.`);
  if (bytes > BIG_BYTES) warnings.push(`${c.name}: 약 ${mb(bytes)} — 문서(pptx) 용량이 커지고 저장이 실패할 수 있습니다.`);

  return {
    id: uid(),
    name: c.name,
    data: fc,
    bbox: [minX, minY, maxX, maxY] as BBox,
    featureCount: fc.features.length,
    crsLabel: crs.label,
    encoding: c.encoding,
    vertexCount,
    bytes,
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

const fromShp = (l: RawShpLayer): Candidate => ({ name: l.name, fc: l.fc, source: "shp", crsHint: null, prj: l.prj, encoding: l.encoding, notes: l.notes });

const EXT = {
  json: /\.(geo)?json$/i,
  zip: /\.zip$/i,
  gpkg: /\.gpkg$/i,
  dxf: /\.dxf$/i,
};

/** 여러 파일 한꺼번에 처리 (zip, 낱개 shp 묶음, geojson, gpkg, dxf 섞여 있어도 됨) */
export async function importFilesCore(input: FileList | File[], crsOverride: string | null, opts: CoreOptions = {}): Promise<ImportResult> {
  const { onProgress, aborted } = opts;
  const check = () => {
    if (aborted?.()) throw abortError();
  };
  const files = Array.from(input);
  const result: ImportResult = { layers: [], errors: [], warnings: [] };
  const candidates: Candidate[] = [];

  // 크기 한도: 거부 / 경고
  const ok: File[] = [];
  for (const f of files) {
    if (f.size > HARD_FILE_BYTES) {
      result.errors.push(
        `${f.name}: 파일이 너무 큽니다 (${mb(f.size)}). 한 파일당 ${mb(HARD_FILE_BYTES)} 까지만 가져올 수 있습니다. 영역을 잘라내거나 단순화한 뒤 다시 올려주세요.`,
      );
      continue;
    }
    if (f.size > SOFT_FILE_BYTES) result.warnings.push(`${f.name}: ${mb(f.size)} — 큰 파일이라 시간이 걸리고 문서 용량이 커질 수 있습니다.`);
    ok.push(f);
  }

  const shpParts = ok.filter((f) => isShapefilePart(f.name));
  const zips = ok.filter((f) => EXT.zip.test(f.name));
  const jsons = ok.filter((f) => EXT.json.test(f.name));
  const gpkgs = ok.filter((f) => EXT.gpkg.test(f.name));
  const dxfs = ok.filter((f) => EXT.dxf.test(f.name));
  const handled = new Set([...shpParts, ...zips, ...jsons, ...gpkgs, ...dxfs]);
  for (const f of ok) {
    if (handled.has(f)) continue;
    result.errors.push(
      /\.dwg$/i.test(f.name)
        ? `${f.name}: DWG 는 지원하지 않습니다. DXF 로 내보내 다시 올려주세요.`
        : `${f.name}: 지원하지 않는 형식입니다. (GeoJSON, SHP, SHP zip, GeoPackage, DXF)`,
    );
  }

  // SHP 는 그룹별 오류를 모아 두고 성공한 레이어만 이어서 처리한다
  const addShp = (r: ShpReadResult) => {
    r.layers.forEach((l) => candidates.push(fromShp(l)));
    result.errors.push(...r.errors);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    check();
    onProgress?.({ stage: "읽는 중", file: label });
    try {
      await fn();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  };

  for (const f of jsons) await run(f.name, async () => void candidates.push(await readGeoJSON(f)));
  for (const z of zips) await run(z.name, async () => addShp(await readShapefileZip(z)));
  if (shpParts.length) await run("Shapefile", async () => addShp(await readShapefileParts(shpParts)));
  for (const g of gpkgs) {
    await run(g.name, async () => {
      const layers = await readGpkg(
        g,
        (pct, table) => onProgress?.({ stage: "GeoPackage 읽는 중", pct, file: `${g.name} / ${table}` }),
        () => !!aborted?.(),
      );
      for (const l of layers) {
        const known = l.crsHint && getCrs(l.crsHint);
        candidates.push({
          name: l.name,
          fc: l.fc,
          source: "gpkg",
          crsHint: l.crsHint,
          prj: known ? null : l.prj, // 레지스트리에 있으면 EPSG 코드 우선
          notes: l.skipped ? [`${l.name}: 빈 지오메트리/해석 실패 ${l.skipped.toLocaleString()}행을 건너뛰었습니다.`] : undefined,
        });
      }
    });
  }
  for (const d of dxfs) {
    await run(d.name, async () => {
      onProgress?.({ stage: "DXF 해석 중", file: d.name });
      const r = readDxf(new Uint8Array(await d.arrayBuffer()), d.name.replace(EXT.dxf, ""), opts.dxf);
      candidates.push({ name: r.name, fc: r.fc, source: "dxf", crsHint: null, prj: null, encoding: r.encoding, notes: r.warnings });
    });
  }

  let i = 0;
  for (const c of candidates) {
    check();
    onProgress?.({ stage: "좌표 변환 중", file: c.name, pct: candidates.length ? i / candidates.length : 1 });
    i++;
    try {
      const layer = finalize(c, crsOverride);
      result.layers.push(layer);
      if (layer.warning) result.warnings.push(layer.warning);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  onProgress?.({ stage: "완료", pct: 1 });
  return result;
}
