/**
 * 슬라이드에 반영 (docs/ARCHITECTURE.md §5)
 *  1) inspectSlide : 현재 슬라이드에서 이 지도의 객체를 수집, 프레임 변경 감지, 사용자가 옮긴 꾸미기 위치 기억
 *  2) runBake      : 재료 생성 → 새 객체 삽입(태그/이름) → 성공 후 기존 객체 삭제 (실패 시 기존 유지)
 *  z 순서(아래→위): 배경지도 → 레이어 SVG → 라벨 → 범례 → 축척 → 방위표
 */
import type L from "leaflet";

import { placeVectorLabels, vectorBasemapToSvg, type VectorBasemapData, type VectorStyleId } from "@/lib/vectorBasemap";

import { captureBasemapV2, makeProjector, labelsSvgBody, layerSvgBody, placeDataLabels, svgDoc, type BakeLayer } from "@/lib/bake";
import type { PlacedLabel } from "@/lib/labels";
import { diag } from "@/pane/diag";
import { buildDecos } from "@/pane/decorate";
import type { Frame, MapDoc } from "@/pane/model";
import { TAG_MAP, TAG_PART, TAG_VER, type SlideAdapter, type SlideShape } from "@/pane/slide";

const r2 = (v: number) => Math.round(v * 100) / 100;
const MOVABLE = ["north", "scale", "legend"] as const;

export type Inspect = {
  /** 삭제 대상(이 지도의 기존 객체 + 묶음 해제로 풀린 자식) */
  oldIds: string[];
  newFrame: Frame | null;
  kept: Partial<Record<(typeof MOVABLE)[number], { left: number; top: number }>>;
  found: number;
  ungrouped: boolean;
};

const differs = (a: Frame, b: Frame) =>
  Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5 || Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5;

export async function inspectSlide(adapter: SlideAdapter, doc: MapDoc): Promise<Inspect> {
  let shapes = await adapter.listShapes();
  let mine = shapes.filter((s) => s.mapId === doc.id);
  const extra: string[] = [];
  let ungrouped = false;
  const groups = mine.filter((s) => s.part === "group");
  if (groups.length) {
    if (adapter.ungroup) {
      for (const g of groups) {
        try {
          extra.push(...(await adapter.ungroup(g.id)));
          ungrouped = true;
        } catch (e) {
          diag(`묶음 해제 실패(${g.name}): ${e instanceof Error ? e.message : e}`, "warn");
        }
      }
      shapes = await adapter.listShapes();
      mine = shapes.filter((s) => s.mapId === doc.id);
    }
    diag(`묶음 ${groups.length}개 감지 → 해제 ${ungrouped ? "성공" : "불가(그룹째 교체)"}; 해제 후 태그된 객체 ${mine.length}개`);
  }
  const base = mine.find((s) => s.part === "basemap");
  const rect = (s: SlideShape): Frame => ({ left: s.left, top: s.top, width: s.width, height: s.height });
  let newFrame: Frame | null = null;
  if (base && differs(rect(base), doc.frame)) {
    newFrame = { left: r2(base.left), top: r2(base.top), width: r2(base.width), height: r2(base.height) };
    diag(`프레임 변경 감지: ${JSON.stringify(doc.frame)} → ${JSON.stringify(newFrame)}`);
  }
  const kept: Inspect["kept"] = {};
  for (const p of MOVABLE) {
    const s = mine.find((x) => x.part === p);
    if (s) kept[p] = { left: s.left, top: s.top };
  }
  const oldIds = [...new Set([...mine.map((s) => s.id), ...extra.filter((id) => !mine.some((m) => m.id === id))])];
  // 묶음을 해제하지 못한 경우: 그룹 자체를 삭제 대상으로 (mine 에 이미 포함)
  return { oldIds, newFrame, kept, found: mine.length, ungrouped };
}

export type BakeParams = {
  adapter: SlideAdapter;
  doc: MapDoc;
  map: L.Map;
  W: number;
  H: number;
  /** 아래 → 위, 보이는 레이어만 */
  layers: BakeLayer[];
  insp: Inspect;
  /** 배경지도만 (지도 추가 직후 자리표시용) */
  placeholder?: boolean;
  basemapIsRaster: boolean;
  /** 벡터 배경지도일 때 */
  vector?: { data: VectorBasemapData | null; styleId: VectorStyleId };
};

export type BakeResult = { inserted: number; parts: string[]; notes: string[]; ms: number };

type Part =
  | { kind: "png"; part: string; label: string; data: string; frame: Frame }
  | { kind: "svg"; part: string; label: string; data: string; frame: Frame }
  | { kind: "text"; part: string; label: string; text: string; frame: Frame; style: Parameters<SlideAdapter["addTextBox"]>[2] };

export async function runBake(p: BakeParams): Promise<BakeResult> {
  const t0 = Date.now();
  const { adapter, doc, map, W, H, layers, insp } = p;
  const notes: string[] = [];
  const f = doc.frame;
  const kx = f.width / W;
  const ky = f.height / H;
  const opt = p.placeholder ? { ...doc.bake, shapes: false, labels: false, basemap: true } : doc.bake;
  const showDeco = p.placeholder ? { north: false, scale: false, legend: false } : { north: doc.deco.north.show, scale: doc.deco.scale.show, legend: doc.deco.legend.show };
  const parts: Part[] = [];
  const frameFor = (x: number, y: number, w: number, h: number): Frame => ({ left: r2(f.left + x * kx), top: r2(f.top + y * ky), width: r2(w * kx), height: r2(h * ky) });
  const full: Frame = { left: f.left, top: f.top, width: f.width, height: f.height };

  // 1) 배경지도
  if (opt.basemap && p.vector && adapter.caps.svg) {
    if (!p.vector.data) notes.push("벡터 배경지도 데이터가 아직 없습니다(네트워크 확인).");
    else {
      const proj = makeProjector(map);
      const nativeLabels = opt.basemapLabelsNative && adapter.caps.textBox;
      const svg = vectorBasemapToSvg(p.vector.data, proj, { width: W, height: H }, p.vector.styleId, { includeLabels: !nativeLabels, background: true });
      parts.push({ kind: "svg", part: "basemap", label: "배경지도", data: svg, frame: full });
      if (nativeLabels) {
        const vl = placeVectorLabels(p.vector.data, proj, p.vector.styleId, { width: W, height: H }, 90).slice(0, 90);
        for (const l of vl) {
          parts.push({
            kind: "text",
            part: "basemap-label",
            label: `지도글자 · ${l.text}`.slice(0, 40),
            text: l.text,
            frame: frameFor(l.box.left, l.box.top, l.box.width + 2, l.box.height),
            style: {
              fontSizePt: r2(l.fontSize * 0.75),
              color: l.color ?? "#111827",
              bold: !!l.bold,
              fontName: "Malgun Gothic",
              align: l.anchor === "right" ? "Left" : "Center",
              rotation: l.angle ? r2(l.angle) : undefined,
            },
          });
        }
        notes.push(`배경지도 글자 ${vl.length}개 (텍스트 상자)`);
      }
    }
  } else if (opt.basemap && !p.vector) {
    const cap = await captureBasemapV2(map, 2);
    if (p.basemapIsRaster && cap.tiles === 0) notes.push("배경지도 타일이 로드되지 않았습니다(네트워크/API 키 확인). 흰 배경으로 삽입합니다.");
    parts.push({ kind: "png", part: "basemap", label: "배경지도", data: cap.png, frame: full });
  }

  // 2) 도형 SVG
  if (opt.shapes) {
    if (!adapter.caps.svg) notes.push("SVG 삽입을 지원하지 않아 도형을 건너뜁니다.");
    else if (opt.split) {
      for (const l of layers) {
        const { body, count } = layerSvgBody(map, l);
        if (count > 0 && body) parts.push({ kind: "svg", part: `layer:${l.id}`, label: l.name, data: svgDoc(W, H, body), frame: full });
        else notes.push(`"${l.name}": 현재 화면 범위에 도형이 없어 건너뜁니다.`);
      }
    } else {
      const bodies = layers.map((l) => layerSvgBody(map, l).body).filter(Boolean);
      if (bodies.length) parts.push({ kind: "svg", part: "layer:all", label: "도형", data: svgDoc(W, H, bodies.join("")), frame: full });
      else notes.push("현재 화면 범위에 도형이 없습니다.");
    }
  }

  // 3) 라벨
  if (opt.labels && layers.some((l) => l.style.label.field)) {
    const placed = placeDataLabels(map, layers, W, H);
    const byLayer = new Map(layers.map((l) => [`data:${l.id}`, l]));
    const nativeOk = adapter.caps.textBox;
    const svgLabels: PlacedLabel[] = [];
    const native: PlacedLabel[] = [];
    for (const pl of placed) {
      const l = byLayer.get(pl.kind ?? "");
      if (l?.style.label.native && nativeOk) native.push(pl);
      else svgLabels.push(pl);
    }
    if (layers.some((l) => l.style.label.native) && !nativeOk) notes.push("네이티브 텍스트 상자 미지원(PowerPointApi 1.4) → 라벨을 SVG 로 삽입합니다.");
    if (svgLabels.length && adapter.caps.svg) parts.push({ kind: "svg", part: "labels", label: "라벨", data: svgDoc(W, H, labelsSvgBody(svgLabels)), frame: full });
    for (const pl of native) {
      const b = pl.box;
      const left = pl.anchor === "right";
      parts.push({
        kind: "text",
        part: "label",
        label: `라벨 · ${pl.text}`.slice(0, 40),
        text: pl.text,
        frame: frameFor(b.left, b.top, b.width + 2, b.height),
        style: { fontSizePt: r2(pl.fontSize * 0.75), color: pl.color ?? "#111827", bold: !!pl.bold, fontName: "Malgun Gothic", align: left ? "Left" : "Center" },
      });
    }
    notes.push(`라벨 ${placed.length}개 (네이티브 ${native.length}, SVG ${svgLabels.length})`);
  }

  // 4) 범례·축척·방위표 (사용자가 옮겨 둔 위치는 유지)
  const decos = buildDecos(map, { ...doc.deco, north: { ...doc.deco.north, show: showDeco.north }, scale: { ...doc.deco.scale, show: showDeco.scale }, legend: { ...doc.deco.legend, show: showDeco.legend } }, layers, W, H);
  for (const name of ["legend", "scale", "north"] as const) {
    const d = decos[name];
    if (!d) continue;
    if (!adapter.caps.svg) {
      notes.push("SVG 미지원 → 꾸미기 요소 건너뜀");
      break;
    }
    const fr = frameFor(d.x, d.y, d.width, d.height);
    const keep = insp.kept[name];
    if (keep) {
      fr.left = r2(keep.left);
      fr.top = r2(keep.top);
    }
    parts.push({ kind: "svg", part: name, label: { legend: "범례", scale: "축척", north: "방위표" }[name], data: d.svg, frame: fr });
  }
  if (doc.deco.legend.show && !p.placeholder && !decos.legend) notes.push("범례에 표시할 레이어가 없습니다.");

  // 5) 삽입 (새 것 먼저 → 성공하면 기존 삭제)
  const inserted: string[] = [];
  const insertedParts: string[] = [];
  const tagsFor = (part: string) => ({ [TAG_MAP]: doc.id, [TAG_PART]: part, [TAG_VER]: "2" });
  try {
    let batch: Extract<Part, { kind: "text" }>[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const items = batch.map((b) => ({ text: b.text, box: b.frame, style: b.style, tags: tagsFor(b.part), name: `SlideMap · ${doc.name} · ${b.label}` }));
      let ids: string[] = [];
      if (adapter.addTextBoxes) ids = await adapter.addTextBoxes(items);
      else for (const it of items) ids.push(await adapter.addTextBox(it.text, it.box, it.style, { tags: it.tags, name: it.name }));
      inserted.push(...ids);
      insertedParts.push(...batch.map((b) => b.part));
      batch = [];
    };
    for (const pt of parts) {
      if (pt.kind === "text") {
        batch.push(pt);
        continue;
      }
      await flush();
      const name = `SlideMap · ${doc.name} · ${pt.label}`;
      let id: string;
      if (pt.kind === "png") {
        id = await adapter.insertImage(pt.data, pt.frame);
        await adapter.tagShape(id, tagsFor(pt.part), name);
      } else if (pt.kind === "svg") {
        id = await adapter.insertSvg(pt.data, pt.frame);
        await adapter.tagShape(id, tagsFor(pt.part), name);
      } else {
        continue;
      }
      inserted.push(id);
      insertedParts.push(pt.part);
    }
    await flush();
  } catch (e) {
    diag(`삽입 실패 → 새로 넣은 ${inserted.length}개 되돌림: ${e instanceof Error ? e.message : e}`, "error");
    try {
      await adapter.deleteShapes(inserted);
    } catch {
      /* ignore */
    }
    throw e;
  }
  if (insp.oldIds.length) await adapter.deleteShapes(insp.oldIds);

  // 6) 묶기
  if (opt.group && !p.placeholder) {
    if (adapter.group && adapter.caps.group && inserted.length > 1) {
      try {
        const gid = await adapter.group(inserted, `SlideMap · ${doc.name}`);
        await adapter.tagShape(gid, tagsFor("group"), `SlideMap · ${doc.name}`);
        notes.push("하나로 묶음");
      } catch (e) {
        notes.push(`묶기 실패: ${e instanceof Error ? e.message : e}`);
        diag(`묶기 실패: ${e instanceof Error ? e.message : e}`, "warn");
      }
    } else notes.push("묶기를 지원하지 않습니다(PowerPointApi 1.8).");
  }

  const ms = Date.now() - t0;
  diag(`반영 완료: ${inserted.length}개 삽입, ${insp.oldIds.length}개 교체, ${ms}ms`);
  return { inserted: inserted.length, parts: insertedParts, notes, ms };
}
