/**
 * 슬라이드 어댑터 — PowerPoint(Office.js) 와 브라우저 모의(Mock) 두 구현
 * 실제 PowerPoint 검증 결과(빌드 16.0.20527):
 *  - PowerPointApi 1.1–1.10, ImageCoercion 1.1/1.2 지원
 *  - setSelectedDataAsync(Image/XmlSvg, imageLeft/Top/Width/Height) = 지정 사각형(pt)에 새 도형 삽입.
 *    삽입 후 getSelectedShapes() 는 비어 있으므로 삽입 전후 슬라이드 도형 id 비교로 새 도형을 찾는다.
 *  - shape.tags.add / tags.getItemOrNullObject / shape.name 정상, addTextBox·addGroup·rotation 정상
 *  - presentation.pageSetup(1.10) 으로 슬라이드 크기 조회 (960×540)
 */
import { diag } from "@/pane/diag";
import type { Frame } from "@/pane/model";
import { DEFAULT_SLIDE } from "@/pane/model";

export const TAG_MAP = "SLIDEMAP_MAP";
export const TAG_PART = "SLIDEMAP_PART";
export const TAG_VER = "SLIDEMAP_VER";

export type SlideShape = {
  id: string;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  mapId?: string;
  part?: string;
};

export type TextStyle = { fontSizePt: number; color: string; bold: boolean; fontName: string; align?: "Left" | "Center" | "Right"; rotation?: number };

export interface SlideAdapter {
  kind: "office" | "mock";
  caps: { tags: boolean; textBox: boolean; group: boolean; selection: boolean; svg: boolean };
  currentSlideId(): Promise<string | null>;
  slideSize(): Promise<{ width: number; height: number }>;
  listShapes(): Promise<SlideShape[]>;
  insertImage(pngBase64: string, f: Frame): Promise<string>;
  insertSvg(svg: string, f: Frame): Promise<string>;
  addTextBox(text: string, box: Frame, style: TextStyle, meta?: { tags: Record<string, string>; name: string }): Promise<string>;
  /** 여러 텍스트 상자를 한 번의 PowerPoint.run 으로 (속도) */
  addTextBoxes?(items: { text: string; box: Frame; style: TextStyle; tags: Record<string, string>; name: string }[]): Promise<string[]>;
  tagShape(id: string, tags: Record<string, string>, name?: string): Promise<void>;
  deleteShapes(ids: string[]): Promise<void>;
  group?(ids: string[], name: string): Promise<string>;
  ungroup?(id: string): Promise<string[]>;
  onSelectionChanged(cb: (sel: SlideShape[]) => void): () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* PowerPoint                                                           */
/* ------------------------------------------------------------------ */

const supported = (v: string) => {
  try {
    return Office.context.requirements.isSetSupported("PowerPointApi", v);
  } catch {
    return false;
  }
};

export class OfficeSlideAdapter implements SlideAdapter {
  kind = "office" as const;
  caps = {
    tags: supported("1.3"),
    textBox: supported("1.4"),
    group: supported("1.8"),
    selection: supported("1.5"),
    svg: (() => {
      try {
        return Office.context.requirements.isSetSupported("ImageCoercion", "1.2");
      } catch {
        return false;
      }
    })(),
  };

  constructor() {
    diag(`OfficeSlideAdapter caps: ${JSON.stringify(this.caps)}`);
  }

  async currentSlideId(): Promise<string | null> {
    return PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      return slides.items[0]?.id ?? null;
    });
  }

  async slideSize() {
    try {
      if (supported("1.10")) {
        return await PowerPoint.run(async (ctx) => {
          const ps = ctx.presentation.pageSetup;
          ps.load("slideWidth,slideHeight");
          await ctx.sync();
          return { width: ps.slideWidth, height: ps.slideHeight };
        });
      }
    } catch (e) {
      diag(`슬라이드 크기 조회 실패(기본값 사용): ${errMsg(e)}`, "warn");
    }
    return { ...DEFAULT_SLIDE };
  }

  private async readShapes(ctx: PowerPoint.RequestContext, shapes: PowerPoint.ShapeCollection | PowerPoint.ShapeScopedCollection): Promise<SlideShape[]> {
    shapes.load("items/id,items/name,items/left,items/top,items/width,items/height");
    await ctx.sync();
    const out: SlideShape[] = shapes.items.map((s) => ({ id: s.id, name: s.name, left: s.left, top: s.top, width: s.width, height: s.height }));
    if (this.caps.tags && shapes.items.length) {
      const maps = shapes.items.map((s) => s.tags.getItemOrNullObject(TAG_MAP));
      const parts = shapes.items.map((s) => s.tags.getItemOrNullObject(TAG_PART));
      maps.forEach((t) => t.load("isNullObject,value"));
      parts.forEach((t) => t.load("isNullObject,value"));
      await ctx.sync();
      out.forEach((o, i) => {
        if (!maps[i].isNullObject) o.mapId = maps[i].value;
        if (!parts[i].isNullObject) o.part = parts[i].value;
      });
    }
    return out;
  }

  async listShapes(): Promise<SlideShape[]> {
    return PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      if (!slides.items.length) return [];
      return this.readShapes(ctx, slides.items[0].shapes);
    });
  }

  private setSelected(data: string, type: Office.CoercionType, f: Frame): Promise<void> {
    return new Promise((resolve, reject) => {
      Office.context.document.setSelectedDataAsync(
        data,
        { coercionType: type, imageLeft: f.left, imageTop: f.top, imageWidth: f.width, imageHeight: f.height },
        (r) => (r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(`${r.error.code} ${r.error.message}`))),
      );
    });
  }

  private async insertAndFind(data: string, type: Office.CoercionType, f: Frame): Promise<string> {
    const before = new Set((await this.listShapes()).map((s) => s.id));
    await this.setSelected(data, type, f);
    // 삽입 직후에는 도형 목록에 아직 반영되지 않을 수 있어 짧게 재시도 [확인 필요: 실측상 대부분 즉시 반영]
    for (let i = 0; i < 8; i++) {
      const now = await this.listShapes();
      const added = now.filter((s) => !before.has(s.id));
      if (added.length) {
        if (added.length > 1) diag(`삽입 후 새 도형이 ${added.length}개 감지됨 → 마지막 것 사용`, "warn");
        return added[added.length - 1].id;
      }
      await sleep(80);
    }
    throw new Error("삽입한 도형을 슬라이드에서 찾지 못했습니다.");
  }

  insertImage(png: string, f: Frame) {
    return this.insertAndFind(png, Office.CoercionType.Image, f);
  }

  insertSvg(svg: string, f: Frame) {
    if (!this.caps.svg) throw new Error("이 PowerPoint 는 SVG 삽입(ImageCoercion 1.2)을 지원하지 않습니다.");
    return this.insertAndFind(svg, Office.CoercionType.XmlSvg, f);
  }

  async addTextBox(text: string, box: Frame, st: TextStyle, meta?: { tags: Record<string, string>; name: string }): Promise<string> {
    return PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      const slide = slides.items[0];
      const tb = slide.shapes.addTextBox(text, { left: box.left, top: box.top, width: box.width, height: box.height });
      tb.fill.clear();
      tb.lineFormat.visible = false;
      tb.textFrame.wordWrap = false;
      tb.textFrame.autoSizeSetting = "AutoSizeNone";
      tb.textFrame.leftMargin = 0;
      tb.textFrame.rightMargin = 0;
      tb.textFrame.topMargin = 0;
      tb.textFrame.bottomMargin = 0;
      tb.textFrame.verticalAlignment = "Middle";
      const font = tb.textFrame.textRange.font;
      font.size = st.fontSizePt;
      font.color = st.color;
      font.bold = st.bold;
      font.name = st.fontName;
      tb.textFrame.textRange.paragraphFormat.horizontalAlignment = st.align ?? "Center";
      if (st.rotation) tb.rotation = st.rotation;
      if (meta) {
        if (this.caps.tags) for (const [k, v] of Object.entries(meta.tags)) tb.tags.add(k, v);
        tb.name = meta.name;
      }
      tb.load("id");
      await ctx.sync();
      return tb.id;
    });
  }

  async addTextBoxes(items: { text: string; box: Frame; style: TextStyle; tags: Record<string, string>; name: string }[]): Promise<string[]> {
    if (!items.length) return [];
    return PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      const shapes = slides.items[0].shapes;
      const boxes = items.map((it) => {
        const tb = shapes.addTextBox(it.text, { left: it.box.left, top: it.box.top, width: it.box.width, height: it.box.height });
        tb.fill.clear();
        tb.lineFormat.visible = false;
        tb.textFrame.wordWrap = false;
        tb.textFrame.autoSizeSetting = "AutoSizeNone";
        tb.textFrame.leftMargin = 0;
        tb.textFrame.rightMargin = 0;
        tb.textFrame.topMargin = 0;
        tb.textFrame.bottomMargin = 0;
        tb.textFrame.verticalAlignment = "Middle";
        const font = tb.textFrame.textRange.font;
        font.size = it.style.fontSizePt;
        font.color = it.style.color;
        font.bold = it.style.bold;
        font.name = it.style.fontName;
        tb.textFrame.textRange.paragraphFormat.horizontalAlignment = it.style.align ?? "Center";
        if (it.style.rotation) tb.rotation = it.style.rotation;
        if (this.caps.tags) for (const [k, v] of Object.entries(it.tags)) tb.tags.add(k, v);
        tb.name = it.name;
        tb.load("id");
        return tb;
      });
      await ctx.sync(); // 전부 한 번에
      return boxes.map((b) => b.id);
    });
  }

  async tagShape(id: string, tags: Record<string, string>, name?: string): Promise<void> {
    await PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      const sh = slides.items[0].shapes.getItem(id);
      if (this.caps.tags) for (const [k, v] of Object.entries(tags)) sh.tags.add(k, v);
      if (name) sh.name = name;
      await ctx.sync();
    });
  }

  async deleteShapes(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      const shapes = slides.items[0].shapes;
      for (const id of ids) shapes.getItem(id).delete();
      await ctx.sync();
    });
  }

  async group(ids: string[], name: string): Promise<string> {
    return PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      const g = slides.items[0].shapes.addGroup(ids);
      g.name = name;
      g.load("id");
      await ctx.sync();
      return g.id;
    });
  }

  /** 묶음 해제 — 실측(PowerPoint 16.0.20527): ungroup() 은 반환값 없음(void), 자식 도형은 id 와 태그를 그대로 유지 → 해제 전에 자식 id 를 읽어 둔다 */
  async ungroup(id: string): Promise<string[]> {
    return PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      const sh = slides.items[0].shapes.getItem(id);
      const grp = sh.group;
      grp.shapes.load("items/id");
      await ctx.sync();
      const childIds = grp.shapes.items.map((s) => s.id);
      grp.ungroup();
      await ctx.sync();
      return childIds;
    });
  }

  onSelectionChanged(cb: (sel: SlideShape[]) => void): () => void {
    if (!this.caps.selection) return () => {};
    const handler = async () => {
      try {
        const sel = await PowerPoint.run(async (ctx) => this.readShapes(ctx, ctx.presentation.getSelectedShapes()));
        cb(sel);
      } catch (e) {
        diag(`선택 읽기 실패: ${errMsg(e)}`, "warn");
      }
    };
    let added = false;
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler, (r) => {
      added = r.status === Office.AsyncResultStatus.Succeeded;
      if (!added) diag(`선택 이벤트 등록 실패: ${r.error.message}`, "warn");
    });
    return () => {
      if (added) Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, { handler });
    };
  }
}

/* ------------------------------------------------------------------ */
/* Mock (브라우저 모드)                                                    */
/* ------------------------------------------------------------------ */

export type MockShape = SlideShape & {
  kind: "png" | "svg" | "text" | "group";
  data: string;
  textStyle?: TextStyle;
  tags: Record<string, string>;
  children?: MockShape[];
};

export class MockSlideAdapter implements SlideAdapter {
  kind = "mock" as const;
  caps = { tags: true, textBox: true, group: true, selection: true, svg: true };
  shapes: MockShape[] = [];
  selection: string[] = [];
  private seq = 100;
  private subs = new Set<() => void>();
  private selSubs = new Set<(sel: SlideShape[]) => void>();

  constructor() {
    if (typeof window !== "undefined") {
      const self = this;
      (window as unknown as { __slidemapMock: unknown }).__slidemapMock = {
        get shapes() {
          return self.shapes;
        },
        move: (id: string, dx: number, dy: number) => self.patch(id, (s) => ((s.left += dx), (s.top += dy))),
        setRect: (id: string, r: Partial<Frame>) => self.patch(id, (s) => Object.assign(s, r)),
        select: (ids: string[]) => self.select(ids),
        clear: () => ((self.shapes = []), self.emit()),
        byPart: (part: string) => self.shapes.filter((s) => s.part === part || s.tags[TAG_PART] === part),
      };
    }
  }

  subscribe(cb: () => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  private emit() {
    this.subs.forEach((s) => s());
  }
  patch(id: string, fn: (s: MockShape) => void) {
    const s = this.shapes.find((x) => x.id === id);
    if (s) {
      fn(s);
      this.emit();
    }
  }
  select(ids: string[]) {
    this.selection = ids;
    const sel = this.shapes.filter((s) => ids.includes(s.id)).map((s) => this.pub(s));
    this.selSubs.forEach((c) => c(sel));
    this.emit();
  }
  private pub(s: MockShape): SlideShape {
    return { id: s.id, name: s.name, left: s.left, top: s.top, width: s.width, height: s.height, mapId: s.tags[TAG_MAP], part: s.tags[TAG_PART] };
  }

  async currentSlideId() {
    return "mock-slide-1";
  }
  async slideSize() {
    return { ...DEFAULT_SLIDE };
  }
  async listShapes() {
    return this.shapes.map((s) => this.pub(s));
  }
  private add(kind: MockShape["kind"], data: string, f: Frame, textStyle?: TextStyle): string {
    const id = String(++this.seq);
    this.shapes.push({ id, name: `${kind === "png" ? "Picture" : kind === "svg" ? "Graphic" : "TextBox"} ${id}`, ...f, kind, data, textStyle, tags: {} });
    this.emit();
    return id;
  }
  async insertImage(png: string, f: Frame) {
    return this.add("png", png, f);
  }
  async insertSvg(svg: string, f: Frame) {
    return this.add("svg", svg, f);
  }
  async addTextBox(text: string, box: Frame, style: TextStyle, meta?: { tags: Record<string, string>; name: string }) {
    const id = this.add("text", text, box, style);
    if (meta) await this.tagShape(id, meta.tags, meta.name);
    return id;
  }
  async addTextBoxes(items: { text: string; box: Frame; style: TextStyle; tags: Record<string, string>; name: string }[]) {
    const out: string[] = [];
    for (const it of items) out.push(await this.addTextBox(it.text, it.box, it.style, { tags: it.tags, name: it.name }));
    return out;
  }
  async tagShape(id: string, tags: Record<string, string>, name?: string) {
    this.patch(id, (s) => {
      Object.assign(s.tags, tags);
      if (name) s.name = name;
    });
  }
  async deleteShapes(ids: string[]) {
    this.shapes = this.shapes.filter((s) => !ids.includes(s.id));
    this.emit();
  }
  async group(ids: string[], name: string) {
    const kids = this.shapes.filter((s) => ids.includes(s.id));
    if (!kids.length) throw new Error("묶을 도형이 없습니다.");
    const l = Math.min(...kids.map((k) => k.left));
    const t = Math.min(...kids.map((k) => k.top));
    const r = Math.max(...kids.map((k) => k.left + k.width));
    const b = Math.max(...kids.map((k) => k.top + k.height));
    const id = String(++this.seq);
    const g: MockShape = { id, name, left: l, top: t, width: r - l, height: b - t, kind: "group", data: "", tags: {}, children: kids };
    this.shapes = [...this.shapes.filter((s) => !ids.includes(s.id)), g];
    this.emit();
    return id;
  }
  async ungroup(id: string) {
    const g = this.shapes.find((s) => s.id === id);
    if (!g?.children) return [];
    this.shapes = [...this.shapes.filter((s) => s.id !== id), ...g.children];
    this.emit();
    return g.children.map((c) => c.id);
  }
  onSelectionChanged(cb: (sel: SlideShape[]) => void) {
    this.selSubs.add(cb);
    return () => this.selSubs.delete(cb);
  }
}

let mockSingleton: MockSlideAdapter | null = null;
/** StrictMode 에서 어댑터가 두 번 만들어져도 window.__slidemapMock 이 같은 인스턴스를 가리키도록 단일 인스턴스 */
export function getMockAdapter(): MockSlideAdapter {
  return (mockSingleton ??= new MockSlideAdapter());
}
