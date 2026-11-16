/**
 * 좌표계 레지스트리 + 감지 (D-019)
 *  - 한국에서 자주 쓰는 EPSG 정의를 내장
 *  - .prj(ESRI WKT) 는 proj4 로 파싱한 뒤 "투영 파라미터"를 레지스트리와 비교해 매칭
 *    → 이름이 제각각인 ESRI prj 도 정확한 EPSG 정의(특히 Bessel 데이텀 변환 포함)로 치환
 *  - 매칭 실패 시 prj 를 그대로 proj4 에 넘김 (데이텀 변환이 빠질 수 있음 → 경고)
 */
import proj4 from "proj4";

/** Korean 1985(Bessel) → WGS84 7변수. 국내 GIS 에서 통용되는 값. [확인 필요: 실데이터 위치 대조] */
const BESSEL_TOWGS84 = "-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43";

export type CrsDef = { code: string; label: string; proj4: string; group: string };

export const CRS_LIST: CrsDef[] = [
  { code: "EPSG:4326", label: "WGS84 경위도", group: "경위도", proj4: "+proj=longlat +datum=WGS84 +no_defs" },
  { code: "EPSG:4737", label: "KGD2002 경위도", group: "경위도", proj4: "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs" },
  { code: "EPSG:4162", label: "Korean 1985 경위도 (Bessel)", group: "경위도", proj4: `+proj=longlat +ellps=bessel +towgs84=${BESSEL_TOWGS84} +no_defs` },

  { code: "EPSG:5186", label: "GRS80 중부원점 (5186)", group: "GRS80 TM", proj4: "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  { code: "EPSG:5185", label: "GRS80 서부원점 (5185)", group: "GRS80 TM", proj4: "+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  { code: "EPSG:5187", label: "GRS80 동부원점 (5187)", group: "GRS80 TM", proj4: "+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  { code: "EPSG:5188", label: "GRS80 동해원점 (5188)", group: "GRS80 TM", proj4: "+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  { code: "EPSG:5179", label: "UTM-K (5179, 네이버 등)", group: "GRS80 TM", proj4: "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  { code: "EPSG:5181", label: "GRS80 중부원점 y=500000 (5181, 카카오)", group: "GRS80 TM", proj4: "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  { code: "EPSG:5182", label: "GRS80 제주 (5182)", group: "GRS80 TM", proj4: "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=550000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },

  { code: "EPSG:5174", label: "Bessel 보정 중부원점 (5174, 구 지적)", group: "Bessel TM", proj4: `+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=${BESSEL_TOWGS84} +units=m +no_defs` },
  { code: "EPSG:5173", label: "Bessel 보정 서부원점 (5173)", group: "Bessel TM", proj4: `+proj=tmerc +lat_0=38 +lon_0=125.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=${BESSEL_TOWGS84} +units=m +no_defs` },
  { code: "EPSG:5176", label: "Bessel 보정 동부원점 (5176)", group: "Bessel TM", proj4: `+proj=tmerc +lat_0=38 +lon_0=129.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=${BESSEL_TOWGS84} +units=m +no_defs` },
  { code: "EPSG:5177", label: "Bessel 보정 동해원점 (5177)", group: "Bessel TM", proj4: `+proj=tmerc +lat_0=38 +lon_0=131.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=${BESSEL_TOWGS84} +units=m +no_defs` },
  { code: "EPSG:5175", label: "Bessel 보정 제주 (5175)", group: "Bessel TM", proj4: `+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=550000 +ellps=bessel +towgs84=${BESSEL_TOWGS84} +units=m +no_defs` },
  { code: "EPSG:2097", label: "Bessel 중부원점 (2097, 미보정)", group: "Bessel TM", proj4: `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=${BESSEL_TOWGS84} +units=m +no_defs` },
  { code: "EPSG:2098", label: "Bessel 서부원점 (2098, 미보정)", group: "Bessel TM", proj4: `+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=${BESSEL_TOWGS84} +units=m +no_defs` },
  { code: "EPSG:2096", label: "Bessel 동부원점 (2096, 미보정)", group: "Bessel TM", proj4: `+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=${BESSEL_TOWGS84} +units=m +no_defs` },

  { code: "EPSG:32652", label: "WGS84 UTM 52N", group: "기타", proj4: "+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs" },
  { code: "EPSG:32651", label: "WGS84 UTM 51N", group: "기타", proj4: "+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs" },
  { code: "EPSG:3857", label: "Web Mercator (3857)", group: "기타", proj4: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs" },
];

for (const c of CRS_LIST) proj4.defs(c.code, c.proj4);

export function getCrs(code: string): CrsDef | undefined {
  const norm = code.toUpperCase().replace(/\s/g, "");
  return CRS_LIST.find((c) => c.code === norm);
}

/** "urn:ogc:def:crs:EPSG::5186", "EPSG:5186", "5186" → CrsDef */
export function crsFromName(name: string | null | undefined): CrsDef | undefined {
  if (!name) return undefined;
  if (/CRS84/i.test(name)) return getCrs("EPSG:4326");
  const m = /EPSG:{1,2}(\d+)/i.exec(name) ?? /^(\d{4,5})$/.exec(name.trim());
  return m ? getCrs(`EPSG:${m[1]}`) : undefined;
}

/* ------------------------------------------------------------------ */
/* .prj 매칭                                                            */
/* ------------------------------------------------------------------ */

type ProjParams = {
  projected: boolean;
  /** 정규화한 투영 종류 (tmerc/utm/etmerc 는 모두 "tmerc") */
  proj: string;
  /** 데이텀 이름 (소문자, 없으면 "") */
  datum: string;
  lat0: number;
  long0: number;
  k0: number;
  x0: number;
  y0: number;
  a: number;
  b: number;
  toMeter: number;
};

/** 투영 이름 정규화: 대소문자·구분자 무시, TM 계열 동의어 통합 */
function normProj(name: string): string {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^(tmerc|utm|etmerc|transversemercator|gausskruger|gausskrueger)$/.test(n)) return "tmerc";
  if (/^(merc|mercator|mercatorauxiliarysphere|popularvisualisationpseudomercator)$/.test(n)) return "merc";
  return n;
}

function paramsOf(def: string): ProjParams | null {
  try {
    // proj4 내부 Proj 객체에서 파라미터를 읽는다 (라디안 단위)
    const p = new (proj4 as unknown as { Proj: new (d: string) => Record<string, unknown> }).Proj(def);
    const num = (k: string, d = 0) => (typeof p[k] === "number" ? (p[k] as number) : d);
    const projName = String(p.projName ?? "");
    return {
      projected: projName !== "longlat" && projName !== "identity",
      proj: normProj(projName),
      datum: String(p.datumCode ?? "").toLowerCase(),
      b: num("b", num("a")),
      toMeter: num("to_meter", 1),
      lat0: num("lat0"),
      long0: num("long0"),
      k0: num("k0", 1),
      x0: num("x0"),
      y0: num("y0"),
      a: num("a"),
    };
  } catch {
    return null;
  }
}

const REG_PARAMS = CRS_LIST.map((c) => ({ crs: c, p: paramsOf(c.proj4) }));

function close(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol;
}

/** 경위도 레지스트리 항목별 허용 데이텀 이름(proj4 datumCode, 소문자) */
const GEO_DATUM: Record<string, RegExp> = {
  "EPSG:4326": /^(wgs_?(19)?84)$/,
  "EPSG:4737": /^(korea_?2000|kgd_?2002|korean_?geodetic_?datum_?2000)$/,
  "EPSG:4162": /^(korean_?(datum_?)?1985|korea_?1985|kgd_?1985)$/,
};

export type PrjMatch =
  | { kind: "registry"; crs: CrsDef }
  | { kind: "raw"; proj4: string; note: string }
  | { kind: "none"; note: string };

export function matchPrj(prjText: string): PrjMatch {
  const wkt = prjText.trim();
  if (!wkt) return { kind: "none", note: ".prj 가 비어 있습니다." };

  // EPSG 코드가 박혀 있으면 우선 사용
  const auth = /AUTHORITY\["EPSG","(\d+)"\]\]\s*$/.exec(wkt);
  if (auth) {
    const c = getCrs(`EPSG:${auth[1]}`);
    if (c) return { kind: "registry", crs: c };
  }

  // ESRI Web Mercator (구체 기반 보조구) — proj4 가 타원체로 해석하는 것을 막고 3857 로 고정
  if (/Mercator_Auxiliary_Sphere/i.test(wkt) && /Central_Meridian",\s*0(\.0*)?\]/i.test(wkt)) {
    const c = getCrs("EPSG:3857");
    if (c) return { kind: "registry", crs: c };
  }

  const p = paramsOf(wkt);
  if (!p) return { kind: "none", note: ".prj 를 해석하지 못했습니다." };

  const deg = Math.PI / 180;
  for (const { crs, p: r } of REG_PARAMS) {
    if (!r || r.projected !== p.projected) continue;
    if (!close(r.a, p.a, 1)) continue; // 타원체 (GRS80/WGS84 vs Bessel 구분)
    if (!close(r.b, p.b, 1)) continue; // 구체(3857)와 타원체 메르카토르 구분
    if (!p.projected) {
      // 경위도: 같은 타원체라도 데이텀이 다르면(예: GCS_Tokyo vs Korean 1985) 다른 좌표계 → 이름으로 확인
      if (GEO_DATUM[crs.code]?.test(p.datum)) return { kind: "registry", crs };
      continue;
    }
    if (r.proj !== p.proj) continue; // LCC·Mollweide 등이 매개변수만 같다고 TM 으로 오인되지 않도록
    if (!close(r.toMeter, p.toMeter, 1e-9)) continue;
    if (
      close(r.lat0, p.lat0, 1e-6 * deg) &&
      close(r.long0, p.long0, 1e-6 * deg) &&
      close(r.k0, p.k0, 1e-7) &&
      close(r.x0, p.x0, 0.01) &&
      close(r.y0, p.y0, 0.01)
    ) {
      return { kind: "registry", crs };
    }
  }
  const isBessel = close(p.a, 6377397.155, 1);
  return {
    kind: "raw",
    proj4: wkt,
    note: isBessel
      ? "알려진 한국 좌표계와 일치하지 않는 Bessel 좌표계입니다(예: Tokyo 데이텀). 데이텀 변환이 빠져 수백 m 어긋날 수 있습니다."
      : "내장 목록에 없는 좌표계라 .prj 를 그대로 사용했습니다. 위치가 어긋나면 [입력 좌표계]에서 직접 지정하세요.",
  };
}
