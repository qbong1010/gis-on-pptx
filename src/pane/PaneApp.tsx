/**
 * Slide Map v2 — 단일 패널 애드인 (docs/ARCHITECTURE.md)
 *  지도 목록 + WYSIWYG 편집기 + 슬라이드에 "분리된 태그 객체"로 반영
 *
 * 동시성 규칙 (리뷰 H1/H2):
 *  - 반영(bake)·가져오기(import)는 시작할 때 지도 id·슬라이드 id 를 고정한다. 도중에 지도·슬라이드를 바꿔도 다른 대상에 영향을 주지 않는다.
 *  - 반영 중에는 지도 전환/추가/삭제와 선택 연동 자동 전환을 막는다 (ref 가드로 더블클릭도 방지).
 */
import { Check, ChevronDown, ChevronRight, Layers, Loader2, Map as MapIcon, Maximize, Minus, Pencil, Plus, Send, TriangleAlert, Trash2, X, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import type { BakeLayer } from "@/lib/bake";
import { BASEMAP_META, getStoredVworldKey, resolveBasemap, storeVworldKey } from "@/lib/basemaps";
import { countVertices, importFiles, simplifyForBudget } from "@/lib/importers";
import { defaultStyle, describeFc, type LayerStyle } from "@/lib/style";
import { cn } from "@/lib/utils";
import { createDocStore, SIZE_WARN_BYTES } from "@/shared/docStore";
import { zoomForScaleChange } from "@/shared/crs";
import type { OfficeEnv } from "@/shared/office";
import { isPowerPoint, lsGet, lsSet, uid } from "@/shared/util";
import { inspectSlide, runBake, type BakeResult } from "@/pane/bakeRun";
import { Onboarding, SettingsMenu } from "@/pane/chrome";
import { diag } from "@/pane/diag";
import DiagPanel from "@/pane/DiagPanel";
import MapPreview, { type PreviewHandle } from "@/pane/MapPreview";
import MockSlide from "@/pane/MockSlide";
import { DEFAULT_SLIDE, hashDoc, newMapDoc, normalizeMapDoc, virtualSize, type DecoName, type DecoSettings, type Frame, type LayerMeta, type MapDoc } from "@/pane/model";
import { getMockAdapter, OfficeSlideAdapter, type MockSlideAdapter, type SlideAdapter } from "@/pane/slide";
import { BakeTab } from "@/pane/tabs/BakeTab";
import { BasemapTab } from "@/pane/tabs/BasemapTab";
import { DecorateTab } from "@/pane/tabs/DecorateTab";
import { LayersTab } from "@/pane/tabs/LayersTab";
import { EmptyState, IconButton, Section, Tabs } from "@/pane/ui";
import { panelId, tabId } from "@/pane/ui/Tabs";

type TabId = "layers" | "basemap" | "deco" | "bake";
type Toast = { kind: "ok" | "error" | "info"; text: string } | null;
type Preview = "compact" | "normal" | "large";
type SlideChoice = { mapId: string; slideId: string; index: number } | null;

const SIMPLIFY_ABOVE = 200_000; // M9: 꼭짓점 이 수를 넘는 레이어는 문서에는 단순화본을 저장한다

const waitFor = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 60));
  return cond();
};

/** 보기 위치/줌(view)·updatedAt 만 바뀐 저장인가 — 이런 저장은 늦게(2.5초 디바운스) 한다 */
const isViewOnly = (a: MapDoc, b: MapDoc) => (Object.keys(b) as (keyof MapDoc)[]).every((k) => k === "view" || k === "updatedAt" || a[k] === b[k]);

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
  const [result, setResult] = useState<{ ok: boolean; text: string; notes: string[]; hash?: string } | null>(null);
  const [zoom100, setZoom100] = useState(false);
  const [slide, setSlide] = useState(DEFAULT_SLIDE);
  const [dataVersion, setDataVersion] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [slideChoice, setSlideChoice] = useState<SlideChoice>(null);
  const [status, setStatus] = useState({ saving: false, error: null as string | null, bytes: 0 });
  const [vh, setVh] = useState(typeof window !== "undefined" ? window.innerHeight : 800);
  const [previewOpen, setPreviewOpen] = useState(() => lsGet("previewOpen") !== "0");
  const [previewSize, setPreviewSize] = useState<Preview>(() => (lsGet("previewSize") as Preview) || "normal");
  const [showDiag, setShowDiag] = useState(() => lsGet("diag") === "1");
  const [guide, setGuide] = useState(() => lsGet("guideDone") !== "1");

  const previewRef = useRef<PreviewHandle>(null);
  const dragDepth = useRef(0);
  const pending = useRef<string | null>(null);
  const savedRef = useRef<Map<string, MapDoc> | null>(null);
  if (!savedRef.current) savedRef.current = new Map(maps.map((m) => [m.id, m])); // M9: 열 때 전부 다시 저장하지 않는다
  const bodyRef = useRef<HTMLDivElement>(null);
  const bakingRef = useRef(false);
  const openSettingsRef = useRef<(() => void) | null>(null);
  const dismissGuideRef = useRef<() => void>(() => {});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doc = maps.find((m) => m.id === activeId) ?? null;
  const docRef = useRef(doc);
  docRef.current = doc;
  const mapsRef = useRef(maps);
  mapsRef.current = maps;
  const getDoc = useCallback((id: string) => mapsRef.current.find((m) => m.id === id) ?? null, []);

  /* ---------- 저장 ---------- */
  useEffect(() => {
    const saved = savedRef.current!;
    for (const m of maps) {
      const prev = saved.get(m.id);
      if (prev !== m) {
        saved.set(m.id, m);
        store.saveMap(m, { lazy: !!prev && isViewOnly(prev, m) });
      }
    }
  }, [maps, store]);
  useEffect(() => store.onStatus(setStatus), [store]);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0; // 탭을 바꾸면 맨 위부터
  }, [tab]);
  useEffect(() => {
    setResult(null);
    setSlideChoice(null);
    setConfirmDel(false);
    setRenaming(false);
  }, [activeId]);

  const flash = useCallback((kind: "ok" | "error" | "info", text: string) => {
    setToast({ kind, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (kind !== "error") toastTimer.current = setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 6000);
  }, []);

  const updateDocById = useCallback((id: string, fn: (d: MapDoc) => MapDoc) => {
    setMaps((prev) => prev.map((m) => (m.id === id ? { ...fn(m), updatedAt: Date.now() } : m)));
  }, []);
  const updateDoc = useCallback(
    (fn: (d: MapDoc) => MapDoc) => {
      const id = docRef.current?.id;
      if (id) updateDocById(id, fn);
    },
    [updateDocById],
  );

  /* ---------- 슬라이드 크기 / 선택 감지 (M5: 한 번만 등록, 최신 값은 ref 로) ---------- */
  useEffect(() => {
    void adapter.slideSize().then(setSlide);
  }, [adapter]);
  useEffect(
    () =>
      adapter.onSelectionChanged((sel) => {
        if (bakingRef.current) return; // 반영 중에는 자동 전환 금지
        const hit = sel.find((s) => s.mapId && mapsRef.current.some((m) => m.id === s.mapId));
        if (hit?.mapId && hit.mapId !== docRef.current?.id) setActiveId(hit.mapId);
      }),
    [adapter],
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

  const curHash = useMemo(() => (doc ? hashDoc(doc) : ""), [doc]);
  const dirty = !!doc?.bakedHash && doc.bakedHash !== curHash;
  const showResult = !!result && (!result.ok || result.hash === curHash);

  /* ---------- 지도 CRUD ---------- */
  const addMap = async () => {
    if (bakingRef.current) return;
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
    if (!doc || bakingRef.current) return;
    store.deleteMap(doc);
    const rest = maps.filter((m) => m.id !== doc.id);
    setMaps(rest);
    savedRef.current!.delete(doc.id);
    setActiveId(rest[0]?.id ?? null);
    setConfirmDel(false);
  };

  /* ---------- 가져오기 (L1: 대상 지도 고정, M9: 큰 레이어는 단순화해 저장) ---------- */
  const doImport = useCallback(
    async (files: FileList | File[]) => {
      const d = docRef.current;
      if (!d) {
        flash("info", "먼저 [+ 지도 추가] 로 지도를 만드세요.");
        return;
      }
      if (d.futureV) return;
      const mapId = d.id;
      setImporting(true);
      try {
        const r = await importFiles(files, crsOverride === "auto" ? null : crsOverride);
        const notes: string[] = [];
        const metas: LayerMeta[] = r.layers.map((l, i) => {
          const vc = l.vertexCount ?? countVertices(l.data);
          let toStore = l.data;
          if (vc > SIMPLIFY_ABOVE) {
            const sr = simplifyForBudget(l.data, SIMPLIFY_ABOVE);
            if (sr.simplified) {
              toStore = sr.data;
              notes.push(`"${l.name}" 은(는) 꼭짓점이 ${vc.toLocaleString()}개로 많아, 문서에는 ${sr.vertexCount.toLocaleString()}개로 단순화해 저장합니다. 이번 작업 중에는 원본으로 표시하지만 다시 열면 단순화본이 쓰입니다.`);
            }
          }
          store.saveLayer(l.id, toStore);
          if (toStore !== l.data) store.setSessionLayer(l.id, l.data);
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
        if (!getDoc(mapId)) {
          // 가져오는 동안 지도가 삭제됨 → 저장해 둔 레이어 데이터 정리
          metas.forEach((m) => store.deleteLayer(m.id));
          flash("info", "가져오는 동안 지도가 삭제되어 레이어를 추가하지 않았습니다.");
          return;
        }
        if (metas.length) {
          setDataVersion((v) => v + 1);
          updateDocById(mapId, (m) => ({ ...m, layers: [...m.layers, ...metas] }));
          const b = metas.reduce<[number, number, number, number]>(
            (a, l) => [Math.min(a[0], l.bbox[0]), Math.min(a[1], l.bbox[1]), Math.max(a[2], l.bbox[2]), Math.max(a[3], l.bbox[3])],
            [180, 90, -180, -90],
          );
          if (docRef.current?.id === mapId) setTimeout(() => previewRef.current?.fitBounds(b), 50);
        }
        const msgs = [...r.errors, ...r.warnings, ...notes];
        if (r.errors.length && !metas.length) flash("error", r.errors.join("\n"));
        else flash(metas.length ? "ok" : "info", `${metas.length}개 레이어 추가${msgs.length ? "\n" + msgs.join("\n") : ""}`);
        [...r.warnings, ...notes].forEach((w) => diag(w, "warn"));
      } catch (e) {
        flash("error", e instanceof Error ? e.message : String(e));
      } finally {
        setImporting(false);
      }
    },
    [crsOverride, flash, getDoc, store, updateDocById],
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

  /** 꾸미기 설정이 바뀌면, 위치(모서리·여백)가 바뀐 요소는 사용자가 옮겨 둔 오프셋을 버린다 (H4) */
  const onDeco = (next: DecoSettings) =>
    updateDoc((m) => {
      const userRel = { ...(m.userRel ?? {}) };
      for (const n of ["north", "scale", "legend"] as DecoName[]) {
        const a = m.deco[n].pos;
        const b = next[n].pos;
        if (a.corner !== b.corner || a.margin !== b.margin) delete userRel[n];
      }
      return { ...m, deco: next, userRel };
    });

  /* ---------- 반영 ---------- */
  const bake = useCallback(
    async (opt: { placeholder?: boolean; id?: string; target?: "orig" | "here" } = {}) => {
      const id = opt.id ?? docRef.current?.id;
      if (!id || bakingRef.current) return;
      let d = getDoc(id);
      if (!d || d.futureV) return;
      const placeholder = !!opt.placeholder;
      bakingRef.current = true;
      setBaking(true);
      setResult(null);
      setSlideChoice(null);
      try {
        await store.flush().catch(() => {}); // 보기 위치 등 늦게 저장되는 값을 먼저 저장
        const cur = await adapter.currentSlideId();
        if (!cur) throw new Error("선택된 슬라이드가 없습니다. 슬라이드를 하나 선택한 뒤 다시 시도하세요.");
        let target = cur;
        if (!placeholder && opt.target === "orig" && d.slideId && d.slideId !== cur) {
          if (!(await adapter.selectSlide(d.slideId))) throw new Error("원래 슬라이드로 이동하지 못했습니다. 슬라이드를 직접 선택한 뒤 다시 시도하세요.");
          target = d.slideId;
        }
        adapter.bindSlide(target); // H1: 이후 모든 조작은 이 슬라이드에만
        // M7: 다른 슬라이드를 보고 있는데 여기에는 이 지도 객체가 없으면 어디에 넣을지 묻는다
        if (!placeholder && !opt.target && d.slideId && d.slideId !== cur) {
          const here = (await adapter.listShapes()).some((s) => s.mapId === id);
          const info = here ? null : await adapter.slideInfo(d.slideId);
          if (!here && info) {
            setSlideChoice({ mapId: id, slideId: d.slideId, index: info.index });
            return;
          }
        }
        const insp = await inspectSlide(adapter, d);
        if (placeholder && insp.found > 0) return; // M8: 이미 이 슬라이드에 있으면 자리표시 반영을 하지 않는다
        if (insp.newFrame && !placeholder) {
          const nf = insp.newFrame;
          updateDocById(id, (m) => ({ ...m, frame: nf }));
          const { W, H } = virtualSize(nf);
          await waitFor(() => {
            const cd = getDoc(id);
            const sz = previewRef.current?.getMap()?.getSize();
            return !!cd && cd.frame.left === nf.left && cd.frame.top === nf.top && cd.frame.width === nf.width && cd.frame.height === nf.height && !!sz && sz.x === W && sz.y === H;
          });
        }
        const vec = previewRef.current?.getVector();
        if (vec) await vec.refresh().catch((e) => diag(`벡터 배경지도 갱신 실패: ${e}`, "warn"));
        await previewRef.current?.whenIdle();
        d = getDoc(id);
        if (!d) throw new Error("반영하는 동안 지도가 삭제되었습니다.");
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
          basemap: bm,
          vector: bm.kind === "vector" && bm.vectorStyle ? { data: vec?.getData() ?? null, styleId: bm.vectorStyle } : undefined,
        });
        // M11: 키가 없어 OSM 으로 대체된 경우 알린다
        if (BASEMAP_META.find((b) => b.id === d!.settings.basemapId)?.requiresKey && !vworldKey) r.notes.push("VWorld API 키가 없어 OpenStreetMap 으로 대체해 반영했습니다.");
        const hash = hashDoc({ ...d, frame: r.baked.frame });
        updateDocById(id, (m) => ({ ...m, slideId: target, bakedFrame: r.baked.frame, bakedPos: r.baked.pos, userRel: r.baked.userRel, bakedHash: hash }));
        const text = `${r.inserted}개 객체 ${insp.found ? "교체" : "삽입"} (${(r.ms / 1000).toFixed(1)}초)${insp.newFrame ? " · 슬라이드에서 바꾼 영역을 반영" : ""}`;
        setResult({ ok: true, text, notes: r.notes, hash });
        if (!placeholder && lsGet("guideDone") !== "1") dismissGuideRef.current(); // 첫 반영이 끝나면 시작 안내는 접는다
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        diag(`반영 실패: ${msg}`, "error");
        setResult({ ok: false, text: msg, notes: [] });
      } finally {
        adapter.bindSlide(null);
        bakingRef.current = false;
        setBaking(false);
      }
    },
    [adapter, getDoc, store, updateDocById, vworldKey],
  );
  const bakeRef = useRef(bake);
  bakeRef.current = bake;

  const onMapReady = useCallback(() => {
    const id = pending.current;
    if (!id || docRef.current?.id !== id) return;
    pending.current = null;
    setTimeout(async () => {
      await previewRef.current?.whenIdle();
      await bakeRef.current({ placeholder: true, id });
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
  const readOnly = !!doc?.futureV;
  const bakeReason = !doc ? "지도를 먼저 추가하세요" : readOnly ? "더 새 버전으로 만든 문서라 읽기 전용입니다" : baking ? "반영 중" : null;
  const guideStep: 1 | 2 | 3 = !doc ? 1 : doc.layers.length === 0 ? 2 : 3;
  const previewMax = previewSize === "compact" ? 150 : previewSize === "large" ? Math.max(260, Math.min(560, vh * 0.55)) : Math.max(180, Math.min(380, vh * 0.36));
  const setPreviewOpenP = (v: boolean) => {
    setPreviewOpen(v);
    lsSet("previewOpen", v ? "1" : "0");
  };
  const setPreviewSizeP = (v: Preview) => {
    setPreviewSize(v);
    lsSet("previewSize", v);
  };
  const dismissGuide = () => {
    setGuide(false);
    lsSet("guideDone", "1");
  };
  dismissGuideRef.current = dismissGuide;

  return (
    <div
      className="slide-map-root flex h-full flex-col bg-background text-foreground"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* 헤더 */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <MapIcon className="size-4" aria-hidden />
        <h1 className="text-[13px] font-semibold">Slide Map</h1>
        <span
          data-testid="conn"
          className={cn("ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", inOffice ? "bg-emerald-50 text-emerald-800" : "bg-secondary text-muted-foreground")}
          title={inOffice ? "PowerPoint 에 연결됨" : "브라우저 모드: 모의 슬라이드를 사용합니다"}
        >
          <span className={cn("size-1.5 rounded-full", inOffice ? "bg-emerald-500" : "bg-muted-foreground/50")} />
          {inOffice ? "PowerPoint 연결됨" : "브라우저 모드"}
        </span>
        <SettingsMenu
          vworldKey={vworldKey}
          onKey={(k) => {
            storeVworldKey(k);
            setVworldKey(k);
            flash("ok", k ? "API 키를 저장했습니다." : "API 키를 지웠습니다.");
          }}
          showDiag={showDiag}
          onShowDiag={(v) => {
            setShowDiag(v);
            lsSet("diag", v ? "1" : "0");
          }}
          onShowGuide={() => {
            setGuide(true);
            lsSet("guideDone", "0");
          }}
          openRef={openSettingsRef}
        />
      </header>

      {/* 지도 목록 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
        {confirmDel && doc ? (
          <div role="alertdialog" aria-label="지도 삭제 확인" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" data-testid="map-delete-confirm">
            <span className="min-w-0 flex-1">
              <b className="font-semibold">{doc.name}</b> 지도를 삭제할까요?
              <span className="block text-[11px] text-muted-foreground">슬라이드에 이미 넣은 객체는 그대로 남습니다.</span>
            </span>
            <button type="button" data-testid="map-delete-yes" onClick={removeMap} className="rounded-md bg-destructive px-2 py-1 text-[12px] font-medium text-white hover:bg-destructive/90">
              삭제
            </button>
            <button type="button" autoFocus data-testid="map-delete-no" onClick={() => setConfirmDel(false)} className="rounded-md border border-border bg-background px-2 py-1 text-[12px] hover:bg-accent">
              취소
            </button>
          </div>
        ) : (
          <>
            {maps.length > 0 && doc ? (
              renaming ? (
                <input
                  autoFocus
                  value={doc.name}
                  aria-label="지도 이름"
                  onChange={(e) => updateDoc((m) => ({ ...m, name: e.target.value }))}
                  onBlur={() => setRenaming(false)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setRenaming(false)}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px]"
                />
              ) : (
                <div className="relative min-w-0 flex-1">
                  <select
                    value={doc.id}
                    data-testid="map-select"
                    aria-label="지도 선택"
                    disabled={baking}
                    onChange={(e) => !bakingRef.current && setActiveId(e.target.value)}
                    className="h-7 w-full appearance-none rounded-md border border-border bg-background pr-6 pl-2 text-[12px] font-medium outline-none disabled:opacity-60"
                  >
                    {maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1.5 right-1.5 size-4 text-muted-foreground" aria-hidden />
                </div>
              )
            ) : (
              <span className="flex-1 text-[12px] text-muted-foreground">이 문서에 지도가 없습니다</span>
            )}
            {doc && (
              <>
                <IconButton label="지도 이름 바꾸기" onClick={() => setRenaming(true)}>
                  <Pencil className="size-3.5" />
                </IconButton>
                <IconButton label="지도 삭제" danger disabled={baking} onClick={() => setConfirmDel(true)} data-testid="map-delete">
                  <Trash2 className="size-3.5" />
                </IconButton>
              </>
            )}
            <Button size="sm" className="h-7 px-2 text-[12px]" disabled={baking} onClick={() => void addMap()} data-testid="add-map">
              <Plus className="size-3.5" />
              지도 추가
            </Button>
          </>
        )}
      </div>

      {guide && !readOnly && <Onboarding step={guideStep} onDismiss={dismissGuide} />}
      {readOnly && (
        <p role="alert" className="shrink-0 border-b border-border bg-amber-50 px-3 py-1.5 text-[12px] leading-snug text-amber-900">
          이 지도는 더 새로운 버전의 Slide Map(v{doc!.futureV})으로 저장되어 있어 읽기 전용입니다. 변경 사항은 저장되지 않으며 슬라이드에 반영할 수 없습니다.
        </p>
      )}

      {doc ? (
        <>
          {/* 미리보기 (접기 / 크기 선택) */}
          <div className="shrink-0 border-b border-border bg-secondary/50">
            <div className="flex items-center gap-1 px-2 py-1">
              <button
                type="button"
                aria-expanded={previewOpen}
                aria-controls="preview-body"
                onClick={() => setPreviewOpenP(!previewOpen)}
                data-testid="preview-toggle"
                className="flex items-center gap-1 rounded px-1 py-0.5 text-[12px] font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ChevronRight className={cn("size-3.5 transition-transform", previewOpen && "rotate-90")} aria-hidden />
                지도 미리보기
              </button>
              <span className="ml-1 truncate text-[11px] text-muted-foreground tabular-nums" title="슬라이드 지도 영역 크기 / 줌">
                {Math.round(doc.frame.width)}×{Math.round(doc.frame.height)}pt · z{doc.view.zoom.toFixed(1)}
              </span>
              {previewOpen && (
                <div role="group" aria-label="미리보기 크기" className="ml-auto flex overflow-hidden rounded-md border border-border bg-background">
                  {(
                    [
                      ["compact", "작게"],
                      ["normal", "보통"],
                      ["large", "크게"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={previewSize === k}
                      onClick={() => setPreviewSizeP(k)}
                      className={cn("h-5 border-r border-border px-1.5 text-[11px] last:border-r-0", previewSize === k ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div id="preview-body" style={previewOpen ? undefined : { height: 0, overflow: "hidden" }} aria-hidden={!previewOpen} inert={!previewOpen}>
              <div className="px-2 pb-2">
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
                  maxHeight={previewMax}
                  onToggle100={() => setZoom100(true)}
                  onViewChange={(v) => updateDoc((m) => ({ ...m, view: v }))}
                  onReady={onMapReady}
                />
                <div className="mt-1.5 flex items-center gap-1">
                  <IconButton label="확대" onClick={() => previewRef.current?.zoomBy(0.5)} className="border border-border bg-background" size="sm">
                    <Plus className="size-3.5" />
                  </IconButton>
                  <IconButton label="축소" onClick={() => previewRef.current?.zoomBy(-0.5)} className="border border-border bg-background" size="sm">
                    <Minus className="size-3.5" />
                  </IconButton>
                  <IconButton label="보이는 레이어 전체 보기" disabled={!doc.layers.length} onClick={fitAll} className="border border-border bg-background" size="sm">
                    <Maximize className="size-3.5" />
                  </IconButton>
                  <button
                    type="button"
                    title="100% 크기로 보기 (슬라이드에서 보이는 실제 글자·선 크기)"
                    aria-pressed={zoom100}
                    onClick={() => setZoom100(!zoom100)}
                    data-testid="zoom100"
                    className={cn("flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-[11px] hover:bg-accent", zoom100 ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-background")}
                  >
                    <ZoomIn className="size-3" aria-hidden />
                    100%
                  </button>
                </div>
              </div>
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

          <div ref={bodyRef} id={panelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)} className="min-h-0 flex-1 overflow-y-auto" data-testid="tab-body">
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
                onOpenSettings={() => openSettingsRef.current?.()}
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
            {tab === "deco" && <DecorateTab deco={doc.deco} onChange={onDeco} />}
            {tab === "bake" && (
              <BakeTab
                doc={doc}
                adapter={adapter}
                slide={slide}
                onBake={(p) => updateDoc((m) => ({ ...m, bake: { ...m.bake, ...p } }))}
                onDeco={onDeco}
                onFrame={(f: Frame) => updateDoc((m) => ({ ...m, frame: f }))}
              />
            )}

            {adapter.kind === "mock" && (
              <Section title="브라우저 모드: 슬라이드 미리보기" defaultOpen>
                <MockSlide adapter={adapter as MockSlideAdapter} />
                <p className="mt-1 text-[11px] text-muted-foreground">도형을 끌어 옮기거나 파란 모서리로 크기를 바꾼 뒤 다시 반영해 보세요.</p>
              </Section>
            )}
            {showDiag && <DiagPanel />}
            <p className="px-3 pt-2 pb-3 text-[11px] leading-snug text-muted-foreground">{basemap.attribution.replace(/<[^>]+>/g, "").replace(/&copy;/g, "©")}</p>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState icon={<Layers className="size-9" />} title="지도를 추가해 시작하세요">
            [+ 지도 추가] 를 누르면 현재 슬라이드에 배경지도가 먼저 들어갑니다. 패널에서 레이어·스타일을 편집한 뒤 [슬라이드에 반영] 으로 갱신하세요.
          </EmptyState>
          {showDiag && <DiagPanel />}
        </div>
      )}

      {/* 하단 액션 바: 메시지는 겹쳐 뜨지 않고 이 영역 안에서 표시한다 */}
      <footer className="shrink-0 border-t border-border bg-background px-3 py-2 shadow-[0_-4px_8px_-6px_rgba(0,0,0,.15)]">
        {(big || status.error) && (
          <p role={status.error ? "alert" : "status"} className="mb-1.5 flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {status.error
              ? `문서 저장 실패: ${status.error}`
              : `문서 저장 용량이 큽니다(${(status.bytes / 1048576).toFixed(1)}MB). 문서에 저장되는 한도가 확인되지 않았으므로 저장이 실패할 수 있습니다. 큰 레이어는 줄이거나 지우는 것을 권장합니다.`}
          </p>
        )}
        {toast && (
          <div
            role={toast.kind === "error" ? "alert" : "status"}
            data-testid="toast"
            className={cn(
              "mb-1.5 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[12px] leading-snug whitespace-pre-line",
              toast.kind === "ok" && "bg-emerald-50 text-emerald-900",
              toast.kind === "error" && "bg-red-50 text-red-900",
              toast.kind === "info" && "bg-secondary text-foreground",
            )}
          >
            <span className="min-w-0 flex-1 break-words">{toast.text}</span>
            <button type="button" aria-label="메시지 닫기" onClick={() => setToast(null)} className="shrink-0 rounded p-0.5 hover:bg-black/10">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {slideChoice && (
          <div role="group" aria-label="반영할 슬라이드 선택" data-testid="slide-choice" className="mb-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[12px] leading-snug text-amber-900">
            <p>
              지금 보고 있는 슬라이드에는 이 지도의 객체가 없습니다. 이 지도는 <b>슬라이드 {slideChoice.index}</b> 에 있습니다.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Button size="sm" className="h-7 px-2 text-[12px]" data-testid="choice-orig" onClick={() => void bake({ id: slideChoice.mapId, target: "orig" })}>
                슬라이드 {slideChoice.index} 로 이동해서 반영
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-[12px]" data-testid="choice-here" onClick={() => void bake({ id: slideChoice.mapId, target: "here" })}>
                이 슬라이드에 새로 넣기
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setSlideChoice(null)}>
                취소
              </Button>
            </div>
          </div>
        )}
        <Button className="relative h-9 w-full" disabled={!!bakeReason} title={bakeReason ?? undefined} onClick={() => void bake()} data-testid="bake">
          {baking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {baking ? "반영 중…" : "슬라이드에 반영"}
          {dirty && !baking && (
            <span data-testid="dirty-badge" className="ml-1 rounded-full bg-amber-400 px-1.5 py-px text-[11px] font-semibold text-amber-950">
              변경 있음
            </span>
          )}
        </Button>
        <div className="mt-1 min-h-4 text-[11px] leading-snug" data-testid="bake-result" aria-live="polite">
          {showResult && result ? (
            <p className={cn("flex items-start gap-1", result.ok ? "text-emerald-800" : "text-destructive")} role={result.ok ? undefined : "alert"}>
              {result.ok ? <Check className="mt-0.5 size-3 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />}
              <span className="min-w-0 break-words">
                {result.text}
                {result.notes.length > 0 && <span className="block text-muted-foreground">{result.notes.join(" · ")}</span>}
              </span>
            </p>
          ) : dirty ? (
            <p className="flex items-center gap-1 text-amber-800">
              <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
              반영 안 된 변경이 있습니다
            </p>
          ) : (
            <p className="text-muted-foreground">{status.saving ? "문서에 저장 중…" : doc ? (doc.bakedHash ? "슬라이드와 같은 상태입니다" : "편집한 내용을 슬라이드 객체로 만듭니다") : ""}</p>
          )}
        </div>
      </footer>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[4000] grid place-items-center border-2 border-dashed border-primary bg-background/80">
          <p className="text-[13px] font-medium">여기에 놓으면 레이어로 추가됩니다</p>
        </div>
      )}
    </div>
  );
}
