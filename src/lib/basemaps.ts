/**
 * 배경지도 정의
 * - VWorld WMTS: https://api.vworld.kr/req/wmts/1.0.0/{key}/{layer}/{z}/{y}/{x}.{ext}
 * - 키 우선순위: 패널에서 저장한 키(localStorage / 지도 인스턴스 설정) → .env.local 의 VITE_VWORLD_KEY
 */
import type { VectorStyleId } from "@/lib/vectorBasemap";
import { lsGet, lsSet } from "@/shared/util";

/**
 * 기본 키 (D-038)
 * - 개발(dev 서버): .env.local 의 VITE_VWORLD_KEY
 * - 배포 빌드: VITE_VWORLD_KEY_PUBLIC 만 번들에 넣는다 (배포 도메인으로 발급받은 키).
 *   개인 키가 공개 정적 사이트 번들에 실려 나가지 않게 하기 위함. 없으면 사용자가 패널 설정에서 입력.
 */
export const ENV_VWORLD_KEY: string =
  (import.meta.env.DEV ? import.meta.env.VITE_VWORLD_KEY : import.meta.env.VITE_VWORLD_KEY_PUBLIC) ?? "";

export function getStoredVworldKey(): string {
  return lsGet("vworldKey") ?? ENV_VWORLD_KEY;
}

export function storeVworldKey(key: string) {
  lsSet("vworldKey", key);
}

/** raster = 타일 이미지, none = 흰 배경, vector = 벡터 배경지도 (src/lib/vectorBasemap.ts, 별도 구현) */
export type BasemapKind = "raster" | "none" | "vector";

export type Basemap = {
  id: string;
  label: string;
  kind: BasemapKind;
  /** raster 일 때만 의미 있음 */
  url: string;
  subdomains?: string;
  /** kind === "vector" 일 때 스타일 프리셋 (src/lib/vectorBasemap) */
  vectorStyle?: VectorStyleId;
  overlayUrl?: string;
  attribution: string;
  maxNativeZoom: number;
  requiresKey?: boolean;
};

export type BasemapMeta = Pick<Basemap, "id" | "label" | "requiresKey" | "kind">;

const VW_ATTR = '&copy; <a href="https://www.vworld.kr" target="_blank">VWorld</a>';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

/**
 * dev 서버에서는 같은 오리진 프록시(/tiles/...)로 받아 캔버스 캡처가 가능하게 한다 (D-025).
 * 빌드(배포)본은 원 주소 — 배포 시 프록시 서버 필요 여부는 미정 [확인 필요].
 */
const USE_PROXY = import.meta.env.DEV;
const VW_BASE = USE_PROXY ? "/tiles/vworld" : "https://api.vworld.kr/req/wmts/1.0.0";
const VEC_ATTR = "© OpenMapTiles © OpenStreetMap contributors";
const CARTO_ATTR = "&copy; OpenStreetMap contributors &copy; CARTO";
const CARTO_BASE = USE_PROXY ? "/tiles/carto" : "https://{s}.basemaps.cartocdn.com";
const OSM_URL = USE_PROXY ? "/tiles/osm/{z}/{x}/{y}.png" : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function buildBasemaps(key: string): Basemap[] {
  const vw = (layer: string, ext: "png" | "jpeg") => `${VW_BASE}/${key}/${layer}/{z}/{y}/{x}.${ext}`;
  return [
    { id: "vw-base", label: "브이월드 기본", kind: "raster", url: vw("Base", "png"), attribution: VW_ATTR, maxNativeZoom: 19, requiresKey: true },
    { id: "vw-white", label: "브이월드 백지도", kind: "raster", url: vw("white", "png"), attribution: VW_ATTR, maxNativeZoom: 18, requiresKey: true },
    { id: "vw-midnight", label: "브이월드 야간", kind: "raster", url: vw("midnight", "png"), attribution: VW_ATTR, maxNativeZoom: 18, requiresKey: true },
    {
      id: "vw-satellite",
      label: "브이월드 위성",
      kind: "raster",
      url: vw("Satellite", "jpeg"),
      overlayUrl: vw("Hybrid", "png"),
      attribution: VW_ATTR,
      maxNativeZoom: 19,
      requiresKey: true,
    },
    { id: "osm", label: "OpenStreetMap", kind: "raster", url: OSM_URL, attribution: OSM_ATTR, maxNativeZoom: 19 },
    {
      id: "carto-light-nolabels",
      label: "CARTO 밝은 지도 (라벨 없음)",
      kind: "raster",
      url: `${CARTO_BASE}/light_nolabels/{z}/{x}/{y}.png`,
      subdomains: "abcd",
      attribution: CARTO_ATTR,
      maxNativeZoom: 20,
    },
    {
      id: "carto-light-all",
      label: "CARTO 밝은 지도 (라벨)",
      kind: "raster",
      url: `${CARTO_BASE}/light_all/{z}/{x}/{y}.png`,
      subdomains: "abcd",
      attribution: CARTO_ATTR,
      maxNativeZoom: 20,
    },
    ...(
      [
        ["vec-plan-gray", "편집형 벡터 (도시계획 회색)", "plan-gray"],
        ["vec-mono-line", "편집형 벡터 (흑백 선화)", "mono-line"],
        ["vec-color", "편집형 벡터 (컬러)", "color"],
      ] as const
    ).map(
      ([id, label, vectorStyle]): Basemap => ({ id, label, kind: "vector", url: "", vectorStyle, attribution: VEC_ATTR, maxNativeZoom: 19 }),
    ),
    { id: "none", label: "없음 (흰 배경)", kind: "none", url: "", attribution: "", maxNativeZoom: 19 },
  ];
}

/** 프로덕션(프록시 없음)에서는 캔버스 합성을 위해 CORS 요청으로 타일을 받는다 (VWorld·CARTO 는 ACAO:* 응답) */
export const TILE_CROSS_ORIGIN: "anonymous" | undefined = USE_PROXY ? undefined : "anonymous";

export const BASEMAP_META: BasemapMeta[] = buildBasemaps("").map(({ id, label, requiresKey, kind }) => ({ id, label, requiresKey, kind }));

export function resolveBasemap(id: string, key: string): Basemap {
  const all = buildBasemaps(key);
  const found = all.find((b) => b.id === id) ?? all[0];
  // 키가 없으면 OSM 으로 폴백
  if (found.requiresKey && !key) return all.find((b) => b.id === "osm")!;
  return found;
}
