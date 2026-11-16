import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 작은 선택지 버튼 묶음 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: {
  options: { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="group" className={cn("flex w-full overflow-hidden rounded-md border border-border", className)}>
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          title={o.title}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "h-7 flex-1 truncate border-r border-border px-1 text-[12px] transition-colors last:border-r-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            value === o.id ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-accent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
