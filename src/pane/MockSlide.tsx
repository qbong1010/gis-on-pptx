/** 브라우저 모드 전용: 960×540pt 모의 슬라이드. 삽입된 도형을 보여 주고, 끌어서 옮기거나 크기를 바꿀 수 있다(프레임 변경 로직 시험용). */
import { useEffect, useReducer, useRef, useState } from "react";

import type { MockShape, MockSlideAdapter } from "@/pane/slide";
import { DEFAULT_SLIDE } from "@/pane/model";

type Drag = { id: string; mode: "move" | "resize"; sx: number; sy: number; o: { left: number; top: number; width: number; height: number } };

export default function MockSlide({ adapter }: { adapter: MockSlideAdapter }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const off = adapter.subscribe(force);
    return () => void off();
  }, [adapter]);
  useEffect(() => {
    const el = rootRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const k = width / DEFAULT_SLIDE.width;

  const onDown = (e: React.PointerEvent, s: MockShape, mode: Drag["mode"]) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: s.id, mode, sx: e.clientX, sy: e.clientY, o: { left: s.left, top: s.top, width: s.width, height: s.height } };
    if (adapter.selection[0] !== s.id) adapter.select([s.id]);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / k;
    const dy = (e.clientY - d.sy) / k;
    adapter.patch(d.id, (s) => {
      if (d.mode === "move") {
        s.left = d.o.left + dx;
        s.top = d.o.top + dy;
      } else {
        s.width = Math.max(20, d.o.width + dx);
        s.height = Math.max(20, d.o.height + dy);
      }
    });
  };
  const onUp = () => {
    drag.current = null;
  };

  const src = (s: MockShape) =>
    s.kind === "png" ? `data:image/png;base64,${s.data}` : s.kind === "svg" ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.data)}` : undefined;

  return (
    <div ref={rootRef} className="w-full">
      <div
        data-testid="mock-slide"
        className="relative overflow-hidden bg-white shadow-[0_0_0_1px_rgba(0,0,0,.2)]"
        style={{ width, height: DEFAULT_SLIDE.height * k }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerDown={() => adapter.select([])}
      >
        {adapter.shapes.map((s) => {
          const sel = adapter.selection.includes(s.id);
          return (
            <div
              key={s.id}
              data-shape-id={s.id}
              data-part={s.tags.SLIDEMAP_PART}
              title={s.name}
              onPointerDown={(e) => onDown(e, s, "move")}
              className="absolute cursor-move"
              style={{
                left: s.left * k,
                top: s.top * k,
                width: s.width * k,
                height: s.height * k,
                transform: s.textStyle?.rotation ? `rotate(${s.textStyle.rotation}deg)` : undefined,
                outline: sel ? "1.5px solid #2563eb" : s.kind === "group" ? "1px dashed #9ca3af" : undefined,
              }}
            >
              {src(s) && <img src={src(s)} alt="" draggable={false} className="pointer-events-none size-full select-none" style={{ objectFit: "fill" }} />}
              {s.kind === "text" && (
                <div
                  className="pointer-events-none size-full whitespace-nowrap"
                  style={{
                    fontSize: (s.textStyle?.fontSizePt ?? 9) * k,
                    color: s.textStyle?.color,
                    fontWeight: s.textStyle?.bold ? 700 : 400,
                    textAlign: s.textStyle?.align === "Left" ? "left" : "center",
                    lineHeight: `${s.height * k}px`,
                  }}
                >
                  {s.data}
                </div>
              )}
              {sel && (
                <span
                  onPointerDown={(e) => onDown(e, s, "resize")}
                  className="absolute -right-1 -bottom-1 size-2.5 cursor-nwse-resize rounded-sm border border-blue-600 bg-white"
                />
              )}
            </div>
          );
        })}
        {adapter.shapes.length === 0 && <p className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground">슬라이드가 비어 있습니다</p>}
      </div>
    </div>
  );
}
