/**
 * Slide Map v2 — 단일 패널 애드인 (docs/ARCHITECTURE.md)
 *  지도 목록 + WYSIWYG 편집기 + 슬라이드에 "분리된 태그 객체"로 반영
 */
import { Check, ChevronDown, Crosshair, Layers, Loader2, Map as MapIcon, Maximize, Minus, Pencil, Plus, Send, Settings2, Stamp, Trash2, TriangleAlert, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import type { BakeLayer } from "@/lib/bake";
import { getStoredVworldKey, resolveBasemap, storeVworldKey } from "@/lib/basemaps";
import { importFiles } from "@/lib/importers";
import { defaultStyle, describeFc, type LayerStyle } from "@/lib/style";
import { cn } from "@/lib/utils";
import { createDocStore, SIZE_WARN_BYTES } from "@/shared/docStore";
import { zoomForScaleChange } from "@/shared/crs";
import type { OfficeEnv } from "@/shared/office";
import { isPowerPoint, uid } from "@/shared/util";
import { inspectSlide, runBake, type BakeResult } from "@/pane/bakeRun";
import { diag } from "@/pane/diag";
import DiagPanel from "@/pane/DiagPanel";
import MapPreview, { type PreviewHandle } from "@/pane/MapPreview";
import MockSlide from "@/pane/MockSlide";
import { DEFAULT_SLIDE, newMapDoc, normalizeMapDoc, virtualSize, type DecoSettings, type Frame, type LayerMeta, type MapDoc } from "@/pane/model";
import { getMockAdapter, OfficeSlideAdapter, type MockSlideAdapter, type SlideAdapter } from "@/pane/slide";
import { BakeTab } from "@/pane/tabs/BakeTab";
import { BasemapTab } from "@/pane/tabs/BasemapTab";
import { DecorateTab } from "@/pane/tabs/DecorateTab";
import { LayersTab } from "@/pane/tabs/LayersTab";
import { Section, Tabs, EmptyState } from "@/pane/ui";

type TabId = "layers" | "basemap" | "deco" | "bake";
type Toast = { kind: "ok" | "error" | "info"; text: string } | null;

const waitFor = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 60));
  return cond();
};

export default function PaneApp({ env }: { env: OfficeEnv }) {
  const inOffice = isPowerPoint(env.host);
  const adapter = useMemo<SlideAdapter>(() => (inOffice ? new OfficeSlideAdapter() : getMockAdapter()), [inOffice]);
  const store = useMemo(() => createDocStore(inOffice, normalizeMapDoc), [inOffice]);

  const [maps, setMaps] = useState<MapDoc[]>(() => store.listMaps());
  const [activeId, setActiveId] = useState<string | null>(() => store.listMaps()[0]?.id ?? null);
  const [tab, setTab] = useState<TabId>("layers");
  const [toast, setToast] = useState<Toast>(null);
  const [vworldKey, setVworldKey] = useState(getStoredVworldKey());
  const [crsOverride, setCrsOverride] = useState("auto");
  const [importing, setImporting] = useState(false);
  const [baking, setBaking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; notes: string[] } | null>(null);
  const [zoom100, setZoom100] = useState(false);
  const [slide, setSlide] = useState(DEFAULT_SLIDE);
  const [dataVersion, setDataVersion] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [status, setStatus] = useState({ saving: false, error: null as string | null, bytes: 0 });
  const [vh, setVh] = useState(typeof window !== "undefined" ? window.innerHeight : 800);

  const previewRef = useRef<PreviewHandle>(null);
  const dragDepth = useRef(0);
  const pending = useRef<string | null>(null);
  const savedRef = useRef(new Map<string, MapDoc>());

  const doc = maps.find((m) => m.id === activeId) ?? null;
  const docRef = useRef(doc);
  docRef.current = doc;

  /* ---------- 저장 ---------- */
  useEffect(() => {
    for (const m of maps) {
      if (savedRef.current.get(m.id) !== m) {
        savedRef.current.set(m.id, m);
        store.saveMap(m);
      }
    }
  }, [maps, store]);
  useEffect(() => store.onStatus(setStatus), [store]);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const flash = useCallback((kind: "ok" | "error" | "info", text: string) => {
    setToast({ kind, text });
    if (kind !== "error") setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4500);
  }, []);

  const updateDoc = useCallback(
    (fn: (d: MapDoc) => MapDoc) => {
      const id = docRef.current?.id;
      if (!id) return;
      setMaps((prev) => prev.map((m) => (m.id === id ? { ...fn(m), updatedAt: Date.now() } : m)));
    },
    [],
  );

  /* ---------- 슬라이드 크기 / 선택 감지 ---------- */
  useEffect(() => {
    void adapter.slideSize().then(setSlide);
  }, [adapter]);
  useEffect(
    () =>
      adapter.onSelectionChanged((sel) => {
        const hit = sel.find((s) => s.mapId && maps.some((m) => m.id === s.mapId));
        if (hit?.mapId) setActiveId(hit.mapId);
      }),
    [adapter, maps],
  );

  /* ---------- 미리보기에 넘길 값 ---------- */
  const basemap = useMemo(() => resolveBasemap(doc?.settings.basemapId ?? "osm", vworldKey), [doc?.settings.basemapId, vworldKey]);
  const layers = useMemo<BakeLayer[]>(() => {
    if (!doc) return [];
    return doc.layers
      .filter((l) => l.visible)
      .map((l) => ({ id: l.id, name: l.name, style: l.style, kind: l.kind, data: store.getLayer(l.id)! }))
      .filter((l) => l.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.layers, dataVersion, store]);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  /* ---------- 지도 CRUD ---------- */
  const addMap = async () => {
    const n = maps.length + 1;
    const sz = await adapter.slideSize();
    setSlide(sz);
    const d = newMapDoc(uid(), `지도 ${n}`, vworldKey ? "vw-base" : "osm", sz);
    pending.current = d.id;
    setMaps((m) => [...m, d]);
    setActiveId(d.id);
    setTab("layers");
  };
  const removeMap = () => {
    if (!doc) return;
    if (!window.confirm(`"${doc.name}" 지도를 삭제할까요?\n(슬라이드에 이미 넣은 객체는 그대로 남습니다)`)) return;
    store.deleteMap(doc);
    const rest = maps.filter((m) => m.id !== doc.id);
    setMaps(rest);
    savedRef.current.delete(doc.id);
    setActiveId(rest[0]?.id ?? null);
  };

  /* ---------- 가져오기 ---------- */
  const doImport = useCallback(
    async (files: FileList | File[]) => {
      const d = docRef.current;
      if (!d) {
        flash("info", "먼저 [+ 지도 추가] 로 지도를 만드세요.");
        return;
      }
      setImporting(true);
      try {
        const r = await importFiles(files, crsOverride === "auto" ? null : crsOverride);
        const metas: LayerMeta[] = r.layers.map((l, i) => {
          store.saveLayer(l.id, l.data);
          const info = describeFc(l.data);
          return {
            id: l.id,
            name: l.name,
            visible: true,
            bbox: l.bbox,
            featureCount: l.featureCount,
            kind: info.kind,
            fields: info.fields,
            style: defaultStyle(info.kind, d.layers.length + i),
          };
        });
        if (metas.length) {
          setDataVersion((v) => v + 1);
          updateDoc((m) => ({ ...m, layers: [...m.layers, ...metas] }));
          const b = metas.reduce<[number, number, number, number]>(
            (a, l) => [Math.min(a[0], l.bbox[0]), Math.min(a[1], l.bbox[1]), Math.max(a[2], l.bbox[2]), Math.max(a[3], l.bbox[3])],
            [180, 90, -180, -90],
          );
          setTimeout(() => previewRef.current?.fitBounds(b), 50);
        }
        const msgs = [...r.errors, ...r.warnings];
        if (r.errors.length && !metas.length) flash("error", r.errors.join("\n"));
        else flash(metas.length ? "ok" : "info", `${metas.length}개 레이어 추가${msgs.length ? "\n" + msgs.join("\n") : ""}`);
        r.warnings.forEach((w) => diag(w, "warn"));
      } catch (e) {
        flash("error", e instanceof Error ? e.message : String(e));
      } finally {
        setImporting(false);
      }
    },
    [crsOverride, flash, store, updateDoc],
  );

  const patchLayer = (id: string, patch: Partial<LayerMeta>) => updateDoc((m) => ({ ...m, layers: m.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const styleLayer = (id: string, style: LayerStyle) => patchLayer(id, { style });
  const moveLayer = (id: string, dir: -1 | 1) =>
    updateDoc((m) => {
      const a = [...m.layers];
      const i = a.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return m;
      [a[i], a[j]] = [a[j], a[i]];
      return { ...m, layers: a };
    });
  const removeLayer = (id: string) => {
    store.deleteLayer(id);
    setDataVersion((v) => v + 1);
    updateDoc((m) => ({ ...m, layers: m.layers.filter((l) => l.id !== id) }));
  };
  const zoomLayer = (id: string) => {
    const l = docRef.current?.layers.find((x) => x.id === id);
    if (l) previewRef.current?.fitBounds([l.bbox[0], l.bbox[1], l.bbox[2], l.bbox[3]]);
  };
  const fitAll = () => {
    const ls = docRef.current?.layers.filter((l) => l.visible) ?? [];
    if (!ls.length) return;
    previewRef.current?.fitBounds(
      ls.reduce<[number, number, number, number]>((a, l) => [Math.min(a[0], l.bbox[0]), Math.min(a[1], l.bbox[1]), Math.max(a[2], l.bbox[2]), Math.max(a[3], l.bbox[3])], [180, 90, -180, -90]),
    );
  };

  /* ---------- 반영 ---------- */
  const bake = useCallback(
    async (placeholder = false) => {
      let d = docRef.current;
      if (!d || baking) return;
      setBaking(true);
      setResult(null);
      try {
        const insp = await inspectSlide(adapter, d);
        if (insp.newFrame && !placeholder) {
          const nf = insp.newFrame;
          updateDoc((m) => ({ ...m, frame: nf }));
          const { W, H } = virtualSize(nf);
          await waitFor(() => {
            const sz = previewRef.current?.getMap()?.getSize();
            return !!sz && sz.x === W && sz.y === H;
          });
        }
        const vec = previewRef.current?.getVector();
        if (vec) await vec.refresh().catch((e) => diag(`벡터 배경지도 갱신 실패: ${e}`, "warn"));
        await previewRef.current?.whenIdle();
        d = docRef.current!;
        const map = previewRef.current?.getMap();
        if (!map) throw new Error("지도가 아직 준비되지 않았습니다.");
        const { W, H } = virtualSize(d.frame);
        const bm = resolveBasemap(d.settings.basemapId, vworldKey);
        const r: BakeResult = await runBake({
          adapter,
          doc: d,
          map,
          W,
          H,
          layers: layersRef.current,
          insp,
          placeholder,
          basemapIsRaster: bm.kind === "raster",
          vector: bm.kind === "vector" && bm.vectorStyle ? { data: vec?.getData() ?? null, styleId: bm.vectorStyle } : undefined,
        });
        const slideId = await adapter.currentSlideId().catch(() => null);
        updateDoc((m) => ({ ...m, slideId }));
        const text = `${r.inserted}개 객체 ${insp.found ? "교체" : "삽입"} (${(r.ms / 1000).toFixed(1)}초)${insp.newFrame ? " · 슬라이드에서 바꾼 영역을 반영" : ""}`;
        setResult({ ok: true, text, notes: r.notes });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        diag(`반영 실패: ${msg}`, "error");
        setResult({ ok: false, text: msg, notes: [] });
      } finally {
        setBaking(false);
      }
    },
    [adapter, baking, updateDoc, vworldKey],
  );
  const bakeRef = useRef(bake);
  bakeRef.current = bake;

  const onMapReady = useCallback(() => {
    const id = pending.current;
    if (!id || docRef.current?.id !== id) return;
    pending.current = null;
    setTimeout(async () => {
      await previewRef.current?.whenIdle();
      await bakeRef.current(true);
    }, 0);
  }, []);

  /* ---------- 드래그&드롭 ---------- */
  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    if (--dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) void doImport(e.dataTransfer.files);
  };

  /* ---------- 렌더 ---------- */
  const big = status.bytes > SIZE_WARN_BYTES;
  const bakeReason = !doc ? "지도를 먼저 추가하세요" : baking ? "반영 중" : null;

  return (
    <div
      className="slide-map-root flex h-full flex-col bg-background text-foreground"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* 헤더 */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <MapIcon className="size-4" />
        <h1 className="text-[13px] font-semibold">Slide Map</h1>
        <span
          data-testid="conn"
          className={cn("ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]", inOffice ? "bg-emerald-50 text-emerald-700" : "bg-secondary text-muted-foreground")}
          title={inOffice ? "PowerPoint 에 연결됨" : "브라우저 모드: 모의 슬라이드를 사용합니다"}
        >
          <span className={cn("size-1.5 rounded-full", inOffice ? "bg-emerald-500" : "bg-muted-foreground/50")} />
          {inOffice ? "PowerPoint 연결됨" : "브라우저 모드"}
        </span>
        <button type="button" title="배경지도·API 키 설정" onClick={() => setTab("basemap")} className="flex size-6 items-center justify-center rounded hover:bg-accent">
          <Settings2 className="size-3.5" />
        </button>
      </header>

      {/* 지도 목록 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
        {maps.length > 0 && doc ? (
          renaming ? (
            <input
              autoFocus
              value={doc.name}
              onChange={(e) => updateDoc((m) => ({ ...m, name: e.target.value }))}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => e.key === "Enter" && setRenaming(false)}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px]"
            />
          ) : (
            <div className="relative min-w-0 flex-1">
              <select
                value={doc.id}
                data-testid="map-select"
                onChange={(e) => setActiveId(e.target.value)}
                className="h-7 w-full appearance-none rounded-md border border-border bg-background pr-6 pl-2 text-[12px] font-medium outline-none"
              >
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1.5 right-1.5 size-4 text-muted-foreground" />
            </div>
          )
        ) : (
          <span className="flex-1 text-[12px] text-muted-foreground">이 문서에 지도가 없습니다</span>
        )}
        {doc && (
          <>
            <button type="button" title="이름 바꾸기" onClick={() => setRenaming(true)} className="flex size-7 items-center justify-center rounded hover:bg-accent">
              <Pencil className="size-3.5" />
            </button>
            <button type="button" title="지도 삭제" onClick={removeMap} className="flex size-7 items-center justify-center rounded text-destructive hover:bg-accent">
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
        <Button size="sm" className="h-7 px-2 text-[12px]" onClick={() => void addMap()} data-testid="add-map">
          <Plus className="size-3.5" />
          지도 추가
        </Button>
      </div>

      {doc ? (
        <>
          {/* 미리보기 */}
          <div className="shrink-0 border-b border-border bg-secondary/50 p-2">
            <MapPreview
              key={`${doc.id}-${doc.settings.tileScale}`}
              ref={previewRef}
              W={virtualSize(doc.frame).W}
              H={virtualSize(doc.frame).H}
              tileScale={doc.settings.tileScale}
              initialView={doc.view}
              basemap={basemap}
              layers={layers}
              deco={doc.deco}
              zoom100={zoom100}
              maxHeight={Math.max(180, Math.min(380, vh * 0.36))}
              onViewChange={(v) => updateDoc((m) => ({ ...m, view: v }))}
              onReady={onMapReady}
            />
            <div className="mt-1.5 flex items-center gap-1">
              <button type="button" title="확대" onClick={() => previewRef.current?.zoomBy(0.5)} className="flex size-6 items-center justify-center rounded border border-border bg-background hover:bg-accent">
                <Plus className="size-3.5" />
              </button>
              <button type="button" title="축소" onClick={() => previewRef.current?.zoomBy(-0.5)} className="flex size-6 items-center justify-center rounded border border-border bg-background hover:bg-accent">
                <Minus className="size-3.5" />
              </button>
              <button type="button" title="보이는 레이어 전체 보기" disabled={!doc.layers.length} onClick={fitAll} className="flex size-6 items-center justify-center rounded border border-border bg-background hover:bg-accent disabled:opacity-40">
                <Maximize className="size-3.5" />
              </button>
              <button
                type="button"
                title="100% 크기로 보기 (슬라이드에서 보이는 실제 글자·선 크기)"
                onClick={() => setZoom100(!zoom100)}
                data-testid="zoom100"
                className={cn("flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] hover:bg-accent", zoom100 ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-background")}
              >
                <ZoomIn className="size-3" />
                100%
              </button>
              <span className="ml-auto truncate text-[10px] text-muted-foreground tabular-nums" title="슬라이드 프레임 크기 / 줌">
                {Math.round(doc.frame.width)}×{Math.round(doc.frame.height)}pt · z{doc.view.zoom.toFixed(2)}
              </span>
            </div>
          </div>

          <Tabs<TabId>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "layers", label: "레이어", badge: doc.layers.length },
              { id: "basemap", label: "배경지도" },
              { id: "deco", label: "꾸미기" },
              { id: "bake", label: "반영" },
            ]}
          />

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="tab-body">
            {tab === "layers" && (
              <LayersTab
                doc={doc}
                importing={importing}
                crsOverride={crsOverride}
                setCrsOverride={setCrsOverride}
                onImport={(f) => void doImport(f)}
                onPatch={patchLayer}
                onStyle={styleLayer}
                onMove={moveLayer}
                onRemove={removeLayer}
                onZoom={zoomLayer}
              />
            )}
            {tab === "basemap" && (
              <BasemapTab
                doc={doc}
                vworldKey={vworldKey}
                onKey={(k) => {
                  storeVworldKey(k);
                  setVworldKey(k);
                  flash("ok", k ? "API 키를 저장했습니다." : "API 키를 지웠습니다.");
                }}
                onBasemap={(id) => updateDoc((m) => ({ ...m, settings: { ...m.settings, basemapId: id } }))}
                onTileScale={(s) =>
                  updateDoc((m) => ({
                    ...m,
                    settings: { ...m.settings, tileScale: s },
                    view: { ...m.view, zoom: zoomForScaleChange(m.view.zoom, m.settings.tileScale, s) },
                  }))
                }
              />
            )}
            {tab === "deco" && <DecorateTab deco={doc.deco} onChange={(d: DecoSettings) => updateDoc((m) => ({ ...m, deco: d }))} />}
            {tab === "bake" && (
              <BakeTab
                doc={doc}
                adapter={adapter}
                slide={slide}
                onBake={(p) => updateDoc((m) => ({ ...m, bake: { ...m.bake, ...p } }))}
                onDeco={(d) => updateDoc((m) => ({ ...m, deco: d }))}
                onFrame={(f: Frame) => updateDoc((m) => ({ ...m, frame: f }))}
              />
            )}

            {adapter.kind === "mock" && (
              <Section title="브라우저 모드: 슬라이드 미리보기" defaultOpen>
                <MockSlide adapter={adapter as MockSlideAdapter} />
                <p className="mt-1 text-[11px] text-muted-foreground">도형을 끌어 옮기거나 파란 모서리로 크기를 바꾼 뒤 다시 반영해 보세요.</p>
              </Section>
            )}
            <DiagPanel />
            <p className="px-3 pb-3 text-[10px] leading-snug text-muted-foreground/70">
              {basemap.attribution.replace(/<[^>]+>/g, "").replace(/&copy;/g, "©")}
            </p>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState icon={<Layers className="size-9" />} title="지도를 추가해 시작하세요">
            [+ 지도 추가] 를 누르면 현재 슬라이드에 배경지도가 먼저 들어가고,
            <br />
            패널에서 레이어·스타일을 편집한 뒤 [슬라이드에 반영] 으로 갱신합니다.
          </EmptyState>
          <DiagPanel />
        </div>
      )}

      {/* 하단 액션 바 */}
      <footer className="shrink-0 border-t border-border bg-background px-3 py-2 shadow-[0_-4px_8px_-6px_rgba(0,0,0,.15)]">
        {(big || status.error) && (
          <p className="mb-1.5 flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            {status.error ? `문서 저장 실패: ${status.error}` : `문서에 저장된 지도 데이터가 ${(status.bytes / 1048576).toFixed(1)}MB 입니다(8MB 초과). 저장이 실패할 수 있습니다.`}
          </p>
        )}
        <Button className="h-9 w-full" disabled={!!bakeReason} title={bakeReason ?? undefined} onClick={() => void bake(false)} data-testid="bake">
          {baking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {baking ? "반영 중…" : "슬라이드에 반영"}
        </Button>
        <div className="mt-1 min-h-4 text-[11px] leading-snug" data-testid="bake-result">
          {result ? (
            <p className={cn("flex items-start gap-1", result.ok ? "text-emerald-700" : "text-destructive")}>
              {result.ok ? <Check className="mt-0.5 size-3 shrink-0" /> : <TriangleAlert className="mt-0.5 size-3 shrink-0" />}
              <span className="min-w-0 break-words">
                {result.text}
                {result.notes.length > 0 && <span className="block text-muted-foreground">{result.notes.join(" · ")}</span>}
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-1 text-muted-foreground">
              <Stamp className="size-3" />
              {status.saving ? "문서에 저장 중…" : doc ? "편집한 내용을 슬라이드 객체로 만듭니다" : ""}
              <Crosshair className="hidden" />
            </p>
          )}
        </div>
      </footer>

      {toast && (
        <div
          role="status"
          onClick={() => setToast(null)}
          className={cn(
            "fixed bottom-24 left-1/2 z-[3000] max-w-[92%] -translate-x-1/2 cursor-pointer whitespace-pre-line rounded-md px-3 py-2 text-[12px] shadow-lg",
            toast.kind === "ok" && "bg-emerald-600 text-white",
            toast.kind === "error" && "bg-destructive text-white",
            toast.kind === "info" && "bg-foreground text-background",
          )}
        >
          {toast.text}
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[4000] grid place-items-center border-2 border-dashed border-primary bg-background/80">
          <p className="text-[13px] font-medium">여기에 놓으면 레이어로 추가됩니다</p>
        </div>
      )}
    </div>
  );
}
