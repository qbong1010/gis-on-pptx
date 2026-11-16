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
  /** 읽기 단계 경고 (예: .dbf 해석 실패 → 속성 없이 도형만) */
  notes?: string[];
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

const HANGUL = /[\uac00-\ud7a3]/g;

/** 셀 끝에서 잘려 불완전해진 멀티바이트 시퀀스를 떼어낸다 (고정폭 필드가 글자 중간에서 잘린 경우) */
function trimTruncated(cell: Uint8Array, enc: "utf-8" | "euc-kr"): Uint8Array {
  const n = cell.length;
  if (enc === "utf-8") {
    // 끝 3바이트 안에서 마지막 리드 바이트를 찾아, 필요한 길이보다 모자라면 거기서 자른다
    for (let k = 1; k <= Math.min(3, n); k++) {
      const b = cell[n - k];
      if (b >= 0xc0) {
        const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
        return need > k ? cell.subarray(0, n - k) : cell;
      }
      if (b < 0x80) break;
    }
    return cell;
  }
  // euc-kr: 끝의 연속된 고비트 바이트가 홀수 개면 마지막 하나는 짝 잃은 리드 바이트
  let run = 0;
  while (run < n && cell[n - 1 - run] >= 0x80) run++;
  return run % 2 === 1 ? cell.subarray(0, n - 1) : cell;
}

/** 비엄격 디코드 후 { 깨진 글자 수, 한글 수 } */
function scoreDecode(chunks: Uint8Array[], enc: "utf-8" | "euc-kr") {
  const dec = new TextDecoder(enc);
  let bad = 0;
  let hangul = 0;
  for (const c of chunks) {
    const t = dec.decode(trimTruncated(c, enc));
    for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 0xfffd) bad++;
    hangul += (t.match(HANGUL) ?? []).length;
  }
  return { bad, hangul };
}

/**
 * DBF 인코딩 추정 (.cpg 가 없을 때)
 *  - 헤더의 바이너리 바이트(필드 길이 254=0xFE 등)가 판정을 망치지 않도록, 필드명(11바이트)만 따로 본다.
 *  - 레코드는 필드 셀 단위로 두 인코딩 모두 비엄격 디코드해 깨진 글자 수를 비교한다.
 *    (고정폭에서 잘린 글자 끝은 제외, 표본은 레코드 경계에서 자른다)
 */
function sniffDbfEncoding(dbf: Uint8Array): string {
  if (dbf.length < 32) return "utf-8";
  const view = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const headerLen = view.getUint16(8, true);
  const recLen = view.getUint16(10, true);
  if (headerLen < 33 || headerLen > dbf.length || recLen < 2) return "utf-8";

  // 필드 디스크립터: 32바이트씩, 0x0D 로 끝남
  const fields: { name: Uint8Array; len: number }[] = [];
  for (let off = 32; off + 32 <= headerLen && dbf[off] !== 0x0d; off += 32) {
    let e = off;
    while (e < off + 11 && dbf[e] !== 0) e++;
    fields.push({ name: dbf.subarray(off, e), len: dbf[off + 16] });
  }

  const chunks: Uint8Array[] = fields.map((f) => f.name).filter((n) => n.some((b) => b >= 0x80));
  // 표본: 최대 512KB, 레코드 단위로
  const maxRecs = Math.max(1, Math.floor((512 * 1024) / recLen));
  const nRecs = Math.min(maxRecs, Math.floor((dbf.length - headerLen) / recLen));
  for (let r = 0; r < nRecs; r++) {
    let pos = headerLen + r * recLen + 1; // 삭제 플래그 1바이트
    for (const f of fields) {
      const cell = dbf.subarray(pos, pos + f.len);
      if (cell.some((b) => b >= 0x80)) chunks.push(cell);
      pos += f.len;
    }
  }
  if (!chunks.length) return "utf-8"; // 전부 ASCII

  const u = scoreDecode(chunks, "utf-8");
  if (u.bad === 0) return "utf-8";
  const k = scoreDecode(chunks, "euc-kr");
  if (k.bad === 0) return "euc-kr";
  // 둘 다 일부 깨짐: 깨진 글자 적은 쪽, 같으면 한글이 많은 쪽 (한국 데이터 기본값 EUC-KR)
  if (u.bad !== k.bad) return u.bad < k.bad ? "utf-8" : "euc-kr";
  return u.hangul > k.hangul ? "utf-8" : "euc-kr";
}

function buildLayer(name: string, parts: Parts): RawShpLayer {
  if (!parts.shp) throw new Error(`${name}: .shp 파일이 없습니다. (.shp/.dbf/.prj 를 함께 올려주세요)`);

  const geoms = parseShp(parts.shp); // prj 미전달 → 원 좌표
  let encoding = normalizeEncoding(parts.cpg) ?? (parts.dbf ? sniffDbfEncoding(parts.dbf) : "utf-8");
  let rows: Record<string, unknown>[] = [];
  const notes: string[] = [];
  if (parts.dbf) {
    try {
      rows = parseDbf(parts.dbf, encoding);
    } catch {
      try {
        encoding = encoding === "utf-8" ? "euc-kr" : "utf-8";
        rows = parseDbf(parts.dbf, encoding);
      } catch (e) {
        // 속성표만 깨진 경우 도형은 살린다
        rows = [];
        notes.push(`${name}: .dbf 를 해석하지 못해 속성 없이 도형만 가져왔습니다. (${e instanceof Error ? e.message : e})`);
      }
    }
  }

  const features: Feature[] = [];
  geoms.forEach((g, i) => {
    if (g) features.push({ type: "Feature", geometry: g, properties: (rows[i] ?? {}) as Record<string, unknown> });
  });

  return { name, fc: { type: "FeatureCollection", features }, prj: parts.prj ?? null, encoding, notes: notes.length ? notes : undefined };
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

export type ShpReadResult = { layers: RawShpLayer[]; errors: string[] };

/** 그룹별로 읽어 한 그룹이 깨져도 나머지 레이어는 살린다 */
function buildAll(groups: Iterable<{ display: string; parts: Parts }>, nameOf: (display: string, i: number) => string): ShpReadResult {
  const out: ShpReadResult = { layers: [], errors: [] };
  let i = 0;
  for (const g of groups) {
    const name = nameOf(g.display, i++);
    try {
      out.layers.push(buildLayer(name, g.parts));
    } catch (e) {
      out.errors.push(e instanceof Error ? (e.message.startsWith(name) ? e.message : `${name}: ${e.message}`) : `${name}: ${String(e)}`);
    }
  }
  return out;
}

/** 낱개 파일들(.shp/.dbf/.prj/.cpg) → 레이어들 */
export async function readShapefileParts(files: File[]): Promise<ShpReadResult> {
  const groups = new Map<string, { display: string; parts: Parts }>();
  for (const f of files) collect(groups, f.name, new Uint8Array(await f.arrayBuffer()));
  return buildAll(
    [...groups.values()].filter((g) => g.parts.shp || g.parts.dbf),
    (d) => d,
  );
}

/** .zip → 레이어들 */
export async function readShapefileZip(file: File): Promise<ShpReadResult> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const groups = new Map<string, { display: string; parts: Parts }>();
  for (const entry of iter(raw)) {
    if (entry.filename.includes("__MACOSX") || !SHP_PARTS.test(entry.filename)) continue;
    try {
      collect(groups, entry.filename, await entry.read());
    } catch {
      /* 이 항목만 건너뜀 — 해당 그룹은 이후 .shp 누락으로 보고된다 */
    }
  }
  const zipStem = file.name.replace(/\.zip$/i, "");
  const layers = [...groups.values()].filter((g) => g.parts.shp);
  if (!layers.length) throw new Error(`${file.name}: zip 안에 .shp 파일이 없습니다.`);
  // zip 내부 파일명이 CP949 라 깨진 경우 zip 이름으로 대체
  return buildAll(layers, (d, i) => (d.includes("�") ? `${zipStem}${layers.length > 1 ? `_${i + 1}` : ""}` : d));
}
