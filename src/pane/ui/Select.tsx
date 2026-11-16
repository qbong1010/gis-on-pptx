import type { ReactNode, SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      {...p}
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
    >
      {children}
    </select>
  );
}
