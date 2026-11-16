import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type TabDef<T extends string> = { id: T; label: string; icon?: ReactNode; badge?: string | number };

/** 상단 탭 막대 (패널 폭 340px 에서도 한 줄) */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: TabDef<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex border-b border-border bg-background px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          data-tab={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "relative flex flex-1 items-center justify-center gap-1 px-1 py-2 text-[12px] font-medium transition-colors",
            value === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.icon}
          <span className="truncate">{t.label}</span>
          {t.badge !== undefined && t.badge !== 0 && (
            <span className="rounded-full bg-secondary px-1.5 text-[10px] leading-4 text-muted-foreground">{t.badge}</span>
          )}
          {value === t.id && <span className="absolute inset-x-2 bottom-[-1px] h-[2px] rounded bg-primary" />}
        </button>
      ))}
    </div>
  );
}
