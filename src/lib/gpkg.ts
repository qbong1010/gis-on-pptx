/**
 * GeoPackage(.gpkg) 읽기
 *  - sql.js(WASM SQLite)로 열고 gpkg_contents(features) 테이블마다 레이어 1개
 *  - 좌표계: gpkg_spatial_ref_sys 의 EPSG 코드 우선, 레지스트리에 없으면 WKT(definition) 를 prj 로 전달
 *  - 지오메트리: GeoPackage 바이너리 헤더('GP') + WKB(ISO Z/M/ZM, EWKB 플래그 모두) → GeoJSON, Z/M 은 버림
 *  - 좌표 변환은 여기서 하지 않음 (importers → reproject.ts)
 */
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

export type RawGpkgLayer = {
  name: string;
  fc: FeatureCollection;
  /** "EPSG:5186" 형태 (레지스트리와 대조는 importers 에서) */
  crsHint: string | null;
  /** 좌표계 WKT (EPSG 코드가 없거나 미등록일 때) */
  prj: string | null;
  skipped: number; // 해석 실패·빈 지오메트리로 건너뛴 행
};

type SqlJs = Awaited<ReturnType<typeof initSqlJs>>;
let sqlPromise: Promise<SqlJs> | null = null;
function getSql(): Promise<SqlJs> {
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl });
  return sqlPromise;
}

/* ------------------------------------------------------------------ */
/* WKB / GeoPackage geometry                                            */
/* ------------------------------------------------------------------ */

class Reader {
  private v: DataView;
  pos: number;
  le = true;
  constructor(buf: Uint8Array, pos = 0) {
    this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = pos;
  }
  u8() {
    return this.v.getUint8(this.pos++);
  }
  u32() {
    const r = this.v.getUint32(this.pos, this.le);
    this.pos += 4;
    return r;
  }
  f64() {
    const r = this.v.getFloat64(this.pos, this.le);
    this.pos += 8;
    return r;
  }
}

/** 좌표 1개 읽기: Z/M 은 읽고 버림 */
function readPoint(r: Reader, hasZ: boolean, hasM: boolean): Position {
  const x = r.f64();
  const y = r.f64();
  if (hasZ) r.f64();
  if (hasM) r.f64();
  return [x, y];
}

function readPoints(r: Reader, hasZ: boolean, hasM: boolean): Position[] {
  const n = r.u32();
  const out: Position[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = readPoint(r, hasZ, hasM);
  return out;
}

/** WKB 지오메트리 1개 (중첩 가능). 빈 Point(NaN) 는 null */
function readWkb(r: Reader): Geometry | null {
  r.le = r.u8() === 1;
  const raw = r.u32();
  let hasZ = (raw & 0x80000000) !== 0;
  let hasM = (raw & 0x40000000) !== 0;
  const hasSrid = (raw & 0x20000000) !== 0;
  const t = raw & 0x0fffffff;
  const iso = Math.floor(t / 1000); // ISO: 1000=Z, 2000=M, 3000=ZM
  if (iso === 1 || iso === 3) hasZ = true;
  if (iso === 2 || iso === 3) hasM = true;
  const base = t % 1000;
  if (hasSrid) r.u32();

  switch (base) {
    case 1: {
      const c = readPoint(r, hasZ, hasM);
      return Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { type: "Point", coordinates: c } : null;
    }
    case 2: // LineString
    case 8: // CircularString → 현(chord) 근사 [확인 필요: 곡선은 실데이터 없음]
      return { type: "LineString", coordinates: readPoints(r, hasZ, hasM) };
    case 3: {
      const n = r.u32();
      const rings: Position[][] = [];
      for (let i = 0; i < n; i++) rings.push(readPoints(r, hasZ, hasM));
      return { type: "Polygon", coordinates: rings };
    }
    case 4:
    case 5:
    case 6:
    case 7: {
      const n = r.u32();
      const parts: Geometry[] = [];
      for (let i = 0; i < n; i++) {
        const leBefore = r.le;
        const g = readWkb(r);
        r.le = leBefore;
        if (g) parts.push(g);
      }
      if (base === 7) return { type: "GeometryCollection", geometries: parts };
      if (base === 4)
        return { type: "MultiPoint", coordinates: parts.map((p) => (p as { coordinates: Position }).coordinates) };
      if (base === 5)
        return { type: "MultiLineString", coordinates: parts.map((p) => (p as { coordinates: Position[] }).coordinates) };
      return { type: "MultiPolygon", coordinates: parts.map((p) => (p as { coordinates: Position[][] }).coordinates) };
    }
    default:
      throw new Error(`지원하지 않는 WKB 타입 ${raw}`);
  }
}

/** GeoPackageBinary → GeoJSON Geometry (빈 지오메트리는 null) */
export function parseGpkgGeometry(buf: Uint8Array): Geometry | null {
  if (buf.length < 8 || buf[0] !== 0x47 || buf[1] !== 0x50) throw new Error("GeoPackage 지오메트리 헤더('GP')가 아닙니다.");
  const flags = buf[3];
  const littleEndian = (flags & 1) === 1;
  const envelope = (flags >> 1) & 7;
  const empty = ((flags >> 4) & 1) === 1;
  if (empty) return null;
  const envBytes = [0, 32, 48, 48, 64][envelope];
  if (envBytes === undefined) throw new Error(`알 수 없는 envelope 지시자 ${envelope}`);
  void littleEndian; // 헤더의 srs_id/envelope 는 쓰지 않음 (WKB 자체에 바이트 순서가 있음)
  const r = new Reader(buf, 8 + envBytes);
  return readWkb(r);
}

/* ------------------------------------------------------------------ */
/* 테이블 읽기                                                           */
/* ------------------------------------------------------------------ */

function q(db: Database, sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Record<string, SqlValue>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

function readSrs(db: Database, srsId: number): { crsHint: string | null; prj: string | null } {
  if (srsId <= 0) return { crsHint: null, prj: null }; // 0/-1 = 정의 안 됨
  const rows = q(db, "SELECT organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys WHERE srs_id = ?", [srsId]);
  if (!rows.length) return { crsHint: srsId === 4326 ? "EPSG:4326" : null, prj: null };
  const { organization, organization_coordsys_id: id, definition } = rows[0];
  const crsHint = String(organization ?? "").toUpperCase() === "EPSG" && id != null ? `EPSG:${id}` : srsId === 4326 ? "EPSG:4326" : null;
  const def = typeof definition === "string" && definition.trim() && definition.trim() !== "undefined" ? definition : null;
  return { crsHint, prj: def };
}

export type GpkgProgress = (pct: number, table: string) => void;

export async function readGpkg(
  file: File,
  onProgress?: GpkgProgress,
  shouldAbort?: () => boolean,
): Promise<RawGpkgLayer[]> {
  const SQL = await getSql();
  const bytes = new Uint8Array(await file.arrayBuffer());
  // SQLite 헤더 확인
  const magic = new TextDecoder().decode(bytes.subarray(0, 15));
  if (magic !== "SQLite format 3") throw new Error(`${file.name}: GeoPackage(SQLite) 파일이 아닙니다.`);

  let db: Database;
  try {
    db = new SQL.Database(bytes);
  } catch (e) {
    throw new Error(`${file.name}: GeoPackage 를 열지 못했습니다. (${e instanceof Error ? e.message : e})`);
  }

  try {
    let tables: Record<string, SqlValue>[];
    try {
      tables = q(db, "SELECT table_name, identifier FROM gpkg_contents WHERE lower(data_type) = 'features'");
    } catch {
      throw new Error(`${file.name}: GeoPackage 표준 테이블(gpkg_contents)이 없습니다.`);
    }
    if (!tables.length) throw new Error(`${file.name}: 피처(벡터) 테이블이 없습니다. (래스터/타일 GeoPackage 는 지원하지 않습니다)`);

    const layers: RawGpkgLayer[] = [];
    for (const t of tables) {
      if (shouldAbort?.()) throw new DOMException("취소됨", "AbortError");
      const table = String(t.table_name);
      const display = String(t.identifier || table);
      const gc = q(db, "SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?", [table]);
      if (!gc.length) continue;
      const geomCol = String(gc[0].column_name);
      const { crsHint, prj } = readSrs(db, Number(gc[0].srs_id));

      const total = Number(q(db, `SELECT count(*) AS n FROM ${quoteIdent(table)}`)[0]?.n ?? 0);
      const stmt = db.prepare(`SELECT * FROM ${quoteIdent(table)}`);
      const features: Feature[] = [];
      let skipped = 0;
      let i = 0;
      try {
        while (stmt.step()) {
          const row = stmt.getAsObject();
          i++;
          if (i % 5000 === 0) {
            onProgress?.(total ? i / total : 0, display);
            if (shouldAbort?.()) throw new DOMException("취소됨", "AbortError");
          }
          const g = row[geomCol];
          let geometry: Geometry | null = null;
          if (g instanceof Uint8Array) {
            try {
              geometry = parseGpkgGeometry(g);
            } catch {
              skipped++;
              continue;
            }
          }
          if (!geometry) {
            skipped++;
            continue;
          }
          const props: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (k === geomCol || v instanceof Uint8Array) continue; // BLOB(지오메트리·이미지 등) 제외
            props[k] = v;
          }
          features.push({ type: "Feature", geometry, properties: props });
        }
      } finally {
        stmt.free();
      }
      layers.push({ name: display, fc: { type: "FeatureCollection", features }, crsHint, prj, skipped });
    }
    if (!layers.length) throw new Error(`${file.name}: gpkg_geometry_columns 에 등록된 지오메트리 열이 없습니다.`);
    return layers;
  } finally {
    db.close();
  }
}
