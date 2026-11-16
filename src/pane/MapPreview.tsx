/**
 * WYSIWYG 지도 미리보기
 *  - 슬라이드 프레임(pt) × 4/3 = 가상 px 크기로 Leaflet 지도를 만들고,
 *    CSS transform: scale(s) 로 패널 폭에 맞게 축소해서 보여준다 (Leaflet 1.9 는 CSS 배율을 마우스 좌표에 반영).
 *  - 라벨·방위표·축척·범례는 같은 가상 좌표계의 오버레이로 그려 Bake 결과와 일치시킨다.
 */
import L from "leaflet";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";

import { buildCategories, featureKind, markerIconHtml, resolveStyle } from "@/lib/style";
import { placeDataLabels, type BakeLayer } from "@/lib/bake";
import { TILE_CROSS_ORIGIN, type Basemap } from "@/lib/basemaps";
import type { PlacedLabel } from "@/lib/labels";
import { createVectorBasemapLayer, type VectorBasemapLayer } from "@/lib/vectorBasemap";
import { makeScaledCRS, tilePx } from "@/shared/crs";
import { buildDecos, type Decos } from "@/pane/decorate";
import type { DecoSettings, MapDoc } from "@/pane/model";

export type PreviewHandle = {
  getMap(): L.Map | null;
  /** 벡터 배경지도일 때만 */
  getVector(): VectorBasemapLayer | null;
  /** 타일 로딩이 끝날 때까지 대기 */
  whenIdle(timeoutMs?: number): Promise<void>;
  fitBounds(bbox: [number, number, number, number]): void;
  zoomBy(delta: number): void;
};

type Props = {
  ref?: Ref<PreviewHandle>;
  W: number;
  H: number;
  tileScale: number;
  initialView: MapDoc["view"];
  basemap: Basemap;
  /** 보이는 레이어만, 아래 → 위 */
  layers: BakeLayer[];
  deco: DecoSettings;
  zoom100: boolean;
  maxHeight: number;
  onViewChange: (v: MapDoc["view"]) => void;
  onReady: (map: L.Map) => void;
};

function dataLayerFor(layer: BakeLayer): L.Layer {
  const cats = buildCategories(layer.data, layer.style);
  const resolve = (f: GeoJSON.Feature) => {
    const kind = featureKind(f.geometry);
    return kind ? { kind, r: resolveStyle(layer.style, kind, f.properties as Record<string, unknown> | null, cats) } : null;
  };
  return L.geoJSON(layer.data, {
    interactive: false,
    style: (f) => {
      const x = f && resolve(f);
      if (!x) return {};
      const { r } = x;
      return {
        stroke: r.strokeWidth > 0,
        color: r.stroke,
        weight: r.strokeWidth,
        opacity: r.strokeOpacity,
        dashArray: r.dashArray ?? undefined,
        lineCap: r.cap,
        lineJoin: "round",
        fill: !!r.fill,
        fillColor: r.fill ?? undefined,
        fillOpacity: r.fillOpacity,
        fillRule: "evenodd",
        radius: r.radius,
      } as L.PathOptions;
    },
    pointToLayer: (f, ll) => {
      const x = resolve(f);
      const r = x!.r;
      if (r.shape === "circle") return L.circleMarker(ll, { radius: r.radius, interactive: false });
      const icon = markerIconHtml(r);
      return L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ html: icon.html, className: "sm-marker", iconSize: [icon.size, icon.size] }) });
    },
  });
}

export default function MapPreview({ ref, W, H, tileScale, initialView, basemap, layers, deco, zoom100, maxHeight, onViewChange, onReady }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer[]>([]);
  const dataRef = useRef<L.Layer[]>([]);
  const vecRef = useRef<VectorBasemapLayer | null>(null);
  const loadingRef = useRef(0);
  const [avail, setAvail] = useState(320);
  const [tick, setTick] = useState(0);
  const [moving, setMoving] = useState(false);
  const cbRef = useRef({ onViewChange, onReady });
  cbRef.current = { onViewChange, onReady };

  /* ----- 패널 폭 측정 → 표시 배율 ----- */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setAvail(Math.max(120, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = zoom100 ? 1 : Math.min(1, avail / W, maxHeight / H);
  const dispW = W * scale;
  const dispH = H * scale;

  /* ----- 지도 생성 (tileScale 이 바뀌면 부모가 key 로 다시 만든다) ----- */
  useEffect(() => {
    const el = mapDivRef.current!;
    const map = L.map(el, {
      crs: makeScaledCRS(tileScale),
      center: initialView.center,
      zoom: initialView.zoom,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      maxZoom: 21,
      preferCanvas: true,
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
      zoomAnimation: true,
    });
    mapRef.current = map;
    const report = () => {
      const c = map.getCenter();
      cbRef.current.onViewChange({ center: [c.lat, c.lng], zoom: map.getZoom() });
      setTick((t) => t + 1);
      setMoving(false);
    };
    map.on("moveend", report);
    map.on("movestart zoomstart", () => setMoving(true));
    cbRef.current.onReady(map);
    setTick((t) => t + 1);
    return () => {
      map.off();
      map.remove();
      mapRef.current = null;
      tilesRef.current = [];
      dataRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- 크기 변경 ----- */
  useLayoutEffect(() => {
    mapRef.current?.invalidateSize({ animate: false });
    setTick((t) => t + 1);
  }, [W, H]);

  /* ----- 배경지도 ----- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tilesRef.current.forEach((t) => map.removeLayer(t));
    tilesRef.current = [];
    loadingRef.current = 0;
    if (vecRef.current) {
      map.removeLayer(vecRef.current);
      vecRef.current = null;
    }
    if (basemap.kind === "vector" && basemap.vectorStyle) {
      const v = createVectorBasemapLayer(basemap.vectorStyle, { includeLabels: true });
      v.addTo(map);
      vecRef.current = v;
      return;
    }
    if (basemap.kind !== "raster") return;
    const size = tilePx(tileScale);
    const urls = [basemap.url, ...(basemap.overlayUrl ? [basemap.overlayUrl] : [])];
    for (const url of urls) {
      const t = L.tileLayer(url, {
        tileSize: size,
        maxNativeZoom: basemap.maxNativeZoom,
        maxZoom: 21,
        subdomains: basemap.subdomains ?? "abc",
        crossOrigin: TILE_CROSS_ORIGIN,
        keepBuffer: 2,
      });
      let loading = false;
      t.on("loading", () => {
        if (!loading) loadingRef.current++;
        loading = true;
      });
      t.on("load", () => {
        if (loading) loadingRef.current--;
        loading = false;
      });
      t.addTo(map);
      t.setZIndex(1);
      tilesRef.current.push(t);
    }
  }, [basemap, tileScale]);

  /* ----- 데이터 레이어 ----- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    dataRef.current.forEach((l) => map.removeLayer(l));
    dataRef.current = layers.map((l) => dataLayerFor(l).addTo(map));
    setTick((t) => t + 1);
  }, [layers]);

  useImperativeHandle(
    ref,
    () => ({
      getMap: () => mapRef.current,
      getVector: () => vecRef.current,
      whenIdle: (timeoutMs = 8000) =>
        new Promise<void>((resolve) => {
          const t0 = Date.now();
          let calm = 0;
          const vec = vecRef.current;
          if (vec && !vec.getData()) void Promise.race([vec.whenDrawn().catch(() => {}), new Promise((r) => setTimeout(r, timeoutMs))]);
          const poll = () => {
            if (vec && !vec.getData() && Date.now() - t0 <= timeoutMs) {
              calm = 0;
              return void setTimeout(poll, 150);
            }
            const imgs = mapDivRef.current?.querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img.leaflet-tile") ?? [];
            const pendingImg = Array.from(imgs).some((i) => !i.complete);
            if (loadingRef.current <= 0 && !pendingImg) calm++;
            else calm = 0;
            if (calm >= 3 || Date.now() - t0 > timeoutMs) resolve();
            else setTimeout(poll, 120);
          };
          setTimeout(poll, 80); // rAF 는 창이 가려지면 멈추므로 사용하지 않음
        }),
      fitBounds: (b) => mapRef.current?.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [20, 20], animate: false }),
      zoomBy: (d) => mapRef.current?.setZoom(mapRef.current.getZoom() + d),
    }),
    [],
  );

  /* ----- 라벨/꾸미기 오버레이 (이동·줌이 끝나면 다시 계산) ----- */
  const { labels, decos } = useMemo<{ labels: PlacedLabel[]; decos: Decos | null }>(() => {
    const map = mapRef.current;
    if (!map || tick < 0) return { labels: [], decos: null };
    try {
      return { labels: placeDataLabels(map, layers, W, H), decos: buildDecos(map, deco, layers, W, H) };
    } catch (e) {
      console.warn("[slide-map] overlay failed", e);
      return { labels: [], decos: null };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, layers, deco, W, H]);

  const deco1 = (d: Decos["north"], name: string) =>
    d && (
      <div
        key={name}
        data-deco={name}
        className="absolute"
        style={{ left: d.x, top: d.y, width: d.width, height: d.height, lineHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: d.svg }}
      />
    );

  return (
    <div
      ref={rootRef}
      className="w-full"
      style={zoom100 ? { overflow: "auto", maxHeight, background: "#e5e7eb" } : undefined}
      data-testid="map-preview"
    >
      <div style={{ width: dispW, height: dispH, position: "relative", margin: "0 auto", boxShadow: "0 0 0 1px rgba(0,0,0,.12)" }}>
        <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", position: "absolute", left: 0, top: 0 }} data-scale={scale}>
          <div ref={mapDivRef} className="sm-map" style={{ width: W, height: H, background: "#ffffff" }} />
          <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1000 }}>
            {!moving &&
              labels.map((l, i) => (
                <div
                  key={i}
                  data-label={l.text}
                  className="absolute whitespace-nowrap"
                  style={{
                    left: l.box.left,
                    top: l.box.top,
                    width: l.anchor === "right" ? undefined : l.box.width,
                    height: l.box.height,
                    lineHeight: `${l.box.height}px`,
                    textAlign: l.anchor === "right" ? "left" : "center",
                    fontSize: l.fontSize,
                    fontWeight: l.bold ? 700 : 400,
                    color: l.color,
                    fontFamily: '"Malgun Gothic","맑은 고딕",sans-serif',
                    textShadow: l.halo === false ? undefined : "-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff,0 0 3px #fff",
                  }}
                >
                  {l.text}
                </div>
              ))}
            {decos && (
              <>
                {deco1(decos.legend, "legend")}
                {deco1(decos.scale, "scale")}
                {deco1(decos.north, "north")}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
