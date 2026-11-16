/** 꾸미기 요소 생성 — 미리보기 오버레이와 Bake 가 같은 결과를 쓴다 */
import type L from "leaflet";

import { metersPerPx, type BakeLayer } from "@/lib/bake";
import { legendSvg, northArrowSvg, placeDeco, scaleBarSvg, type Deco, type LegendItem } from "@/lib/decorations";
import { buildCategories, resolveStyle, type GeomKind } from "@/lib/style";
import type { DecoSettings } from "@/pane/model";

export type PlacedDeco = Deco & { x: number; y: number };
export type Decos = { north: PlacedDeco | null; scale: PlacedDeco | null; legend: PlacedDeco | null; metersPerPx: number };

/** 범례 항목: 위에 그려지는 레이어가 먼저. 분류 색상 레이어는 값별로 풀어서 표시 */
export function legendItemsFor(layers: BakeLayer[]): LegendItem[] {
  const items: LegendItem[] = [];
  for (const l of [...layers].reverse()) {
    const kind: GeomKind = l.kind && l.kind !== "mixed" ? l.kind : "polygon";
    const cats = buildCategories(l.data, l.style);
    if (cats && l.style.categoryField) {
      for (const c of cats.items) {
        items.push({ label: c.value, kind, style: resolveStyle(l.style, kind, { [l.style.categoryField]: c.value }, cats) });
      }
      if (cats.hasOther) items.push({ label: "기타", kind, style: resolveStyle(l.style, kind, { [l.style.categoryField]: "\u0000" }, cats) });
    } else {
      items.push({ label: l.name, kind, style: resolveStyle(l.style, kind) });
    }
  }
  return items;
}

export function buildDecos(map: L.Map, deco: DecoSettings, layers: BakeLayer[], W: number, H: number): Decos {
  const mpp = metersPerPx(map);
  const put = (d: Deco | null, pos: DecoSettings["north"]["pos"]): PlacedDeco | null => {
    if (!d) return null;
    const { x, y } = placeDeco(pos, d.width, d.height, W, H);
    return { ...d, x, y };
  };
  const north = deco.north.show ? put(northArrowSvg({ preset: deco.north.preset, size: deco.north.size, color: deco.north.color }), deco.north.pos) : null;
  const scale =
    deco.scale.show && Number.isFinite(mpp) && mpp > 0
      ? put(scaleBarSvg({ preset: deco.scale.preset, color: deco.scale.color, metersPerPx: mpp, targetPx: Math.min(180, W * 0.2) }), deco.scale.pos)
      : null;
  const legend = deco.legend.show ? put(legendSvg({ preset: deco.legend.preset, title: deco.legend.title, items: legendItemsFor(layers) }), deco.legend.pos) : null;
  return { north, scale, legend, metersPerPx: mpp };
}
