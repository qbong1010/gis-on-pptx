import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 접이식 구역 (헤더 오른쪽에 액션 슬롯) */
export function Section({
  title,
  children,
  defaultOpen = true,
  right,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("border-b border-border", className)}>
      <div className="flex items-center gap-1 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-[12px] font-semibold">
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
          <span className="truncate">{title}</span>
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <p className="text-[13px] font-medium">{title}</p>
      {children && <div className="text-[12px] leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}
