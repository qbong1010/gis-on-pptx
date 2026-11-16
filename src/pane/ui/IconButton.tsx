import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

/** 아이콘 전용 버튼 — label 이 title 과 aria-label 을 겸한다 (접근성). 포커스 링·hover 일관 */
export function IconButton({
  label,
  children,
  className,
  size = "md",
  danger,
  active,
  ref,
  ...p
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  label: string;
  children: ReactNode;
  size?: "sm" | "md";
  danger?: boolean;
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      {...p}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-35",
        size === "sm" ? "size-6" : "size-7",
        danger && "text-destructive",
        active && "bg-primary text-primary-foreground hover:bg-primary/90",
        className,
      )}
    >
      {children}
    </button>
  );
}
