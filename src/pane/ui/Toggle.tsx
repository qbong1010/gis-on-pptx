import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 스위치 + 라벨. disabled 일 때는 reason 을 tooltip 으로 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  reason,
  className,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  reason?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <label
      title={disabled ? reason : undefined}
      className={cn("flex min-h-6 cursor-pointer select-none items-center gap-2 text-[12px]", disabled && "cursor-not-allowed opacity-50", className)}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        aria-label={typeof label === "string" ? label : undefined}
        className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", checked ? "bg-primary" : "bg-input")}
      >
        <span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow transition-all", checked ? "left-[14px]" : "left-0.5")} />
      </button>
      {label !== undefined && <span className="min-w-0 truncate">{label}</span>}
    </label>
  );
}
