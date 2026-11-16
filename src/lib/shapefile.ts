/**
 * Shapefile 읽기 (D-020)
 *  - 입력: .zip (안에 여러 shp 가능) 또는 .shp/.dbf/.prj/.cpg/.shx 낱개 파일들
 *  - 파일명(확장자 뺀 경로)으로 묶어 레이어 단위로 반환
 *  - DBF 인코딩: .cpg 우선, 없으면 UTF-8 로 읽어 보고 깨지면 CP949(EUC-KR)
 *  - 좌표 변환은 여기서 하지 않음 (importers.ts → reproject.ts)
 */
import { iter } from "but-unzip";
import { parseDbf, parseShp } from "shpjs";
import type { Feature, FeatureCollection } from "geojson";

export type RawShpLayer = {
  name: string;
  fc: FeatureCollection; // 원 좌표 그대로
  prj: string | null;
  encoding: string;
};

type Parts = { shp?: Uint8Array; dbf?: Uint8Array; prj?: string; cpg?: string };

const SHP_PARTS = /\.(shp|dbf|prj|cpg|shx)$/i;

export function isShapefilePart(name: string): boolean {
  return SHP_PARTS.test(name);
}

const utf8 = new TextDecoder("utf-8");

/** .cpg 내용 → TextDecoder 라벨 */
function normalizeEncoding(cpg: string | undefined): string | null {
  if (!cpg) return null;
  const v = cpg.trim().toLowerCase();
  if (!v) return null;
  if (/utf-?8|65001/.test(v)) return "utf-8";
  if (/949|euc-?kr|ks_?c|korean|cp949|uhc/.test(v)) return "euc-kr";
  try {
    new TextDecoder(v);
    return v;
  } catch {
    return null;
  }
}

/** DBF 레코드 영역이 올바른 UTF-8 인지 검사 → 아니면 EUC-KR */
function sniffDbfEncoding(dbf: Uint8Array): string {
  if (dbf.length < 32) return "utf-8";
  const view = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const headerLen = view.getUint16(8, true);
  const body = dbf.subarray(headerLen, Math.min(dbf.length, headerLen + 512 * 1024));
  // 필드명(헤더)도 한글일 수 있으므로 같이 검사
  const header = dbf.subarray(32, headerLen);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(header);
    new TextDecoder("utf-8", { fatal: true }).decode(body);
    return "utf-8";
  } catch {
    return "euc-kr";
  }
}

function buildLayer(name: string, parts: Parts): RawShpLayer {
  if (!parts.shp) throw new Error(`${name}: .shp 파일이 없습니다. (.shp/.dbf/.prj 를 함께 올려주세요)`);

  const geoms = parseShp(parts.shp); // prj 미전달 → 원 좌표
  let encoding = normalizeEncoding(parts.cpg) ?? (parts.dbf ? sniffDbfEncoding(parts.dbf) : "utf-8");
  let rows: Record<string, unknown>[] = [];
  if (parts.dbf) {
    try {
      rows = parseDbf(parts.dbf, encoding);
    } catch {
      encoding = encoding === "utf-8" ? "euc-kr" : "utf-8";
      rows = parseDbf(parts.dbf, encoding);
    }
  }

  const features: Feature[] = [];
  geoms.forEach((g, i) => {
    if (g) features.push({ type: "Feature", geometry: g, properties: (rows[i] ?? {}) as Record<string, unknown> });
  });

  return { name, fc: { type: "FeatureCollection", features }, prj: parts.prj ?? null, encoding };
}

function baseKey(path: string): { key: string; ext: string; display: string } {
  const m = /^(.*)\.([^.\\/]+)$/.exec(path);
  const stem = m ? m[1] : path;
  const ext = (m ? m[2] : "").toLowerCase();
  const display = stem.split(/[\\/]/).pop() ?? stem;
  return { key: stem.toLowerCase(), ext, display };
}

function collect(groups: Map<string, { display: string; parts: Parts }>, path: string, bytes: Uint8Array) {
  const { key, ext, display } = baseKey(path);
  const g = groups.get(key) ?? { display, parts: {} };
  if (ext === "shp") g.parts.shp = bytes;
  else if (ext === "dbf") g.parts.dbf = bytes;
  else if (ext === "prj") g.parts.prj = utf8.decode(bytes);
  else if (ext === "cpg") g.parts.cpg = utf8.decode(bytes);
  else return; // .shx 등은 무시
  groups.set(key, g);
}

/** 낱개 파일들(.shp/.dbf/.prj/.cpg) → 레이어들 */
export async function readShapefileParts(files: File[]): Promise<RawShpLayer[]> {
  const groups = new Map<string, { display: string; parts: Parts }>();
  for (const f of files) collect(groups, f.name, new Uint8Array(await f.arrayBuffer()));
  return [...groups.values()].filter((g) => g.parts.shp || g.parts.dbf).map((g) => buildLayer(g.display, g.parts));
}

/** .zip → 레이어들 */
export async function readShapefileZip(file: File): Promise<RawShpLayer[]> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const groups = new Map<string, { display: string; parts: Parts }>();
  for (const entry of iter(raw)) {
    if (entry.filename.includes("__MACOSX") || !SHP_PARTS.test(entry.filename)) continue;
    collect(groups, entry.filename, await entry.read());
  }
  const zipStem = file.name.replace(/\.zip$/i, "");
  const layers = [...groups.values()].filter((g) => g.parts.shp);
  if (!layers.length) throw new Error(`${file.name}: zip 안에 .shp 파일이 없습니다.`);
  return layers.map((g, i) => {
    // zip 내부 파일명이 CP949 라 깨진 경우 zip 이름으로 대체
    const display = g.display.includes("�") ? `${zipStem}${layers.length > 1 ? `_${i + 1}` : ""}` : g.display;
    return buildLayer(display, g.parts);
  });
}
