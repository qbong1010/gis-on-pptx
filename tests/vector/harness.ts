// Playwright 테스트가 페이지 안에서 import 하는 하네스 (Vite 가 서빙)
import L from "leaflet";
import { makeScaledCRS } from "@/shared/crs";
import { createVectorBasemapLayer, renderVectorBasemapSvg, VECTOR_STYLES, type VectorStyleId } from "@/lib/vectorBasemap";

export type RunCfg = { lat: number; lng: number; zoom: number; styles: VectorStyleId[]; tileScale?: number; w?: number; h?: number };

export async function run(cfg: RunCfg) {
  const w = cfg.w ?? 800, h = cfg.h ?? 450;
  const div = document.createElement("div");
  div.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:0;top:0`;
  document.body.appendChild(div);
  const map = L.map(div, { crs: makeScaledCRS(cfg.tileScale ?? 1), zoomControl: false, center: [cfg.lat, cfg.lng], zoom: cfg.zoom });
  const layer = createVectorBasemapLayer(cfg.styles[0]);
  const t0 = performance.now();
  const drawn = layer.whenDrawn();
  layer.addTo(map);
  await drawn;
  const fetchMs = performance.now() - t0;
  const data = layer.getData()!;
  const project = (lng: number, lat: number) => {
    const p = map.latLngToContainerPoint([lat, lng]);
    return { x: p.x, y: p.y };
  };
  const out: Record<string, unknown> = {};
  for (const id of cfg.styles) {
    const t1 = performance.now();
    const r = renderVectorBasemapSvg(data, project, { width: w, height: h }, id, {});
    out[id] = { svg: r.svg, bytes: r.bytes, counts: r.counts, ms: Math.round(performance.now() - t1), zoomEq: r.zoomEq, labels: r.placedLabels.map((l) => [l.kind, l.text, l.angle ?? 0]) };
    void VECTOR_STYLES;
  }
  const featCounts = Object.fromEntries(Object.entries(data.groups).map(([k, v]) => [k, v.length]));
  const overlayImg = document.querySelector("img.slidemap-vector-basemap") as HTMLImageElement | null;
  const res = { fetchMs: Math.round(fetchMs), tileZoom: data.tileZoom, tileCount: data.tileCount, failed: data.failedTiles, featCounts, labelCount: data.labels.length, overlay: !!overlayImg, styles: out };
  map.remove();
  div.remove();
  return res;
}

/** Leaflet 레이어(이미지 오버레이) 표시 + 이동 후 재요청 확인용 */
export async function overlayDemo() {
  const div = document.createElement("div");
  div.style.cssText = "width:800px;height:450px";
  document.body.appendChild(div);
  const map = L.map(div, { crs: makeScaledCRS(0.7), zoomControl: false, center: [37.4979, 127.0276], zoom: 16 });
  const layer = createVectorBasemapLayer("plan-gray");
  const d1 = layer.whenDrawn();
  layer.addTo(map);
  await d1;
  const d2 = layer.whenDrawn();
  map.panBy([300, 100], { animate: false });
  await d2;
  L.circleMarker([37.4979, 127.0276], { radius: 6, color: "red" }).addTo(map);
  return { bytes: layer.getLastRender()!.bytes, tiles: layer.getData()!.tileCount };
}

/**
 * 패닝 직후 (moveend 재요청 전) setStyleId 로 다시 그려도 오버레이가 밀리지 않는지 확인.
 * 강남역 좌표에 빨간 마커를 올리고 라벨 점(검은 원)과 겹치는지 스크린샷으로 본다. 또 whenDrawn 타임아웃/제거 reject 동작도 확인.
 */
export async function panRedrawDemo() {
  const div = document.createElement("div");
  div.style.cssText = "width:800px;height:450px";
  document.body.appendChild(div);
  const map = L.map(div, { crs: makeScaledCRS(0.7), zoomControl: false, center: [37.4979, 127.0276], zoom: 16.5 });
  const layer = createVectorBasemapLayer("mono-line");
  const d1 = layer.whenDrawn();
  layer.addTo(map);
  await d1;
  map.panBy([120, 60], { animate: false }); // moveend -> 250ms 뒤 재요청 예약
  layer.setStyleId("plan-gray"); // 재요청 전에 옛 뷰 데이터로 즉시 다시 그림
  L.circleMarker([37.4979, 127.0276], { radius: 6, color: "red", fillOpacity: 0 }).addTo(map);
  const r: Record<string, unknown> = { zoomEq: layer.getLastRender()!.zoomEq, tileZoom: layer.getData()!.tileZoom };
  // 타임아웃: 아무도 그리지 않는 상황 (50ms)
  const t0 = performance.now();
  r.timeout = await layer.whenDrawn({ timeoutMs: 50 }).then(() => "resolved?", (e) => String(e.message).slice(0, 30));
  r.timeoutMs = Math.round(performance.now() - t0);
  return r;
}

export async function settleDemo() {
  const div = document.createElement("div");
  div.style.cssText = "width:800px;height:450px";
  document.body.appendChild(div);
  const map = L.map(div, { zoomControl: false, center: [37.4979, 127.0276], zoom: 16 });
  const layer = createVectorBasemapLayer("plan-gray");
  const out: Record<string, string> = {};
  // 제거 시 reject
  const p = layer.whenDrawn({ timeoutMs: 5000 });
  layer.addTo(map);
  map.removeLayer(layer);
  out.remove = await p.then(() => "resolved", (e) => "rejected: " + e.message);
  // 크기 0
  const z = document.createElement("div");
  z.style.cssText = "width:0;height:0";
  document.body.appendChild(z);
  const m0 = L.map(z, { zoomControl: false, center: [37.5, 127], zoom: 16 });
  const l0 = createVectorBasemapLayer("plan-gray");
  const p0 = l0.whenDrawn({ timeoutMs: 5000 });
  l0.addTo(m0);
  out.size0 = await p0.then(() => "resolved", (e) => "rejected: " + e.message);
  return out;
}
