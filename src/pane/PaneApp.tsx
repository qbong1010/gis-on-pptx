/**
 * Slide Map 우측 패널 (PowerPoint TaskPane 애드인)
 * - 슬라이드에 삽입된 지도 박스(콘텐츠 애드인)들을 목록으로 관리하고 메시지로 제어한다.
 * - API 키, 배경지도, 해상도 배율, 레이어 가시성, Bake 를 여기서 처리.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Crosshair,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  Locate,
  Map as MapIcon,
  RefreshCw,
  Stamp,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { BASEMAP_META, ENV_VWORLD_KEY, getStoredVworldKey, storeVworldKey } from "@/lib/basemaps";
import { CRS_LIST } from "@/lib/crs";
import { ACCEPT_ATTR, importFiles } from "@/lib/importers";
import { cn } from "@/lib/utils";
import { createBus, type Bus } from "@/shared/bus";
import type { OfficeEnv } from "@/shared/office";
import type { BakeOptions, BakePayload, MapCommand, MapSettings, MapSnapshot, Msg } from "@/shared/protocol";
import { detectMapFrame, fallbackFrame, insertBake } from "./insert";
import { uid } from "@/shared/util";

const STALE_MS = 12_000;
const SCALE_PRESETS = [0.5, 0.7, 0.85, 1, 1.25];

type MapEntry = { snapshot: MapSnapshot; lastSeen: number };
type Toast = { kind: "ok" | "error" | "info"; text: string } | null;

export default function PaneApp({ env }: { env: OfficeEnv }) {
  const [maps, setMaps] = useState<Record<string, MapEntry>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [now, setNow] = useState(Date.now());
  const [keyDraft, setKeyDraft] = useState(getStoredVworldKey());
  const [showKey, setShowKey] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [crsOverride, setCrsOverride] = useState<string>("auto");
  const [busy, setBusy] = useState(false);
  const [bakeOpts, setBakeOpts] = useState<BakeOptions>({ vectors: true, basemap: true });
  const [baking, setBaking] = useState(false);
  const [diag, setDiag] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ png: string | null; svg: string | null; w: number; h: number } | null>(null);
  const pendingBake = useRef(new Map<string, (r: { ok: boolean; message: string; payload: BakePayload | null }) => void>());

  const busRef = useRef<Bus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  /* ---------- 버스 ---------- */
  useEffect(() => {
    const bus = createBus(`pane:${uid()}`, (msg: Msg) => {
      switch (msg.type) {
        case "map:state": {
          const s = msg.snapshot;
          setMaps((prev) => ({ ...prev, [s.mapId]: { snapshot: s, lastSeen: Date.now() } }));
          setSelectedId((cur) => cur ?? s.mapId);
          break;
        }
        case "map:bye":
          setMaps((prev) => {
            const next = { ...prev };
            delete next[msg.mapId];
            return next;
          });
          break;
        case "map:focus":
          setSelectedId(msg.mapId);
          break;
        case "map:result":
          if (msg.message) setToast({ kind: msg.ok ? "ok" : "info", text: msg.message });
          break;
        case "map:bakeData": {
          const resolve = pendingBake.current.get(msg.reqId);
          if (resolve) {
            pendingBake.current.delete(msg.reqId);
            resolve({ ok: msg.ok, message: msg.message, payload: msg.payload });
          }
          break;
        }
        default:
          break;
      }
    });
    busRef.current = bus;
    bus.send({ type: "pane:hello" });
    // 패널 시작 시 저장된 키를 지도들에 한 번 전파
    const k = getStoredVworldKey();
    if (k) bus.send({ type: "pane:config", vworldKey: k });
    const tick = setInterval(() => setNow(Date.now()), 2000);
    return () => {
      clearInterval(tick);
      bus.close();
      busRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 8000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const mapList = useMemo(
    () => Object.values(maps).sort((a, b) => a.snapshot.label.localeCompare(b.snapshot.label)),
    [maps],
  );
  const selected = selectedId ? maps[selectedId] : undefined;
  const sel = selected?.snapshot;
  const isAlive = (e: MapEntry) => now - e.lastSeen < STALE_MS;

  const send = useCallback(
    (cmd: MapCommand, mapId = selectedId) => {
      if (!mapId) {
        setToast({ kind: "error", text: "먼저 지도를 선택하세요." });
        return;
      }
      busRef.current?.send({ type: "pane:cmd", mapId, reqId: uid(), cmd });
    },
    [selectedId],
  );

  const patchSettings = (patch: Partial<MapSettings>) => send({ kind: "setSettings", patch });

  /* ---------- 파일 가져오기 (GeoJSON / SHP) ---------- */
  const addFiles = async (files: FileList | File[]) => {
    if (!selectedId) {
      setToast({ kind: "error", text: "레이어를 넣을 지도를 먼저 선택하세요." });
      return;
    }
    setBusy(true);
    try {
      const r = await importFiles(files, crsOverride === "auto" ? null : crsOverride);
      if (r.layers.length) {
        send({
          kind: "addLayers",
          layers: r.layers.map(({ id, name, data, bbox, featureCount }) => ({ id, name, data, bbox, featureCount })),
        });
      }
      const lines = r.layers.map(
        (l) => `✓ ${l.name} · ${l.featureCount.toLocaleString()}개 · ${l.crsLabel}${l.encoding ? ` · ${l.encoding.toUpperCase()}` : ""}`,
      );
      if (r.errors.length) setToast({ kind: "error", text: [...lines, ...r.errors.map((e) => `✗ ${e}`), ...r.warnings.map((w) => `⚠ ${w}`)].join("\n") });
      else if (r.warnings.length) setToast({ kind: "info", text: [...lines, ...r.warnings.map((w) => `⚠ ${w}`)].join("\n") });
      else if (lines.length) setToast({ kind: "ok", text: lines.join("\n") });
    } catch (e) {
      setToast({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

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
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };

  /* ---------- API 키 ---------- */
  const saveKey = () => {
    const k = keyDraft.trim();
    storeVworldKey(k);
    busRef.current?.send({ type: "pane:config", vworldKey: k });
    setToast({ kind: "ok", text: k ? "VWorld 키를 저장하고 모든 지도에 적용했습니다." : "키를 비웠습니다. (OSM 사용)" });
  };

  /* ---------- Bake ---------- */
  const bake = async () => {
    if (!selectedId) {
      setToast({ kind: "error", text: "정착할 지도를 선택하세요." });
      return;
    }
    if (!bakeOpts.vectors && !bakeOpts.basemap) {
      setToast({ kind: "error", text: "도형 또는 배경지도 중 하나 이상 선택하세요." });
      return;
    }
    setBaking(true);
    const log: string[] = [];
    try {
      // 1) 지도 박스에서 재료(SVG/PNG) 받기
      const reqId = uid();
      const res = await new Promise<{ ok: boolean; message: string; payload: BakePayload | null }>((resolve, reject) => {
        pendingBake.current.set(reqId, resolve);
        busRef.current?.send({ type: "pane:cmd", mapId: selectedId, reqId, cmd: { kind: "bake", options: bakeOpts } });
        setTimeout(() => {
          if (pendingBake.current.delete(reqId)) reject(new Error("지도 박스가 응답하지 않습니다. (20초) 지도 박스가 슬라이드에 보이는지 확인하세요."));
        }, 20000);
      });
      if (!res.ok || !res.payload) throw new Error(res.message || "지도에서 정착 데이터를 만들지 못했습니다.");
      const p = res.payload;
      log.push(`지도 ${p.widthPx}×${p.heightPx}px · 도형 ${p.featureCount}개 · 배경 ${p.png ? "캡처됨" : "없음"}`);
      p.notes.forEach((n) => log.push(`⚠ ${n}`));
      if (!p.svg && !p.png) throw new Error(["넣을 내용이 없습니다.", ...p.notes].join("\n"));
      setPreview({ png: p.png, svg: p.svg, w: p.widthPx, h: p.heightPx });
      if (!env.host) {
        // 브라우저 개발 모드: 재료 생성까지만 확인
        log.push(`SVG ${p.svg ? (p.svg.length / 1024).toFixed(1) + "KB" : "-"} · PNG ${p.png ? ((p.png.length * 0.75) / 1024).toFixed(0) + "KB" : "-"}`);
        setToast({ kind: "info", text: "브라우저 모드: 정착 데이터 생성까지 확인했습니다. 슬라이드 삽입은 PowerPoint 안에서 동작합니다." });
        return;
      }

      // 2) 지도 박스 위치 찾기
      const aspect = p.widthPx / p.heightPx;
      const det = await detectMapFrame(aspect);
      log.push(...det.diag);
      const frame = det.frame ?? fallbackFrame(aspect);
      log.push(`삽입 위치: ${frame.how} → left ${Math.round(frame.left)}, top ${Math.round(frame.top)}, ${Math.round(frame.width)}×${Math.round(frame.height)}pt`);

      // 3) 삽입 (배경 → 도형)
      const done = await insertBake(frame, p.png, p.svg);
      setToast({ kind: "ok", text: `슬라이드에 정착했습니다: ${done.join(" + ")}${det.frame ? "" : "\n지도 박스 위치를 찾지 못해 왼쪽 위에 넣었습니다."}` });
    } catch (e) {
      setToast({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setDiag(log);
      setBaking(false);
    }
  };

  return (
    <div
      className="relative flex h-screen flex-col bg-white text-sm text-foreground"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* ---------------- 헤더 ---------------- */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <MapIcon className="size-4 text-teal-700" />
          <h1 className="font-bold">Slide Map</h1>
        </div>
        <span className="text-xs text-muted-foreground">
          {env.host ? "PowerPoint" : "브라우저"} · 연결된 지도 {mapList.filter(isAlive).length}
        </span>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* ---------------- 지도 목록 ---------------- */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">지도</h2>
            <Button size="iconSm" variant="ghost" title="다시 찾기" onClick={() => busRef.current?.send({ type: "pane:hello" })}>
              <RefreshCw />
            </Button>
          </div>

          {mapList.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
              슬라이드에 지도 박스가 없습니다.
              <br />
              <b className="text-foreground">삽입 → 내 추가 기능 → 개발자 추가 기능 → Slide Map</b> 으로 지도를 넣으세요.
              <br />
              이미 넣었는데도 안 보이면 지도 박스를 한 번 클릭하세요.
            </div>
          ) : (
            <ul className="space-y-1">
              {mapList.map((e) => {
                const s = e.snapshot;
                const active = s.mapId === selectedId;
                return (
                  <li key={s.mapId}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(s.mapId)}
                      onKeyDown={(ev) => ev.key === "Enter" && setSelectedId(s.mapId)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left",
                        active ? "border-teal-600 bg-teal-50" : "border-border hover:bg-muted",
                      )}
                    >
                      <span className={cn("size-2 rounded-full", isAlive(e) ? "bg-emerald-500" : "bg-zinc-300")} />
                      <span className="flex-1 font-medium">{s.label}</span>
                      <span className="text-xs text-muted-foreground">레이어 {s.layers.length}</span>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        title="슬라이드에서 이 지도 표시"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          send({ kind: "identify" }, s.mapId);
                        }}
                      >
                        <Locate />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {sel && (
          <>
            {/* ---------------- 레이어 ---------------- */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">레이어 · {sel.label}</h2>
                {sel.layers.length > 0 && (
                  <button className="text-xs text-muted-foreground hover:underline" onClick={() => send({ kind: "zoomToAll" })}>
                    전체 보기
                  </button>
                )}
              </div>

              <button
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground transition-colors",
                  isDragging ? "border-sky-500 bg-sky-50 text-sky-700" : "border-border hover:bg-muted",
                )}
              >
                <FileUp className="size-5" />
                {busy ? "읽는 중…" : "GeoJSON · SHP 를 끌어다 놓거나 클릭해서 열기"}
                <span className="text-[10px]">SHP 는 .zip 또는 .shp+.dbf+.prj 를 함께 선택</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <label className="mt-2 flex items-center gap-2 text-xs">
                <span className="shrink-0 text-muted-foreground">입력 좌표계</span>
                <select
                  value={crsOverride}
                  onChange={(e) => setCrsOverride(e.target.value)}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-white px-1.5 text-xs"
                  title="자동: .prj / GeoJSON crs 정보로 판별. 정보가 없는 파일이면 직접 고르세요."
                >
                  <option value="auto">자동 감지 (.prj · crs)</option>
                  {[...new Set(CRS_LIST.map((c) => c.group))].map((g) => (
                    <optgroup key={g} label={g}>
                      {CRS_LIST.filter((c) => c.group === g).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              {sel.layers.length > 0 && (
                <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                  {sel.layers.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 px-2.5 py-1.5">
                      <button
                        title={l.visible ? "숨기기" : "보이기"}
                        onClick={() => send({ kind: "setVisible", layerId: l.id, visible: !l.visible })}
                        className={l.visible ? "text-foreground" : "text-zinc-300"}
                      >
                        {l.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                      </button>
                      <span className="inline-block size-3 shrink-0 rounded-sm" style={{ background: l.color, opacity: l.visible ? 1 : 0.3 }} />
                      <button
                        className={cn("min-w-0 flex-1 truncate text-left text-xs hover:underline", !l.visible && "text-muted-foreground")}
                        title={`${l.name} — 클릭해서 확대`}
                        onClick={() => send({ kind: "zoomToLayer", layerId: l.id })}
                      >
                        {l.name}
                      </button>
                      <span className="text-[11px] text-muted-foreground">{l.featureCount}</span>
                      <button
                        title="삭제"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => send({ kind: "removeLayer", layerId: l.id })}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---------------- 지도 설정 ---------------- */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">지도 설정</h2>

              <label className="block">
                <span className="mb-1 block text-xs">배경지도</span>
                <select
                  value={sel.settings.basemapId}
                  onChange={(e) => patchSettings({ basemapId: e.target.value })}
                  className="h-8 w-full rounded-md border border-border bg-white px-2 text-xs"
                >
                  {BASEMAP_META.map((b) => (
                    <option key={b.id} value={b.id} disabled={b.requiresKey && !getStoredVworldKey()}>
                      {b.label}
                      {b.requiresKey && !getStoredVworldKey() ? " (키 필요)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>지도 해상도 배율 (글자 크기)</span>
                  <b>{Math.round(sel.settings.tileScale * 100)}%</b>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={sel.settings.tileScale}
                  onChange={(e) => patchSettings({ tileScale: Number(e.target.value) })}
                  className="w-full accent-teal-700"
                />
                <div className="mt-1 flex gap-1">
                  {SCALE_PRESETS.map((v) => (
                    <button
                      key={v}
                      onClick={() => patchSettings({ tileScale: v })}
                      className={cn(
                        "flex-1 rounded border px-1 py-0.5 text-[11px]",
                        Math.abs(sel.settings.tileScale - v) < 0.001 ? "border-teal-600 bg-teal-50" : "border-border hover:bg-muted",
                      )}
                    >
                      {Math.round(v * 100)}%
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  줌과 별개로 배경지도 타일을 그리는 크기입니다. 낮추면 같은 범위에 더 상세한 지도가 작은 글자로 그려집니다.
                </p>
              </div>

              <label className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <Crosshair className="size-3.5" />
                  지도 위 십자 커서 표시
                </span>
                <input
                  type="checkbox"
                  checked={sel.settings.cursorAid}
                  onChange={(e) => patchSettings({ cursorAid: e.target.checked })}
                  className="accent-teal-700"
                />
              </label>
            </section>
          </>
        )}

        {/* ---------------- API 키 ---------------- */}
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <KeyRound className="size-3.5" />
            VWorld API 키
          </h2>
          <div className="flex gap-1.5">
            <input
              type={showKey ? "text" : "password"}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
              className="h-8 min-w-0 flex-1 rounded-md border border-border px-2 font-mono text-[11px]"
              spellCheck={false}
            />
            <Button size="iconSm" variant="outline" className="size-8" onClick={() => setShowKey((v) => !v)} title="표시/숨기기">
              {showKey ? <EyeOff /> : <Eye />}
            </Button>
            <Button size="sm" onClick={saveKey}>
              저장
            </Button>
          </div>
          {ENV_VWORLD_KEY && keyDraft === ENV_VWORLD_KEY && (
            <p className="text-[11px] text-muted-foreground">.env.local 의 기본 키를 사용 중입니다.</p>
          )}
        </section>
      </div>

      {/* ---------------- 하단 고정: Bake ---------------- */}
      <footer className="space-y-2 border-t border-border bg-white px-4 py-3">
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-teal-700"
              checked={bakeOpts.vectors}
              onChange={(e) => setBakeOpts((o) => ({ ...o, vectors: e.target.checked }))}
            />
            도형 (SVG)
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-teal-700"
              checked={bakeOpts.basemap}
              onChange={(e) => setBakeOpts((o) => ({ ...o, basemap: e.target.checked }))}
            />
            배경지도 (이미지)
          </label>
        </div>
        <Button
          size="lg"
          className="w-full"
          disabled={!sel || baking || (bakeOpts.vectors && !bakeOpts.basemap && sel.layers.length === 0)}
          onClick={() => void bake()}
          title={!sel ? "지도를 선택하세요" : "선택한 지도의 현재 화면을 슬라이드에 정착"}
        >
          <Stamp />
          {baking ? "정착 중…" : "도면 정착 (Bake to Slide)"}
        </Button>
        {diag.length > 0 && (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">마지막 정착 진단</summary>
            {preview && (
              <div
                className="relative mt-1 w-full overflow-hidden rounded border border-border bg-white"
                style={{ aspectRatio: `${preview.w} / ${preview.h}` }}
                data-testid="bake-preview"
              >
                {preview.png && <img alt="" src={`data:image/png;base64,${preview.png}`} className="absolute inset-0 h-full w-full" />}
                {preview.svg && (
                  <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`} className="absolute inset-0 h-full w-full" />
                )}
              </div>
            )}
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[10px]">{diag.join("\n")}</pre>
          </details>
        )}
      </footer>

      {/* ---------------- 토스트 ---------------- */}
      {toast && (
        <div
          className={cn(
            "absolute bottom-20 left-4 right-4 z-50 whitespace-pre-wrap rounded-md border px-3 py-2 text-xs shadow-md",
            toast.kind === "error" && "border-rose-200 bg-rose-50 text-rose-800",
            toast.kind === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-800",
            toast.kind === "info" && "border-border bg-white",
          )}
          onClick={() => setToast(null)}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
