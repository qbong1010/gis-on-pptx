import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 라벨 + 컨트롤 한 줄 (라벨 고정폭, 컨트롤 가변) */
export function Field({ label, children, hint, className, stack }: { label: string; children: ReactNode; hint?: string; className?: string; stack?: boolean }) {
  return (
    <div className={cn("py-1", className)}>
      <div className={cn(stack ? "space-y-1" : "flex items-center gap-2")}>
        <label className={cn("shrink-0 text-[12px] text-muted-foreground", !stack && "w-[68px]")}>{label}</label>
        <div className={cn("min-w-0", !stack && "flex-1")}>{children}</div>
      </div>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  );
}
