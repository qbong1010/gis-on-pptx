/**
 * 꾸미기 요소(방위표·축척·범례) — 순수 함수. 결과는 { svg, width, height } (px, 슬라이드 100% 기준)
 * 슬라이드에는 px × 0.75 = pt 크기로 들어간다.
 * 텍스트 외곽선(halo)은 PowerPoint 의 SVG 변환이 paint-order 를 지원하는지 불확실하므로 [확인 필요]
 * "흰 외곽선 글자 + 본 글자" 두 장을 겹치는 방식으로 만든다.
 */
import { measureText } from "@/lib/labels";
import { escapeXml, markerSvg, type Resolved } from "@/lib/style";

export type Deco = { svg: string; width: number; height: number };

export const FONT = "Malgun Gothic, 맑은 고딕, sans-serif";

const r2 = (v: number) => Math.round(v * 100) / 100;
const wrap = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}">${body}</svg>`;

/** 흰 외곽선(halo) 글자: 외곽선 복사본 + 본 글자 */
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
      const cy = s * 0.56;
      const R = s * 0.4;
      const star = (pts: [number, number][], fill: string) => `<path d="M${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L")}Z" fill="${fill}" stroke="${c}" stroke-width="${r2(s * 0.015)}" stroke-linejoin="round"/>`;
      const a = R * 0.28;
      const body =
        `<circle cx="${cx}" cy="${cy}" r="${r2(R)}" fill="#ffffff" fill-opacity="0.85" stroke="${c}" stroke-width="${r2(s * 0.02)}"/>` +
        star([[cx, cy - R * 0.92], [cx + a, cy], [cx, cy], [cx - a, cy]], c) +
        star([[cx, cy + R * 0.92], [cx + a, cy], [cx, cy], [cx - a, cy]], "#ffffff") +
        star([[cx + R * 0.92, cy], [cx, cy - a], [cx, cy], [cx, cy + a]], "#ffffff") +
        star([[cx - R * 0.92, cy], [cx, cy - a], [cx, cy], [cx, cy + a]], "#ffffff") +
        haloText("N", cx, s * 0.2, { size: fs, color: c, anchor: "middle", bold: true });
      return { svg: wrap(s, s, body), width: s, height: s };
    }
    case "n-circle": {
      const cx = s / 2;
      const cy = s / 2;
      const R = s * 0.47;
      const body =
        `<circle cx="${cx}" cy="${cy}" r="${r2(R)}" fill="${c}"/>` +
        `<path d="M${cx} ${r2(s * 0.14)}L${r2(cx + s * 0.17)} ${r2(s * 0.56)}L${cx} ${r2(s * 0.47)}L${r2(cx - s * 0.17)} ${r2(s * 0.56)}Z" fill="#ffffff"/>` +
        `<text x="${cx}" y="${r2(s * 0.86)}" font-family="${FONT}" font-size="${r2(s * 0.26)}" font-weight="bold" text-anchor="middle" fill="#ffffff">N</text>`;
      return { svg: wrap(s, s, body), width: s, height: s };
    }
    case "minimal": {
      const w = s * 0.5;
      const cx = w / 2;
      const body =
        haloText("N", cx, fs, { size: fs, color: c, anchor: "middle", bold: true }) +
        `<line x1="${cx}" y1="${r2(s * 0.34)}" x2="${cx}" y2="${s}" stroke="${c}" stroke-width="${r2(Math.max(1.2, s * 0.035))}" stroke-linecap="round"/>` +
        `<path d="M${cx} ${r2(s * 0.3)}L${r2(cx + w * 0.28)} ${r2(s * 0.5)}L${r2(cx - w * 0.28)} ${r2(s * 0.5)}Z" fill="${c}"/>`;
      return { svg: wrap(w, s, body), width: w, height: s };
    }
    default: {
      // 'arrow' — 왼쪽 반이 채워진 클래식 화살표
      const cx = s / 2;
      const top = s * 0.3;
      const bottom = s * 0.97;
      const half = s * 0.21;
      const mid = s * 0.78;
      const body =
        haloText("N", cx, s * 0.24, { size: fs, color: c, anchor: "middle", bold: true }) +
        `<path d="M${cx} ${r2(top)}L${r2(cx - half)} ${r2(bottom)}L${cx} ${r2(mid)}Z" fill="${c}" stroke="${c}" stroke-width="${r2(s * 0.02)}" stroke-linejoin="round"/>` +
        `<path d="M${cx} ${r2(top)}L${r2(cx + half)} ${r2(bottom)}L${cx} ${r2(mid)}Z" fill="#ffffff" stroke="${c}" stroke-width="${r2(s * 0.02)}" stroke-linejoin="round"/>`;
      return { svg: wrap(s, s, body), width: s, height: s };
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
    return { svg: wrap(w, h, haloText(label, w / 2, h - 5, { size: fs + 1, color: c, anchor: "middle", bold: true })), width: w, height: h };
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
      `<rect x="${r2(x0 + half)}" y="${top}" width="${r2(half)}" height="${barH}" fill="#ffffff" stroke="${c}" stroke-width="${sw}"/>` +
      haloText("0", x0, top - 3, { size: fs, color: c, anchor: "middle" }) +
      haloText(formatLength(meters / 2).replace(" m", "").replace(" km", ""), x0 + half, top - 3, { size: fs, color: c, anchor: "middle" }) +
      haloText(formatLength(meters), x0 + len, top - 3, { size: fs, color: c, anchor: "middle" });
    return { svg: wrap(w, h, body), width: w, height: h };
  }
  // 'line' — 양끝 눈금이 있는 선
  const top = fs + 4;
  const h = top + tick + 2;
  const sw = 1.5;
  const body =
    `<path d="M${x0} ${top}V${top + tick}H${r2(x0 + len)}V${top}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="miter"/>` +
    haloText("0", x0, top - 3, { size: fs, color: c, anchor: "middle" }) +
    haloText(formatLength(meters), x0 + len, top - 3, { size: fs, color: c, anchor: "middle" });
  return { svg: wrap(w, h, body), width: w, height: h };
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
  let y = pad;
  if (o.title) {
    body += haloText(o.title, pad, y + fs, { size: fs + 1, color, bold: true, halo: o.preset === "plain" });
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
    body += haloText(it.label, pad + sw + 8, y + rowH / 2 + fs * 0.35 - 1, { size: fs, color, halo: o.preset === "plain" });
    y += rowH;
  }
  return { svg: wrap(w, h, body), width: w, height: h };
}
