import { cn } from "@/lib/utils";

export const SWATCHES = ["#111827", "#6b7280", "#ffffff", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#9333ea", "#db2777"];

/** 색상 선택: 팔레트 스워치 + 네이티브 color input */
export function ColorInput({ value, onChange, className }: { value: string; onChange: (c: string) => void; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap gap-[3px]">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`색 ${c}`}
            aria-pressed={value.toLowerCase() === c}
            onClick={() => onChange(c)}
            className={cn("size-[16px] rounded-[3px] border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring", value.toLowerCase() === c ? "border-foreground ring-1 ring-foreground" : "border-border")}
            style={{ background: c }}
          />
        ))}
      </div>
      <label className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border focus-within:outline-2 focus-within:outline-ring" title="직접 선택" style={{ background: value }}>
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          aria-label="색 직접 선택"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
