import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type TabDef<T extends string> = { id: T; label: string; icon?: ReactNode; badge?: string | number };

export const tabId = (id: string) => `tab-${id}`;
export const panelId = (id: string) => `panel-${id}`;

/** 상단 탭 막대 (패널 폭 340px 에서도 한 줄). ←/→/Home/End 로 이동 (WAI-ARIA tabs) */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: TabDef<T>[]; value: T; onChange: (v: T) => void }) {
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[n].id);
    setTimeout(() => document.getElementById(tabId(tabs[n].id))?.focus(), 0);
  };
  return (
    <div role="tablist" aria-label="편집 구역" onKeyDown={onKey} className="flex shrink-0 border-b border-border bg-background px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          id={tabId(t.id)}
          role="tab"
          aria-selected={value === t.id}
          aria-controls={panelId(t.id)}
          tabIndex={value === t.id ? 0 : -1}
          data-tab={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "relative flex flex-1 items-center justify-center gap-1 px-1 py-2 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            value === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.icon}
          <span className="truncate">{t.label}</span>
          {t.badge !== undefined && t.badge !== 0 && <span className="rounded-full bg-secondary px-1.5 text-[11px] leading-4 text-muted-foreground">{t.badge}</span>}
          {value === t.id && <span className="absolute inset-x-2 bottom-[-1px] h-[2px] rounded bg-primary" />}
        </button>
      ))}
    </div>
  );
}
