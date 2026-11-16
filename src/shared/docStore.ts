/**
 * 문서 저장소 (v2) — docs/ARCHITECTURE.md §4
 *  - PowerPoint: Office.context.document.settings (pptx 와 함께 이동)
 *      slidemap.index = { order: string[] }, slidemap.map.<id> = MapDoc, slidemap.layer.<layerId> = FeatureCollection
 *  - 브라우저: localStorage (접두어 `slidemap:dev:`)
 *  - 전체 JSON 크기를 추적하고 8MB 초과 시 경고 (문서 settings 용량 한도는 [확인 필요])
 */
import type { FeatureCollection } from "geojson";

import { diag } from "@/pane/diag";
import type { MapDoc } from "@/pane/model";

export const SIZE_WARN_BYTES = 8 * 1024 * 1024;
const LS_PREFIX = "slidemap:dev:";
const KEY_INDEX = "slidemap.index";
const keyMap = (id: string) => `slidemap.map.${id}`;
const keyLayer = (id: string) => `slidemap.layer.${id}`;

type Backend = {
  kind: "office" | "browser";
  keys(): string[];
  get(key: string): unknown;
  set(key: string, v: unknown): void;
  remove(key: string): void;
  flush(): Promise<void>;
};

function officeBackend(): Backend {
  const settings = Office.context.document.settings;
  // 알려진 키만 읽을 수 있다 (settings 는 키 열거 API 가 없음) → index 에서 키를 유도한다
  const known = new Set<string>();
  return {
    kind: "office",
    keys: () => [...known],
    get: (k) => {
      known.add(k);
      return settings.get(k);
    },
    set: (k, v) => {
      known.add(k);
      settings.set(k, v);
    },
    remove: (k) => {
      known.delete(k);
      settings.remove(k);
    },
    flush: () =>
      new Promise((resolve, reject) =>
        settings.saveAsync((r) => (r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(`${r.error.code} ${r.error.message}`)))),
      ),
  };
}

function browserBackend(): Backend {
  return {
    kind: "browser",
    keys: () => {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length));
      }
      return out;
    },
    get: (k) => {
      try {
        const s = localStorage.getItem(LS_PREFIX + k);
        return s === null ? undefined : JSON.parse(s);
      } catch {
        return undefined;
      }
    },
    set: (k, v) => localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)),
    remove: (k) => localStorage.removeItem(LS_PREFIX + k),
    flush: async () => {},
  };
}

/** 좌표 소수 7자리로 줄여 용량 절감 */
function roundCoords(c: unknown): unknown {
  if (typeof c === "number") return Math.round(c * 1e7) / 1e7;
  if (Array.isArray(c)) return c.map(roundCoords);
  return c;
}
export function compactFc(fc: FeatureCollection): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      geometry: f.geometry ? ({ ...f.geometry, coordinates: roundCoords((f.geometry as { coordinates?: unknown }).coordinates) } as typeof f.geometry) : f.geometry,
    })),
  };
}

export type DocStore = {
  kind: "office" | "browser";
  listMaps(): MapDoc[];
  saveMap(doc: MapDoc): void;
  deleteMap(doc: MapDoc): void;
  getLayer(id: string): FeatureCollection | null;
  saveLayer(id: string, fc: FeatureCollection): void;
  deleteLayer(id: string): void;
  totalBytes(): number;
  onStatus(cb: (s: { saving: boolean; error: string | null; bytes: number }) => void): () => void;
};

export function createDocStore(inOffice: boolean, normalize: (raw: Partial<MapDoc> & { id: string }) => MapDoc): DocStore {
  let be: Backend;
  try {
    be = inOffice ? officeBackend() : browserBackend();
  } catch (e) {
    diag(`문서 저장소 초기화 실패 → 브라우저 저장소 사용: ${e instanceof Error ? e.message : e}`, "error");
    be = browserBackend();
  }

  const sizes = new Map<string, number>();
  const dirty = new Set<string>();
  const removed = new Set<string>();
  const layerCache = new Map<string, FeatureCollection>();
  let order: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(s: { saving: boolean; error: string | null; bytes: number }) => void>();
  const bytes = () => [...sizes.values()].reduce((a, b) => a + b, 0);
  const emit = (saving: boolean, error: string | null) => listeners.forEach((l) => l({ saving, error, bytes: bytes() }));

  const idx = be.get(KEY_INDEX) as { order?: string[] } | undefined;
  order = idx?.order ?? (be.kind === "browser" ? be.keys().filter((k) => k.startsWith("slidemap.map.")).map((k) => k.slice("slidemap.map.".length)) : []);

  const cache = new Map<string, unknown>();

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 600);
  };
  async function flush() {
    timer = null;
    emit(true, null);
    try {
      for (const k of removed) be.remove(k);
      removed.clear();
      for (const k of dirty) {
        const v = k === KEY_INDEX ? { order } : cache.get(k);
        if (v !== undefined) be.set(k, v);
      }
      dirty.clear();
      await be.flush();
      emit(false, null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      diag(`문서 저장 실패: ${msg}`, "error");
      emit(false, msg);
    }
  }
  const put = (key: string, value: unknown) => {
    cache.set(key, value);
    sizes.set(key, JSON.stringify(value).length);
    dirty.add(key);
    removed.delete(key);
    schedule();
  };
  const del = (key: string) => {
    cache.delete(key);
    sizes.delete(key);
    dirty.delete(key);
    removed.add(key);
    schedule();
  };

  // 초기 로드
  const maps: MapDoc[] = [];
  for (const id of order) {
    const raw = be.get(keyMap(id)) as (Partial<MapDoc> & { id: string }) | undefined;
    if (!raw) continue;
    const doc = normalize({ ...raw, id });
    maps.push(doc);
    cache.set(keyMap(id), doc);
    sizes.set(keyMap(id), JSON.stringify(doc).length);
    for (const l of doc.layers) {
      const fc = be.get(keyLayer(l.id)) as FeatureCollection | undefined;
      if (fc) {
        layerCache.set(l.id, fc);
        sizes.set(keyLayer(l.id), JSON.stringify(fc).length);
        cache.set(keyLayer(l.id), fc);
      }
    }
  }
  order = maps.map((m) => m.id);

  // 페이지 닫기 직전 즉시 저장
  if (typeof window !== "undefined") window.addEventListener("pagehide", () => timer && void flush());

  return {
    kind: be.kind,
    listMaps: () => maps.slice(),
    saveMap(doc) {
      if (!order.includes(doc.id)) {
        order.push(doc.id);
        dirty.add(KEY_INDEX);
      }
      put(keyMap(doc.id), doc);
    },
    deleteMap(doc) {
      order = order.filter((i) => i !== doc.id);
      dirty.add(KEY_INDEX);
      del(keyMap(doc.id));
      for (const l of doc.layers) {
        layerCache.delete(l.id);
        del(keyLayer(l.id));
      }
      schedule();
    },
    getLayer: (id) => layerCache.get(id) ?? null,
    saveLayer(id, fc) {
      const c = compactFc(fc);
      layerCache.set(id, c);
      put(keyLayer(id), c);
    },
    deleteLayer(id) {
      layerCache.delete(id);
      del(keyLayer(id));
    },
    totalBytes: bytes,
    onStatus(cb) {
      listeners.add(cb);
      cb({ saving: false, error: null, bytes: bytes() });
      return () => listeners.delete(cb);
    },
  };
}
