/**
 * 편집 가능한 벡터 배경지도 (OpenFreeMap / OpenMapTiles 스키마)
 *  - fetchVectorBasemap : 화면 범위의 벡터 타일 -> 스타일 그룹/라벨 데이터
 *  - VECTOR_STYLES      : 스타일 프리셋 (plan-gray / mono-line / color)
 *  - createVectorBasemapLayer : Leaflet 레이어 (SVG 를 이미지 오버레이로 표시 -> Bake 결과와 동일한 모양)
 *  - vectorBasemapToSvg / vectorLabelCandidates : Bake 용 순수 함수 (./vectorBasemap/bake)
 */
import L from "leaflet";
import { fetchVectorBasemap, ATTRIBUTION } from "./vectorBasemap/tiles";
import { renderVectorBasemapSvg, type SvgOptions, type SvgResult } from "./vectorBasemap/bake";
import type { VectorBasemapData, VectorStyleId } from "./vectorBasemap/types";

export { fetchVectorBasemap, clearVectorTileCache, tileRangeFor } from "./vectorBasemap/tiles";
export { VECTOR_STYLES, getVectorStyle } from "./vectorBasemap/styles";
export { vectorBasemapToSvg, renderVectorBasemapSvg, vectorLabelCandidates, placeVectorLabels, viewZoomEq } from "./vectorBasemap/bake";
export type { SvgOptions, SvgResult, ProjectFn, LabelRect, VectorLabelCandidate, VectorPlacedLabel } from "./vectorBasemap/bake";
export type * from "./vectorBasemap/types";

export type VectorBasemapLayer = L.Layer & {
  /** 마지막으로 가져온 데이터 (Bake 용). 아직 없으면 null */
  getData(): VectorBasemapData | null;
  /** 마지막 렌더 결과 (SVG/통계) */
  getLastRender(): SvgResult | null;
  /** 스타일 변경 (재요청 없이 다시 그림) */
  setStyleId(id: VectorStyleId): void;
  getStyleId(): VectorStyleId;
  /**
   * 다음 그리기가 끝나면 resolve (테스트/Bake 대기용).
   * 가져오기 실패 / 지도 크기 0 / 레이어 제거 / 타임아웃(기본 15초) 이면 reject 해서 영원히 걸리지 않는다.
   */
  whenDrawn(opts?: WhenDrawnOptions): Promise<void>;
  /** 지금 뷰로 즉시 다시 가져오기 */
  refresh(opts?: WhenDrawnOptions): Promise<void>;
};

export type WhenDrawnOptions = { /** 대기 제한 시간 ms (기본 15000) */ timeoutMs?: number };

export type VectorLayerOptions = {
  includeLabels?: boolean;
  svgOptions?: SvgOptions;
  /** 레이어 pane z-index (기본 250: 래스터 타일 위, 데이터 레이어 아래) */
  zIndex?: number;
  /** 화면 밖 여유 비율 (기본 0.25) */
  pad?: number;
  onData?: (d: VectorBasemapData) => void;
};

/**
 * Leaflet 레이어. 화면 범위 + 여유분만큼 SVG 를 만들어 L.imageOverlay 로 올린다.
 * 지도 투영은 map.latLngToContainerPoint 를 쓰므로 makeScaledCRS 로 만든 배율 CRS 에서도 정확하다.
 */
export function createVectorBasemapLayer(styleId: VectorStyleId, options: VectorLayerOptions = {}): VectorBasemapLayer {
  const pad = options.pad ?? 0.25;
  let map: L.Map | null = null;
  let overlay: L.ImageOverlay | null = null;
  let blobUrl: string | null = null;
  let data: VectorBasemapData | null = null;
  let last: SvgResult | null = null;
  let style = styleId;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | null = null;
  let seq = 0;
  type Waiter = { ok: () => void; err: (e: unknown) => void; t: ReturnType<typeof setTimeout> };
  let waiters: Waiter[] = [];
  // 가져온 시점의 뷰: 그리기는 이 값만으로 투영한다 (이후 패닝/줌과 무관)
  let lastView: { bounds: L.LatLngBounds; zoom: number; w: number; h: number; ox: number; oy: number; vw: number; vh: number } | null = null;

  const layer = L.Layer.extend({
    onAdd(m: L.Map) {
      map = m;
      const paneName = "slidemap-vector-basemap";
      const pane = m.getPane(paneName) ?? m.createPane(paneName);
      pane.style.zIndex = String(options.zIndex ?? 250);
      pane.style.pointerEvents = "none";
      m.attributionControl?.addAttribution(ATTRIBUTION);
      m.on("moveend", schedule);
      schedule(0);
      return this;
    },
    onRemove(m: L.Map) {
      clearTimeout(timer);
      seq++;
      ctrl?.abort();
      resolveAll(new Error("벡터 배경지도 레이어가 제거되었습니다"));
      m.off("moveend", schedule);
      m.attributionControl?.removeAttribution(ATTRIBUTION);
      if (overlay) m.removeLayer(overlay);
      overlay = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = null;
      map = null;
      return this;
    },
    getData: () => data,
    getLastRender: () => last,
    getStyleId: () => style,
    setStyleId(id: VectorStyleId) {
      style = id;
      if (data && lastView) draw();
    },
    whenDrawn: (o?: WhenDrawnOptions) =>
      new Promise<void>((ok, err) => {
        const w: Waiter = {
          ok,
          err,
          t: setTimeout(() => {
            waiters = waiters.filter((x) => x !== w);
            err(new Error(`벡터 배경지도 그리기 대기 시간 초과 (${o?.timeoutMs ?? 15000}ms)`));
          }, o?.timeoutMs ?? 15000),
        };
        waiters.push(w);
      }),
    refresh: (o?: WhenDrawnOptions) => {
      const p = inst.whenDrawn(o);
      schedule(0);
      return p;
    },
  }) as unknown as new () => VectorBasemapLayer;
  const inst = new layer();

  function schedule(delay: number | L.LeafletEvent = 250) {
    clearTimeout(timer);
    timer = setTimeout(() => void update(), typeof delay === "number" ? delay : 250);
  }

  function resolveAll(err?: unknown) {
    const ws = waiters;
    waiters = [];
    for (const w of ws) {
      clearTimeout(w.t);
      if (err) w.err(err);
      else w.ok();
    }
  }

  async function update() {
    const m = map;
    if (!m) return;
    const my = ++seq;
    ctrl?.abort();
    ctrl = new AbortController();
    const size = m.getSize();
    if (!size.x || !size.y) {
      resolveAll(new Error("지도 크기가 0 이라 벡터 배경지도를 그릴 수 없습니다"));
      return;
    }
    const zoom = m.getZoom();
    // 타일 줌은 "화면 환산 줌"(배율 CRS 반영: 타일 1장 = 256*scale px) 기준으로 고른다
    const zEq = Math.log2(m.options.crs!.scale(zoom) / 256);
    const ox = Math.round(size.x * pad), oy = Math.round(size.y * pad);
    const w = size.x + ox * 2, h = size.y + oy * 2;
    const tl = m.containerPointToLatLng(L.point(-ox, -oy));
    const br = m.containerPointToLatLng(L.point(size.x + ox, size.y + oy));
    const bounds = L.latLngBounds(tl, br);
    try {
      const d = await fetchVectorBasemap({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, zEq, { signal: ctrl.signal });
      if (my !== seq || !map) return; // 더 새로운 요청이 대기자들을 처리하거나, 제거 시 이미 reject 됨
      data = d;
      lastView = { bounds, zoom, w, h, ox, oy, vw: size.x, vh: size.y };
      options.onData?.(d);
      draw();
    } catch (e) {
      if (my !== seq) return; // 더 새로운 요청이 이어받음
      if ((e as { name?: string }).name !== "AbortError") console.warn("[vectorBasemap]", e);
      resolveAll(e);
    }
  }

  function draw() {
    const m = map;
    if (!m || !data || !lastView) return;
    const { bounds, zoom, w, h, ox, oy, vw, vh } = lastView;
    // 투영: 가져온 시점의 줌/범위 기준 (뷰 독립). 오버레이 좌상단(bounds NW)이 SVG (0,0). 정수 반올림 없음.
    const origin = m.project(bounds.getNorthWest(), zoom);
    const project = (lng: number, lat: number) => {
      const p = m.project([lat, lng], zoom);
      return { x: p.x - origin.x, y: p.y - origin.y };
    };
    // 라벨은 실제 보이는 영역(여유분 패딩 제외)에만 배치
    const labelRect = { x0: ox, y0: oy, x1: ox + vw, y1: oy + vh };
    last = renderVectorBasemapSvg(data, project, { width: w, height: h }, style, { includeLabels: options.includeLabels !== false, labelRect, ...options.svgOptions });
    const url = URL.createObjectURL(new Blob([last.svg], { type: "image/svg+xml;charset=utf-8" }));
    const prev = blobUrl;
    blobUrl = url;
    if (overlay) {
      overlay.setUrl(url);
      overlay.setBounds(bounds);
    } else {
      overlay = L.imageOverlay(url, bounds, { pane: "slidemap-vector-basemap", interactive: false, className: "slidemap-vector-basemap" }).addTo(m);
    }
    if (prev) setTimeout(() => URL.revokeObjectURL(prev), 3000);
    resolveAll();
  }

  return inst;
}
