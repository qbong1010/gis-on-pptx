/**
 * 슬라이드 어댑터 — PowerPoint(Office.js) 와 브라우저 모의(Mock) 두 구현
 * 실제 PowerPoint 검증 결과(빌드 16.0.20527):
 *  - PowerPointApi 1.1–1.10, ImageCoercion 1.1/1.2 지원
 *  - setSelectedDataAsync(Image/XmlSvg, imageLeft/Top/Width/Height) = 지정 사각형(pt)에 새 도형 삽입.
 *    삽입 후 getSelectedShapes() 는 비어 있으므로 삽입 전후 슬라이드 도형 id 비교로 새 도형을 찾는다.
 *  - shape.tags.add / tags.getItemOrNullObject / shape.name 정상, addTextBox·addGroup·rotation 정상
 *  - presentation.pageSetup(1.10) 으로 슬라이드 크기 조회 (960×540)
 */
import { stripInvalidXml } from "@/lib/xml";
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
  /** 이후 모든 도형 조작을 이 슬라이드로 고정 (null = 해제, 현재 선택 슬라이드 사용) */
  bindSlide(id: string | null): void;
  /** 슬라이드 번호(1부터)·전체 수. 없으면 null */
  slideInfo(id: string): Promise<{ index: number; count: number } | null>;
  /** 슬라이드로 이동(선택). 성공 여부 */
  selectSlide(id: string): Promise<boolean>;
  slideSize(): Promise<{ width: number; height: number }>;
  listShapes(): Promise<SlideShape[]>;
  insertImage(pngBase64: string, f: Frame): Promise<string>;
  insertSvg(svg: string, f: Frame): Promise<string>;
  addTextBox(text: string, box: Frame, style: TextStyle, meta?: { tags: Record<string, string>; name: string }): Promise<string>;
  /** 여러 텍스트 상자를 한 번의 PowerPoint.run 으로 (속도) */
  addTextBoxes?(items: { text: string; box: Frame; style: TextStyle; tags: Record<string, string>; name: string }[]): Promise<string[]>;
  tagShape(id: string, tags: Record<string, string>, name?: string): Promise<void>;
  /** 실패한 개수를 돌려준다 (이미 없는 도형은 무시) */
  deleteShapes(ids: string[]): Promise<number>;
  /** 투명 사각형 (배경지도가 없을 때 영역 추적용) */
  addFrameRect(f: Frame, tags: Record<string, string>, name: string): Promise<string>;
  bringToFront(ids: string[]): Promise<void>;
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
  /** 반영 중 고정한 슬라이드 id — 모든 도형 조작은 이 슬라이드에만 한다 (H1) */
  private boundId: string | null = null;

  constructor() {
    diag(`OfficeSlideAdapter caps: ${JSON.stringify(this.caps)}`);
  }

  bindSlide(id: string | null) {
    this.boundId = id;
  }

  async currentSlideId(): Promise<string | null> {
    return PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.getSelectedSlides();
      slides.load("items/id");
      await ctx.sync();
      return slides.items[0]?.id ?? null;
    });
  }

  /** 고정된 슬라이드(없으면 현재 선택 슬라이드). 선택이 없으면 명확한 오류 */
  private async getSlide(ctx: PowerPoint.RequestContext): Promise<PowerPoint.Slide> {
    if (this.boundId) {
      const s = ctx.presentation.slides.getItemOrNullObject(this.boundId);
      s.load("isNullObject,id");
      await ctx.sync();
      if (s.isNullObject) throw new Error("대상 슬라이드를 찾을 수 없습니다(삭제되었을 수 있습니다).");
      return s;
    }
    const slides = ctx.presentation.getSelectedSlides();
    slides.load("items/id");
    await ctx.sync();
    if (!slides.items.length) throw new Error("선택된 슬라이드가 없습니다. 슬라이드를 하나 선택한 뒤 다시 시도하세요.");
    return slides.items[0];
  }

  async slideInfo(id: string): Promise<{ index: number; count: number } | null> {
    return PowerPoint.run(async (ctx) => {
      const slides = ctx.presentation.slides;
      slides.load("items/id");
      await ctx.sync();
      const i = slides.items.findIndex((s) => s.id === id);
      return i < 0 ? null : { index: i + 1, count: slides.items.length };
    });
  }

  async selectSlide(id: string): Promise<boolean> {
    if (!this.caps.selection) return false;
    try {
      await PowerPoint.run(async (ctx) => {
        ctx.presentation.setSelectedSlides([id]);
        await ctx.sync();
      });
    } catch (e) {
      diag(`슬라이드 선택 실패: ${errMsg(e)}`, "warn");
      return false;
    }
    for (let i = 0; i < 20; i++) {
      if ((await this.currentSlideId().catch(() => null)) === id) return true;
      await sleep(100);
    }
    return false;
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

  /** z 순서(아래 → 위) 그대로 */
  async listShapes(): Promise<SlideShape[]> {
    return PowerPoint.run(async (ctx) => {
      const slide = await this.getSlide(ctx);
      return this.readShapes(ctx, slide.shapes);
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

  /** setSelectedDataAsync 는 "현재 선택된 슬라이드"에 넣으므로, 고정 슬라이드가 아니면 다시 선택하고 안 되면 중단한다 */
  private async ensureOnBound(): Promise<void> {
    if (!this.boundId) return;
    const cur = await this.currentSlideId().catch(() => null);
    if (cur === this.boundId) return;
    diag(`반영 중 슬라이드가 바뀜(${cur} ≠ ${this.boundId}) → 원래 슬라이드를 다시 선택`, "warn");
    if (!(await this.selectSlide(this.boundId))) throw new Error("반영 중 슬라이드가 바뀌어 중단했습니다. 지도가 있는 슬라이드를 선택한 뒤 다시 시도하세요.");
  }

  private async insertAndFind(data: string, type: Office.CoercionType, f: Frame): Promise<string> {
    await this.ensureOnBound();
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

  private styleTextBox(tb: PowerPoint.Shape, st: TextStyle) {
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
  }

  async addTextBox(text: string, box: Frame, st: TextStyle, meta?: { tags: Record<string, string>; name: string }): Promise<string> {
    const ids = await this.addTextBoxes([{ text, box, style: st, tags: meta?.tags ?? {}, name: meta?.name ?? "" }]);
    return ids[0];
  }

  async addTextBoxes(items: { text: string; box: Frame; style: TextStyle; tags: Record<string, string>; name: string }[]): Promise<string[]> {
    if (!items.length) return [];
    return PowerPoint.run(async (ctx) => {
      const slide = await this.getSlide(ctx);
      const shapes = slide.shapes;
      const boxes = items.map((it) => {
        const tb = shapes.addTextBox(stripInvalidXml(it.text), { left: it.box.left, top: it.box.top, width: it.box.width, height: it.box.height });
        this.styleTextBox(tb, it.style);
        if (this.caps.tags) for (const [k, v] of Object.entries(it.tags)) tb.tags.add(k, v);
        if (it.name) tb.name = it.name;
        tb.load("id");
        return tb;
      });
      await ctx.sync(); // 전부 한 번에
      return boxes.map((b) => b.id);
    });
  }

  /** 배경지도를 끈 지도의 영역 추적용: 채움·선 없는 투명 사각형 (L6) */
  async addFrameRect(f: Frame, tags: Record<string, string>, name: string): Promise<string> {
    return PowerPoint.run(async (ctx) => {
      const slide = await this.getSlide(ctx);
      const r = slide.shapes.addGeometricShape(PowerPoint.GeometricShapeType.rectangle, { left: f.left, top: f.top, width: f.width, height: f.height });
      r.fill.clear();
      r.lineFormat.visible = false;
      if (this.caps.tags) for (const [k, v] of Object.entries(tags)) r.tags.add(k, v);
      r.name = name;
      r.load("id");
      await ctx.sync();
      return r.id;
    });
  }

  async tagShape(id: string, tags: Record<string, string>, name?: string): Promise<void> {
    await PowerPoint.run(async (ctx) => {
      const slide = await this.getSlide(ctx);
      const sh = slide.shapes.getItem(id);
      if (this.caps.tags) for (const [k, v] of Object.entries(tags)) sh.tags.add(k, v);
      if (name) sh.name = name;
      await ctx.sync();
    });
  }

  /** 삭제 직전에 존재하는 것만 골라 지운다. 이미 없는 도형은 무시, 실패한 개수를 돌려준다 (M2) */
  async deleteShapes(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    let failed = 0;
    await PowerPoint.run(async (ctx) => {
      const slide = await this.getSlide(ctx);
      const found = ids.map((id) => slide.shapes.getItemOrNullObject(id));
      found.forEach((s) => s.load("isNullObject"));
      await ctx.sync();
      const live = found.filter((s) => !s.isNullObject);
      try {
        live.forEach((s) => s.delete());
        await ctx.sync();
      } catch {
        // 일괄 삭제가 실패하면 하나씩 시도
        for (const s of live) {
          try {
            s.delete();
            await ctx.sync();
          } catch {
            failed++;
          }
        }
      }
    });
    return failed;
  }

  /** 지정한 도형들을 (주어진 순서대로) 맨 위로 — 다시 반영한 뒤에도 사용자의 제목·화살표가 위에 있도록 (M6) */
  async bringToFront(ids: string[]): Promise<void> {
    if (!ids.length || !this.caps.group) return; // setZOrder = PowerPointApi 1.8
    await PowerPoint.run(async (ctx) => {
      const slide = await this.getSlide(ctx);
      const found = ids.map((id) => slide.shapes.getItemOrNullObject(id));
      found.forEach((s) => s.load("isNullObject"));
      await ctx.sync();
      for (const s of found) if (!s.isNullObject) s.setZOrder(PowerPoint.ShapeZOrder.bringToFront);
      await ctx.sync();
    });
  }

  async group(ids: string[], name: string): Promise<string> {
    return PowerPoint.run(async (ctx) => {
      const slide = await this.getSlide(ctx);
      const g = slide.shapes.addGroup(ids);
      g.name = name;
      g.load("id");
      await ctx.sync();
      return g.id;
    });
  }

  /** 묶음 해제 — 실측(PowerPoint 16.0.20527): ungroup() 은 반환값 없음(void), 자식 도형은 id 와 태그를 그대로 유지 → 해제 전에 자식 id 를 읽어 둔다 */
  async ungroup(id: string): Promise<string[]> {
    return PowerPoint.run(async (ctx) => {
      const slide = await this.getSlide(ctx);
      const sh = slide.shapes.getItem(id);
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
    let disposed = false;
    let added = false;
    const handler = async () => {
      if (disposed) return;
      try {
        const sel = await PowerPoint.run(async (ctx) => this.readShapes(ctx, ctx.presentation.getSelectedShapes()));
        if (!disposed) cb(sel);
      } catch (e) {
        diag(`선택 읽기 실패: ${errMsg(e)}`, "warn");
      }
    };
    const remove = () =>
      Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, { handler }, (r) => {
        if (r.status !== Office.AsyncResultStatus.Succeeded) diag(`선택 이벤트 해제 실패: ${r.error.message}`, "warn");
      });
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler, (r) => {
      added = r.status === Office.AsyncResultStatus.Succeeded;
      if (!added) diag(`선택 이벤트 등록 실패: ${r.error.message}`, "warn");
      else if (disposed) remove(); // 등록이 끝나기 전에 해제 요청이 왔던 경우
    });
    return () => {
      disposed = true;
      if (added) remove();
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

  bindSlide() {}
  async currentSlideId() {
    return "mock-slide-1";
  }
  async slideInfo(id: string) {
    return id === "mock-slide-1" ? { index: 1, count: 1 } : null;
  }
  async selectSlide() {
    return true;
  }
  async addFrameRect(f: Frame, tags: Record<string, string>, name: string) {
    const id = this.add("svg", "", f);
    await this.tagShape(id, tags, name);
    return id;
  }
  async bringToFront(ids: string[]) {
    const moving = ids.map((i) => this.shapes.find((x) => x.id === i)).filter(Boolean) as MockShape[];
    this.shapes = [...this.shapes.filter((x) => !ids.includes(x.id)), ...moving];
    this.emit();
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
    return 0;
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
