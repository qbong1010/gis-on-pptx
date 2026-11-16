/**
 * 라벨 배치 (공용) — 화면 px 좌표의 라벨 후보들을 우선순위대로 놓고, 겹치는 것은 버린다.
 * 데이터 레이어 라벨(속성 필드)과 벡터 배경지도 라벨(지명·도로명)이 함께 쓴다.
 * Bake 시 결과는 PowerPoint 네이티브 텍스트 상자(편집 가능) 또는 SVG <text> 로 내보낸다.
 */

export type LabelCandidate = {
  text: string;
  /** 앵커 위치 (지도 화면 px) */
  x: number;
  y: number;
  /** 글자 크기 (px = 슬라이드 100% 기준 pt*4/3) */
  fontSize: number;
  /** 클수록 먼저 배치 */
  priority: number;
  color?: string;
  bold?: boolean;
  halo?: boolean;
  /** 앵커 기준 정렬 — 기본 center (점 라벨은 'right' 로 점 옆에 붙인다) */
  anchor?: "center" | "right";
  /** 구분용 (예: 'place' | 'road' | 'poi' | 'data:<layerId>') */
  kind?: string;
};

export type PlacedLabel = LabelCandidate & {
  /** 텍스트 상자 왼쪽 위/크기 (px) */
  box: { left: number; top: number; width: number; height: number };
};

export type PlaceOptions = {
  width: number;
  height: number;
  /** 라벨 사이 최소 여백 px */
  padding?: number;
  /** 최대 라벨 수 (PowerPoint 텍스트 상자가 너무 많아지면 느리고 지저분함) */
  maxLabels?: number;
  /** 화면 가장자리 여백 px — 이 안쪽에 완전히 들어오는 라벨만 */
  margin?: number;
};

/** 한글/영문 혼합 대략 폭 추정 (canvas measureText 가 있으면 그걸 쓴다) */
let measureCtx: CanvasRenderingContext2D | null | undefined;
export function measureText(text: string, fontSize: number, bold = false): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    measureCtx.font = `${bold ? "bold " : ""}${fontSize}px "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif`;
    return measureCtx.measureText(text).width;
  }
  let w = 0;
  for (const ch of text) w += /[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? 1 : 0.55;
  return w * fontSize * (bold ? 1.05 : 1);
}

export function placeLabels(cands: LabelCandidate[], opts: PlaceOptions): PlacedLabel[] {
  const pad = opts.padding ?? 4;
  const margin = opts.margin ?? 2;
  const max = opts.maxLabels ?? 80;
  const placed: PlacedLabel[] = [];
  const seenText = new Map<string, number>(); // 같은 이름 반복 억제 (도로명 등)

  const sorted = [...cands].filter((c) => c.text && c.text.trim()).sort((a, b) => b.priority - a.priority);
  for (const c of sorted) {
    if (placed.length >= max) break;
    const w = measureText(c.text, c.fontSize, c.bold) + 2;
    const h = c.fontSize * 1.25;
    const left = c.anchor === "right" ? c.x + c.fontSize * 0.5 : c.x - w / 2;
    const top = c.y - h / 2;
    if (left < margin || top < margin || left + w > opts.width - margin || top + h > opts.height - margin) continue;

    const key = `${c.kind ?? ""}|${c.text}`;
    const prev = seenText.get(key) ?? 0;
    if (prev >= 2) continue;

    const collide = placed.some(
      (p) => left < p.box.left + p.box.width + pad && left + w + pad > p.box.left && top < p.box.top + p.box.height + pad && top + h + pad > p.box.top,
    );
    if (collide) continue;
    placed.push({ ...c, box: { left, top, width: w, height: h } });
    seenText.set(key, prev + 1);
  }
  return placed;
}
