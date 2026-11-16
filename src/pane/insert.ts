/**
 * 패널 쪽 Bake 삽입 (D-026)
 *  1) 지도 박스(콘텐츠 애드인)가 슬라이드의 어디에 있는지 찾는다
 *     - PowerPointApi 1.5: 선택된 도형 → 없으면 현재 슬라이드의 도형 중 지도 비율과 맞는 "알 수 없는 유형" 도형
 *     [확인 필요] 콘텐츠 애드인이 PowerPoint API 의 Shape 로 노출되는지/어떤 type 인지
 *  2) 배경지도 PNG → 벡터 SVG 순서로 삽입 (나중에 넣은 것이 위)
 */

export type Frame = { left: number; top: number; width: number; height: number; how: string };

type ShapeInfo = { id: string; name: string; type: string; left: number; top: number; width: number; height: number };

const KNOWN_TYPES = new Set(["GeometricShape", "Line", "TextBox", "Image", "Group", "Table", "SmartArt", "Placeholder", "Media", "Chart"]);

export type DetectResult = { frame: Frame | null; diag: string[] };

export async function detectMapFrame(aspect: number): Promise<DetectResult> {
  const diag: string[] = [];
  if (typeof PowerPoint === "undefined" || !Office.context.requirements.isSetSupported("PowerPointApi", "1.5")) {
    diag.push("PowerPointApi 1.5 미지원 → 위치 자동 감지 불가");
    return { frame: null, diag };
  }

  try {
    return await PowerPoint.run(async (ctx) => {
      const load = (col: PowerPoint.ShapeScopedCollection | PowerPoint.ShapeCollection) =>
        col.load("items/id,items/name,items/type,items/left,items/top,items/width,items/height");

      const selected = ctx.presentation.getSelectedShapes();
      load(selected);
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();

      const toInfo = (s: PowerPoint.Shape): ShapeInfo => ({
        id: s.id,
        name: s.name,
        type: String(s.type),
        left: s.left,
        top: s.top,
        width: s.width,
        height: s.height,
      });

      const pick = (list: ShapeInfo[], label: string): Frame | null => {
        const scored = list
          .filter((s) => s.width > 0 && s.height > 0)
          .map((s) => ({ s, err: Math.abs(s.width / s.height - aspect) / aspect, unknown: !KNOWN_TYPES.has(s.type) }))
          .filter((x) => x.err < 0.04) // 비율 4% 이내
          .sort((a, b) => Number(b.unknown) - Number(a.unknown) || a.err - b.err);
        const best = scored[0];
        if (!best) return null;
        return { left: best.s.left, top: best.s.top, width: best.s.width, height: best.s.height, how: `${label}: "${best.s.name}" (${best.s.type})` };
      };

      const sel = selected.items.map(toInfo);
      diag.push(`선택된 도형 ${sel.length}개${sel.length ? ": " + sel.map((s) => `${s.name}/${s.type}`).join(", ") : ""}`);
      const fromSel = pick(sel, "선택된 도형");
      if (fromSel) return { frame: fromSel, diag };

      if (slides.items.length) {
        const shapes = slides.items[0].shapes;
        load(shapes);
        await ctx.sync();
        const all = shapes.items.map(toInfo);
        diag.push(`현재 슬라이드 도형 ${all.length}개: ${all.map((s) => `${s.name}/${s.type}`).join(", ")}`);
        const fromSlide = pick(all, "슬라이드 도형");
        if (fromSlide) return { frame: fromSlide, diag };
      }
      return { frame: null, diag };
    });
  } catch (e) {
    diag.push(`도형 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { frame: null, diag };
  }
}

export function fallbackFrame(aspect: number): Frame {
  // 16:9 기본 슬라이드(960×540pt) 기준 왼쪽 위
  const width = 480;
  return { left: 40, top: 40, width, height: Math.round(width / aspect), how: "기본 위치(왼쪽 위)" };
}

function setSelected(data: string, coercionType: Office.CoercionType, f: Frame): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.document.setSelectedDataAsync(
      data,
      { coercionType, imageLeft: f.left, imageTop: f.top, imageWidth: f.width, imageHeight: f.height },
      (r) => (r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(`${r.error.code} ${r.error.message}`))),
    );
  });
}

export async function insertBake(frame: Frame, png: string | null, svg: string | null): Promise<string[]> {
  const done: string[] = [];
  if (png) {
    await setSelected(png, Office.CoercionType.Image, frame);
    done.push("배경지도 이미지");
  }
  if (svg) {
    if (Office.context.requirements.isSetSupported("ImageCoercion", "1.2")) {
      await setSelected(svg, Office.CoercionType.XmlSvg, frame);
      done.push("도형(SVG)");
    } else {
      throw new Error("이 PowerPoint 는 SVG 삽입(ImageCoercion 1.2)을 지원하지 않습니다.");
    }
  }
  return done;
}
