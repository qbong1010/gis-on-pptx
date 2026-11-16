import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** 슬라이더 + 숫자 표시 (+ 단위). 드래그 중 갱신은 ~60ms 로 묶어 미리보기 다시 그리기를 줄인다 (M10) */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  className,
  digits,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  className?: string;
  digits?: number;
  label?: string;
}) {
  const d = digits ?? (step < 1 ? (step < 0.1 ? 2 : 1) : 0);
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const cb = useRef(onChange);
  cb.current = onChange;
  // 바깥에서 값이 바뀌면(프리셋 적용 등) 따라간다
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        cb.current(latest.current); // 언마운트 직전 마지막 값 반영
      }
    },
    [],
  );
  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      cb.current(latest.current);
    }
  };
  const push = (v: number) => {
    setLocal(v);
    latest.current = v;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      cb.current(latest.current);
    }, 60);
  };
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        aria-label={label}
        onChange={(e) => push(Number(e.target.value))}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => {
          dragging.current = false;
          flush();
        }}
        onBlur={() => {
          dragging.current = false;
          flush();
        }}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[oklch(0.205_0_0)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <span className="w-[44px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {local.toFixed(d)}
        {unit}
      </span>
    </div>
  );
}
