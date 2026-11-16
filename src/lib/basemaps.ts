/**
 * 배경지도 정의
 * - VWorld WMTS: https://api.vworld.kr/req/wmts/1.0.0/{key}/{layer}/{z}/{y}/{x}.{ext}
 * - 키 우선순위: 패널에서 저장한 키(localStorage / 지도 인스턴스 설정) → .env.local 의 VITE_VWORLD_KEY
 */
import { lsGet, lsSet } from "@/shared/util";

export const ENV_VWORLD_KEY: string = import.meta.env.VITE_VWORLD_KEY ?? "";

export function getStoredVworldKey(): string {
  return lsGet("vworldKey") ?? ENV_VWORLD_KEY;
}

export function storeVworldKey(key: string) {
  lsSet("vworldKey", key);
}

export type Basemap = {
  id: string;
  label: string;
  url: string;
  overlayUrl?: string;
  attribution: string;
  maxNativeZoom: number;
  requiresKey?: boolean;
};

export type BasemapMeta = Pick<Basemap, "id" | "label" | "requiresKey">;

const VW_ATTR = '&copy; <a href="https://www.vworld.kr" target="_blank">VWorld</a>';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

/**
 * dev 서버에서는 같은 오리진 프록시(/tiles/...)로 받아 캔버스 캡처가 가능하게 한다 (D-025).
 * 빌드(배포)본은 원 주소 — 배포 시 프록시 서버 필요 여부는 미정 [확인 필요].
 */
const USE_PROXY = import.meta.env.DEV;
const VW_BASE = USE_PROXY ? "/tiles/vworld" : "https://api.vworld.kr/req/wmts/1.0.0";
const OSM_URL = USE_PROXY ? "/tiles/osm/{z}/{x}/{y}.png" : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function buildBasemaps(key: string): Basemap[] {
  const vw = (layer: string, ext: "png" | "jpeg") => `${VW_BASE}/${key}/${layer}/{z}/{y}/{x}.${ext}`;
  return [
    { id: "vw-base", label: "브이월드 기본", url: vw("Base", "png"), attribution: VW_ATTR, maxNativeZoom: 19, requiresKey: true },
    { id: "vw-white", label: "브이월드 백지도", url: vw("white", "png"), attribution: VW_ATTR, maxNativeZoom: 18, requiresKey: true },
    { id: "vw-midnight", label: "브이월드 야간", url: vw("midnight", "png"), attribution: VW_ATTR, maxNativeZoom: 18, requiresKey: true },
    {
      id: "vw-satellite",
      label: "브이월드 위성",
      url: vw("Satellite", "jpeg"),
      overlayUrl: vw("Hybrid", "png"),
      attribution: VW_ATTR,
      maxNativeZoom: 19,
      requiresKey: true,
    },
    { id: "osm", label: "OpenStreetMap", url: OSM_URL, attribution: OSM_ATTR, maxNativeZoom: 19 },
  ];
}

export const BASEMAP_META: BasemapMeta[] = buildBasemaps("").map(({ id, label, requiresKey }) => ({ id, label, requiresKey }));

export function resolveBasemap(id: string, key: string): Basemap {
  const all = buildBasemaps(key);
  const found = all.find((b) => b.id === id) ?? all[0];
  // 키가 없으면 OSM 으로 폴백
  if (found.requiresKey && !key) return all.find((b) => b.id === "osm")!;
  return found;
}
