/**
 * 지도 박스 (PowerPoint 콘텐츠 애드인) — "표현되는 단일 객체"
 * - UI 는 최소화: 지도 + 줌 컨트롤 + 축척바 + (드래그 시) 드롭 오버레이
 * - 모든 관리(레이어, 배경지도, 해상도 배율, Bake)는 우측 패널(taskpane.html)에서 메시지로 제어
 * - 자기 상태(레이어/뷰/설정)는 인스턴스 설정(Office.context.document.settings)에 저장 → 문서 재오픈 시 복원
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { GeoJSON, MapContainer, ScaleControl, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { BBox, Feature } from "geojson";

import { getStoredVworldKey, resolveBasemap } from "@/lib/basemaps";
import { makeBakePayload } from "@/lib/bake";
import { importFiles } from "@/lib/importers";
import { createBus, type Bus } from "@/shared/bus";
import { makeScaledCRS, tilePx, zoomForScaleChange } from "@/shared/crs";
import { createInstanceStore } from "@/shared/instanceStore";
import type { OfficeEnv } from "@/shared/office";
import {
  DEFAULT_SETTINGS,
  LAYER_COLORS,
  type LayerInput,
  type LayerState,
  type MapCommand,
  type MapSettings,
  type MapSnapshot,
  type MapView,
  type Msg,
} from "@/shared/protocol";
import { isPowerPoint, uid } from "@/shared/util";

const GANGNAM_VIEW: MapView = { center: [37.4979, 127.0276], zoom: 16 };

type Persisted = { v: 1; layers: LayerState[]; settings: MapSettings; view: MapView };

/* ------------------------------------------------------------------ */

function unionBBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null;
  return boxes.reduce<BBox>(
    (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function fitBBox(map: L.Map, bbox: BBox) {
  const [minX, minY, maxX, maxY] = bbox;
  if (minX === maxX && minY === maxY) map.setView([minY, minX], Math.max(map.getZoom(), 17));
  else map.fitBounds([[minY, minX], [maxY, maxX]], { padding: [24, 24], maxZoom: 19 });
}

function styleFor(color: string): L.StyleFunction {
  return (feature?: Feature) => {
    const t = feature?.geometry?.type ?? "";
    if (t.includes("Polygon")) return { color, weight: 2, fillColor: color, fillOpacity: 0.3 };
    return { color, weight: 3, fillOpacity: 0 };
  };
}

function pointToLayerFor(color: string) {
  return (_f: Feature, latlng: L.LatLng) =>
    L.circleMarker(latlng, { radius: 5, color: "#ffffff", weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false });
}

/** Leaflet map 인스턴스 연결 + 리사이즈 대응 + 뷰 변경 보고 */
function MapBridge({ onReady, onView }: { onReady: (m: L.Map) => void; onView: (v: MapView) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(map.getContainer());
    const report = () => {
      const c = map.getCenter();
      onView({ center: [c.lat, c.lng], zoom: map.getZoom() });
    };
    map.on("moveend", report);
    return () => {
      ro.disconnect();
      map.off("moveend", report);
    };
  }, [map, onReady, onView]);
  return null;
}

/* ------------------------------------------------------------------ */

export default function App({ env }: { env: OfficeEnv }) {
  const inOffice = isPowerPoint(env.host);
  const store = useMemo(() => createInstanceStore(inOffice), [inOffice]);

  // 인스턴스 ID (박스마다 고유, 문서에 저장)
  const [mapId] = useState<string>(() => {
    const existing = store.get<string>("mapId");
    if (existing) return existing;
    const id = uid();
    store.set("mapId", id);
    void store.save().catch(() => {});
    return id;
  });
  const label = `지도 ${mapId.slice(0, 4).toUpperCase()}`;

  const persisted = useMemo(() => store.get<Persisted>("state"), [store]);
  const [layers, setLayers] = useState<LayerState[]>(persisted?.layers ?? []);
  const [settings, setSettings] = useState<MapSettings>({ ...DEFAULT_SETTINGS, ...(persisted?.settings ?? {}) });
  const [view, setView] = useState<MapView>(persisted?.view ?? GANGNAM_VIEW);
  const [vworldKey, setVworldKey] = useState<string>(() => store.get<string>("vworldKey") || getStoredVworldKey());
  const [flash, setFlash] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const busRef = useRef<Bus | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  const basemap = resolveBasemap(settings.basemapId, vworldKey);
  const crs = useMemo(() => makeScaledCRS(settings.tileScale), [settings.tileScale]);
  const size = tilePx(settings.tileScale);

  /* ---------- 최신 상태 스냅샷 ---------- */
  const snapshotRef = useRef<MapSnapshot | null>(null);
  snapshotRef.current = {
    mapId,
    label,
    inOffice,
    settings,
    view,
    layers: layers.map(({ data: _d, ...rest }) => rest),
    ts: Date.now(),
  };
  const sendState = useCallback(() => {
    if (snapshotRef.current) busRef.current?.send({ type: "map:state", snapshot: { ...snapshotRef.current, ts: Date.now() } });
  }, []);

  /* ---------- 저장 (디바운스) ---------- */
  useEffect(() => {
    const t = setTimeout(() => {
      store.set("state", { v: 1, layers, settings, view } satisfies Persisted);
      void store.save().catch((e) => console.warn("[slide-map] save failed", e));
    }, 800);
    return () => clearTimeout(t);
  }, [store, layers, settings, view]);

  /* ---------- 상태 브로드캐스트 (디바운스) ---------- */
  useEffect(() => {
    const t = setTimeout(sendState, 150);
    return () => clearTimeout(t);
  }, [layers, settings, view, sendState]);

  /* ---------- 명령 처리 ---------- */
  const addLayers = useCallback((inputs: LayerInput[]) => {
    setLayers((prev) => {
      const next = [
        ...prev,
        ...inputs.map((l, i) => ({ ...l, visible: true, color: LAYER_COLORS[(prev.length + i) % LAYER_COLORS.length] })),
      ];
      return next;
    });
    const box = unionBBox(inputs.map((l) => l.bbox));
    if (box && mapRef.current) fitBBox(mapRef.current, box);
  }, []);

  const runCommand = useCallback(
    (cmd: MapCommand): { ok: boolean; message: string } => {
      const map = mapRef.current;
      switch (cmd.kind) {
        case "addLayers":
          addLayers(cmd.layers);
          return { ok: true, message: "" }; // 상세 결과는 패널이 표시
        case "setVisible":
          setLayers((prev) => prev.map((l) => (l.id === cmd.layerId ? { ...l, visible: cmd.visible } : l)));
          return { ok: true, message: "" };
        case "removeLayer":
          setLayers((prev) => prev.filter((l) => l.id !== cmd.layerId));
          return { ok: true, message: "레이어 삭제" };
        case "zoomToLayer": {
          const l = layersRef.current.find((x) => x.id === cmd.layerId);
          if (l && map) fitBBox(map, l.bbox);
          return { ok: true, message: "" };
        }
        case "zoomToAll": {
          const box = unionBBox(layersRef.current.map((l) => l.bbox));
          if (box && map) fitBBox(map, box);
          return { ok: true, message: "" };
        }
        case "setSettings": {
          const patch = cmd.patch;
          if (patch.tileScale !== undefined && map) {
            // 배율이 바뀌면 지도를 새 CRS 로 다시 만들므로, 같은 지리 범위가 보이도록 줌 보정
            const c = map.getCenter();
            const z = zoomForScaleChange(map.getZoom(), settingsRef.current.tileScale, patch.tileScale);
            setView({ center: [c.lat, c.lng], zoom: z });
          }
          setSettings((s) => ({ ...s, ...patch }));
          return { ok: true, message: "" };
        }
        case "identify":
          setFlash(true);
          setTimeout(() => setFlash(false), 1500);
          return { ok: true, message: "" };
        case "bake":
          return { ok: true, message: "" }; // 비동기 처리 — 버스 핸들러에서 map:bakeData 로 응답
      }
    },
    [addLayers],
  );

  const layersRef = useRef(layers);
  layersRef.current = layers;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const runRef = useRef(runCommand);
  runRef.current = runCommand;

  /* ---------- 버스 연결 ---------- */
  useEffect(() => {
    const bus = createBus(`map:${mapId}:${uid()}`, (msg: Msg) => {
      switch (msg.type) {
        case "pane:hello":
          sendState();
          break;
        case "pane:config":
          setVworldKey(msg.vworldKey);
          store.set("vworldKey", msg.vworldKey);
          break;
        case "pane:cmd": {
          if (msg.mapId !== mapId) return;
          if (msg.cmd.kind === "bake") {
            const map = mapRef.current;
            const { reqId } = msg;
            if (!map) {
              bus.send({ type: "map:bakeData", mapId, reqId, ok: false, message: "지도가 아직 준비되지 않았습니다.", payload: null });
              return;
            }
            makeBakePayload(map, layersRef.current, msg.cmd.options)
              .then((payload) => bus.send({ type: "map:bakeData", mapId, reqId, ok: true, message: "", payload }))
              .catch((e) =>
                bus.send({ type: "map:bakeData", mapId, reqId, ok: false, message: e instanceof Error ? e.message : String(e), payload: null }),
              );
            return;
          }
          const r = runRef.current(msg.cmd);
          bus.send({ type: "map:result", mapId, reqId: msg.reqId, ok: r.ok, message: r.message });
          break;
        }
        default:
          break;
      }
    });
    busRef.current = bus;
    sendState();
    const hb = setInterval(sendState, 4000); // 패널이 "살아있는 지도" 목록을 유지하도록
    const bye = () => bus.send({ type: "map:bye", mapId });
    window.addEventListener("beforeunload", bye);
    return () => {
      clearInterval(hb);
      window.removeEventListener("beforeunload", bye);
      bus.close();
      busRef.current = null;
    };
  }, [mapId, sendState, store]);

  // 다른 창(패널)에서 키를 저장하면 localStorage 이벤트로도 반영
  useEffect(() => {
    const onStorage = () => {
      const k = getStoredVworldKey();
      if (k && k !== vworldKey) setVworldKey(k);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [vworldKey]);

  /* ---------- 클릭 시 패널에 "이 지도 선택" 알림 ---------- */
  const onPointerDown = () => busRef.current?.send({ type: "map:focus", mapId });

  /* ---------- 소프트웨어 커서 ---------- */
  const onPointerMove = (e: PointerEvent) => {
    const el = cursorRef.current;
    if (!el) return;
    el.style.opacity = "1";
    el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  };
  const onPointerLeave = () => {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
  };

  /* ---------- 드래그 앤 드롭 (패널 없이도 바로 올릴 수 있게 유지) ---------- */
  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };
  const onDragOver = (e: DragEvent) => e.preventDefault();
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;
    const r = await importFiles(files);
    if (r.layers.length) addLayers(r.layers.map(({ id, name, data, bbox, featureCount }) => ({ id, name, data, bbox, featureCount })));
    const msgs = [...r.errors, ...r.warnings];
    if (msgs.length) {
      setNotice(msgs.join("\n"));
      setTimeout(() => setNotice(null), 9000);
    }
  };

  const onMapReady = useCallback((m: L.Map) => {
    mapRef.current = m;
  }, []);
  const onView = useCallback((v: MapView) => setView(v), []);

  return (
    <div
      className="slide-map-root relative h-screen w-screen overflow-hidden bg-white"
      onPointerDownCapture={onPointerDown}
      onPointerMoveCapture={settings.cursorAid ? onPointerMove : undefined}
      onPointerLeave={onPointerLeave}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <MapContainer
        key={`crs-${size}`}
        crs={crs}
        center={view.center}
        zoom={view.zoom}
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={120}
        maxZoom={21}
        className="h-full w-full"
      >
        <TileLayer
          key={`${basemap.id}-${size}-${vworldKey ? "k" : "nok"}`}
          url={basemap.url}
          attribution={basemap.attribution}
          tileSize={size}
          maxNativeZoom={basemap.maxNativeZoom}
          maxZoom={21}
        />
        {basemap.overlayUrl && (
          <TileLayer
            key={`${basemap.id}-ov-${size}`}
            url={basemap.overlayUrl}
            tileSize={size}
            maxNativeZoom={basemap.maxNativeZoom}
            maxZoom={21}
          />
        )}

        {layers
          .filter((l) => l.visible)
          .map((l) => (
            <GeoJSON
              key={`${l.id}-${l.color}`}
              data={l.data}
              interactive={false}
              style={styleFor(l.color)}
              pointToLayer={pointToLayerFor(l.color)}
            />
          ))}

        <ScaleControl position="bottomleft" imperial={false} />
        <MapBridge onReady={onMapReady} onView={onView} />
      </MapContainer>

      {/* 식별 플래시 (패널에서 "이 지도 찾기") */}
      {flash && (
        <div className="pointer-events-none absolute inset-0 z-[1500] flex items-center justify-center ring-8 ring-inset ring-sky-500/70">
          <span className="rounded-md bg-sky-600 px-4 py-2 text-lg font-bold text-white shadow">{label}</span>
        </div>
      )}

      {/* 드래그 오버레이 */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-[2000] flex items-center justify-center bg-sky-500/10 ring-4 ring-inset ring-sky-500/60">
          <div className="rounded-lg bg-white/95 px-5 py-3 text-sm font-semibold text-sky-700 shadow">여기에 GeoJSON / SHP(zip) 을 놓으세요</div>
        </div>
      )}

      {notice && (
        <div className="absolute bottom-8 left-1/2 z-[1600] max-w-[80%] -translate-x-1/2 whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 shadow">
          {notice}
        </div>
      )}

      {/* 소프트웨어 십자 커서 (웹뷰에서 OS 커서가 사라지는 경우 대비) */}
      {settings.cursorAid && (
        <div ref={cursorRef} className="slide-map-cursor" style={{ opacity: 0 }} aria-hidden>
          <span className="h" />
          <span className="v" />
          <span className="dot" />
        </div>
      )}
    </div>
  );
}

