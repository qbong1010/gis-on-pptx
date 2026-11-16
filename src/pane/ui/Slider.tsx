import { cn } from "@/lib/utils";

/** 슬라이더 + 숫자 표시 (+ 단위) */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  className,
  digits,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  className?: string;
  digits?: number;
}) {
  const d = digits ?? (step < 1 ? (step < 0.1 ? 2 : 1) : 0);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[oklch(0.205_0_0)]"
      />
      <span className="w-[44px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {value.toFixed(d)}
        {unit}
      </span>
    </div>
  );
}
