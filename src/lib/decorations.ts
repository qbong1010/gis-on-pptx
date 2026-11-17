/**
 * 꾸미기 요소(방위표·축척·범례) — 순수 함수. 결과는 { svg, svgGraphic, texts, width, height } (px, 슬라이드 100% 기준)
 * 슬라이드에는 px × 0.75 = pt 크기로 들어간다.
 * 슬라이드에는 글자 없는 svgGraphic + 글자별 네이티브 텍스트 상자를 그룹으로 넣는다 (SVG <text> 는 "도형으로 변환" 때
 * PowerPoint 가 자체 여백·자동크기로 다시 만들어 글자가 밀리고 halo 가 번져 보이기 때문). 그래서 꾸미기 글자에는 halo 가 없다.
 * haloText 는 데이터 라벨 SVG(bake.ts) 에서만 쓴다.
 */
import { measureText } from "@/lib/labels";
import { escapeXml, markerSvg, type Resolved } from "@/lib/style";

/** 꾸미기 글자 한 줄. y = 글자 줄의 세로 "가운데"(px), x = anchor 기준 가로 위치(px) */
export type DecoText = { text: string; x: number; y: number; size: number; color: string; bold: boolean; anchor: "start" | "middle" | "end" };
/**
 * svg        : 글자 포함 (패널 미리보기·모의 슬라이드·네이티브 상자 미지원 시 대체용)
 * svgGraphic : 글자(<text>) 가 전혀 없는 도형만 — 슬라이드에는 이것 + texts 를 네이티브 텍스트 상자로 넣는다
 */
export type Deco = { svg: string; svgGraphic: string; texts: DecoText[]; width: number; height: number };

export const FONT = "Malgun Gothic, 맑은 고딕, sans-serif";

const r2 = (v: number) => Math.round(v * 100) / 100;
const wrap = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}">${body}</svg>`;

/** 미리보기용 글자: 슬라이드의 텍스트 상자(세로 가운데 맞춤)와 같은 위치가 되도록 dominant-baseline=central. halo 없음 */
function textSvg(t: DecoText): string {
  return `<text x="${r2(t.x)}" y="${r2(t.y)}" font-family="${FONT}" font-size="${r2(t.size)}" text-anchor="${t.anchor}" dominant-baseline="central" fill="${t.color}"${t.bold ? ' font-weight="bold"' : ""}>${escapeXml(t.text)}</text>`;
}
const T = (text: string, x: number, y: number, size: number, color: string, anchor: DecoText["anchor"] = "start", bold = false): DecoText => ({ text, x, y, size, color, bold, anchor });
function mk(w: number, h: number, gfx: string, texts: DecoText[]): Deco {
  return { svg: wrap(w, h, gfx + texts.map(textSvg).join("")), svgGraphic: wrap(w, h, gfx), texts, width: w, height: h };
}

/** 흰 외곽선(halo) 글자 (데이터 라벨 SVG 용): 외곽선 복사본 + 본 글자 */
export function haloText(
  text: string,
  x: number,
  y: number,
  o: { size: number; color: string; anchor?: "start" | "middle" | "end"; bold?: boolean; halo?: boolean },
): string {
  const common = `x="${r2(x)}" y="${r2(y)}" font-family="${FONT}" font-size="${r2(o.size)}" text-anchor="${o.anchor ?? "start"}"${o.bold ? ' font-weight="bold"' : ""}`;
  const t = escapeXml(text);
  const halo =
    o.halo === false
      ? ""
      : `<text ${common} fill="#ffffff" stroke="#ffffff" stroke-width="${r2(Math.max(2, o.size * 0.28))}" stroke-linejoin="round">${t}</text>`;
  return `${halo}<text ${common} fill="${o.color}">${t}</text>`;
}

/* ------------------------------------------------------------------ */
/* 위치                                                                 */
/* ------------------------------------------------------------------ */

export type Corner = "tl" | "tr" | "bl" | "br";
export type DecoPos = { corner: Corner; margin: number };

/** 프레임(W×H px) 안에서 꾸미기 요소(w×h)의 왼쪽 위 좌표 */
export function placeDeco(pos: DecoPos, w: number, h: number, W: number, H: number): { x: number; y: number } {
  const m = pos.margin;
  return {
    x: pos.corner === "tl" || pos.corner === "bl" ? m : W - w - m,
    y: pos.corner === "tl" || pos.corner === "tr" ? m : H - h - m,
  };
}

/* ------------------------------------------------------------------ */
/* 방위표                                                               */
/* ------------------------------------------------------------------ */

export type NorthPreset = "arrow" | "compass" | "n-circle" | "minimal";
export const NORTH_PRESETS: { id: NorthPreset; label: string }[] = [
  { id: "arrow", label: "화살표" },
  { id: "compass", label: "나침반" },
  { id: "n-circle", label: "N 원형" },
  { id: "minimal", label: "단순" },
];
export const NORTH_SIZES = { S: 40, M: 64, L: 96 } as const;

export function northArrowSvg(o: { preset: NorthPreset; size: number; color: string }): Deco {
  const s = o.size;
  const c = o.color;
  const fs = s * 0.26;
  switch (o.preset) {
    case "compass": {
      const cx = s / 2;
      const cy = s * 0.6;
      const R = s * 0.37;
      const star = (pts: [number, number][], fill: string) => `<path d="M${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L")}Z" fill="${fill}" stroke="${c}" stroke-width="${r2(s * 0.015)}" stroke-linejoin="round"/>`;
      const a = R * 0.28;
      const body =
        `<circle cx="${cx}" cy="${cy}" r="${r2(R)}" fill="#ffffff" fill-opacity="0.85" stroke="${c}" stroke-width="${r2(s * 0.02)}"/>` +
        star([[cx, cy - R * 0.92], [cx + a, cy], [cx, cy], [cx - a, cy]], c) +
        star([[cx, cy + R * 0.92], [cx + a, cy], [cx, cy], [cx - a, cy]], "#ffffff") +
        star([[cx + R * 0.92, cy], [cx, cy - a], [cx, cy], [cx, cy + a]], "#ffffff") +
        star([[cx - R * 0.92, cy], [cx, cy - a], [cx, cy], [cx, cy + a]], "#ffffff");
      return mk(s, s, body, [T("N", cx, s * 0.11, fs, c, "middle", true)]);
    }
    case "n-circle": {
      const cx = s / 2;
      const cy = s / 2;
      const R = s * 0.47;
      const body =
        `<circle cx="${cx}" cy="${cy}" r="${r2(R)}" fill="${c}"/>` +
        `<path d="M${cx} ${r2(s * 0.14)}L${r2(cx + s * 0.17)} ${r2(s * 0.56)}L${cx} ${r2(s * 0.47)}L${r2(cx - s * 0.17)} ${r2(s * 0.56)}Z" fill="#ffffff"/>`;
      return mk(s, s, body, [T("N", cx, s * 0.77, s * 0.26, "#ffffff", "middle", true)]);
    }
    case "minimal": {
      const w = s * 0.5;
      const cx = w / 2;
      const body =
        `<line x1="${cx}" y1="${r2(s * 0.34)}" x2="${cx}" y2="${s}" stroke="${c}" stroke-width="${r2(Math.max(1.2, s * 0.035))}" stroke-linecap="round"/>` +
        `<path d="M${cx} ${r2(s * 0.3)}L${r2(cx + w * 0.28)} ${r2(s * 0.5)}L${r2(cx - w * 0.28)} ${r2(s * 0.5)}Z" fill="${c}"/>`;
      return mk(w, s, body, [T("N", cx, fs * 0.6, fs, c, "middle", true)]);
    }
    default: {
      // 'arrow' — 왼쪽 반이 채워진 클래식 화살표
      const cx = s / 2;
      const top = s * 0.3;
      const bottom = s * 0.97;
      const half = s * 0.21;
      const mid = s * 0.78;
      const body =
        `<path d="M${cx} ${r2(top)}L${r2(cx - half)} ${r2(bottom)}L${cx} ${r2(mid)}Z" fill="${c}" stroke="${c}" stroke-width="${r2(s * 0.02)}" stroke-linejoin="round"/>` +
        `<path d="M${cx} ${r2(top)}L${r2(cx + half)} ${r2(bottom)}L${cx} ${r2(mid)}Z" fill="#ffffff" stroke="${c}" stroke-width="${r2(s * 0.02)}" stroke-linejoin="round"/>`;
      return mk(s, s, body, [T("N", cx, s * 0.15, fs, c, "middle", true)]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 축척                                                                 */
/* ------------------------------------------------------------------ */

export type ScalePreset = "line" | "bar" | "text";
export const SCALE_PRESETS: { id: ScalePreset; label: string }[] = [
  { id: "line", label: "선" },
  { id: "bar", label: "막대" },
  { id: "text", label: "1:n 문자" },
];

/** 1·2·5 × 10^n 중 max 이하 최대값 */
export function niceLength(maxMeters: number): number {
  if (!(maxMeters > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(maxMeters)));
  const f = maxMeters / p;
  const n = f >= 5 ? 5 : f >= 2 ? 2 : 1;
  return n * p;
}

export function formatLength(m: number): string {
  if (m >= 1000) {
    const km = m / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${m < 1 ? m.toFixed(1) : Math.round(m)} m`;
}

/** 슬라이드를 100% 로 인쇄한다고 가정한 분모 (1px = 0.75pt = 0.2646mm) */
export function scaleDenominator(metersPerPx: number): number {
  const printed = 0.0254 / 96; // m per px
  const raw = metersPerPx / printed;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - f) < Math.abs(best - f)) best = s;
  return Math.round(best * p);
}

export function scaleBarSvg(o: { preset: ScalePreset; color: string; metersPerPx: number; targetPx: number; fontSize?: number }): Deco {
  const fs = o.fontSize ?? 12;
  const c = o.color;
  if (o.preset === "text") {
    const label = `1:${scaleDenominator(o.metersPerPx).toLocaleString("en-US")}`;
    const w = measureText(label, fs + 1, true) + 4;
    const h = fs + 8;
    return mk(w, h, "", [T(label, w / 2, h - 5 - 0.35 * (fs + 1), fs + 1, c, "middle", true)]);
  }
  const meters = niceLength(o.targetPx * o.metersPerPx);
  const len = Math.max(8, meters / o.metersPerPx);
  const padX = 18;
  const w = len + padX * 2;
  const x0 = padX;
  const tick = 7;
  if (o.preset === "bar") {
    const barH = 6;
    const top = fs + 4;
    const h = top + barH + 3;
    const half = len / 2;
    const sw = 1;
    const body =
      `<rect x="${x0}" y="${top}" width="${r2(half)}" height="${barH}" fill="${c}" stroke="${c}" stroke-width="${sw}"/>` +
      `<rect x="${r2(x0 + half)}" y="${top}" width="${r2(half)}" height="${barH}" fill="#ffffff" stroke="${c}" stroke-width="${sw}"/>`;
    const ty = top - 3 - 0.45 * fs;
    return mk(w, h, body, [
      T("0", x0, ty, fs, c, "middle"),
      T(formatLength(meters / 2).replace(" m", "").replace(" km", ""), x0 + half, ty, fs, c, "middle"),
      T(formatLength(meters), x0 + len, ty, fs, c, "middle"),
    ]);
  }
  // 'line' — 양끝 눈금이 있는 선
  const top = fs + 4;
  const h = top + tick + 2;
  const sw = 1.5;
  const body =
    `<path d="M${x0} ${top}V${top + tick}H${r2(x0 + len)}V${top}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="miter"/>`;
  const ty = top - 3 - 0.45 * fs;
  return mk(w, h, body, [T("0", x0, ty, fs, c, "middle"), T(formatLength(meters), x0 + len, ty, fs, c, "middle")]);
}

/* ------------------------------------------------------------------ */
/* 범례                                                                 */
/* ------------------------------------------------------------------ */

export type LegendPreset = "box" | "plain";
export const LEGEND_PRESETS: { id: LegendPreset; label: string }[] = [
  { id: "box", label: "박스" },
  { id: "plain", label: "배경 없음" },
];

export type LegendItem = { label: string; kind: "polygon" | "line" | "point"; style: Resolved };

export function legendSvg(o: { preset: LegendPreset; title: string; items: LegendItem[]; color?: string; fontSize?: number }): Deco | null {
  if (!o.items.length) return null;
  const fs = o.fontSize ?? 12;
  const color = o.color ?? "#111827";
  const pad = o.preset === "box" ? 10 : 2;
  const sw = 26; // 견본 폭
  const rowH = fs + 8;
  const titleH = o.title ? fs + 10 : 0;
  let maxText = o.title ? measureText(o.title, fs + 1, true) : 0;
  for (const it of o.items) maxText = Math.max(maxText, sw + 8 + measureText(it.label, fs));
  const w = Math.ceil(maxText + pad * 2 + 2);
  const h = Math.ceil(pad * 2 + titleH + o.items.length * rowH - 2);
  let body = o.preset === "box" ? `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#ffffff" fill-opacity="0.92" stroke="#6b7280" stroke-width="1"/>` : "";
  const texts: DecoText[] = [];
  let y = pad;
  if (o.title) {
    texts.push(T(o.title, pad, y + fs + 0.5 - 0.35 * (fs + 1), fs + 1, color, "start", true));
    y += titleH;
  }
  for (const it of o.items) {
    const cy = y + rowH / 2 - 1;
    const st = it.style;
    if (it.kind === "polygon") {
      const fill = st.fill ? `fill="${st.fill}" fill-opacity="${st.fillOpacity}"` : 'fill="none"';
      const stroke = `stroke="${st.stroke}" stroke-opacity="${st.strokeOpacity}" stroke-width="${Math.min(st.strokeWidth, 3)}"${st.dashArray ? ` stroke-dasharray="${st.dashArray}"` : ""}`;
      body += `<rect x="${pad + 1}" y="${r2(cy - 6)}" width="${sw - 2}" height="12" ${fill} ${stroke}/>`;
    } else if (it.kind === "line") {
      body += `<line x1="${pad}" y1="${r2(cy)}" x2="${pad + sw}" y2="${r2(cy)}" stroke="${st.stroke}" stroke-opacity="${st.strokeOpacity}" stroke-width="${Math.min(st.strokeWidth, 6)}"${st.dashArray ? ` stroke-dasharray="${st.dashArray}"` : ""} stroke-linecap="${st.cap}"/>`;
    } else {
      body += markerSvg({ ...st, radius: Math.min(st.radius, 7) }, pad + sw / 2, cy);
    }
    texts.push(T(it.label, pad + sw + 8, cy, fs, color));
    y += rowH;
  }
  return mk(w, h, body, texts);
}
